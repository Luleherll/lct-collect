// Owner-only migration of Firebase Functions to a dedicated build identity.
// The default build account and its existing roles are never delegated or removed.
const {
  config,
  functions,
  accountEmail,
  waitOperation,
  authenticate,
  client,
  updatePolicy,
} = require('./firebase-deployment.cjs');
function buildPlan(project) {
  config(project);
  const account = `lct-functions-build@${project}.iam.gserviceaccount.com`;
  return {
    project,
    account,
    role: 'roles/cloudbuild.builds.builder',
    functions: functions.map((fn) => `${fn.name}(${fn.region})`),
    updateMask: 'buildConfig.serviceAccount',
  };
}
async function configureBuild(project, makeClient = client) {
  const settings = config(project);
  const plan = buildPlan(project);
  const resource = `projects/${project}/serviceAccounts/${plan.account}`;
  const backend = makeClient('cloudfunctions', 'v2');
  // Validate every target before provisioning the identity or changing a build.
  const deployed = await Promise.all(
    functions.map(async (fn) => {
      const name = `projects/${project}/locations/${fn.region}/functions/${fn.name}`;
      const current = (await backend.get('/' + name)).body;
      if (
        current.state !== 'ACTIVE' ||
        current.serviceConfig?.serviceAccountEmail !== settings.runtime
      )
        throw new Error(
          `Initialize ${fn.name} as the owner before configuring its build identity.`,
        );
      accountEmail(current.buildConfig?.serviceAccount, settings);
      return { name, current };
    }),
  );
  const iam = makeClient('iam');
  try {
    await iam.post(`/projects/${project}/serviceAccounts`, {
      accountId: 'lct-functions-build',
      serviceAccount: { displayName: 'LCT Firebase Functions builds' },
    });
  } catch (error) {
    if (error.status !== 409) throw error;
  }
  const manager = makeClient('cloudresourcemanager');
  const policy = (
    await manager.post(`/projects/${project}:getIamPolicy`, {
      options: { requestedPolicyVersion: 3 },
    })
  ).body;
  const unexpected = (policy.bindings || []).filter(
    (b) =>
      b.members?.includes(`serviceAccount:${plan.account}`) &&
      b.role !== plan.role,
  );
  if (unexpected.length)
    throw new Error(
      'The dedicated build account already has other project roles; review them before using it.',
    );
  await updatePolicy(
    manager,
    `/projects/${project}`,
    plan.role,
    `serviceAccount:${plan.account}`,
  );
  const updated = await Promise.all(
    deployed.map(async ({ name, current }) => {
      if (
        accountEmail(current.buildConfig.serviceAccount, settings) ===
        plan.account
      )
        return false;
      const operation = (
        await backend.patch(
          '/' + name,
          { name, buildConfig: { serviceAccount: resource } },
          { queryParams: { updateMask: plan.updateMask } },
        )
      ).body;
      await waitOperation(backend, operation, { attempts: 180 });
      return true;
    }),
  );
  return { account: plan.account, updated: updated.filter(Boolean).length };
}
async function main() {
  const args = process.argv.slice(2);
  const at = args.indexOf('--project');
  const project = at >= 0 ? args[at + 1] : undefined;
  if (
    args.some(
      (value, i) => i !== at + 1 && !['--project', '--apply'].includes(value),
    )
  )
    throw new Error('Use --project PROJECT [--apply].');
  console.log(JSON.stringify(buildPlan(project), null, 2));
  if (!args.includes('--apply')) {
    console.log(
      'Dry-run only. No accounts, permissions or Functions were changed.',
    );
    return;
  }
  await authenticate(project);
  const result = await configureBuild(project);
  console.log(
    `Dedicated Firebase build identity configured: ${result.account}; ${result.updated} Functions updated. Rerun owner setup to grant deployment use of this account.`,
  );
}
module.exports = { buildPlan, configureBuild };
if (require.main === module)
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });

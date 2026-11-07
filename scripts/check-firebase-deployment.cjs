// Read-only readiness check, using the same identity that will deploy the release.
const {
  config,
  functions,
  services,
  accountEmail,
  hasGrant,
  authenticate,
  client,
} = require('./firebase-deployment.cjs');
async function checkDeployment(project, makeClient = client) {
  if (process.env.FIREBASE_SKIP_INFORMATIONAL_IAM)
    throw new Error(
      'Deployment readiness must run with real IAM checks enabled.',
    );
  const settings = config(project);
  const usage = makeClient('serviceusage');
  for (const name of services) {
    const service = (
      await usage.get(`/projects/${settings.number}/services/${name}`)
    ).body;
    if (service.state !== 'ENABLED')
      throw new Error(
        `Production setup incomplete: enable ${name} through owner setup.`,
      );
  }
  const backend = makeClient('cloudfunctions', 'v2');
  const secrets = makeClient('secretmanager');
  let pageToken;
  let enabledSecret = false;
  do {
    const versions = (
      await secrets.get(
        `/projects/${project}/secrets/REMINDER_SIGNING_KEY/versions`,
        { queryParams: { pageToken } },
      )
    ).body;
    enabledSecret ||= (versions.versions || []).some(
      (version) => version.state === 'ENABLED',
    );
    pageToken = versions.nextPageToken;
  } while (pageToken && !enabledSecret);
  if (!enabledSecret)
    throw new Error(
      'The reminder signing secret needs an enabled version before release.',
    );
  const run = makeClient('run');
  const iam = makeClient('iam');
  const buildAccounts = new Set();
  for (const fn of functions) {
    const path = `/projects/${project}/locations/${fn.region}/functions/${fn.name}`;
    const deployed = (await backend.get(path)).body;
    if (
      deployed.state !== 'ACTIVE' ||
      deployed.serviceConfig?.serviceAccountEmail !== settings.runtime
    )
      throw new Error(
        `Initialize ${fn.name} with the correct Firebase runtime before releasing.`,
      );
    buildAccounts.add(
      accountEmail(deployed.buildConfig?.serviceAccount, settings),
    );
    const service = deployed.serviceConfig.service;
    const expected = `projects/${project}/locations/${fn.region}/services/${fn.name.toLowerCase()}`;
    if (service !== expected)
      throw new Error(`Unexpected service resource for ${fn.name}.`);
    const policy = (await run.get('/' + service + ':getIamPolicy')).body;
    if (fn.http && !hasGrant(policy, 'roles/run.invoker', 'allUsers'))
      throw new Error(
        `Owner setup must configure HTTP invocation for ${fn.name}; Auth/signed-ticket checks remain in the handler.`,
      );
    const permissions = [
      'run.services.getIamPolicy',
      'run.services.setIamPolicy',
    ];
    const result = (
      await run.post('/' + service + ':testIamPermissions', { permissions })
    ).body;
    if (
      !permissions.every((permission) =>
        result.permissions?.includes(permission),
      )
    )
      throw new Error(
        `Deployment identity lacks scoped service permissions for ${fn.name}. Rerun owner setup.`,
      );
  }
  for (const account of new Set([settings.runtime, ...buildAccounts])) {
    const result = (
      await iam.post(
        `/projects/${project}/serviceAccounts/${account}:testIamPermissions`,
        { permissions: ['iam.serviceAccounts.actAs'] },
      )
    ).body;
    if (!result.permissions?.includes('iam.serviceAccounts.actAs'))
      throw new Error(
        `Deployment identity cannot use ${account}. Rerun owner setup.`,
      );
  }
  return { functions: functions.length, buildAccounts: [...buildAccounts] };
}
if (require.main === module) {
  const project = process.env.FIREBASE_PROJECT_ID;
  Promise.resolve()
    .then(async () => {
      config(project);
      await authenticate(project);
      const result = await checkDeployment(project);
      console.log(
        `Firebase readiness passed for ${project}: ${result.functions} active Functions, runtime/build access, and invocation policies.`,
      );
    })
    .catch((error) => {
      console.error(`Firebase deployment is not ready: ${error.message}`);
      process.exitCode = 1;
    });
}
module.exports = { checkDeployment };

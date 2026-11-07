// Trusted owner bootstrap. Dry-run by default; never called by a release/preview.
const fs = require('node:fs');
const crypto = require('node:crypto');
const { parseEnv } = require('node:util');
const {
  config,
  functions,
  services,
  accountEmail,
  waitOperation,
  isMissing,
  authenticate,
  client,
  updatePolicy,
} = require('./firebase-deployment.cjs');
const deployRoles = [
  'roles/firebasehosting.admin',
  'roles/firebaserules.admin',
  'roles/datastore.indexAdmin',
  'roles/serviceusage.serviceUsageConsumer',
  'roles/cloudfunctions.developer',
  'roles/cloudscheduler.admin',
  'roles/serviceusage.serviceUsageViewer',
  'roles/artifactregistry.reader',
];
function options(args) {
  const result = { apply: false };
  for (let i = 0; i < args.length; i++) {
    const name = args[i];
    if (name === '--apply') {
      result.apply = true;
      continue;
    }
    if (name === '--allow-privileged-build-account') {
      result.allowPrivilegedBuildAccount = true;
      continue;
    }
    if (
      ![
        '--project',
        '--billing-account',
        '--firebase-config',
        '--public-vapid-key',
      ].includes(name) ||
      !args[i + 1] ||
      args[i + 1].startsWith('--')
    )
      throw new Error(
        'Use --project PROJECT [--billing-account ACCOUNT] [--firebase-config PATH] [--public-vapid-key PUBLIC_KEY] [--allow-privileged-build-account] [--apply].',
      );
    result[name.slice(2)] = args[++i];
  }
  config(result.project);
  if (
    result['billing-account'] &&
    !/^[0-9A-F]{6}(-[0-9A-F]{6}){2}$/.test(result['billing-account'])
  )
    throw new Error('Billing account format must be XXXXXX-XXXXXX-XXXXXX.');
  if (result['public-vapid-key'])
    validatePublicKey(result['public-vapid-key'], result.project);
  return result;
}
function validatePublicKey(key, project) {
  const bytes = Buffer.from(key, 'base64url');
  if (!/^[A-Za-z0-9_-]{87}$/.test(key) || bytes.length !== 65 || bytes[0] !== 4)
    throw new Error(
      'Provide the public Web Push key from this Firebase project.',
    );
  crypto.ECDH.convertKey(bytes, 'prime256v1');
  if (project === 'lct-collect-prod') {
    const stagingKey = parseEnv(
      fs.readFileSync('.env.example', 'utf8'),
    ).PUBLIC_FIREBASE_VAPID_KEY;
    if (key === stagingKey)
      throw new Error(
        'Production needs its own Web Push key; the staging key cannot be reused.',
      );
  }
}
function plan(settings, billingAccount) {
  return {
    project: settings.project,
    billing: billingAccount
      ? `Link Firebase Blaze billing account ${billingAccount}`
      : 'Require enabled Blaze billing; do not change the billing account',
    enableServices: services,
    runtime: {
      account: settings.runtime,
      projectRoles: [
        'roles/datastore.user',
        'roles/firebasecloudmessaging.admin',
      ],
    },
    deploy: { account: settings.deploy, projectRoles: deployRoles },
    build:
      'Discover real regional build accounts; grant roles/cloudbuild.builds.builder, never Editor. Existing project Owner/Editor requires --allow-privileged-build-account after review.',
    actAs:
      'Service Account User for the deploy identity on the runtime and discovered build accounts only',
    servicePolicies: functions.map((fn) => ({
      service: `projects/${settings.project}/locations/${fn.region}/services/${fn.name.toLowerCase()}`,
      deployRole: 'roles/run.admin',
      ...(fn.http
        ? {
            invocation:
              'allUsers: roles/run.invoker; application Auth or signed tickets still required',
          }
        : {}),
    })),
    secret:
      'Create an enabled REMINDER_SIGNING_KEY without exposing its value; preserve existing keys',
    initialDeployment:
      'If Functions are missing, deploy the reminders codebase once as owner, then rerun setup for the service policies',
  };
}
async function ensureSecret(api, settings, randomBytes = crypto.randomBytes) {
  const path = `/projects/${settings.project}/secrets/REMINDER_SIGNING_KEY`;
  try {
    await api.get(path);
  } catch (error) {
    if (!isMissing(error)) throw error;
    await api.post(
      `/projects/${settings.project}/secrets`,
      { replication: { automatic: {} } },
      { queryParams: { secretId: 'REMINDER_SIGNING_KEY' } },
    );
  }
  const versions = [];
  let pageToken;
  do {
    const response = (
      await api.get(path + '/versions', {
        queryParams: pageToken ? { pageToken } : {},
      })
    ).body;
    versions.push(...(response.versions || []));
    pageToken = response.nextPageToken;
  } while (pageToken);
  if (!versions.some((version) => version.state === 'ENABLED')) {
    // Recover an empty partially-created secret, but never silently rotate an old key.
    if (versions.length)
      throw new Error(
        'Signing secret has no enabled version. Restore an approved version before continuing.',
      );
    await api.post(
      path + ':addVersion',
      {
        payload: {
          data: Buffer.from(randomBytes(48).toString('base64url')).toString(
            'base64',
          ),
        },
      },
      { skipLog: { body: true, resBody: true } },
    );
  }
  for (const [role, member] of [
    [
      'roles/secretmanager.secretAccessor',
      `serviceAccount:${settings.runtime}`,
    ],
    ['roles/secretmanager.viewer', `serviceAccount:${settings.deploy}`],
  ])
    await updatePolicy(api, path, role, member, { get: true });
}
async function bootstrap(opts, makeClient = client) {
  const settings = config(opts.project);
  const member = `serviceAccount:${settings.deploy}`;
  const billing = makeClient('cloudbilling');
  const billingInfo = (
    await billing.get(`/projects/${settings.project}/billingInfo`)
  ).body;
  if (opts['billing-account']) {
    await billing.put(`/projects/${settings.project}/billingInfo`, {
      billingAccountName: 'billingAccounts/' + opts['billing-account'],
    });
    const linked = (
      await billing.get(`/projects/${settings.project}/billingInfo`)
    ).body;
    if (!linked.billingEnabled)
      throw new Error(
        'Enable Firebase Blaze billing before provisioning Functions.',
      );
  } else if (!billingInfo.billingEnabled) {
    throw new Error(
      'Enable Firebase Blaze or explicitly select --billing-account before applying setup.',
    );
  }
  const usage = makeClient('serviceusage');
  const operation = (
    await usage.post(`/projects/${settings.number}/services:batchEnable`, {
      serviceIds: services,
    })
  ).body;
  await waitOperation(usage, operation);
  console.log('Required Firebase backend services are enabled.');
  const iam = makeClient('iam');
  try {
    await iam.post(`/projects/${settings.project}/serviceAccounts`, {
      accountId: 'lct-reminders',
      serviceAccount: { displayName: 'LCT private note reminders' },
    });
  } catch (error) {
    if (error.status !== 409) throw error;
  }
  const manager = makeClient('cloudresourcemanager');
  for (const role of [
    'roles/datastore.user',
    'roles/firebasecloudmessaging.admin',
  ])
    await updatePolicy(
      manager,
      `/projects/${settings.project}`,
      role,
      `serviceAccount:${settings.runtime}`,
    );
  for (const role of deployRoles)
    await updatePolicy(manager, `/projects/${settings.project}`, role, member);
  await updatePolicy(
    manager,
    `/projects/${settings.project}`,
    'roles/artifactregistry.admin',
    member,
    {
      condition: {
        title: 'LCT reminder build images',
        expression: "resource.name.endsWith('/repositories/gcf-artifacts')",
      },
    },
  );
  await updatePolicy(
    iam,
    `/projects/${settings.project}/serviceAccounts/${settings.runtime}`,
    'roles/iam.serviceAccountUser',
    member,
  );
  await ensureSecret(makeClient('secretmanager'), settings);
  const buildAccounts = new Set();
  const pending = [];
  const backend = makeClient('cloudfunctions', 'v2');
  const run = makeClient('run');
  for (const fn of functions) {
    let deployed;
    try {
      deployed = (
        await backend.get(
          `/projects/${settings.project}/locations/${fn.region}/functions/${fn.name}`,
        )
      ).body;
    } catch (error) {
      if (!isMissing(error)) throw error;
      pending.push(fn.name);
      continue;
    }
    if (deployed.serviceConfig?.serviceAccountEmail !== settings.runtime)
      throw new Error(
        `Unexpected runtime on ${fn.name}; review it before changing permissions.`,
      );
    if (deployed.buildConfig?.serviceAccount)
      buildAccounts.add(
        accountEmail(deployed.buildConfig.serviceAccount, settings),
      );
    const path = '/' + deployed.serviceConfig.service;
    if (
      path !==
      `/projects/${settings.project}/locations/${fn.region}/services/${fn.name.toLowerCase()}`
    )
      throw new Error(`Unexpected managed service for ${fn.name}.`);
    await updatePolicy(run, path, 'roles/run.admin', member, { get: true });
    if (fn.http)
      await updatePolicy(run, path, 'roles/run.invoker', 'allUsers', {
        get: true,
      });
  }
  if (pending.length) {
    const build = makeClient('cloudbuild');
    for (const region of new Set(functions.map((fn) => fn.region))) {
      const result = (
        await build.get(
          `/projects/${settings.project}/locations/${region}/defaultServiceAccount`,
        )
      ).body;
      buildAccounts.add(accountEmail(result.serviceAccountEmail, settings));
    }
  }
  if (!buildAccounts.size)
    throw new Error(
      'No Functions build account was discovered; setup is incomplete.',
    );
  for (const account of buildAccounts) {
    await iam.get(`/projects/${settings.project}/serviceAccounts/${account}`);
    const currentPolicy = (
      await manager.post(`/projects/${settings.project}:getIamPolicy`, {
        options: { requestedPolicyVersion: 3 },
      })
    ).body;
    const privileged = (currentPolicy.bindings || [])
      .filter(
        (binding) =>
          ['roles/editor', 'roles/owner'].includes(binding.role) &&
          binding.members?.includes(`serviceAccount:${account}`),
      )
      .map((binding) => binding.role);
    if (privileged.length && !opts.allowPrivilegedBuildAccount)
      throw new Error(
        `Build account ${account} has ${privileged.join(', ')}. Review those privileges; --allow-privileged-build-account is required before delegating use of it.`,
      );
    await updatePolicy(
      manager,
      `/projects/${settings.project}`,
      'roles/cloudbuild.builds.builder',
      `serviceAccount:${account}`,
    );
    await updatePolicy(
      iam,
      `/projects/${settings.project}/serviceAccounts/${account}`,
      'roles/iam.serviceAccountUser',
      member,
    );
  }
  if (opts['public-vapid-key']) {
    const file = settings.project.endsWith('-prod')
      ? '.env.production.example'
      : '.env.example';
    const text = fs.readFileSync(file, 'utf8');
    const line = `PUBLIC_FIREBASE_VAPID_KEY=${opts['public-vapid-key']}`;
    fs.writeFileSync(
      file,
      /^PUBLIC_FIREBASE_VAPID_KEY=.*$/m.test(text)
        ? text.replace(/^PUBLIC_FIREBASE_VAPID_KEY=.*$/m, line)
        : text + '\n' + line + '\n',
    );
  }
  return { pending, buildAccounts: [...buildAccounts] };
}
async function main() {
  const opts = options(process.argv.slice(2));
  console.log(
    JSON.stringify(
      plan(config(opts.project), opts['billing-account']),
      null,
      2,
    ),
  );
  if (!opts.apply) {
    console.log(
      'Dry-run only. No authentication, billing, IAM, or Firebase changes were made.',
    );
    return;
  }
  await authenticate(opts.project, opts['firebase-config']);
  const result = await bootstrap(opts);
  console.log('Verified build identities:', result.buildAccounts.join(', '));
  if (result.pending.length) {
    console.log(
      `Prerequisites provisioned. Initialize Functions once as owner: ${result.pending.join(', ')}.`,
    );
    console.log(
      `Run the Firebase CLI deploy for --only functions:reminders --project ${opts.project}, then rerun setup --apply to configure service policies.`,
    );
    process.exitCode = 2;
  } else
    console.log(
      'Owner setup complete. Run the deployment readiness check before release.',
    );
}
module.exports = { options, validatePublicKey, plan, ensureSecret, bootstrap };
if (require.main === module)
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });

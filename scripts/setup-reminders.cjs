// Trusted owner bootstrap; dry-run unless --apply. Never runs in the browser or PR preview workflow.
const fs = require('fs'),
  crypto = require('crypto'),
  path = require('path'),
  os = require('os');
const option = (name) => {
  const at = process.argv.indexOf(name);
  return at < 0 ? undefined : process.argv[at + 1];
};
const project = option('--project');
const number = {
  'lct-collect-staging': '679421917255',
  'lct-collect-prod': '275805072037',
}[project];
const billingAccount = option('--billing-account');
if (!number || !/^[0-9A-F]{6}(-[0-9A-F]{6}){2}$/.test(billingAccount || ''))
  throw new Error(
    'Use --project lct-collect-staging|lct-collect-prod --billing-account XXXXXX-XXXXXX-XXXXXX [--apply].',
  );
if (!process.argv.includes('--apply')) {
  console.log(
    'Would link billing and provision the isolated reminder identity, APIs, deployment roles and signing secret for',
    project,
  );
  process.exit(0);
}
process.env.GOOGLE_CLOUD_QUOTA_PROJECT = project;
const {
  setRefreshToken,
} = require('../node_modules/firebase-tools/lib/auth.js');
const {
  Client: BaseClient,
} = require('../node_modules/firebase-tools/lib/apiv2.js');
class Client extends BaseClient {
  post(path, options = {}) {
    const { body = {}, ...rest } = options;
    return super.post(path, body, rest);
  }
  put(path, options = {}) {
    const { body = {}, ...rest } = options;
    return super.put(path, body, rest);
  }
}
setRefreshToken(
  JSON.parse(
    fs.readFileSync(
      option('--firebase-config') ||
        path.join(
          process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'),
          'configstore/firebase-tools.json',
        ),
      'utf8',
    ),
  ).tokens.refresh_token,
);
const client = (host, version = 'v1') =>
  new Client({
    urlPrefix: `https://${host}.googleapis.com`,
    apiVersion: version,
  });
const runtime = `lct-reminders@${project}.iam.gserviceaccount.com`,
  deploy = `lct-github-${project.endsWith('-prod') ? 'prod' : 'staging'}@${project}.iam.gserviceaccount.com`;
(async () => {
  const billing = client('cloudbilling');
  await billing.put(`/projects/${project}/billingInfo`, {
    body: { billingAccountName: 'billingAccounts/' + billingAccount },
  });
  console.log('Reminder billing linked.');
  const services = client('serviceusage');
  await services.post(`/projects/${number}/services:batchEnable`, {
    body: {
      serviceIds: [
        'cloudfunctions.googleapis.com',
        'cloudscheduler.googleapis.com',
        'run.googleapis.com',
        'cloudbuild.googleapis.com',
        'artifactregistry.googleapis.com',
        'secretmanager.googleapis.com',
        'fcm.googleapis.com',
        'fcmregistrations.googleapis.com',
        'firebaseinstallations.googleapis.com',
        'billingbudgets.googleapis.com',
      ],
    },
  });
  console.log('Requested reminder APIs.');
  const iam = client('iam');
  try {
    await iam.post(`/projects/${project}/serviceAccounts`, {
      body: {
        accountId: 'lct-reminders',
        serviceAccount: { displayName: 'LCT private note reminders' },
      },
    });
  } catch (e) {
    if (e.status !== 409) throw e;
  }
  console.log('Reminder runtime identity ready.');
  const manager = client('cloudresourcemanager');
  const policy = (
    await manager.post(`/projects/${project}:getIamPolicy`, {
      body: { options: { requestedPolicyVersion: 3 } },
    })
  ).body;
  const add = (role, member) => {
    let b = policy.bindings.find((b) => b.role === role && !b.condition);
    if (!b) {
      b = { role, members: [] };
      policy.bindings.push(b);
    }
    if (!b.members.includes(member)) b.members.push(member);
  };
  for (const role of [
    'roles/datastore.user',
    'roles/firebasecloudmessaging.admin',
  ])
    add(role, `serviceAccount:${runtime}`);
  for (const role of [
    'roles/cloudfunctions.developer',
    'roles/cloudscheduler.admin',
    'roles/serviceusage.serviceUsageViewer',
    'roles/artifactregistry.reader',
  ])
    add(role, `serviceAccount:${deploy}`);
  // Creating/updating managed HTTP functions requires permission to maintain their invocation policy.
  const runCondition = {
    title: 'LCT reminder services',
    expression: [
      'managenote',
      'registerreminderdevice',
      'validatereminder',
      'dispatchreminders',
    ]
      .map((name) => `resource.name.endsWith('/services/${name}')`)
      .join(' || '),
  };
  if (
    !policy.bindings.some(
      (b) =>
        b.role === 'roles/run.admin' &&
        b.condition?.title === runCondition.title,
    )
  )
    policy.bindings.push({
      role: 'roles/run.admin',
      members: [`serviceAccount:${deploy}`],
      condition: runCondition,
    });
  if (
    !policy.bindings.some(
      (b) =>
        b.role === 'roles/artifactregistry.admin' &&
        b.condition?.title === 'LCT reminder build images',
    )
  )
    policy.bindings.push({
      role: 'roles/artifactregistry.admin',
      members: [`serviceAccount:${deploy}`],
      condition: {
        title: 'LCT reminder build images',
        expression: "resource.name.endsWith('/repositories/gcf-artifacts')",
      },
    });
  policy.version = 3;
  await manager.post(`/projects/${project}:setIamPolicy`, { body: { policy } });
  console.log('Runtime and staging deploy project roles configured.');
  const saPath = `/projects/${project}/serviceAccounts/${runtime}`;
  let saPolicy = (await iam.post(saPath + ':getIamPolicy', { body: {} })).body;
  saPolicy.bindings ??= [];
  if (
    !saPolicy.bindings.some(
      (b) =>
        b.role === 'roles/iam.serviceAccountUser' &&
        b.members.includes(`serviceAccount:${deploy}`),
    )
  )
    saPolicy.bindings.push({
      role: 'roles/iam.serviceAccountUser',
      members: [`serviceAccount:${deploy}`],
    });
  await iam.post(saPath + ':setIamPolicy', { body: { policy: saPolicy } });
  console.log('Reminder deploy may use only reminder runtime identity.');
  const secret = client('secretmanager');
  const secretPath = `/projects/${project}/secrets/REMINDER_SIGNING_KEY`;
  let exists = true;
  try {
    await secret.get(secretPath);
  } catch (e) {
    if (e.status === 404) exists = false;
    else throw e;
  }
  if (!exists) {
    await secret.post(`/projects/${project}/secrets`, {
      queryParams: { secretId: 'REMINDER_SIGNING_KEY' },
      body: { replication: { automatic: {} } },
    });
    await secret.post(secretPath + ':addVersion', {
      body: {
        payload: {
          data: Buffer.from(
            crypto.randomBytes(48).toString('base64url'),
          ).toString('base64'),
        },
      },
    });
  }
  const secretPolicy = (await secret.get(secretPath + ':getIamPolicy')).body;
  secretPolicy.bindings ??= [];
  for (const [role, member] of [
    ['roles/secretmanager.secretAccessor', `serviceAccount:${runtime}`],
    ['roles/secretmanager.viewer', `serviceAccount:${deploy}`],
  ]) {
    let b = secretPolicy.bindings.find((b) => b.role === role);
    if (!b) {
      b = { role, members: [] };
      secretPolicy.bindings.push(b);
    }
    if (!b.members.includes(member)) b.members.push(member);
  }
  await secret.post(secretPath + ':setIamPolicy', {
    body: { policy: secretPolicy },
  });
  console.log('Signing secret provisioned without exposing its value.');
})().catch((e) => {
  console.error(e.status, e.message);
  process.exitCode = 1;
});

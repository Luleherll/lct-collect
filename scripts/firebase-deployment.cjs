// Shared owner setup and deployment checks; no service-account keys are needed.
const projects = {
  'lct-collect-staging': '679421917255',
  'lct-collect-prod': '275805072037',
};
const functions = [
  { name: 'manageNote', region: 'africa-south1', http: true },
  { name: 'registerReminderDevice', region: 'africa-south1', http: true },
  { name: 'syncOperation', region: 'africa-south1', http: true },
  { name: 'validateReminder', region: 'europe-west1', http: true },
  { name: 'dispatchReminders', region: 'europe-west1', http: false },
];
const services = [
  'cloudfunctions.googleapis.com',
  'cloudscheduler.googleapis.com',
  'run.googleapis.com',
  'eventarc.googleapis.com',
  'pubsub.googleapis.com',
  'storage.googleapis.com',
  'firebaseextensions.googleapis.com',
  'cloudbuild.googleapis.com',
  'artifactregistry.googleapis.com',
  'secretmanager.googleapis.com',
  'fcm.googleapis.com',
  'fcmregistrations.googleapis.com',
  'firebaseinstallations.googleapis.com',
];
function config(project) {
  if (!Object.hasOwn(projects, project))
    throw new Error('Use a known LCT Firebase project.');
  return {
    project,
    number: projects[project],
    runtime: `lct-reminders@${project}.iam.gserviceaccount.com`,
    deploy: `lct-github-${project.endsWith('-prod') ? 'prod' : 'staging'}@${project}.iam.gserviceaccount.com`,
  };
}
function grant(policy, role, member, condition) {
  const next = structuredClone(policy);
  next.bindings ??= [];
  let binding = next.bindings.find(
    (b) =>
      b.role === role &&
      (!b.condition || !condition
        ? b.condition === condition
        : ['expression', 'title', 'description'].every(
            (key) => (b.condition[key] || '') === (condition[key] || ''),
          )),
  );
  if (binding?.members.includes(member))
    return { policy: next, changed: false };
  if (!binding) {
    binding = { role, members: [], ...(condition ? { condition } : {}) };
    next.bindings.push(binding);
  }
  binding.members.push(member);
  if (condition) next.version = 3;
  return { policy: next, changed: true };
}
function hasGrant(policy, role, member) {
  return !!policy.bindings?.some(
    (b) => b.role === role && !b.condition && b.members?.includes(member),
  );
}
function accountEmail(value, settings) {
  if (typeof value !== 'string')
    throw new Error('Functions did not identify their build account.');
  if (
    value.includes('/') &&
    !value.startsWith(`projects/${settings.project}/serviceAccounts/`) &&
    !value.startsWith(`projects/${settings.number}/serviceAccounts/`)
  )
    throw new Error('The Functions build resource belongs to another project.');
  const email = value.replace(/^projects\/[^/]+\/serviceAccounts\//, '');
  if (!(
    (/^[a-z][a-z0-9-]*@/.test(email) &&
      email.endsWith(`@${settings.project}.iam.gserviceaccount.com`)) ||
    [
      `${settings.number}-compute@developer.gserviceaccount.com`,
      `${settings.number}@cloudbuild.gserviceaccount.com`,
    ].includes(email)
  ))
    throw new Error(
      'The Functions build account must belong to the selected project.',
    );
  return email;
}
async function waitOperation(
  api,
  operation,
  { pause = (ms) => new Promise((r) => setTimeout(r, ms)), attempts = 90 } = {},
) {
  let current = operation;
  for (let i = 0; i < attempts; i++) {
    if (current.error)
      throw new Error(
        `Firebase service setup failed: ${current.error.message}`,
      );
    if (current.done) return current;
    if (!current.name)
      throw new Error('Service setup did not return an operation.');
    await pause(2000);
    current = (await api.get('/' + current.name)).body;
  }
  throw new Error(
    'Firebase service setup has not completed; retry after it finishes.',
  );
}
function isMissing(error) {
  return error.status === 404 || error.context?.response?.statusCode === 404;
}
async function authenticate(project, credentialPath) {
  const { getGlobalDefaultAccount } = require('firebase-tools/lib/auth.js');
  const { requireAuth } = require('firebase-tools/lib/requireAuth.js');
  const account = credentialPath
    ? JSON.parse(require('node:fs').readFileSync(credentialPath, 'utf8'))
    : getGlobalDefaultAccount();
  if (credentialPath && (!account?.user || !account?.tokens))
    throw new Error(
      'The selected file must contain a signed-in Firebase CLI account.',
    );
  await requireAuth({ project, ...(account || {}), nonInteractive: true });
}
function client(host, version = 'v1') {
  const { Client } = require('firebase-tools/lib/apiv2.js');
  return new Client({
    urlPrefix: `https://${host}.googleapis.com`,
    apiVersion: version,
  });
}
async function updatePolicy(
  api,
  path,
  role,
  member,
  { condition, get = false } = {},
) {
  const response = get
    ? await api.get(path + ':getIamPolicy', {
        queryParams: { 'options.requestedPolicyVersion': 3 },
      })
    : await api.post(path + ':getIamPolicy', {
        options: { requestedPolicyVersion: 3 },
      });
  const policy = response.body;
  const next = grant(policy, role, member, condition);
  if (next.changed)
    await api.post(path + ':setIamPolicy', { policy: next.policy });
}
module.exports = {
  config,
  functions,
  services,
  grant,
  hasGrant,
  accountEmail,
  waitOperation,
  isMissing,
  authenticate,
  client,
  updatePolicy,
};

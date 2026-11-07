import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseEnv } from 'node:util';

// Firebase CLI's legacy preflight checks the App Engine default account even
// when every deployed function explicitly uses our isolated runtime account.
// Verify the real configuration and permission before opting out of that check.
export function validateRuntime(project, environment, functions) {
  if (!['lct-collect-staging', 'lct-collect-prod'].includes(project))
    throw new Error('A known Firebase deployment project is required.');
  const account = `lct-reminders@${project}.iam.gserviceaccount.com`;
  if (environment.REMINDER_SERVICE_ACCOUNT !== account)
    throw new Error(
      'Functions must use the dedicated runtime for this project.',
    );
  const endpoints = Object.values(functions).map((fn) => fn.__endpoint);
  if (
    !endpoints.length ||
    endpoints.some(
      (endpoint) =>
        endpoint?.platform !== 'gcfv2' ||
        endpoint.serviceAccountEmail?.name !== 'REMINDER_SERVICE_ACCOUNT',
    )
  )
    throw new Error(
      'Every function must explicitly select the dedicated runtime.',
    );
  return account;
}

export async function checkPermission(project, account, testPermission) {
  if (process.env.FIREBASE_SKIP_INFORMATIONAL_IAM)
    throw new Error('The real runtime permission check must not be skipped.');
  const result = await testPermission(
    'https://iam.googleapis.com',
    'v1',
    `projects/${project}/serviceAccounts/${account}`,
    ['iam.serviceAccounts.actAs'],
  );
  if (!result.passed)
    throw new Error(`Deployment identity cannot use the runtime ${account}.`);
}

async function main() {
  const project = process.env.FIREBASE_PROJECT_ID;
  if (!['lct-collect-staging', 'lct-collect-prod'].includes(project))
    throw new Error('A known Firebase deployment project is required.');
  const baseEnv = 'functions/.env';
  const environment = {
    ...(existsSync(baseEnv) ? parseEnv(readFileSync(baseEnv, 'utf8')) : {}),
    ...parseEnv(readFileSync(`functions/.env.${project}`, 'utf8')),
  };
  const functions = await import(
    pathToFileURL(resolve('functions/lib/index.js'))
  );
  const account = validateRuntime(project, environment, functions);
  const require = createRequire(import.meta.url);
  const { authenticate } = require('./firebase-deployment.cjs');
  const {
    testResourceIamPermissions,
  } = require('firebase-tools/lib/gcp/iam.js');
  await authenticate(project);
  await checkPermission(project, account, testResourceIamPermissions);
  console.log(
    `Verified deployment access to Firebase Functions runtime ${account}.`,
  );
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });

import { existsSync } from 'node:fs';
if (existsSync('.env')) process.loadEnvFile('.env');
const e = process.env;
for (const name of [
  'PUBLIC_FIREBASE_API_KEY',
  'PUBLIC_FIREBASE_AUTH_DOMAIN',
  'PUBLIC_FIREBASE_PROJECT_ID',
  'PUBLIC_FIREBASE_APP_ID',
  'PUBLIC_FIREBASE_MESSAGING_SENDER_ID',
])
  if (!e[name]) throw new Error(`Missing build configuration: ${name}`);
if (e.PUBLIC_USE_EMULATORS === 'true')
  throw new Error(
    'Static deployment builds must not enable local emulators. Use dev:emulators for local testing.',
  );
const p = e.PUBLIC_FIREBASE_PROJECT_ID;
if (
  e.PUBLIC_APP_ENV === 'production'
    ? p === 'lct-collect-staging' || p.startsWith('demo-')
    : p !== 'lct-collect-staging'
)
  throw new Error(
    'Firebase project does not match this deployment environment.',
  );
console.log(
  `Validated ${e.PUBLIC_APP_ENV ?? 'staging'} build configuration for ${p}.`,
);

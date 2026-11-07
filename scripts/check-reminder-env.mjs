import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
if (existsSync('.env')) process.loadEnvFile('.env');
const key = process.env.PUBLIC_FIREBASE_VAPID_KEY;
if (!key)
  throw new Error(
    'Configure this environment’s public Firebase Web Push key before deploying reminders.',
  );
const require = createRequire(import.meta.url);
const { validatePublicKey } = require('./setup-reminders.cjs');
validatePublicKey(key, process.env.PUBLIC_FIREBASE_PROJECT_ID);
console.log('Public Web Push configuration is present.');

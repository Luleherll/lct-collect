import { existsSync } from 'node:fs';
if (existsSync('.env')) process.loadEnvFile('.env');
const key = process.env.PUBLIC_FIREBASE_VAPID_KEY;
if (
  !key ||
  !/^[A-Za-z0-9_-]{87}$/.test(key) ||
  Buffer.from(key, 'base64url').length !== 65 ||
  Buffer.from(key, 'base64url')[0] !== 4
)
  throw new Error(
    'Configure this environment’s public Firebase Web Push key before deploying reminders.',
  );
console.log('Public Web Push configuration is present.');

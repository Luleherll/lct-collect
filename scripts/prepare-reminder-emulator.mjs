import { writeFileSync } from 'node:fs';
// Deliberately public dummy value; only the demo emulator reads .secret.local.
writeFileSync(
  'functions/.secret.local',
  'REMINDER_SIGNING_KEY=emulator-only-key-never-use-for-deployment\n',
);

writeFileSync(
  'functions/.env.local',
  'REMINDER_SERVICE_ACCOUNT=emulator-runtime@demo-lct-collect.iam.gserviceaccount.com\n',
);

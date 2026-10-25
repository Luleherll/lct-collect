import { execFileSync } from 'node:child_process';
import {
  appendFileSync,
  lstatSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
const number = process.env.PR_NUMBER;
const sha = process.env.PREVIEW_HEAD_SHA;
if (!/^[1-9][0-9]*$/.test(number ?? '') || !/^[a-f0-9]{40}$/.test(sha ?? '')) {
  throw new Error('A numeric PR number and exact source SHA are required.');
}
if (!process.env.GITHUB_OUTPUT || !process.env.GITHUB_STEP_SUMMARY) {
  throw new Error('GitHub output paths are required.');
}
// Downloaded PR files are static content only. Never execute their config/hooks.
function checkFiles(path) {
  for (const file of readdirSync(path)) {
    const child = join(path, file);
    const info = lstatSync(child);
    if (info.isSymbolicLink() || (!info.isFile() && !info.isDirectory())) {
      throw new Error(
        'Preview artifacts must contain ordinary files/directories.',
      );
    }
    if (file.startsWith('.') || file.startsWith('gha-creds-')) {
      throw new Error(
        'Hidden files and deployment credentials cannot be published.',
      );
    }
    if (info.isDirectory()) checkFiles(child);
  }
}
checkFiles('preview-dist');
const { hosting } = JSON.parse(readFileSync('firebase.json', 'utf8'));
if (!hosting || Array.isArray(hosting))
  throw new Error('Expected one trusted Hosting config.');
const { predeploy, postdeploy, target, site, ...settings } = hosting;
writeFileSync(
  'preview.firebase.json',
  JSON.stringify({
    hosting: {
      ...settings,
      site: 'lct-collect-staging',
      public: 'preview-dist',
    },
  }),
);
const output = execFileSync(
  'npx',
  [
    '-y',
    'firebase-tools@15.34.1',
    'hosting:channel:deploy',
    `pr-${number}`,
    '--config',
    'preview.firebase.json',
    '--project',
    'lct-collect-staging',
    '--expires',
    '7d',
    '--no-authorized-domains',
    '--non-interactive',
    '--json',
  ],
  { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] },
);
const response = JSON.parse(output);
const release = response.result?.['lct-collect-staging'];
const url = release?.url;
if (
  response.status !== 'success' ||
  !/^https:\/\/lct-collect-staging--pr-[0-9]+-[a-z0-9]+\.web\.app$/.test(
    url ?? '',
  )
) {
  throw new Error('Firebase did not return a valid PR preview release.');
}
appendFileSync(process.env.GITHUB_OUTPUT, `url=${url}\n`);
appendFileSync(
  process.env.GITHUB_STEP_SUMMARY,
  `Preview: ${url}\n\nPR #${number} · source ${sha} · version ${release.version}\n`,
);
console.log(`PR #${number}: ${url}`);

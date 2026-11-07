import { describe, expect, it, vi } from 'vitest';
import {
  readFileSync,
  mkdtempSync,
  mkdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import YAML from 'yaml';
import {
  checkPermission,
  validateRuntime,
} from '../scripts/check-functions-runtime.mjs';
const workflow = (name: string) =>
  YAML.parse(readFileSync(`.github/workflows/${name}.yml`, 'utf8'));
describe('deployment boundaries', () => {
  it('keeps the owner setup manifest aligned with all compiled function exports', () => {
    const compiled = spawnSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `
      import * as backend from './functions/lib/index.js';
      import deployment from './scripts/firebase-deployment.cjs';
      const actual = Object.entries(backend).map(([name, fn]) => ({name, region: fn.__endpoint.region[0], http: !fn.__endpoint.scheduleTrigger}));
      console.log(JSON.stringify({actual, expected: deployment.functions}));
    `,
      ],
      { encoding: 'utf8' },
    );
    expect(compiled.status, compiled.stderr).toBe(0);
    const { actual, expected } = JSON.parse(compiled.stdout);
    expect(
      actual.sort((a: { name: string }, b: { name: string }) =>
        a.name.localeCompare(b.name),
      ),
    ).toEqual(
      expected.sort((a: { name: string }, b: { name: string }) =>
        a.name.localeCompare(b.name),
      ),
    );
  });
  it('routes reminder validation to its compiled function in a Hosting-supported region', () => {
    const config = JSON.parse(readFileSync('firebase.json', 'utf8'));
    const rewrite = config.hosting.rewrites.find(
      (rule: { function?: { functionId: string } }) =>
        rule.function?.functionId === 'validateReminder',
    );
    const compiled = spawnSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        "import {validateReminder} from './functions/lib/index.js'; console.log(JSON.stringify(validateReminder.__endpoint.region));",
      ],
      { encoding: 'utf8' },
    );
    expect(compiled.status, compiled.stderr).toBe(0);
    expect(rewrite.function.region).not.toBe('africa-south1');
    expect(JSON.parse(compiled.stdout.trim())).toEqual([
      rewrite.function.region,
    ]);
  });
  it('checks the dedicated runtime before opting out of the CLI default-account check', () => {
    const step = workflow('deploy-staging').jobs.deploy.steps.find(
      (s: { name?: string }) => s.name === 'Deploy reminders backend',
    );
    expect(step.run.trim().split('\n')[0]).toBe(
      'node scripts/check-functions-runtime.mjs',
    );
    expect(step.run).toContain(
      'FIREBASE_SKIP_INFORMATIONAL_IAM=true npx -y firebase-tools@15.34.1 deploy --only functions:reminders',
    );
    expect(workflow('deploy-staging').jobs.deploy.env).not.toHaveProperty(
      'FIREBASE_SKIP_INFORMATIONAL_IAM',
    );
  });
  it('checks production runtime, build access and invocation before deploying rules', () => {
    const w = workflow('deploy-production');
    const steps = w.jobs.deploy.steps;
    const verify = steps.findIndex(
      (s: { name?: string }) => s.name === 'Verify reminder setup',
    );
    const rules = steps.findIndex(
      (s: { name?: string }) => s.name === 'Deploy Firestore rules and indexes',
    );
    expect(verify).toBeLessThan(rules);
    expect(steps[verify].run).toContain(
      'node scripts/check-functions-runtime.mjs',
    );
    expect(steps[verify].run).toContain(
      'node scripts/check-firebase-deployment.cjs',
    );
    expect(steps[verify].env?.FIREBASE_SKIP_INFORMATIONAL_IAM).toBeUndefined();
    expect(w.jobs.deploy.env.FIREBASE_SKIP_INFORMATIONAL_IAM).toBeUndefined();
    const deploy = steps.find(
      (s: { name?: string }) => s.name === 'Deploy reminders backend',
    );
    expect(deploy.run).toMatch(/^FIREBASE_SKIP_INFORMATIONAL_IAM=true npx/);
  });
  it('rejects default or cross-project runtimes for any exported function', () => {
    const project = 'lct-collect-staging';
    const environment = {
      REMINDER_SERVICE_ACCOUNT: `lct-reminders@${project}.iam.gserviceaccount.com`,
    };
    const endpoint = {
      platform: 'gcfv2',
      serviceAccountEmail: { name: 'REMINDER_SERVICE_ACCOUNT' },
    };
    expect(
      validateRuntime(project, environment, {
        manageNote: { __endpoint: endpoint },
      }),
    ).toBe(environment.REMINDER_SERVICE_ACCOUNT);
    for (const unsafe of [
      {},
      { ...endpoint, serviceAccountEmail: undefined },
      { ...endpoint, serviceAccountEmail: { name: 'OTHER_RUNTIME' } },
      { ...endpoint, platform: 'gcfv1' },
    ]) {
      expect(() =>
        validateRuntime(project, environment, {
          manageNote: { __endpoint: endpoint },
          syncOperation: { __endpoint: unsafe },
        }),
      ).toThrow('Every function');
    }
    expect(() => validateRuntime(project, environment, {})).toThrow();
    expect(() =>
      validateRuntime('lct-collect-prod', environment, {
        manageNote: { __endpoint: endpoint },
      }),
    ).toThrow('dedicated runtime');
  });
  it('fails closed when the real runtime permission is denied or unavailable', async () => {
    const project = 'lct-collect-staging';
    const account = `lct-reminders@${project}.iam.gserviceaccount.com`;
    const calls: unknown[][] = [];
    await checkPermission(project, account, async (...args: unknown[]) => {
      calls.push(args);
      return { passed: true };
    });
    expect(calls).toEqual([
      [
        'https://iam.googleapis.com',
        'v1',
        `projects/${project}/serviceAccounts/${account}`,
        ['iam.serviceAccounts.actAs'],
      ],
    ]);
    await expect(
      checkPermission(project, account, async () => ({ passed: false })),
    ).rejects.toThrow('cannot use');
    await expect(
      checkPermission(project, account, async () => {
        throw new Error('Unavailable');
      }),
    ).rejects.toThrow('Unavailable');
  });
  it('refuses an inherited flag that would skip the real runtime check', async () => {
    const request = vi.fn();
    vi.stubEnv('FIREBASE_SKIP_INFORMATIONAL_IAM', 'true');
    try {
      await expect(
        checkPermission('lct-collect-staging', 'runtime', request),
      ).rejects.toThrow('must not be skipped');
      expect(request).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllEnvs();
    }
  });
  it('routes develop and main to separate permanent Hosting projects', () => {
    for (const [name, branch, project] of [
      ['deploy-staging', 'develop', 'lct-collect-staging'],
      ['deploy-production', 'main', 'lct-collect-prod'],
    ]) {
      const w = workflow(name);
      expect(w.on.push.branches).toEqual([branch]);
      expect(w.jobs.deploy.env.FIREBASE_PROJECT_ID).toBe(project);
      const runs = w.jobs.deploy.steps.flatMap((s: { run?: string }) =>
        s.run ? [s.run] : [],
      );
      expect(
        runs.some((r: string) =>
          r.includes('deploy --only hosting --project "$FIREBASE_PROJECT_ID"'),
        ),
      ).toBe(true);
      expect(
        runs.some((r: string) => r.includes('hosting:channel:deploy')),
      ).toBe(false);
      expect(w.jobs.deploy.if).not.toContain('PRODUCTION_DEPLOY_ENABLED');
    }
  });
  it('keeps untrusted PR code outside the privileged preview workflow', () => {
    const w = workflow('deploy-preview');
    expect(w.on.pull_request_target.branches).toEqual(['develop', 'main']);
    expect(w.jobs.ci.if).toContain(
      'github.event.pull_request.head.repo.full_name == github.repository',
    );
    expect(w.jobs.ci.permissions['id-token']).toBeUndefined();
    expect(
      w.jobs.ci.steps.every(
        (s: { uses?: string }) => !s.uses?.startsWith('actions/checkout'),
      ),
    ).toBe(true);
    const wait = w.jobs.ci.steps[0].with.script;
    expect(wait).toContain("event: 'pull_request'");
    expect(wait).toContain('head_sha: expected');
    expect(wait).toContain("run.conclusion !== 'success'");
    expect(wait).toContain('r.pull_requests.some(p => p.number === pr.number)');
    const deploy = w.jobs.deploy;
    expect(deploy.environment).toBe('preview');
    const checkout = deploy.steps.find((s: { uses?: string }) =>
      s.uses?.startsWith('actions/checkout'),
    );
    expect(checkout.with.ref).toBe('${{ github.event.pull_request.base.sha }}');
    expect(checkout.with['persist-credentials']).toBe(false);
    const artifact = deploy.steps.find((s: { uses?: string }) =>
      s.uses?.startsWith('actions/download-artifact'),
    );
    expect(artifact.with['run-id']).toBe('${{ needs.ci.outputs.run-id }}');
    const auth = deploy.steps.find((s: { uses?: string }) =>
      s.uses?.startsWith('google-github-actions/auth'),
    );
    expect(auth.with.service_account).toBe(
      'lct-github-preview@lct-collect-staging.iam.gserviceaccount.com',
    );
    expect(
      deploy.steps.flatMap((s: { run?: string }) => (s.run ? [s.run] : [])),
    ).toEqual(['node scripts/deploy-preview.mjs']);
    expect(readFileSync('scripts/deploy-preview.mjs', 'utf8')).toContain(
      'hosting:channel:deploy',
    );
  });
  it('parses every trusted inline preview script before it reaches Actions', () => {
    const AsyncFunction = Object.getPrototypeOf(
      async function () {},
    ).constructor;
    for (const job of Object.values(workflow('deploy-preview').jobs) as {
      steps: { with?: { script?: string } }[];
    }[]) {
      for (const step of job.steps) {
        if (step.with?.script)
          expect(
            () =>
              new AsyncFunction('github', 'context', 'core', step.with!.script),
          ).not.toThrow();
      }
    }
  });
  it('rejects invalid channel input and symlink artifacts before invoking deployment', () => {
    const root = mkdtempSync(join(tmpdir(), 'lct-preview-test-'));
    const script = resolve('scripts/deploy-preview.mjs');
    try {
      const env = {
        ...process.env,
        PR_NUMBER: '2; touch unsafe',
        PREVIEW_HEAD_SHA: 'a'.repeat(40),
        GITHUB_OUTPUT: join(root, 'outputs'),
        GITHUB_STEP_SUMMARY: join(root, 'summary'),
      };
      const invalid = spawnSync(process.execPath, [script], {
        cwd: root,
        env,
        encoding: 'utf8',
      });
      expect(invalid.status).toBe(1);
      expect(invalid.stderr).toContain('numeric PR number');
      mkdirSync(join(root, 'preview-dist'));
      writeFileSync(join(root, 'private'), 'not-public');
      symlinkSync(join(root, 'private'), join(root, 'preview-dist', 'linked'));
      const linked = spawnSync(process.execPath, [script], {
        cwd: root,
        env: { ...env, PR_NUMBER: '2' },
        encoding: 'utf8',
      });
      expect(linked.status).toBe(1);
      expect(linked.stderr).toContain('ordinary files/directories');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

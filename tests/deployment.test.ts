import { describe, expect, it } from 'vitest';
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
const workflow = (name: string) =>
  YAML.parse(readFileSync(`.github/workflows/${name}.yml`, 'utf8'));
describe('deployment boundaries', () => {
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

import { describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { createECDH } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
const require = createRequire(import.meta.url);
const {
  config,
  functions,
  grant,
  accountEmail,
  waitOperation,
} = require('../scripts/firebase-deployment.cjs');
const {
  options,
  validatePublicKey,
  plan,
  ensureSecret,
  bootstrap,
} = require('../scripts/setup-reminders.cjs');
const { checkDeployment } = require('../scripts/check-firebase-deployment.cjs');
const settings = config('lct-collect-prod');
const build = '275805072037-compute@developer.gserviceaccount.com';
function fixture() {
  const state = {
    installed: true,
    billing: true,
    secret: true,
    versions: [{ state: 'ENABLED' }],
    apiEnabled: true,
    public: true,
    actAs: true,
    managePolicy: true,
    buildAccount: `projects/${settings.project}/serviceAccounts/${build}`,
    calls: [] as {
      host: string;
      method: string;
      path: string;
      body?: any;
      options?: any;
    }[],
    policies: new Map<string, any>(),
  };
  const getPolicy = (key: string) => {
    if (!state.policies.has(key))
      state.policies.set(key, {
        etag: 'original',
        version: 3,
        bindings: [
          {
            role: 'roles/viewer',
            members: ['user:retain@example.test'],
            condition: { title: 'Preserve', expression: 'false' },
          },
        ],
      });
    return structuredClone(state.policies.get(key));
  };
  const makeClient = (host: string) => {
    const request = async (
      method: string,
      path: string,
      body?: any,
      opts?: any,
    ) => {
      state.calls.push({ host, method, path, body, options: opts });
      if (host === 'cloudbilling') {
        if (method === 'put') state.billing = true;
        return { body: { billingEnabled: state.billing } };
      }
      if (path.endsWith(':getIamPolicy')) {
        expect(method).toBe(
          ['run', 'secretmanager'].includes(host) ? 'get' : 'post',
        );
        const policy = getPolicy(host + path.replace(':getIamPolicy', ''));
        if (
          host === 'run' &&
          state.public &&
          !path.includes('/services/dispatchreminders:')
        ) {
          policy.bindings.push({
            role: 'roles/run.invoker',
            members: ['allUsers'],
          });
        }
        return { body: policy };
      }
      if (path.endsWith(':setIamPolicy')) {
        const key = host + path.replace(':setIamPolicy', '');
        expect(body.policy.etag).toBe(getPolicy(key).etag);
        state.policies.set(key, {
          ...structuredClone(body.policy),
          etag: body.policy.etag + '-next',
        });
        return { body: body.policy };
      }
      if (host === 'serviceusage')
        return {
          body:
            method === 'post'
              ? { done: true }
              : { state: state.apiEnabled ? 'ENABLED' : 'DISABLED' },
        };
      if (host === 'iam') {
        if (path.endsWith(':testIamPermissions'))
          return {
            body: {
              permissions: state.actAs ? ['iam.serviceAccounts.actAs'] : [],
            },
          };
        if (method === 'post') throw { status: 409 };
        return { body: { email: path.split('/').at(-1) } };
      }
      if (host === 'secretmanager') {
        if (method === 'get' && !state.secret) throw { status: 404 };
        if (path.endsWith('/versions'))
          return { body: { versions: state.versions } };
        if (path.endsWith(':addVersion')) {
          state.versions.push({ state: 'ENABLED' });
          return { body: {} };
        }
        if (method === 'post') state.secret = true;
        return { body: {} };
      }
      if (host === 'cloudfunctions') {
        if (!state.installed) throw { status: 404 };
        const fn = functions.find((f: any) => path.endsWith('/' + f.name));
        expect(fn).toBeDefined();
        return {
          body: {
            state: 'ACTIVE',
            serviceConfig: {
              serviceAccountEmail: settings.runtime,
              service: `projects/${settings.project}/locations/${fn.region}/services/${fn.name.toLowerCase()}`,
            },
            buildConfig: { serviceAccount: state.buildAccount },
          },
        };
      }
      if (host === 'cloudbuild')
        return { body: { serviceAccountEmail: state.buildAccount } };
      if (host === 'run' && path.endsWith(':testIamPermissions'))
        return {
          body: { permissions: state.managePolicy ? body.permissions : [] },
        };
      throw new Error(`Unexpected ${host} ${method} ${path}`);
    };
    return {
      get: (path: string, opts?: any) => request('get', path, undefined, opts),
      post: (path: string, body: any, opts?: any) =>
        request('post', path, body, opts),
      put: (path: string, body: any, opts?: any) =>
        request('put', path, body, opts),
    };
  };
  return { state, makeClient };
}

describe('Firebase owner setup boundaries', () => {
  it('defaults to a project-specific dry run and requires explicit billing selection', () => {
    expect(options(['--project', 'lct-collect-prod'])).toEqual({
      project: 'lct-collect-prod',
      apply: false,
    });
    expect(() => options(['--project', 'other-project'])).toThrow();
    expect(() => options(['--project', 'constructor'])).toThrow();
    expect(() =>
      options([
        '--project',
        'lct-collect-prod',
        '--billing-account',
        'invalid',
      ]),
    ).toThrow();
    expect(() =>
      options(['--project', 'lct-collect-prod', '--unexpected']),
    ).toThrow();
    const dry = plan(settings);
    expect(dry.billing).toContain('do not change');
    expect(dry.servicePolicies).toHaveLength(5);
    expect(dry.servicePolicies.filter((p: any) => p.invocation)).toHaveLength(
      4,
    );
    expect(JSON.stringify(dry)).toContain('/services/syncoperation');
    expect(JSON.stringify(dry)).not.toContain('lct-collect-staging');
  });
  it('preserves unrelated and conditional grants, etags, and idempotency', () => {
    const policy = {
      etag: 'etag',
      bindings: [
        {
          role: 'roles/iam.serviceAccountUser',
          members: ['other'],
          condition: { expression: 'false' },
        },
      ],
    };
    const before = structuredClone(policy);
    const updated = grant(policy, 'roles/iam.serviceAccountUser', 'deploy');
    expect(policy).toEqual(before);
    expect(updated.policy.etag).toBe('etag');
    expect(updated.policy.bindings[0]).toEqual(before.bindings[0]);
    expect(updated.policy.bindings[1].members).toEqual(['deploy']);
    expect(
      grant(updated.policy, 'roles/iam.serviceAccountUser', 'deploy').changed,
    ).toBe(false);
  });
  it('accepts actual legacy, Compute and dedicated build identities only in the target project', () => {
    expect(
      accountEmail(
        `projects/lct-collect-prod/serviceAccounts/${build}`,
        settings,
      ),
    ).toBe(build);
    expect(
      accountEmail('275805072037@cloudbuild.gserviceaccount.com', settings),
    ).toContain('@cloudbuild');
    expect(
      accountEmail(
        'lct-builds@lct-collect-prod.iam.gserviceaccount.com',
        settings,
      ),
    ).toContain('lct-builds');
    for (const account of [
      undefined,
      '',
      '679421917255-compute@developer.gserviceaccount.com',
      'lct-reminders@lct-collect-staging.iam.gserviceaccount.com',
      `projects/other/serviceAccounts/${build}`,
    ])
      expect(() => accountEmail(account, settings)).toThrow();
  });
  it('does not duplicate conditional grants when the API reorders condition properties', () => {
    const policy = {
      etag: 'keep',
      version: 3,
      bindings: [
        {
          role: 'roles/artifactregistry.admin',
          members: ['deploy'],
          condition: {
            expression: 'approved',
            description: '',
            title: 'Images',
          },
        },
      ],
    };
    const next = grant(policy, 'roles/artifactregistry.admin', 'deploy', {
      title: 'Images',
      expression: 'approved',
    });
    expect(next.changed).toBe(false);
    expect(next.policy.bindings).toHaveLength(1);
  });
  it('waits for API activation and reports operation failures and timeouts', async () => {
    const get = vi
      .fn()
      .mockResolvedValueOnce({
        body: { name: 'operations/setup', done: false },
      })
      .mockResolvedValueOnce({ body: { done: true } });
    const pause = vi.fn().mockResolvedValue(undefined);
    await waitOperation({ get }, { name: 'operations/setup' }, { pause });
    expect(get).toHaveBeenCalledTimes(2);
    await expect(
      waitOperation(
        { get },
        { done: true, error: { message: 'Denied' } },
        { pause },
      ),
    ).rejects.toThrow('Denied');
    await expect(
      waitOperation(
        { get: async () => ({ body: { name: 'operations/setup' } }) },
        { name: 'operations/setup' },
        { pause, attempts: 1 },
      ),
    ).rejects.toThrow('not completed');
  });
  it('stops before any mutation when Blaze billing is missing', async () => {
    const { state, makeClient } = fixture();
    state.billing = false;
    await expect(
      bootstrap({ project: settings.project }, makeClient),
    ).rejects.toThrow('Blaze');
    expect(state.calls.every((call) => call.method === 'get')).toBe(true);
  });
  it('scopes production grants to discovered accounts and each known managed service', async () => {
    const { state, makeClient } = fixture();
    state.public = false;
    const result = await bootstrap({ project: settings.project }, makeClient);
    expect(result.pending).toEqual([]);
    expect(result.buildAccounts).toEqual([build]);
    const writes = state.calls.filter((call) =>
      call.path.endsWith(':setIamPolicy'),
    );
    expect(
      writes.some(
        (call) =>
          call.path.includes('/serviceAccounts/' + build) &&
          call.body.policy.bindings.some(
            (b: any) => b.role === 'roles/iam.serviceAccountUser',
          ),
      ),
    ).toBe(true);
    expect(
      writes.some(
        (call) =>
          call.path.endsWith('/projects/lct-collect-prod:setIamPolicy') &&
          call.body.policy.bindings.some(
            (b: any) =>
              b.role === 'roles/iam.serviceAccountUser' ||
              b.role === 'roles/editor',
          ),
      ),
    ).toBe(false);
    expect(
      state.calls.some(
        (call) => call.host === 'cloudbilling' && call.method === 'put',
      ),
    ).toBe(false);
    expect(
      writes.some((call) => call.path.includes('/services/syncoperation')),
    ).toBe(true);
    expect(
      writes
        .filter((call) => call.path.includes('/services/dispatchreminders'))
        .every(
          (call) =>
            !call.body.policy.bindings.some(
              (b: any) =>
                b.role === 'roles/run.invoker' &&
                b.members.includes('allUsers'),
            ),
        ),
    ).toBe(true);
    const count = writes.length;
    await bootstrap({ project: settings.project }, makeClient);
    expect(
      state.calls.filter((call) => call.path.endsWith(':setIamPolicy')),
    ).toHaveLength(count);
    expect(state.calls.some((call) => call.path.endsWith(':addVersion'))).toBe(
      false,
    );
  });
  it('reports initial deployment as pending and discovers both regional defaults', async () => {
    const { state, makeClient } = fixture();
    state.installed = false;
    const result = await bootstrap({ project: settings.project }, makeClient);
    expect(result.pending).toHaveLength(5);
    expect(
      state.calls
        .filter((call) => call.host === 'cloudbuild')
        .map((call) => call.path),
    ).toEqual([
      '/projects/lct-collect-prod/locations/africa-south1/defaultServiceAccount',
      '/projects/lct-collect-prod/locations/europe-west1/defaultServiceAccount',
    ]);
    expect(
      state.calls.some((call) => call.host === 'run' && call.method === 'post'),
    ).toBe(false);
  });
  it('rejects cross-project build metadata without granting use of that account', async () => {
    const { state, makeClient } = fixture();
    state.buildAccount =
      'projects/lct-collect-staging/serviceAccounts/lct-reminders@lct-collect-staging.iam.gserviceaccount.com';
    await expect(
      bootstrap({ project: settings.project }, makeClient),
    ).rejects.toThrow('another project');
    expect(
      state.calls
        .filter((call) => call.method === 'post')
        .some((call) => call.path.includes('lct-collect-staging')),
    ).toBe(false);
  });
  it('requires explicit review before delegating a build account with Editor', async () => {
    const { state, makeClient } = fixture();
    state.policies.set('cloudresourcemanager/projects/lct-collect-prod', {
      etag: 'privileged',
      bindings: [
        { role: 'roles/editor', members: [`serviceAccount:${build}`] },
      ],
    });
    await expect(
      bootstrap({ project: settings.project }, makeClient),
    ).rejects.toThrow('--allow-privileged-build-account');
    expect(
      state.calls.some((call) =>
        call.path.endsWith(`/serviceAccounts/${build}:setIamPolicy`),
      ),
    ).toBe(false);
    await expect(
      bootstrap(
        { project: settings.project, allowPrivilegedBuildAccount: true },
        makeClient,
      ),
    ).resolves.toBeDefined();
    expect(
      state.calls.some((call) =>
        call.path.endsWith(`/serviceAccounts/${build}:setIamPolicy`),
      ),
    ).toBe(true);
  });
  it('recovers an empty secret with a fresh key while suppressing payload logs', async () => {
    const { state, makeClient } = fixture();
    state.secret = false;
    state.versions = [];
    await ensureSecret(makeClient('secretmanager'), settings, () =>
      Buffer.alloc(48, 7),
    );
    const version = state.calls.find((call) =>
      call.path.endsWith(':addVersion'),
    )!;
    expect(version.options.skipLog).toEqual({ body: true, resBody: true });
    expect(state.versions).toEqual([{ state: 'ENABLED' }]);
    expect(state.calls.some((call) => call.path.includes(':access'))).toBe(
      false,
    );
  });
  it('does not rotate a disabled existing signing key', async () => {
    const { state, makeClient } = fixture();
    state.versions = [{ state: 'DISABLED' }];
    await expect(
      ensureSecret(makeClient('secretmanager'), settings),
    ).rejects.toThrow('Restore');
    expect(state.calls.some((call) => call.path.endsWith(':addVersion'))).toBe(
      false,
    );
  });
  it('validates the production public key and rejects reusing the staging key', () => {
    const ecdh = createECDH('prime256v1');
    ecdh.generateKeys();
    expect(() =>
      validatePublicKey(
        ecdh.getPublicKey().toString('base64url'),
        settings.project,
      ),
    ).not.toThrow();
    expect(() => validatePublicKey('invalid', settings.project)).toThrow();
    const staging = parseEnv(
      readFileSync('.env.example', 'utf8'),
    ).PUBLIC_FIREBASE_VAPID_KEY;
    expect(() => validatePublicKey(staging, settings.project)).toThrow(
      'staging',
    );
  });
});

describe('production deployment readiness', () => {
  it('verifies every existing endpoint, both identities, and real service IAM permissions', async () => {
    const { state, makeClient } = fixture();
    expect(await checkDeployment(settings.project, makeClient)).toEqual({
      functions: 5,
      buildAccounts: [build],
    });
    expect(
      state.calls.filter((call) => call.host === 'cloudfunctions'),
    ).toHaveLength(5);
    expect(
      state.calls.some(
        (call) =>
          call.path.includes(build) &&
          call.path.endsWith(':testIamPermissions'),
      ),
    ).toBe(true);
    expect(
      state.calls.filter((call) => call.path.endsWith(':setIamPolicy')),
    ).toHaveLength(0);
  });
  it.each(['apiEnabled', 'public', 'actAs', 'managePolicy'] as const)(
    'fails closed when %s is missing',
    async (field) => {
      const { state, makeClient } = fixture();
      state[field] = false;
      await expect(
        checkDeployment(settings.project, makeClient),
      ).rejects.toThrow();
    },
  );
  it('fails when a required function is missing', async () => {
    const { state, makeClient } = fixture();
    state.installed = false;
    await expect(
      checkDeployment(settings.project, makeClient),
    ).rejects.toBeDefined();
  });
  it('fails before deployment when signing-key versions are disabled', async () => {
    const { state, makeClient } = fixture();
    state.versions = [{ state: 'DISABLED' }];
    await expect(checkDeployment(settings.project, makeClient)).rejects.toThrow(
      'enabled version',
    );
    expect(state.calls.some((call) => call.host === 'cloudfunctions')).toBe(
      false,
    );
  });
  it('refuses to suppress readiness checks with the CLI informational flag', async () => {
    const { makeClient, state } = fixture();
    vi.stubEnv('FIREBASE_SKIP_INFORMATIONAL_IAM', 'true');
    try {
      await expect(
        checkDeployment(settings.project, makeClient),
      ).rejects.toThrow('real IAM');
      expect(state.calls).toHaveLength(0);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

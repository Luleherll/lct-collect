import { it, expect } from 'vitest';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { runInNewContext } from 'node:vm';
it('generated worker caches only known static GETs and loads owner code on demand', async () => {
  const root = mkdtempSync(join(tmpdir(), 'lct-sw-'));
  try {
    mkdirSync(join(root, '_astro'));
    writeFileSync(join(root, 'index.html'), '<html></html>');
    writeFileSync(join(root, '_astro', 'AppRoot.demo.js'), '/* app */');
    writeFileSync(join(root, '_astro', 'MemberAdmin.demo.js'), '/* owner */');
    execFileSync(process.execPath, ['scripts/build-sw.mjs'], {
      env: { ...process.env, LCT_SW_ROOT: root },
    });
    const handlers: Record<string, (e: any) => void> = {};
    let installed: string[] = [];
    const saved: string[] = [];
    const cache = {
      addAll: async (urls: string[]) => {
        installed = urls;
      },
      match: async () => undefined,
      put: async (url: string) => {
        saved.push(url);
      },
    };
    runInNewContext(readFileSync(join(root, 'sw.js'), 'utf8'), {
      URL,
      self: {
        location: { origin: 'https://example.test' },
        addEventListener: (name: string, fn: any) => (handlers[name] = fn),
        clients: { claim: async () => {} },
      },
      caches: { open: async () => cache },
      fetch: async () => ({
        ok: true,
        clone() {
          return this;
        },
      }),
    });
    let installation: Promise<unknown> | undefined;
    handlers.install({
      waitUntil: (p: Promise<unknown>) => (installation = p),
    });
    await installation;
    expect(installed).toContain('/_astro/AppRoot.demo.js');
    expect(installed).not.toContain('/_astro/MemberAdmin.demo.js');
    for (const [url, method] of [
      ['https://firestore.googleapis.com/data', 'GET'],
      ['https://example.test/api/entries', 'GET'],
      ['https://example.test/_astro/AppRoot.demo.js', 'POST'],
    ]) {
      let intercepted = false;
      handlers.fetch({
        request: { url, method },
        respondWith: () => (intercepted = true),
      });
      expect(intercepted).toBe(false);
    }
    let response: Promise<unknown> | undefined;
    handlers.fetch({
      request: {
        url: 'https://example.test/_astro/MemberAdmin.demo.js?version=1',
        method: 'GET',
      },
      respondWith: (p: Promise<unknown>) => (response = p),
    });
    await response;
    expect(saved).toEqual(['/_astro/MemberAdmin.demo.js']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

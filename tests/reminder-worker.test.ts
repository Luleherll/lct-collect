import { it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { IDBFactory } from 'fake-indexeddb';
it('deduplicates validated pushes and suppresses signed-out or stale reminders', async () => {
  const handlers: Record<string, (event: any) => void> = {},
    shown: any[] = [];
  let valid = true,
    uid = 'agent-a';
  runInNewContext(readFileSync('scripts/reminder-worker.js', 'utf8'), {
    indexedDB: new IDBFactory(),
    Date,
    URL,
    fetch: async () => ({
      ok: true,
      json: async () => ({
        valid,
        uid,
        eventId: 'same-occurrence',
        path: '/agent/notes/?note=12345678',
      }),
    }),
    self: {
      location: { origin: 'https://example.test' },
      registration: {
        showNotification: async (...args: any[]) => {
          shown.push(args);
        },
      },
      clients: { matchAll: async () => [] },
      addEventListener: (name: string, fn: any) => (handlers[name] = fn),
    },
  });
  async function event(name: string, data: any) {
    let wait: Promise<unknown> | undefined;
    handlers[name]({ ...data, waitUntil: (p: Promise<unknown>) => (wait = p) });
    await wait;
  }
  await event('message', { data: { type: 'REMINDER_OWNER', uid } });
  await Promise.all([
    event('push', {
      data: { json: () => ({ data: { ticket: 'opaque', uid } }) },
    }),
    event('push', {
      data: { json: () => ({ data: { ticket: 'opaque', uid } }) },
    }),
  ]);
  expect(shown).toHaveLength(1);
  expect(shown[0][0]).toBe('LCT Collect reminder');
  expect(JSON.stringify(shown)).not.toContain('member name');
  await event('message', { data: { type: 'REMINDER_OWNER', uid: null } });
  await event('push', {
    data: { json: () => ({ data: { ticket: 'other', uid } }) },
  });
  expect(shown).toHaveLength(1);
  uid = 'agent-b';
  valid = false;
  await event('message', { data: { type: 'REMINDER_OWNER', uid } });
  await event('push', {
    data: { json: () => ({ data: { ticket: 'stale', uid } }) },
  });
  expect(shown).toHaveLength(1);
});

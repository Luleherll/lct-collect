import { it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { IDBFactory } from 'fake-indexeddb';

function worker() {
  const handlers: Record<string, (event: any) => void> = {};
  const shown: any[] = [];
  const notifications: any[] = [];
  let result: any = {
    valid: true,
    uid: 'agent-a',
    eventId: 'same-occurrence',
    path: '/agent/notes/?note=12345678',
    preview: 'Bring the passbook and confirm the balance.',
  };
  const show = vi.fn(async (...args: any[]) => {
    shown.push(args);
    notifications.push({ data: args[1].data, close: vi.fn() });
  });
  const fetch = vi.fn(async () => ({ ok: true, json: async () => result }));
  runInNewContext(readFileSync('scripts/reminder-worker.js', 'utf8'), {
    indexedDB: new IDBFactory(),
    Date,
    URL,
    fetch,
    self: {
      location: { origin: 'https://example.test' },
      registration: {
        showNotification: show,
        getNotifications: async () => notifications,
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
  return {
    shown,
    notifications,
    fetch,
    show,
    setResult: (value: any) => {
      result = value;
    },
    owner: (uid: string | null) =>
      event('message', { data: { type: 'REMINDER_OWNER', uid } }),
    push: (uid = 'agent-a') =>
      event('push', {
        data: {
          json: () => ({
            data: { ticket: 'opaque', uid, body: 'untrusted push text' },
          }),
        },
      }),
  };
}

it('shows only the validated preview and logo badge, and deduplicates concurrent delivery', async () => {
  const w = worker();
  await w.owner('agent-a');
  await Promise.all([w.push(), w.push()]);
  expect(w.shown).toHaveLength(1);
  expect(w.shown[0]).toEqual([
    'LCT Collect reminder',
    expect.objectContaining({
      body: 'Bring the passbook and confirm the balance.',
      badge: '/icons/notification-badge.png',
      icon: '/icons/icon-192.png',
      data: { path: '/agent/notes/?note=12345678', uid: 'agent-a' },
    }),
  ]);
  expect(JSON.stringify(w.shown)).not.toContain('untrusted push text');
  await w.owner(null);
  expect(w.notifications[0].close).toHaveBeenCalled();
  await w.push();
  expect(w.fetch).toHaveBeenCalledTimes(2);
  expect(w.shown).toHaveLength(1);
});

it('keeps a generic fallback for older validator responses and empty descriptions', async () => {
  for (const preview of [undefined, '', '   ', 123]) {
    const w = worker();
    await w.owner('agent-a');
    w.setResult({
      valid: true,
      uid: 'agent-a',
      eventId: 'event',
      path: '/agent/notes/',
      preview,
    });
    await w.push();
    expect(w.shown[0][1].body).toBe('A note is due. Tap to view it.');
  }
});

it('never displays text from invalid or wrong-account validation responses', async () => {
  for (const response of [
    { valid: false, uid: 'agent-a' },
    { valid: true, uid: 'agent-b' },
  ]) {
    const w = worker();
    await w.owner('agent-a');
    w.setResult({ ...response, preview: 'private note' });
    await w.push();
    expect(w.shown).toHaveLength(0);
  }
});

it('suppresses a pending validation response after an account switch', async () => {
  const w = worker();
  await w.owner('agent-a');
  let respond!: (value: any) => void;
  let requested!: () => void;
  const started = new Promise<void>((resolve) => {
    requested = resolve;
  });
  w.fetch.mockImplementationOnce(async () => {
    requested();
    return new Promise((resolve) => {
      respond = resolve;
    });
  });
  const pending = w.push();
  await started;
  await w.owner('agent-b');
  respond({
    ok: true,
    json: async () => ({
      valid: true,
      uid: 'agent-a',
      eventId: 'event',
      preview: 'private note',
    }),
  });
  await pending;
  expect(w.shown).toHaveLength(0);
});

it('closes a notification if sign-out happens while the platform displays it', async () => {
  const w = worker();
  await w.owner('agent-a');
  const display = w.show.getMockImplementation()!;
  w.show.mockImplementationOnce(async (...args: any[]) => {
    await w.owner(null);
    await display(...args);
  });
  await w.push();
  expect(w.notifications[0].close).toHaveBeenCalled();
});

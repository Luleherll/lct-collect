/* Data-only reminders share this worker with the static app shell. */
const reminderDB = () =>
  new Promise((resolve, reject) => {
    const request = indexedDB.open('lct-reminders', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('state');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
async function reminderState(key, value) {
  const database = await reminderDB();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(
        'state',
        value === undefined ? 'readonly' : 'readwrite',
      ),
      store = tx.objectStore('state');
    const request =
      value === undefined ? store.get(key) : store.put(value, key);
    let result;
    request.onsuccess = () => {
      result = request.result;
    };
    tx.oncomplete = () => {
      database.close();
      resolve(result);
    };
    tx.onerror = () => {
      database.close();
      reject(tx.error);
    };
  });
}
async function receiveReminder(data) {
  if (!data?.ticket || !data.uid || (await reminderState('owner')) !== data.uid)
    return;
  const response = await fetch('/api/reminders/validate/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ticket: data.ticket }),
    cache: 'no-store',
  });
  if (!response.ok) return;
  const result = await response.json();
  if (
    !result.valid ||
    result.uid !== data.uid ||
    (await reminderState('owner')) !== data.uid
  )
    return;
  // Claim in one transaction so foreground/background delivery cannot display twice.
  const database = await reminderDB();
  const first = await new Promise((resolve, reject) => {
    const tx = database.transaction('state', 'readwrite'),
      store = tx.objectStore('state');
    let claimed = false;
    const request = store.get(result.eventId);
    request.onsuccess = () => {
      if (!request.result) {
        store.put(Date.now(), result.eventId);
        claimed = true;
      }
      const cursor = store.openCursor();
      cursor.onsuccess = () => {
        const item = cursor.result;
        if (item) {
          if (
            item.key !== 'owner' &&
            typeof item.value === 'number' &&
            item.value < Date.now() - 29 * 86400000
          )
            item.delete();
          item.continue();
        }
      };
    };
    tx.oncomplete = () => {
      database.close();
      resolve(claimed);
    };
    tx.onerror = () => {
      database.close();
      reject(tx.error);
    };
  });
  if (!first || (await reminderState('owner')) !== result.uid) return;
  await self.registration.showNotification('LCT Collect reminder', {
    body:
      typeof result.preview === 'string' && result.preview.trim()
        ? result.preview
        : 'A note is due. Tap to view it.',
    icon: '/icons/icon-192.png',
    badge: '/icons/notification-badge.png',
    tag: result.eventId,
    data: { path: result.path, uid: result.uid },
  });
  // An account switch can happen while the platform is displaying the alert.
  if ((await reminderState('owner')) !== result.uid) await dismissOtherOwners();
}
async function dismissOtherOwners() {
  const notifications = await self.registration.getNotifications();
  const owner = await reminderState('owner');
  for (const notification of notifications)
    if (!owner || notification.data?.uid !== owner) notification.close();
}
self.addEventListener('push', (event) => {
  let message;
  try {
    message = event.data?.json();
  } catch {
    return;
  }
  event.waitUntil(
    receiveReminder(message?.data ?? message).catch(() => {
      /* An unverified reminder is never displayed. Due notes stay in the app. */
    }),
  );
});
self.addEventListener('message', (event) => {
  if (event.data?.type === 'REMINDER_OWNER')
    event.waitUntil(
      reminderState('owner', event.data.uid).then(dismissOtherOwners),
    );
  if (event.data?.type === 'REMINDER_PUSH')
    event.waitUntil(receiveReminder(event.data.data).catch(() => {}));
});
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data;
  event.waitUntil(
    (async () => {
      if ((await reminderState('owner')) !== data?.uid) return;
      const url = new URL(data.path, self.location.origin);
      if (
        url.origin !== self.location.origin ||
        url.pathname !== '/agent/notes/'
      )
        return;
      const windows = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      });
      const client = windows.find((c) => new URL(c.url).origin === url.origin);
      if (client) {
        await client.focus();
        client.postMessage({
          type: 'OPEN_REMINDER',
          path: url.pathname + url.search,
        });
      } else await self.clients.openWindow(url.href);
    })(),
  );
});

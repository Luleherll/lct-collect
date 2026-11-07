import {
  getMessaging,
  getToken,
  deleteToken,
  isSupported,
  onMessage,
} from 'firebase/messaging';
import { auth } from './firebase';
import { noteCall } from './notes';
import { storage } from './storage';
let currentToken = '',
  stopMessage: (() => void) | undefined;
export const permanentNotesURL = () =>
  `https://${auth.app.options.projectId}.web.app/agent/notes/`;
async function tellWorker(uid: string | null) {
  const registration = await navigator.serviceWorker.ready;
  registration.active?.postMessage({ type: 'REMINDER_OWNER', uid });
}
export async function enableReminders(uid: string, ask = true) {
  if (!('Notification' in window) || !(await isSupported()))
    throw new Error('Notifications are not supported in this browser.');
  if (auth.currentUser?.uid !== uid)
    throw new Error('Sign in again before enabling reminders.');
  const project = auth.app.options.projectId;
  if (
    ![`${project}.web.app`, `${project}.firebaseapp.com`].includes(
      location.hostname,
    )
  )
    throw new Error(
      'Enable reminders on the permanent app, rather than an expiring preview.',
    );
  const key = import.meta.env.PUBLIC_FIREBASE_VAPID_KEY;
  if (!key)
    throw new Error(
      'The web push key needs to be configured before notifications can be enabled.',
    );
  if (ask && Notification.permission === 'default')
    await Notification.requestPermission();
  if (Notification.permission !== 'granted')
    throw new Error(
      'Notifications are blocked. You can still save reminders and view due notes here.',
    );
  let browserId = storage.get('local', 'lct-reminder-browser');
  if (!browserId) {
    browserId = crypto.randomUUID();
    if (!storage.set('local', 'lct-reminder-browser', browserId))
      throw new Error('Enable site storage to register reminders.');
  }
  const registration = await navigator.serviceWorker.ready;
  const messaging = getMessaging(auth.app);
  currentToken = await getToken(messaging, {
    vapidKey: key,
    serviceWorkerRegistration: registration,
  });
  if (auth.currentUser?.uid !== uid) return;
  await noteCall('registerReminderDevice', {
    token: currentToken,
    browserId,
    enabled: true,
  });
  if (auth.currentUser?.uid !== uid) return;
  await tellWorker(uid);
  storage.set('local', 'lct-reminder-enabled', 'true');
  stopMessage?.();
  stopMessage = onMessage(messaging, (payload) =>
    registration.active?.postMessage({
      type: 'REMINDER_PUSH',
      data: payload.data,
    }),
  );
}
export async function restoreReminders(uid: string) {
  if (
    storage.get('local', 'lct-reminder-enabled') === 'true' &&
    'Notification' in window &&
    Notification.permission === 'granted'
  )
    await enableReminders(uid, false);
}
export async function disableReminders() {
  if ('serviceWorker' in navigator) {
    const registration = await navigator.serviceWorker.getRegistration();
    registration?.active?.postMessage({ type: 'REMINDER_OWNER', uid: null });
  }
  storage.remove('local', 'lct-reminder-enabled');
  stopMessage?.();
  stopMessage = undefined;
  if (currentToken) {
    try {
      await noteCall('registerReminderDevice', {
        token: currentToken,
        browserId: storage.get('local', 'lct-reminder-browser'),
        enabled: false,
      });
    } catch {
      /* Local owner clearing prevents display even if disconnected. */
    }
  }
  try {
    if (await isSupported()) await deleteToken(getMessaging(auth.app));
  } catch {
    /* Retry token replacement on the next explicit enable. */
  }
  currentToken = '';
}

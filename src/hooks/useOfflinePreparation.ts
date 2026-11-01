import { useEffect } from 'react';
import {
  collection,
  limit,
  onSnapshot,
  orderBy,
  query,
  where,
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import { changeLocal, localOwner } from '../lib/local';
import { storeScope, useLocalRecords } from './useLocal';
import type { Session } from '../lib/models';
/** Prepare bounded agent workdays even when their screens have not been visited. */
export function useOfflinePreparation(uid: string, enabled: boolean) {
  const sessions = useLocalRecords<Session>(
    'sessions',
    [where('agentId', '==', uid), orderBy('workday', 'desc'), limit(5)],
    `${uid}/latest-five`,
    enabled,
    {
      matches: (s) => s.agentId === uid,
      compare: (a, b) => b.workday.localeCompare(a.workday),
      limit: 5,
    },
  );
  useLocalRecords(
    `users/${uid}/notes`,
    [orderBy('createdAt', 'desc')],
    uid,
    enabled,
  );
  const days = sessions.data.map((s) => s.workday).join('/'),
    owner = localOwner();
  useEffect(() => {
    if (!enabled || !uid || !owner) return;
    let active = true;
    const stops = days
      .split('/')
      .filter(Boolean)
      .map((day) =>
        onSnapshot(
          query(
            collection(db(), 'entries'),
            where('agentId', '==', uid),
            where('workday', '==', day),
            orderBy('createdAt', 'desc'),
          ),
          { includeMetadataChanges: true },
          (snap) => {
            if (!active || snap.metadata.fromCache) return;
            void changeLocal(
              (s) =>
                storeScope(
                  s,
                  `entries:${uid}/agent/${day}`,
                  Object.fromEntries(
                    snap.docs.map((d) => [d.ref.path, d.data()]),
                  ),
                ),
              owner,
            ).catch(() => {});
          },
          () => {},
        ),
      );
    return () => {
      active = false;
      stops.forEach((stop) => stop());
    };
  }, [uid, enabled, days, owner]);
  return sessions;
}

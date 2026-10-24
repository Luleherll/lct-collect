import { useEffect, useState } from 'react';
import {
  collection,
  onSnapshot,
  query,
  type QueryConstraint,
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import { message } from '../lib/errors';
export function useRecords<T>(
  name: string,
  constraints: QueryConstraint[],
  key: string,
  enabled: boolean,
) {
  const [result, setResult] = useState<{
    data: T[];
    loading: boolean;
    cached: boolean;
    error: string;
  }>({ data: [], loading: true, cached: true, error: '' });
  useEffect(() => {
    setResult({ data: [], loading: enabled, cached: true, error: '' });
    if (!enabled) return;
    return onSnapshot(
      query(collection(db(), name), ...constraints),
      { includeMetadataChanges: true },
      (snap) => {
        // Never expose a financial/status change until its server acknowledgement.
        if (snap.metadata.hasPendingWrites) return;
        setResult({
          data: snap.docs.map((d) => d.data() as T),
          loading: false,
          cached: snap.metadata.fromCache,
          error: '',
        });
      },
      (e) =>
        setResult({
          data: [],
          loading: false,
          cached: true,
          error: message(e),
        }),
    );
    // Query identity is represented by key; arrays are rebuilt on render.
  }, [name, key, enabled]);
  return result;
}

import {
  collection,
  doc,
  getDocsFromServer,
  runTransaction,
  serverTimestamp,
} from 'firebase/firestore';
import { db } from './firebase';
import { memberFingerprint, planImport, type ImportPlan } from './import';
import type { Member } from './models';
export async function previewDirectory(text: string) {
  const [current, reservations] = await Promise.all([
    getDocsFromServer(collection(db(), 'members')),
    getDocsFromServer(collection(db(), 'accountNumbers')),
  ]);
  const plan = planImport(
    text,
    current.docs.map((d) => d.data() as Member),
  );
  const owners = new Map(
    reservations.docs.map((d) => [d.id, d.data().memberId as string]),
  );
  for (const row of plan.rows) {
    const owner = owners.get(row.accountNumber);
    if (owner && owner !== row.memberId)
      plan.errors.push(
        `Account number ${row.accountNumber} is reserved for another directory record.`,
      );
  }
  return { ...plan, reserved: reservations.docs.map((d) => d.id) };
}
export async function applyDirectory(
  plan: ImportPlan,
  progress: (text: string) => void,
) {
  if (plan.errors.length)
    throw new Error('Resolve all file errors before applying.');
  let applied = 0;
  const existing = plan.existing ?? [];
  // Reserve legacy numbers first. Historical reservations are never reassigned.
  const prepared = existing
    .filter((m) => !plan.reserved?.includes(m.accountNumber))
    .map((m) => ({
      memberId: m.memberId,
      accountNumber: m.accountNumber,
      fullName: m.fullName,
      action: 'Unchanged' as const,
      previous: {
        accountNumber: m.accountNumber,
        fullName: m.fullName,
        fingerprint: memberFingerprint(m),
      },
    }));
  const changes = plan.rows.filter((r) => r.action !== 'Unchanged');
  for (const phase of [
    { rows: prepared, prepare: true },
    { rows: changes, prepare: false },
  ]) {
    for (let offset = 0; offset < phase.rows.length; offset += 5) {
      const group = phase.rows.slice(offset, offset + 5);
      try {
        if (!navigator.onLine) throw new Error('Connection lost.');
        await runTransaction(db(), async (tx) => {
          const refs = group.map((r) => doc(db(), 'members', r.memberId));
          const reservations = group.map((r) =>
            doc(db(), 'accountNumbers', r.accountNumber),
          );
          const snaps = await Promise.all(refs.map((r) => tx.get(r)));
          const owners = await Promise.all(reservations.map((r) => tx.get(r)));
          group.forEach((r, i) => {
            const current = snaps[i].exists()
              ? (snaps[i].data() as Member)
              : undefined;
            if (
              r.previous
                ? !current ||
                  memberFingerprint(current) !== r.previous.fingerprint
                : !!current
            )
              throw new Error(
                `Account ${r.accountNumber} changed since preview. Re-preview the file.`,
              );
            if (owners[i].exists() && owners[i].data()!.memberId !== r.memberId)
              throw new Error(
                `Account number ${r.accountNumber} is reserved for another directory record.`,
              );
            if (!owners[i].exists())
              tx.set(reservations[i], {
                memberId: r.memberId,
                updatedAt: serverTimestamp(),
              });
            if (!phase.prepare)
              tx.set(refs[i], {
                memberId: r.memberId,
                accountNumber: r.accountNumber,
                fullName: r.fullName,
                searchName: r.fullName.toLowerCase(),
                active: current?.active ?? true,
                updatedAt: serverTimestamp(),
              });
          });
        });
        if (!phase.prepare) applied += group.length;
        progress(
          phase.prepare
            ? `Preparing directory: ${Math.min(offset + 5, phase.rows.length)} of ${phase.rows.length}`
            : `${applied} of ${changes.length} account changes confirmed`,
        );
      } catch (error) {
        throw new Error(
          `${applied} account changes confirmed. The next chunk was not confirmed; re-upload this file to check what remains. ${error instanceof Error ? error.message : 'Check your connection.'}`,
        );
      }
    }
  }
}

import { useLocalVersion } from '../hooks/useLocal';
import { localState } from '../lib/local';
export default function SyncState({
  entryId,
  noteId,
  sessionId,
  type,
}: {
  entryId?: string;
  noteId?: string;
  sessionId?: string;
  type?: string;
}) {
  useLocalVersion();
  const work = localState().commands.filter(
    (p) =>
      (entryId &&
        p.command.data.entryId === entryId &&
        (!type || !p.command.data.type || p.command.data.type === type)) ||
      (noteId && p.command.data.noteId === noteId) ||
      (sessionId && p.command.data.sessionId === sessionId),
  );
  if (!work.length) return null;
  const label = work.some((p) => p.state === 'attention')
    ? 'Needs attention'
    : work.some((p) => p.state === 'syncing')
      ? 'Syncing'
      : 'Pending sync';
  return (
    <span className="sync-state" role="status">
      {label}
    </span>
  );
}

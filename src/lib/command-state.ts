import type { Command } from '../../functions/src/protocol';
export function affectedPaths(c: Command, uid: string) {
  const d = c.data;
  return c.kind === 'note'
    ? [`users/${uid}/notes/${d.noteId}`]
    : c.kind === 'session'
      ? [`sessions/${d.sessionId}`]
      : c.kind === 'record'
        ? [`entries/${d.entryId}`]
        : [`sessions/${d.sessionId}`, `entries/${d.entryId}`];
}

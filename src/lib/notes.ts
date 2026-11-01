import { localState } from './local';
import { parseReminder } from '../../functions/src/schedule';
import { enqueue } from './sync';
import {
  getFunctions,
  connectFunctionsEmulator,
  httpsCallable,
} from 'firebase/functions';
import { auth } from './firebase';
import type { AgentNote, MemberTag } from './models';
import type { Reminder } from '../../functions/src/schedule';
let service: ReturnType<typeof getFunctions> | undefined;
function functions() {
  if (!service) {
    service = getFunctions(auth.app, 'africa-south1');
    if (import.meta.env.PUBLIC_USE_EMULATORS === 'true')
      connectFunctionsEmulator(service, '127.0.0.1', 5001);
  }
  return service;
}
export async function noteCall(name: string, data: unknown) {
  if (!navigator.onLine)
    throw new Error('Connect to save changes. Your draft is still here.');
  return (await httpsCallable(functions(), name)(data)).data;
}
export function savePrivateNote(
  noteId: string,
  body: string,
  tags: MemberTag[],
  reminder: Reminder,
  expectedRevision: number,
  mutationId: string,
) {
  const text = body.trim();
  if (!text || text.length > 2000)
    throw new Error('Enter a note of up to 2,000 characters.');
  const parsed = parseReminder(reminder),
    existing =
      localState().records[`users/${auth.currentUser?.uid}/notes/${noteId}`];
  if (
    parsed.kind === 'once' &&
    parsed.at <= Date.now() &&
    JSON.stringify(parsed) !== JSON.stringify(existing?.reminder)
  )
    throw new Error('Choose a reminder time in the future.');
  return enqueue(
    'note',
    `note:${noteId}`,
    {
      action: 'save',
      noteId,
      body,
      members: tags.map((t) => t.memberId),
      tags,
      reminder,
      expectedRevision,
      mutationId,
    },
    mutationId,
  );
}
export function completeNote(
  note: AgentNote,
  done: boolean,
  mutationId: string,
) {
  return enqueue(
    'note',
    `note:${note.noteId}`,
    {
      action: 'done',
      noteId: note.noteId,
      done,
      expectedRevision: note.revision ?? 0,
      occurrenceAt: note.occurrenceAt ?? null,
      mutationId,
    },
    mutationId,
  );
}
export function deleteNote(note: AgentNote, mutationId: string) {
  return enqueue(
    'note',
    `note:${note.noteId}`,
    {
      action: 'delete',
      noteId: note.noteId,
      expectedRevision: note.revision ?? 0,
      mutationId,
    },
    mutationId,
  );
}

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
  return noteCall('manageNote', {
    action: 'save',
    noteId,
    body,
    members: tags.map((t) => t.memberId),
    reminder,
    expectedRevision,
    mutationId,
  });
}
export function completeNote(
  note: AgentNote,
  done: boolean,
  mutationId: string,
) {
  return noteCall('manageNote', {
    action: 'done',
    noteId: note.noteId,
    done,
    expectedRevision: note.revision ?? 0,
    occurrenceAt: note.occurrenceAt ?? null,
    mutationId,
  });
}
export function deleteNote(note: AgentNote, mutationId: string) {
  return noteCall('manageNote', {
    action: 'delete',
    noteId: note.noteId,
    expectedRevision: note.revision ?? 0,
    mutationId,
  });
}

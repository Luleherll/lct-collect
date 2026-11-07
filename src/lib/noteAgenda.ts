import type { AgentNote } from './models';
import { nextWeekly } from '../../functions/src/schedule';

const zone = 'Africa/Kampala';
export function noteOccurrence(note: AgentNote): number | null {
  const schedule = note.reminder;
  if (!schedule || schedule.kind === 'none') return null;
  if (schedule.kind === 'once') return schedule.at;
  return note.occurrenceAt ?? nextWeekly(schedule, note.createdAt.toMillis());
}
export function noteDay(at: number) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at);
}
export function agendaHeading(at: number, now: number) {
  const day = noteDay(at);
  if (day === noteDay(now)) return 'Today';
  const date = new Intl.DateTimeFormat('en-UG', {
    timeZone: zone,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    ...(new Date(at + 10800000).getUTCFullYear() !==
    new Date(now + 10800000).getUTCFullYear()
      ? { year: 'numeric' as const }
      : {}),
  }).format(at);
  if (day === noteDay(now + 86400000)) return `Tomorrow · ${date}`;
  if (day < noteDay(now)) return `Overdue · ${date}`;
  return date;
}
export function noteTime(at: number) {
  return new Intl.DateTimeFormat('en-UG', {
    timeZone: zone,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
    .format(at)
    .toLowerCase();
}
export function upcomingNotes(notes: AgentNote[]) {
  return notes
    .filter((n) => !n.done && noteOccurrence(n) !== null)
    .sort(
      (a, b) =>
        noteOccurrence(a)! - noteOccurrence(b)! ||
        a.noteId.localeCompare(b.noteId),
    );
}

export type Reminder =
  | { kind: 'none' }
  | { kind: 'once'; at: number }
  | { kind: 'weekly'; day: number; minute: number };
export const NONE: Reminder = { kind: 'none' };
const DAY = 86400000,
  OFFSET = 3 * 3600000;
export function parseReminder(value: unknown): Reminder {
  if (!value || typeof value !== 'object')
    throw new Error('Choose a reminder schedule.');
  const v = value as Record<string, unknown>;
  if (v.kind === 'none' && Object.keys(v).length === 1) return NONE;
  if (
    v.kind === 'once' &&
    Object.keys(v).length === 2 &&
    typeof v.at === 'number' &&
    Number.isSafeInteger(v.at) &&
    v.at > 0 &&
    v.at <= 253402300799999
  )
    return { kind: 'once', at: v.at };
  if (
    v.kind === 'weekly' &&
    Object.keys(v).length === 3 &&
    typeof v.day === 'number' &&
    Number.isInteger(v.day) &&
    v.day >= 0 &&
    v.day <= 6 &&
    typeof v.minute === 'number' &&
    Number.isInteger(v.minute) &&
    v.minute >= 0 &&
    v.minute < 1440
  )
    return { kind: 'weekly', day: v.day, minute: v.minute };
  throw new Error('Check the reminder date, weekday and time.');
}
export function nextWeekly(
  schedule: Extract<Reminder, { kind: 'weekly' }>,
  after: number,
) {
  const local = new Date(after + OFFSET);
  const midnight =
    Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) -
    OFFSET;
  let next =
    midnight +
    ((schedule.day - local.getUTCDay() + 7) % 7) * DAY +
    schedule.minute * 60000;
  if (next <= after) next += 7 * DAY;
  return next;
}
export function firstOccurrence(
  schedule: Reminder,
  now: number,
): number | null {
  if (schedule.kind === 'none') return null;
  if (schedule.kind === 'weekly') return nextWeekly(schedule, now);
  if (schedule.at <= now) throw new Error('Choose a future reminder time.');
  return schedule.at;
}
export function reminderLabel(schedule?: Reminder) {
  if (!schedule || schedule.kind === 'none') return '';
  if (schedule.kind === 'once')
    return new Intl.DateTimeFormat('en-UG', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'Africa/Kampala',
    }).format(new Date(schedule.at));
  return `Every ${['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][schedule.day]} at ${String(Math.floor(schedule.minute / 60)).padStart(2, '0')}:${String(schedule.minute % 60).padStart(2, '0')} EAT`;
}
export function localDateTime(ms: number) {
  return new Date(ms + OFFSET).toISOString().slice(0, 16);
}
export function fromLocalDateTime(value: string) {
  return Date.parse(value + ':00+03:00');
}

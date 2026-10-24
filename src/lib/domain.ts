export const MAX_AMOUNT = 100_000_000;
export const MAX_TOTAL = 9_000_000_000_000;
export const MAX_RECORDING_EVENTS = 40;
export const money = (n: number) =>
  new Intl.NumberFormat('en-UG', { maximumFractionDigits: 0 }).format(n);
export function amount(value: string, allowZero = false): number {
  const clean = value.trim().replaceAll(',', '');
  if (!clean && allowZero) return 0;
  if (!/^\d+$/.test(clean)) throw new Error('Enter whole UGX amounts only.');
  const n = Number(clean);
  if (!Number.isSafeInteger(n) || n > MAX_AMOUNT || n < (allowZero ? 0 : 1))
    throw new Error(
      `Enter an amount ${allowZero ? 'from zero' : 'above zero'} up to UGX ${money(MAX_AMOUNT)}.`,
    );
  return n;
}
export function workday(now = new Date()): string {
  return new Date(now.getTime() + 3_600_000).toISOString().slice(0, 10);
}
export function bounds(day: string): { start: Date; end: Date } {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(day) ||
    new Date(`${day}T00:00:00Z`).toISOString().slice(0, 10) !== day
  )
    throw new Error('Invalid workday.');
  const start = new Date(Date.parse(`${day}T00:00:00Z`) - 3_600_000);
  return { start, end: new Date(start.getTime() + 86_400_000) };
}
export function cash(
  opening: number,
  deposits: number,
  withdrawals: number,
  loans: number,
) {
  const result = opening + deposits + loans - withdrawals;
  if (
    ![opening, deposits, withdrawals, loans, result].every(
      (n) => Number.isSafeInteger(n) && n >= 0 && n <= MAX_TOTAL,
    )
  )
    throw new Error('Withdrawal exceeds expected cash available.');
  return result;
}
export const dayLabel = (day: string) =>
  new Intl.DateTimeFormat('en-UG', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'Africa/Kampala',
  }).format(new Date(`${day}T12:00:00Z`));
export const timeLabel = (value?: { toDate(): Date } | null) =>
  value
    ? new Intl.DateTimeFormat('en-UG', {
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'Africa/Kampala',
      }).format(value.toDate())
    : '—';
export function usernameEmail(username: string) {
  const value = username.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]{2,31}$/.test(value))
    throw new Error('Enter your assigned username.');
  return `${value}@users.lct-collect.invalid`;
}
export function searchMembers<
  T extends {
    memberId: string;
    accountNumber: string;
    fullName: string;
    active: boolean;
  },
>(members: T[], term: string): T[] {
  const q = term.trim().toLowerCase();
  if (!q) return [];
  const rank = (m: T) =>
    m.accountNumber.toLowerCase() === q
      ? 0
      : m.fullName.toLowerCase().startsWith(q)
        ? 1
        : 2;
  return members
    .filter(
      (m) =>
        m.active &&
        `${m.fullName} ${m.accountNumber}`.toLowerCase().includes(q),
    )
    .sort((a, b) => rank(a) - rank(b) || a.fullName.localeCompare(b.fullName))
    .slice(0, 8);
}

export const dateTimeLabel = (value?: { toDate(): Date } | null) =>
  value
    ? new Intl.DateTimeFormat('en-UG', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'Africa/Kampala',
      }).format(value.toDate()) + ' EAT'
    : '—';

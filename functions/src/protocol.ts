/** Versioned wire protocol. Times are milliseconds; identity comes from Auth. */
export const SYNC_VERSION = 1;
export const TYPES = ['deposit', 'withdrawal', 'loanInstalment'] as const;
export type Kind = 'session' | 'entry' | 'void' | 'record' | 'note';
export interface Command {
  version: 1;
  supersedes?: string;
  id: string;
  deviceId: string;
  capturedAt: number;
  sequence: number;
  kind: Kind;
  scope: string;
  dependsOn: string | null;
  data: Record<string, any>;
}
export interface Outcome {
  status?: 'rejected';
  message?: string;
  code?: string;
  records: Record<string, any | null>;
  revision?: number;
  occurrenceAt?: number | null;
}
export const MAX_AMOUNT = 100_000_000;
export const MAX_TOTAL = 9_000_000_000_000;
export function integer(n: unknown, max = MAX_AMOUNT): n is number {
  return Number.isSafeInteger(n) && Number(n) >= 0 && Number(n) <= max;
}
export function dayAt(time: number) {
  return new Date(time + 3_600_000).toISOString().slice(0, 10);
}
export function dayStart(day: string) {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(day) ||
    new Date(`${day}T00:00:00Z`).toISOString().slice(0, 10) !== day
  )
    throw new Error('Invalid workday.');
  return Date.parse(`${day}T00:00:00Z`) - 3_600_000;
}
export function totals(s: any, values: Record<string, number>, direction = 1) {
  const totalDeposits = s.totalDeposits + direction * values.deposit;
  const totalWithdrawals = s.totalWithdrawals + direction * values.withdrawal;
  const totalLoanInstalments =
    s.totalLoanInstalments + direction * values.loanInstalment;
  const expectedCash =
    s.openingCash + totalDeposits + totalLoanInstalments - totalWithdrawals;
  if (
    ![
      totalDeposits,
      totalWithdrawals,
      totalLoanInstalments,
      expectedCash,
    ].every((n) => integer(n, MAX_TOTAL))
  )
    throw new Error(
      'Withdrawal exceeds expected cash available, or total limit reached.',
    );
  return {
    totalDeposits,
    totalWithdrawals,
    totalLoanInstalments,
    expectedCash,
  };
}
export function newLines(
  values: Record<string, number>,
  accountTypes: Record<string, string> = {},
  typed = false,
) {
  return Object.fromEntries(
    TYPES.filter((t) => values[t] > 0).map((t) => [
      t,
      {
        amount: values[t],
        ...(typed && t !== 'loanInstalment'
          ? { accountType: accountTypes[t] }
          : {}),
        state: 'active',
        recorded: false,
        recordedBy: null,
        recordedAt: null,
        voidedBy: null,
        voidedAt: null,
        voidReason: '',
        recordingRevision: 0,
        recordingHistory: {},
      },
    ]),
  );
}

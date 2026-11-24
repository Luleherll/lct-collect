/** Versioned wire protocol. Times are milliseconds; identity comes from Auth. */
export const SYNC_VERSION = 1;
export const TYPES = ['deposit', 'withdrawal', 'loanInstalment'] as const;
export type Kind =
  'session' | 'entry' | 'entryPair' | 'void' | 'record' | 'note';
export interface Command {
  version: 1;
  actorId?: string;
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

export type SplitAmounts = Partial<
  Record<'deposit' | 'withdrawal', { saving: number; fixed: number }>
>;
/** Canonical expansion shared by durable projection and server validation. */
export function entryParts(d: Record<string, any>, paired = false) {
  if (
    !d.values ||
    !TYPES.every((t) => integer(d.values[t])) ||
    !TYPES.some((t) => d.values[t] > 0) ||
    Object.keys(d.values).some((t) => !TYPES.includes(t as any))
  )
    throw new Error('Check the whole UGX amounts.');
  if (!paired) {
    if (d.splitAmounts !== undefined)
      throw new Error('Unsupported split entry.');
    return [
      {
        entryId: d.entryId as string,
        values: d.values as Record<string, number>,
        accountTypes: d.accountTypes ?? {},
      },
    ];
  }
  if (
    !d.otherAccountId ||
    typeof d.fixedEntryId !== 'string' ||
    !/^[A-Za-z0-9_-]{8,100}$/.test(d.fixedEntryId) ||
    d.fixedEntryId === d.entryId ||
    !d.splitAmounts ||
    typeof d.splitAmounts !== 'object' ||
    Array.isArray(d.splitAmounts) ||
    !Object.keys(d.splitAmounts).length ||
    Object.keys(d.splitAmounts).some(
      (t) => !['deposit', 'withdrawal'].includes(t),
    )
  )
    throw new Error('Check the paired entry references and amounts.');
  const saving = {
    deposit: 0,
    withdrawal: 0,
    loanInstalment: d.values.loanInstalment,
  };
  const fixed = { deposit: 0, withdrawal: 0, loanInstalment: 0 };
  for (const t of ['deposit', 'withdrawal'] as const) {
    const split = d.splitAmounts[t];
    if (split !== undefined) {
      if (
        !split ||
        !integer(split.saving) ||
        !integer(split.fixed) ||
        split.saving <= 0 ||
        split.fixed <= 0 ||
        Object.keys(split).some((k) => !['saving', 'fixed'].includes(k)) ||
        split.saving + split.fixed !== d.values[t]
      )
        throw new Error('Enter both Saving and Fixed amounts above zero.');
      saving[t] = split.saving;
      fixed[t] = split.fixed;
    } else if (d.values[t] > 0) {
      if (!['saving', 'fixed'].includes(d.accountTypes?.[t]))
        throw new Error('Choose Fixed, Saving or Both.');
      (d.accountTypes[t] === 'saving' ? saving : fixed)[t] = d.values[t];
    }
  }
  return [
    {
      entryId: d.entryId as string,
      values: saving,
      accountTypes: { deposit: 'saving', withdrawal: 'saving' },
    },
    {
      entryId: d.fixedEntryId as string,
      values: fixed,
      accountTypes: { deposit: 'fixed', withdrawal: 'fixed' },
    },
  ];
}

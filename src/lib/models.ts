import type { Timestamp } from 'firebase/firestore';
export type Role = 'agent' | 'viewer' | 'admin';
export interface Profile {
  username: string;
  displayName: string;
  role: Role;
  active: boolean;
  createdAt: Timestamp;
}
/** One Ssentezo account; several accounts can share a member/group number. */
export interface Member {
  memberId: string;
  accountNumber: string;
  uniqueNumber?: string;
  fullName: string;
  searchName: string;
  active: boolean;
  updatedAt: Timestamp;
}
export interface Session {
  sessionId: string;
  agentId: string;
  workday: string;
  startsAt: Timestamp;
  endsAt: Timestamp;
  openingCash: number;
  totalDeposits: number;
  totalWithdrawals: number;
  totalLoanInstalments: number;
  expectedCash: number;
  revision: number;
  lastMutationId: string;
  createdAt: Timestamp;
}
export const TYPES = ['deposit', 'withdrawal', 'loanInstalment'] as const;
export type LineType = (typeof TYPES)[number];
export const LABELS: Record<LineType, string> = {
  deposit: 'Deposit',
  withdrawal: 'Withdrawal',
  loanInstalment: 'Loan instalment',
};
export interface RecordingEvent {
  actorName?: string;
  by: string;
  at: Timestamp;
  recorded: boolean;
}
export type AccountType = 'fixed' | 'saving';
export const ACCOUNT_TYPES = { fixed: 'Fixed', saving: 'Saving' } as const;
export interface AgentNote {
  noteId: string;
  body: string;
  createdAt: Timestamp;
}
export interface Line {
  accountType?: AccountType;
  amount: number;
  state: 'active' | 'voided';
  recorded: boolean;
  recordedBy: string | null;
  recordedAt: Timestamp | null;
  voidedBy: string | null;
  voidedAt: Timestamp | null;
  voidReason: string;
  recordingRevision: number;
  recordingHistory: Record<string, RecordingEvent>;
}
export interface Entry {
  entryId: string;
  /** Type intent uses internal directory references; no real account is assigned. */
  accountSelection?: 'type';
  otherAccountId?: string;
  note?: string;
  sessionId: string;
  workday: string;
  agentId: string;
  agentNameSnapshot: string;
  memberId: string;
  accountNumberSnapshot: string;
  uniqueNumberSnapshot?: string;
  memberNameSnapshot: string;
  createdAt: Timestamp;
  financialRevision: number;
  lines: Partial<Record<LineType, Line>>;
}
export interface Row {
  entry: Entry;
  type: LineType;
  line: Line;
}
export const flatten = (entries: Entry[]): Row[] =>
  entries.flatMap((entry) =>
    TYPES.flatMap((type) =>
      entry.lines[type] ? [{ entry, type, line: entry.lines[type]! }] : [],
    ),
  );

export const entryAccountLabel = (
  entry: Pick<Entry, 'accountNumberSnapshot' | 'accountSelection'>,
  line?: { accountType?: AccountType },
) =>
  entry.accountSelection === 'type'
    ? line?.accountType
      ? ACCOUNT_TYPES[line.accountType]
      : 'Account type selected per amount'
    : entry.accountNumberSnapshot;

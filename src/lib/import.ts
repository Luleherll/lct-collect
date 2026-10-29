import { isDirectoryNumber } from './account';
import type { Member } from './models';
export interface ImportRow {
  memberId: string;
  accountNumber: string;
  uniqueNumber: string;
  fullName: string;
  action: 'Add' | 'Update' | 'Unchanged';
  previous?: { accountNumber: string; fullName: string; fingerprint: string };
}
export interface ImportPlan {
  rows: ImportRow[];
  errors: string[];
  existing?: Member[];
  reserved?: string[];
  duplicatesSkipped?: number;
  memberCount?: number;
}
export function csvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [],
    cell = '',
    quoted = false;
  text = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else quoted = !quoted;
    } else if (c === ',' && !quoted) {
      row.push(cell);
      cell = '';
    } else if ((c === '\n' || c === '\r') && !quoted) {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      if (row.some((v) => v.trim())) rows.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  if (quoted)
    throw new Error('The CSV has an unclosed quoted value. Export it again.');
  row.push(cell);
  if (row.some((v) => v.trim())) rows.push(row);
  return rows;
}
export function planImport(text: string, existing: Member[]): ImportPlan {
  const table = csvRows(text),
    headers = table.shift()?.map((h) => h.trim().toLowerCase()) ?? [];
  const cols = ['account number', 'unique number', 'account name'].map((k) =>
    headers.indexOf(k),
  );
  if (cols.some((i) => i < 0))
    throw new Error(
      'Required columns: Account Number, Unique Number and Account Name. Keep all accounts in the export.',
    );
  const legacyColumn = headers.indexOf('account id');
  const rows: ImportRow[] = [],
    errors: string[] = [],
    seen = new Map<string, ImportRow>(),
    names = new Map<string, string>();
  let duplicatesSkipped = 0;
  for (const [index, cells] of table.entries()) {
    const [accountNumber, uniqueNumber, rawName] = cols.map((i) =>
      (cells[i] ?? '').trim(),
    );
    const fullName = rawName.replace(/\s+/g, ' '),
      prefix = `Row ${index + 2}`;
    if (
      !/^[0-9]{1,40}$/.test(accountNumber) ||
      !isDirectoryNumber(uniqueNumber) ||
      !fullName ||
      fullName.length > 120
    ) {
      errors.push(
        `${prefix}: check the numeric Account Number, LCT/ABC Unique Number and name (up to 120 characters). Preserve prefixes, spacing and leading zeros.`,
      );
      continue;
    }
    const prior = seen.get(accountNumber);
    if (prior) {
      if (
        prior.uniqueNumber !== uniqueNumber ||
        prior.fullName.toLowerCase() !== fullName.toLowerCase()
      )
        errors.push(
          `${prefix}: account ${accountNumber} has conflicting member details.`,
        );
      else duplicatesSkipped++;
      continue;
    }
    const memberName = names.get(uniqueNumber);
    if (memberName && memberName.toLowerCase() !== fullName.toLowerCase()) {
      errors.push(
        `${prefix}: member ${uniqueNumber} has conflicting names. Review the export.`,
      );
      continue;
    }
    names.set(uniqueNumber, fullName);
    let old = existing.find((m) => m.accountNumber === accountNumber);
    // Restore an account linked by the earlier member-as-account interpretation.
    // The original source ID is used only for a verified legacy bridge.
    if (!old && legacyColumn >= 0) {
      const sourceId = (cells[legacyColumn] ?? '').trim();
      const legacy = existing.find((m) => m.memberId === sourceId);
      if (legacy) {
        if (!legacy.uniqueNumber && legacy.accountNumber === uniqueNumber)
          old = legacy;
        else {
          errors.push(
            `${prefix}: the original account ID is linked to a different account number. Review the export.`,
          );
          continue;
        }
      }
    }
    if (old?.uniqueNumber && old.uniqueNumber !== uniqueNumber) {
      errors.push(
        `${prefix}: account ${accountNumber} belongs to a different member number. Review it before importing.`,
      );
      continue;
    }
    const memberId = old?.memberId ?? `acct_${accountNumber}`;
    if (
      rows.some((r) => r.memberId === memberId) ||
      existing.some((m) => m.memberId === memberId && m !== old)
    ) {
      errors.push(
        `${prefix}: account identity conflicts with the current directory.`,
      );
      continue;
    }
    const row: ImportRow = {
      memberId,
      accountNumber,
      uniqueNumber,
      fullName,
      ...(old
        ? {
            previous: {
              accountNumber: old.accountNumber,
              fullName: old.fullName,
              fingerprint: memberFingerprint(old),
            },
          }
        : {}),
      action: !old
        ? 'Add'
        : old.fullName !== fullName ||
            old.accountNumber !== accountNumber ||
            old.uniqueNumber !== uniqueNumber
          ? 'Update'
          : 'Unchanged',
    };
    seen.set(accountNumber, row);
    rows.push(row);
  }
  const combined = new Map(existing.map((m) => [m.memberId, m.accountNumber]));
  rows.forEach((r) => combined.set(r.memberId, r.accountNumber));
  const owners = new Map<string, string>();
  for (const [id, number] of combined) {
    if (owners.has(number) && owners.get(number) !== id)
      errors.push(
        `Account number ${number} belongs to more than one directory record.`,
      );
    owners.set(number, id);
  }
  const finalMembers = new Map(
    existing.map((m) => [
      m.memberId,
      { uniqueNumber: m.uniqueNumber, fullName: m.fullName },
    ]),
  );
  rows.forEach((r) => finalMembers.set(r.memberId, r));
  const finalNames = new Map<string, string>();
  for (const m of finalMembers.values()) {
    if (!m.uniqueNumber) continue;
    const normalized = m.fullName.replace(/\s+/g, ' ').trim().toLowerCase();
    const prior = finalNames.get(m.uniqueNumber);
    if (prior && prior !== normalized)
      errors.push(
        `Member ${m.uniqueNumber} has conflicting names across its accounts. Include all affected accounts when updating a member name.`,
      );
    finalNames.set(m.uniqueNumber, normalized);
  }
  if (!rows.length && !errors.length) errors.push('No account rows found.');
  return {
    rows,
    errors,
    existing,
    duplicatesSkipped,
    memberCount: new Set(rows.map((r) => r.uniqueNumber)).size,
  };
}
export const memberFingerprint = (m: Member) =>
  JSON.stringify([
    m.memberId,
    m.accountNumber,
    m.uniqueNumber ?? null,
    m.fullName,
    m.active,
    m.updatedAt?.toMillis?.() ?? 0,
  ]);

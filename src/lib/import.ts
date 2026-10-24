import type { Member } from './models';
export interface ImportRow {
  memberId: string;
  accountNumber: string;
  fullName: string;
  action: 'Add' | 'Update' | 'Unchanged';
  previous?: { accountNumber: string; fullName: string; fingerprint: string };
}
export interface ImportPlan {
  rows: ImportRow[];
  errors: string[];
  existing?: Member[];
  reserved?: string[];
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
  const cols = ['account id', 'account number', 'account name'].map((k) =>
    headers.indexOf(k),
  );
  if (cols.some((i) => i < 0))
    throw new Error(
      'Required columns: Account Id, Account Number, Account Name.',
    );
  const rows: ImportRow[] = [],
    errors: string[] = [],
    seen = new Set<string>(),
    numbers = new Map<string, string>();
  for (const [index, cells] of table.entries()) {
    const [memberId, accountNumber, rawName] = cols.map((i) =>
        (cells[i] ?? '').trim(),
      ),
      fullName = rawName.replace(/\s+/g, ' ');
    const prefix = `Row ${index + 2}`;
    if (
      !/^\d{1,32}$/.test(memberId) ||
      !/^\d{1,40}$/.test(accountNumber) ||
      !fullName ||
      fullName.length > 120
    ) {
      errors.push(
        `${prefix}: check ID, account number and name. IDs must be text containing digits, without scientific notation.`,
      );
      continue;
    }
    if (seen.has(memberId)) {
      errors.push(`${prefix}: duplicate account ID ${memberId}.`);
      continue;
    }
    seen.add(memberId);
    const old = existing.find((m) => m.memberId === memberId);
    const owner = existing.find(
      (m) => m.accountNumber === accountNumber && m.memberId !== memberId,
    );
    if (owner) {
      errors.push(
        `${prefix}: account number ${accountNumber} is already assigned to account ID ${owner.memberId}. Numbers cannot move between IDs in a bulk import.`,
      );
      continue;
    }
    rows.push({
      memberId,
      accountNumber,
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
        : old.fullName !== fullName || old.accountNumber !== accountNumber
          ? 'Update'
          : 'Unchanged',
    });
  }
  const combined = new Map(existing.map((m) => [m.memberId, m.accountNumber]));
  rows.forEach((r) => combined.set(r.memberId, r.accountNumber));
  for (const [id, number] of combined) {
    const other = numbers.get(number);
    if (other && other !== id)
      errors.push(
        `Account number ${number} belongs to more than one account ID.`,
      );
    numbers.set(number, id);
  }
  if (!rows.length && !errors.length) errors.push('No account rows found.');
  return { rows, errors, existing };
}

export const memberFingerprint = (m: Member) =>
  JSON.stringify([
    m.memberId,
    m.accountNumber,
    m.fullName,
    m.active,
    m.updatedAt?.toMillis?.() ?? 0,
  ]);

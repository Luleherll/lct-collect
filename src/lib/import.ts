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
  const cols = ['unique number', 'account name'].map((k) => headers.indexOf(k));
  if (cols.some((i) => i < 0))
    throw new Error(
      'Required columns: Unique Number and Account Name. Unique Number must look like LCT002.',
    );
  const legacyColumn = headers.indexOf('account id');
  const hasLegacy = existing.some((m) => !m.accountNumber.startsWith('LCT'));
  const linked = new Set<string>();
  const rows: ImportRow[] = [],
    errors: string[] = [],
    seen = new Set<string>(),
    numbers = new Map<string, string>();
  for (const [index, cells] of table.entries()) {
    const [accountNumber, rawName] = cols.map((i) => (cells[i] ?? '').trim()),
      fullName = rawName.replace(/\s+/g, ' ');
    const prefix = `Row ${index + 2}`;
    if (
      !/^LCT[0-9]{1,37}$/.test(accountNumber) ||
      !fullName ||
      fullName.length > 120
    ) {
      errors.push(
        `${prefix}: enter a Unique Number such as LCT002 and a name up to 120 characters. Keep the LCT prefix and leading zeros.`,
      );
      continue;
    }
    if (seen.has(accountNumber)) {
      errors.push(`${prefix}: duplicate Unique Number ${accountNumber}.`);
      continue;
    }
    seen.add(accountNumber);
    let old = existing.find((m) => m.accountNumber === accountNumber);
    // Owner-approved one-time bridge: never derive a new identity from the old
    // CSV columns. Only preserve a known legacy document and its financial links.
    if (!old && hasLegacy) {
      const legacyId =
        legacyColumn >= 0 ? (cells[legacyColumn] ?? '').trim() : '';
      if (!/^[0-9]{1,32}$/.test(legacyId)) {
        errors.push(
          `${prefix}: the existing directory needs one-time linking. Include the original Account Id column for this upload; names alone cannot safely link accounts.`,
        );
        continue;
      }
      const legacy = existing.find((m) => m.memberId === legacyId);
      if (legacy?.accountNumber.startsWith('LCT')) {
        errors.push(
          `${prefix}: the original account is already linked to a different LCT number. Correct the export before applying.`,
        );
        continue;
      }
      old = legacy;
    }
    const memberId = old?.memberId ?? accountNumber;
    if (linked.has(memberId)) {
      errors.push(
        `${prefix}: two LCT numbers point to the same existing account. Correct the export before applying.`,
      );
      continue;
    }
    linked.add(memberId);
    const identity = existing.find((m) => m.memberId === memberId && m !== old);
    if (identity) {
      errors.push(
        `${prefix}: ${accountNumber} conflicts with an existing directory record. Ask the owner to resolve it.`,
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
        `Account number ${number} belongs to more than one directory record.`,
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

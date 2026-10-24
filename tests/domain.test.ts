import { describe, expect, it } from 'vitest';
import { Timestamp } from 'firebase/firestore';
import {
  amount,
  bounds,
  cash,
  searchMembers,
  usernameEmail,
  workday,
} from '../src/lib/domain';
import { csvRows, planImport } from '../src/lib/import';
import { groupAccounts, isDirectoryNumber } from '../src/lib/account';
import type { Member } from '../src/lib/models';
describe('Uganda workday', () => {
  it.each([
    ['2026-10-18T22:59:59.999Z', '2026-10-18'],
    ['2026-10-18T23:00:00.000Z', '2026-10-19'],
    ['2026-10-18T22:30:00Z', '2026-10-18'],
    ['2026-12-31T23:00:00Z', '2027-01-01'],
    ['2028-02-28T23:00:00Z', '2028-02-29'],
  ])('%s belongs to %s', (input, day) =>
    expect(workday(new Date(input))).toBe(day),
  );
  it('uses a half-open 24 hour interval', () => {
    const b = bounds('2026-10-19');
    expect(b.start.toISOString()).toBe('2026-10-18T23:00:00.000Z');
    expect(b.end.toISOString()).toBe('2026-10-19T23:00:00.000Z');
  });
  it('rejects rolled-over calendar dates', () =>
    expect(() => bounds('2026-02-30')).toThrow());
});
describe('whole-UGX cash', () => {
  it('parses blanks as zero only when requested', () => {
    expect(amount('', true)).toBe(0);
    expect(() => amount('')).toThrow();
    expect(amount('100,000')).toBe(100000);
  });
  it.each(['-1', '1.5', 'NaN', '1e6', '100000001', 'Infinity'])(
    'rejects %s',
    (s) => expect(() => amount(s, true)).toThrow(),
  );
  it('computes expected cash and prevents negative reversals', () => {
    expect(cash(100000, 200000, 50000, 75000)).toBe(325000);
    expect(() => cash(0, 0, 1, 0)).toThrow();
  });
});
describe('member identity', () => {
  const members = [
    {
      memberId: '0137',
      accountNumber: '001337',
      fullName: 'Example Person',
      active: true,
    },
    {
      memberId: '2',
      accountNumber: '002002',
      fullName: 'Example Person',
      active: true,
    },
    {
      memberId: '3',
      accountNumber: '003003',
      fullName: 'Inactive Example',
      active: false,
    },
  ];
  it('keeps accounts separate, supports partial names and exact account-number strings', () => {
    expect(searchMembers(members, '001337')[0].memberId).toBe('0137');
    expect(searchMembers(members, 'Example')).toHaveLength(2);
    expect(searchMembers(members, '002002')[0].memberId).toBe('2');
    expect(searchMembers(members, 'inactive')).toHaveLength(0);
  });
  it('normalizes usernames into reserved internal identities', () => {
    expect(usernameEmail(' Agent.One ')).toBe(
      'agent.one@users.lct-collect.invalid',
    );
    expect(() => usernameEmail('real@example.com')).toThrow();
  });
});
describe('member and account directory import', () => {
  const header = 'Account Id,Account Number,Unique Number,Account Name\n';
  it('keeps each account while grouping matching member numbers', () => {
    const plan = planImport(
      header +
        '1,000101,LCT002,Example\n2,000202,LCT002,Example\n3,000303,ABC 2,Example group',
      [],
    );
    expect(plan.errors).toEqual([]);
    expect(plan.rows).toHaveLength(3);
    expect(plan.memberCount).toBe(2);
    expect(plan.rows[0]).toMatchObject({
      memberId: 'acct_000101',
      accountNumber: '000101',
      uniqueNumber: 'LCT002',
    });
    const grouped = groupAccounts(
      plan.rows.map((r) => ({
        ...r,
        active: true,
        searchName: r.fullName.toLowerCase(),
        updatedAt: Timestamp.fromMillis(0),
      })) as Member[],
    );
    expect(
      grouped.find((g) => g.uniqueNumber === 'LCT002')?.accounts,
    ).toHaveLength(2);
    expect(grouped.find((g) => g.uniqueNumber === 'ABC 2')?.group).toBe(true);
  });
  it('preserves existing record identities, inactive state and historical account numbers', () => {
    const existing = [
      {
        memberId: '0137',
        accountNumber: '000101',
        fullName: 'Old',
        active: false,
      },
    ] as Member[];
    const plan = planImport(header + '999,000101,LCT002,Updated', existing);
    expect(plan.errors).toEqual([]);
    expect(plan.rows[0]).toMatchObject({
      memberId: '0137',
      accountNumber: '000101',
      uniqueNumber: 'LCT002',
      action: 'Update',
    });
    expect(existing[0].active).toBe(false);
  });
  it('restores records affected by the earlier member-as-account interpretation using the original ID', () => {
    const existing = [
      {
        memberId: '137',
        accountNumber: 'LCT002',
        fullName: 'Name',
        active: true,
      },
    ] as Member[];
    const plan = planImport(header + '137,000101,LCT002,Name', existing);
    expect(plan.errors).toEqual([]);
    expect(plan.rows[0].memberId).toBe('137');
    expect(
      planImport(header + '137,000101,LCT003,Name', existing).errors,
    ).not.toEqual([]);
  });
  it('skips only identical account rows and rejects conflicting account or member names', () => {
    const same = planImport(
      header + '1,001,LCT002,Name\n1,001,LCT002,Name',
      [],
    );
    expect(same.errors).toEqual([]);
    expect(same.rows).toHaveLength(1);
    expect(same.duplicatesSkipped).toBe(1);
    expect(
      planImport(header + '1,001,LCT002,A\n1,001,LCT003,B', []).errors,
    ).not.toEqual([]);
    expect(
      planImport(header + '1,001,LCT002,A\n2,002,LCT002,B', []).errors,
    ).not.toEqual([]);
  });
  it('supports ABC formatting and searches all accounts under the matched member', () => {
    expect(isDirectoryNumber('ABC 2')).toBe(true);
    expect(isDirectoryNumber('ABC411')).toBe(true);
    for (const code of [
      'abc2',
      'ABC',
      'ABC  2',
      'ABC/2',
      'LCT' + '0'.repeat(38),
    ])
      expect(isDirectoryNumber(code)).toBe(false);
    const accounts = [
      {
        memberId: '1',
        accountNumber: '001',
        uniqueNumber: 'ABC 2',
        fullName: 'Group',
        active: true,
      },
      {
        memberId: '2',
        accountNumber: '002',
        uniqueNumber: 'ABC 2',
        fullName: 'Group',
        active: true,
      },
    ] as Member[];
    expect(groupAccounts(accounts, 'abc2')[0].accounts).toHaveLength(2);
    expect(groupAccounts(accounts, '002')[0].accounts).toHaveLength(2);
  });
  it('keeps same-name people with different member numbers separate and does not reassign an account', () => {
    const p = planImport(header + '1,001,LCT002,Same\n2,002,LCT003,Same', []);
    expect(p.memberCount).toBe(2);
    expect(
      planImport(header + '1,001,LCT003,Same', [
        {
          memberId: '1',
          accountNumber: '001',
          uniqueNumber: 'LCT002',
          fullName: 'Same',
        },
      ] as Member[]).errors,
    ).not.toEqual([]);
  });
  it('supports CSV quoting, BOM and rejects missing or malformed identities', () => {
    expect(csvRows('A,B\n"a\nb","x""y"')[1]).toEqual(['a\nb', 'x"y']);
    expect(() => csvRows('"oops')).toThrow();
    expect(() =>
      planImport('Unique Number,Account Name\nLCT002,A', []),
    ).toThrow('Account Number');
    expect(planImport(header + '1,1e9,LCT002,A', []).errors).not.toEqual([]);
    expect(
      planImport('\uFEFF' + header + '1,001,LCT002,"Person, Example"', [])
        .rows[0].fullName,
    ).toBe('Person, Example');
  });
});

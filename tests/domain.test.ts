import { describe, expect, it } from 'vitest';
import {
  amount,
  bounds,
  cash,
  searchMembers,
  usernameEmail,
  workday,
} from '../src/lib/domain';
import { csvRows, planImport } from '../src/lib/import';
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
  it('keeps accounts separate, supports partial names and exact string IDs', () => {
    expect(searchMembers(members, '0137')[0].memberId).toBe('0137');
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
describe('Ssentezo directory import', () => {
  const header =
    'Account Id,Account Number,Unique Number,Account Name,Amount\r\n';
  it('extracts only account ID, number and name while retaining zeros', () => {
    const p = planImport(
      '\uFEFF' + header + '0137,0000137,IGNORED,"Example, Person",999\r\n',
      [],
    );
    expect(p.errors).toEqual([]);
    expect(p.rows).toEqual([
      {
        memberId: '0137',
        accountNumber: '0000137',
        fullName: 'Example, Person',
        action: 'Add',
      },
    ]);
  });
  it('updates by account ID and preserves absent accounts', () => {
    const existing = [
      { memberId: '1', accountNumber: '001', fullName: 'Old name' },
      { memberId: '2', accountNumber: '002', fullName: 'Other' },
    ] as Member[];
    const p = planImport(header + '1,001,X,New name,\n', existing);
    expect(p.rows).toHaveLength(1);
    expect(p.rows[0].action).toBe('Update');
    expect(existing).toHaveLength(2);
  });
  it('rejects duplicate IDs and account-number collisions', () => {
    expect(
      planImport(header + '1,001,X,A,\n1,002,Y,B,', []).errors.length,
    ).toBeGreaterThan(0);
    expect(
      planImport(header + '1,001,X,A,\n2,001,Y,B,', []).errors.length,
    ).toBeGreaterThan(0);
  });
  it('permits different accounts with the same name', () =>
    expect(
      planImport(header + '1,001,X,Same name,\n2,002,Y,Same name,', []).errors,
    ).toEqual([]));
  it('supports embedded newlines and escaped quotes', () =>
    expect(csvRows('A,B\n"a\nb","x""y"')[1]).toEqual(['a\nb', 'x"y']));
  it('rejects malformed files and missing columns', () => {
    expect(() => csvRows('"oops')).toThrow();
    expect(() => planImport('Name,ID\nA,1', [])).toThrow();
  });
});

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
describe('Ssentezo directory import', () => {
  const header =
    'Account Id,Account Number,Unique Number,Account Name,Amount\r\n';
  it('imports name and LCT unique number only, preserving zeros and ignoring old columns', () => {
    const p = planImport(
      '\uFEFF' + header + '0137,0000137,LCT002,"Example, Person",999\r\n',
      [],
    );
    expect(p.errors).toEqual([]);
    expect(p.rows).toEqual([
      {
        memberId: 'LCT002',
        accountNumber: 'LCT002',
        fullName: 'Example, Person',
        action: 'Add',
      },
    ]);
    expect(planImport('Unique Number,Account Name\nLCT002,A', []).rows).toEqual(
      [
        {
          memberId: 'LCT002',
          accountNumber: 'LCT002',
          fullName: 'A',
          action: 'Add',
        },
      ],
    );
  });
  it('matches existing accounts by LCT number and ignores misleading legacy columns', () => {
    const existing = [
      { memberId: 'old-key', accountNumber: 'LCT002', fullName: 'Old' },
      { memberId: 'other', accountNumber: 'LCT003', fullName: 'Other' },
    ] as Member[];
    const p = planImport(header + 'other,ignored,LCT002,Updated,', existing);
    expect(p.errors).toEqual([]);
    expect(p.rows[0]).toMatchObject({
      memberId: 'old-key',
      accountNumber: 'LCT002',
      action: 'Update',
    });
    expect(existing).toHaveLength(2);
  });
  it('links a legacy record once, preserving identity and permitting name changes', () => {
    const existing = [
      { memberId: '0137', accountNumber: '0000137', fullName: 'Old' },
    ] as Member[];
    const p = planImport(header + '0137,IGNORED,LCT002,New name,', existing);
    expect(p.errors).toEqual([]);
    expect(p.rows[0]).toMatchObject({
      memberId: '0137',
      accountNumber: 'LCT002',
      fullName: 'New name',
      action: 'Update',
    });
    expect(p.rows[0].previous?.accountNumber).toBe('0000137');
  });
  it('does not guess legacy links by name or map two LCT numbers to one legacy record', () => {
    const existing = [
      { memberId: '137', accountNumber: '137', fullName: 'Same name' },
    ] as Member[];
    expect(
      planImport('Unique Number,Account Name\nLCT002,Same name', existing)
        .errors,
    ).not.toEqual([]);
    expect(
      planImport(header + '137,x,LCT002,A,\n137,y,LCT003,B,', existing).errors,
    ).not.toEqual([]);
  });
  it('rejects conflicting relinks while a legacy transition is only partially complete', () => {
    const existing = [
      { memberId: '1', accountNumber: 'LCT002', fullName: 'A' },
      { memberId: '2', accountNumber: '002', fullName: 'B' },
    ] as Member[];
    expect(
      planImport(header + '1,ignored,LCT003,A,', existing).errors,
    ).not.toEqual([]);
    const resumed = planImport(
      header + '1,ignored,LCT002,A,\n2,ignored,LCT003,B,',
      existing,
    );
    expect(resumed.errors).toEqual([]);
    expect(resumed.rows.map((r) => r.action)).toEqual(['Unchanged', 'Update']);
    expect(resumed.rows.map((r) => r.memberId)).toEqual(['1', '2']);
  });
  it('rejects duplicate unique numbers and malformed identifiers', () => {
    expect(
      planImport(header + '1,1,LCT002,A,\n2,2,LCT002,B,', []).errors,
    ).not.toEqual([]);
    for (const number of [
      '002',
      'lct002',
      'LCT',
      'LCT/002',
      'LCT2.0',
      'LCT' + '0'.repeat(38),
    ])
      expect(
        planImport(`Unique Number,Account Name\n${number},A`, []).errors,
      ).not.toEqual([]);
  });
  it('permits distinct LCT accounts with the same name', () => {
    expect(
      planImport(
        'Unique Number,Account Name\nLCT002,Same name\nLCT003,Same name',
        [],
      ).errors,
    ).toEqual([]);
  });
  it('does not match an existing document key to a different LCT account', () => {
    expect(
      planImport('Unique Number,Account Name\nLCT002,A', [
        { memberId: 'LCT002', accountNumber: 'LCT003', fullName: 'B' },
      ] as Member[]).errors,
    ).not.toEqual([]);
  });
  it('supports embedded newlines and escaped quotes', () =>
    expect(csvRows('A,B\n"a\nb","x""y"')[1]).toEqual(['a\nb', 'x"y']));
  it('rejects malformed files and missing columns', () => {
    expect(() => csvRows('"oops')).toThrow();
    expect(() =>
      planImport('Account Id,Account Number,Account Name\n1,2,A', []),
    ).toThrow('Unique Number');
  });
});

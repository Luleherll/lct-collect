import { expect, it } from 'vitest';
import { planImport } from '../src/lib/import';
import type { Member } from '../src/lib/models';

const header =
  'Name,Client Unique #,Saving Account #,Created At,Product,Balance UGX,Mobile,District,Last Transaction,Status,\n';

it('accepts the savings export and retains every separate account and exact identifier', () => {
  const plan = planImport(
    '\uFEFF' +
      header +
      'Ms. Example Member,LCT0007,000401001007,2026-01-01,Savings account,"120,000",,,,Open,View/Modify\n' +
      'Ms. Example Member,LCT0007,000401002007,2026-01-01,Fixed Deposit account.,500000,,,,Open,View/Modify\n' +
      'Example Group,ABC 2,000401001008,,,,,,,Open,View/Modify\n',
    [],
  );
  expect(plan.errors).toEqual([]);
  expect(plan.rows).toHaveLength(3);
  expect(plan.memberCount).toBe(2);
  expect(plan.rows[0]).toMatchObject({
    memberId: 'acct_000401001007',
    accountNumber: '000401001007',
    uniqueNumber: 'LCT0007',
    fullName: 'Ms. Example Member',
  });
  expect(plan.rows[1].accountNumber).toBe('000401002007');
  expect(plan.rows[2].uniqueNumber).toBe('ABC 2');
  expect(plan.duplicatesSkipped).toBe(0);
});

it('matches savings exports by account number, preserves directory IDs and does not change omitted accounts', () => {
  const existing = [
    {
      memberId: 'legacy-id',
      accountNumber: '000101',
      uniqueNumber: 'LCT0007',
      fullName: 'Old name',
      active: false,
    },
    {
      memberId: 'omitted-id',
      accountNumber: '000102',
      uniqueNumber: 'ABC 2',
      fullName: 'Example Group',
      active: true,
    },
  ] as Member[];
  const before = structuredClone(existing);
  const plan = planImport(
    header + 'New name,LCT0007,000101,,,,,,,Open,View/Modify',
    existing,
  );
  expect(plan.errors).toEqual([]);
  expect(plan.rows).toHaveLength(1);
  expect(plan.rows[0]).toMatchObject({
    memberId: 'legacy-id',
    action: 'Update',
    previous: { accountNumber: '000101', fullName: 'Old name' },
  });
  expect(existing).toEqual(before);
  expect(plan.existing).toEqual(before);
  expect(
    planImport(header + 'New name,LCT0008,000101', existing).errors,
  ).not.toEqual([]);
});

it('recognizes header case and spacing while reporting the specific missing column', () => {
  expect(
    planImport(
      ' saving   account # , CLIENT UNIQUE # , name \n0001,LCT0007,Example',
      [],
    ).errors,
  ).toEqual([]);
  expect(() => planImport('Name,Client Unique #\nExample,LCT0007', [])).toThrow(
    'Missing column: Account Number (or Saving Account #)',
  );
  expect(() => planImport('Name,Saving Account #\nExample,0001', [])).toThrow(
    'Missing column: Unique Number (or Client Unique #)',
  );
  expect(() =>
    planImport('Client Unique #,Saving Account #\nLCT0007,0001', []),
  ).toThrow('Missing column: Account Name (or Name)');
});

it('blocks ambiguous or duplicate identity columns instead of choosing one silently', () => {
  for (const extra of [
    'Account Number',
    'Saving Account #',
    'Unique Number',
    'Client Unique #',
    'Account Name',
    'Name',
  ])
    expect(() =>
      planImport(
        header.trimEnd() + extra + '\nExample,LCT0007,0001,,,,,,,Open,other',
        [],
      ),
    ).toThrow('More than one column matches');
});

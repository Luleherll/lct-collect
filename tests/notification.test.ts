import { expect, it } from 'vitest';
import { reminderPreview } from '../functions/src/notification';

it('makes a short single-line note preview without breaking emoji', () => {
  expect(
    reminderPreview('  Bring the passbook.\n\tConfirm the balance.  '),
  ).toBe('Bring the passbook. Confirm the balance.');
  expect(reminderPreview('x'.repeat(120))).toBe('x'.repeat(120));
  expect(reminderPreview('x'.repeat(121))).toBe('x'.repeat(119) + '…');
  const emoji = '👩🏽‍💻';
  expect(reminderPreview(emoji.repeat(121))).toBe(emoji.repeat(119) + '…');
  for (const body of ['', ' \n ', null, undefined, 123, {}])
    expect(reminderPreview(body)).toBe('');
});

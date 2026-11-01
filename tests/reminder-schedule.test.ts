import { describe, it, expect } from 'vitest';
import {
  nextWeekly,
  firstOccurrence,
  parseReminder,
  localDateTime,
  fromLocalDateTime,
} from '../functions/src/schedule';
describe('Kampala reminder scheduling', () => {
  it('keeps local times stable across UTC date boundaries and leap days', () => {
    for (const text of ['2028-02-29T00:15', '2026-11-01T23:59'])
      expect(localDateTime(fromLocalDateTime(text))).toBe(text);
  });
  it('selects the next weekday in Kampala, strictly after the prior occurrence', () => {
    const monday = Date.parse('2026-11-02T09:00:00+03:00'),
      r = { kind: 'weekly' as const, day: 1, minute: 540 };
    expect(nextWeekly(r, monday - 1)).toBe(monday);
    expect(nextWeekly(r, monday)).toBe(monday + 7 * 86400000);
    expect(
      nextWeekly(
        { kind: 'weekly', day: 0, minute: 15 },
        Date.parse('2026-10-31T23:30:00+03:00'),
      ),
    ).toBe(Date.parse('2026-11-01T00:15:00+03:00'));
  });
  it('rejects malformed schedules and past one-off dates', () => {
    for (const input of [
      { kind: 'weekly', day: 7, minute: 0 },
      { kind: 'weekly', day: 1, minute: 1440 },
      { kind: 'once', at: NaN },
      { kind: 'none', extra: true },
    ])
      expect(() => parseReminder(input)).toThrow();
    expect(() => firstOccurrence({ kind: 'once', at: 100 }, 100)).toThrow(
      'future',
    );
    expect(firstOccurrence({ kind: 'none' }, 100)).toBeNull();
  });
});

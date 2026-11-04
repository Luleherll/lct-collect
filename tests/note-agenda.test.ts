import { describe, expect, it } from 'vitest';
import { Timestamp } from 'firebase/firestore';
import {
  agendaHeading,
  noteDay,
  noteOccurrence,
  noteTime,
  upcomingNotes,
} from '../src/lib/noteAgenda';
import { project } from '../src/lib/projection';
import type { AgentNote } from '../src/lib/models';
import type { Command } from '../functions/src/protocol';
const now = Date.parse('2026-11-04T09:00:00+03:00');
const note = (id: string, fields: Partial<AgentNote> = {}): AgentNote => ({
  noteId: id,
  body: id,
  createdAt: Timestamp.fromMillis(now),
  ...fields,
});
describe('note agenda', () => {
  it('groups by Kampala calendar dates even when the browser is on a different UTC day', () => {
    const tomorrow = Date.parse('2026-11-04T22:00:00Z');
    expect(noteDay(tomorrow)).toBe('2026-11-05');
    expect(agendaHeading(now, now)).toBe('Today');
    expect(agendaHeading(tomorrow, now)).toMatch(/^Tomorrow/);
    expect(agendaHeading(now - 86400000, now)).toMatch(/^Overdue/);
    expect(noteTime(Date.parse('2026-11-04T06:15:00Z'))).toMatch(/9:15\s?am/);
    expect(agendaHeading(Date.parse('2027-01-01T09:00:00Z'), now)).toContain(
      '2027',
    );
  });
  it('sorts every unfinished reminder before pagination and keeps undated/completed notes out', () => {
    const notes = Array.from({ length: 60 }, (_, i) =>
      note(String(i), {
        reminder: { kind: 'once', at: now + (60 - i) * 60000 },
      }),
    );
    const upcoming = upcomingNotes([
      ...notes,
      note('undated'),
      note('completed', {
        done: true,
        reminder: { kind: 'once', at: now - 1 },
      }),
    ]);
    expect(upcoming).toHaveLength(60);
    expect(upcoming[0].noteId).toBe('59');
    expect(upcoming[59].noteId).toBe('0');
  });
  it('uses a weekly occurrence from the server and derives one for a locally saved note', () => {
    const weekly = note('weekly', {
      reminder: { kind: 'weekly', day: 5, minute: 540 },
    });
    expect(noteOccurrence(weekly)).toBe(
      Date.parse('2026-11-06T09:00:00+03:00'),
    );
    expect(noteOccurrence({ ...weekly, occurrenceAt: now - 86400000 })).toBe(
      now - 86400000,
    );
    expect(noteOccurrence(note('plain'))).toBeNull();
  });
  it('resets completion and occurrence immediately when an offline edit changes its schedule', () => {
    const path = 'users/agent/notes/weekly';
    const old = note('weekly', {
      done: true,
      reminder: { kind: 'weekly', day: 5, minute: 540 },
      occurrenceAt: now,
    });
    const command: Command = {
      version: 1,
      id: 'edit',
      deviceId: 'test',
      sequence: 1,
      capturedAt: now,
      scope: 'note:weekly',
      kind: 'note',
      dependsOn: null,
      data: {
        action: 'save',
        noteId: 'weekly',
        body: 'Edited',
        tags: [],
        reminder: { kind: 'once', at: now + 86400000 },
      },
    };
    const edited = project({ [path]: old }, command, 'agent')[path];
    expect(edited.done).toBe(false);
    expect(edited.occurrenceAt).toBe(now + 86400000);
    expect(
      project(
        { [path]: old },
        { ...command, data: { ...command.data, reminder: old.reminder } },
        'agent',
      )[path].done,
    ).toBe(true);
  });
});

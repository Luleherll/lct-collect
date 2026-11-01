import { useState } from 'react';
import SearchField from './SearchField';
import Pagination from './Pagination';
import { groupAccounts } from '../lib/account';
import { usePagination } from '../hooks/usePagination';
import type { Member, MemberTag } from '../lib/models';
import {
  localDateTime,
  fromLocalDateTime,
  type Reminder,
} from '../../functions/src/schedule';
export default function NoteEditor({
  body,
  onBody,
  tags,
  onTags,
  reminder,
  onReminder,
  members,
  busy,
  id = 'new-note',
}: {
  body: string;
  onBody: (v: string) => void;
  tags: MemberTag[];
  onTags: (v: MemberTag[]) => void;
  reminder: Reminder;
  onReminder: (v: Reminder) => void;
  members: Member[];
  busy: boolean;
  id?: string;
}) {
  const [tagging, setTagging] = useState(false),
    [scheduling, setScheduling] = useState(reminder.kind !== 'none'),
    [query, setQuery] = useState('');
  const pages = usePagination(
    query.trim() ? groupAccounts(members, query, true) : [],
    query,
  );
  return (
    <>
      <label htmlFor={id}>
        {id === 'new-note' ? 'New note' : 'Note text'}
        <textarea
          aria-label={id === 'new-note' ? 'New note' : 'Note text'}
          className="resize-none"
          id={id}
          maxLength={2000}
          placeholder="What would you like to remember?"
          value={body}
          disabled={busy}
          onChange={(e) => onBody(e.target.value)}
        />
      </label>
      <div className="note-options">
        <button
          type="button"
          className="text-button"
          disabled={busy}
          aria-expanded={tagging}
          onClick={() => setTagging(!tagging)}
        >
          Tag members{tags.length ? ` (${tags.length})` : ''}
        </button>
        <button
          type="button"
          className="text-button"
          disabled={busy}
          aria-expanded={scheduling}
          onClick={() => setScheduling(!scheduling)}
        >
          Reminder
        </button>
      </div>
      {!!tags.length && (
        <div className="note-tags">
          {tags.map((t) => (
            <span key={t.uniqueNumber}>
              {t.fullName} · {t.uniqueNumber}
              <button
                type="button"
                disabled={busy}
                aria-label={`Remove ${t.fullName} tag`}
                onClick={() =>
                  onTags(tags.filter((x) => x.uniqueNumber !== t.uniqueNumber))
                }
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      {tagging && (
        <div className="note-options-panel">
          <SearchField
            label="Tag members by name or number"
            value={query}
            onChange={setQuery}
          />
          {pages.items.map((g) => (
            <button
              type="button"
              className="tag-result"
              key={g.key}
              disabled={
                busy ||
                tags.length >= 10 ||
                tags.some((t) => t.uniqueNumber === g.uniqueNumber) ||
                !g.uniqueNumber
              }
              onClick={() => {
                onTags([
                  ...tags,
                  {
                    memberId: g.accounts[0].memberId,
                    uniqueNumber: g.uniqueNumber!,
                    fullName: g.fullName,
                  },
                ]);
                setQuery('');
              }}
            >
              {g.fullName}
              <small>{g.uniqueNumber}</small>
            </button>
          ))}
          {pages.pageCount > 1 && (
            <Pagination
              label="Tag member pages"
              page={pages.page}
              pageCount={pages.pageCount}
              onPrevious={pages.previous}
              onNext={pages.next}
            />
          )}
          <small className="muted">
            Up to 10 members. Notes stay private to you.
          </small>
        </div>
      )}
      {scheduling && (
        <div className="note-options-panel reminder-fields">
          <label>
            Repeat
            <select
              aria-label="Repeat"
              disabled={busy}
              value={reminder.kind}
              onChange={(e) =>
                onReminder(
                  e.target.value === 'none'
                    ? { kind: 'none' }
                    : e.target.value === 'once'
                      ? {
                          kind: 'once',
                          at: Math.ceil((Date.now() + 3600000) / 60000) * 60000,
                        }
                      : { kind: 'weekly', day: 1, minute: 540 },
                )
              }
            >
              <option value="none">No reminder</option>
              <option value="once">Once</option>
              <option value="weekly">Weekly</option>
            </select>
          </label>
          {reminder.kind === 'once' && (
            <label>
              Date and time (EAT)
              <input
                disabled={busy}
                type="datetime-local"
                value={
                  Number.isFinite(reminder.at) ? localDateTime(reminder.at) : ''
                }
                onChange={(e) =>
                  onReminder({
                    kind: 'once',
                    at: fromLocalDateTime(e.target.value),
                  })
                }
              />
            </label>
          )}
          {reminder.kind === 'weekly' && (
            <>
              <label>
                Weekday
                <select
                  aria-label="Weekday"
                  disabled={busy}
                  value={reminder.day}
                  onChange={(e) =>
                    onReminder({ ...reminder, day: Number(e.target.value) })
                  }
                >
                  {[
                    'Sunday',
                    'Monday',
                    'Tuesday',
                    'Wednesday',
                    'Thursday',
                    'Friday',
                    'Saturday',
                  ].map((d, i) => (
                    <option key={d} value={i}>
                      {d}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Time (EAT)
                <input
                  disabled={busy}
                  type="time"
                  value={`${String(Math.floor(reminder.minute / 60)).padStart(2, '0')}:${String(reminder.minute % 60).padStart(2, '0')}`}
                  onChange={(e) => {
                    const [h, m] = e.target.value.split(':').map(Number);
                    onReminder({ ...reminder, minute: h * 60 + m });
                  }}
                />
              </label>
            </>
          )}
          <small className="muted">
            Africa/Kampala · reminder times use EAT.
          </small>
        </div>
      )}
    </>
  );
}

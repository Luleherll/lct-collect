import { useLayoutEffect, useRef, useState } from 'react';
import SearchField from './SearchField';
import Pagination from './Pagination';
import Icon from './Icon';
import AnchoredResults from './AnchoredResults';
import { groupAccounts } from '../lib/account';
import { usePagination } from '../hooks/usePagination';
import type { Member, MemberTag } from '../lib/models';
import {
  localDateTime,
  fromLocalDateTime,
  reminderLabel,
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
  error = '',
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
  error?: string;
}) {
  const [tagging, setTagging] = useState(false),
    [scheduling, setScheduling] = useState(false),
    [query, setQuery] = useState('');
  const [resultsOpen, setResultsOpen] = useState(false);
  const memberSearch = useRef<HTMLDivElement>(null);
  const resultsId = `${id}-member-results`;
  function dismissResults(restore = false) {
    if (restore)
      memberSearch.current
        ?.querySelector('input')
        ?.focus({ preventScroll: true });
    setResultsOpen(false);
  }
  const text = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    if (text.current) {
      text.current.style.height = 'auto';
      text.current.style.height = `${Math.max(tagging || scheduling ? 84 : 210, text.current.scrollHeight)}px`;
    }
  }, [body, tagging, scheduling]);
  const pages = usePagination(
    query.trim() ? groupAccounts(members, query, true) : [],
    query,
  );
  const reminderError =
    error.includes('future') ||
    error.includes('weekday') ||
    error.includes('reminder date');
  useLayoutEffect(() => {
    if (reminderError) {
      setScheduling(true);
      requestAnimationFrame(() =>
        document.getElementById(`${id}-date`)?.focus(),
      );
    }
  }, [error]);
  return (
    <>
      <label className="sr-only" htmlFor={id}>
        {id === 'new-note' ? 'New note' : 'Note text'}
      </label>
      <textarea
        ref={text}
        className={`note-writing resize-none ${tagging || scheduling ? 'is-compact' : ''}`}
        id={id}
        maxLength={2000}
        placeholder="What would you like to remember?"
        value={body}
        disabled={busy}
        aria-describedby={`${id}-count`}
        onChange={(e) => onBody(e.target.value)}
      />
      <small className="note-count" id={`${id}-count`}>
        {body.length.toLocaleString('en-UG')} / 2,000
      </small>
      <div className="note-editor-option">
        <button
          type="button"
          className="note-option-toggle"
          disabled={busy}
          aria-label="Members"
          aria-expanded={tagging}
          aria-controls={`${id}-members`}
          onClick={() => setTagging(!tagging)}
        >
          <Icon name="people" />
          <span>
            <strong>Members</strong>
            <small>
              {tags.length
                ? `${tags[0].fullName} · ${tags[0].uniqueNumber}${tags.length > 1 ? ` +${tags.length - 1}` : ''}`
                : 'Add members or groups'}
            </small>
          </span>
          <span className="note-option-add">{tags.length ? 'Add' : ''}</span>
          <Icon name={tagging ? 'chevron-up' : 'chevron-right'} />
        </button>
        {tagging && (
          <div className="note-option-body" id={`${id}-members`}>
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
                        onTags(
                          tags.filter((x) => x.uniqueNumber !== t.uniqueNumber),
                        )
                      }
                    >
                      <Icon name="x-lg" />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <div
              ref={memberSearch}
              className="note-member-search"
              onFocusCapture={(event) => {
                if (event.target instanceof HTMLInputElement && query.trim())
                  setResultsOpen(true);
              }}
              onBlurCapture={(event) => {
                const next = event.relatedTarget as Node | null;
                if (
                  !event.currentTarget.contains(next) &&
                  !document.getElementById(resultsId)?.contains(next)
                )
                  dismissResults();
              }}
              onKeyDown={(event) => {
                if (
                  event.key === 'Enter' &&
                  event.target instanceof HTMLInputElement
                ) {
                  event.preventDefault();
                  if (resultsOpen)
                    document
                      .getElementById(resultsId)
                      ?.querySelector<HTMLButtonElement>(
                        '.tag-result:not(:disabled)',
                      )
                      ?.click();
                  return;
                }
                if (!resultsOpen || !query.trim()) return;
                if (event.key === 'Escape') {
                  event.preventDefault();
                  event.stopPropagation();
                  dismissResults(true);
                } else if (
                  event.key === 'ArrowDown' ||
                  event.key === 'ArrowUp'
                ) {
                  const items = Array.from(
                    document
                      .getElementById(resultsId)
                      ?.querySelectorAll<HTMLButtonElement>(
                        '.tag-result:not(:disabled)',
                      ) ?? [],
                  );
                  if (!items.length) return;
                  const index = items.indexOf(
                    event.target as HTMLButtonElement,
                  );
                  event.preventDefault();
                  items[
                    index < 0
                      ? event.key === 'ArrowDown'
                        ? 0
                        : items.length - 1
                      : (index +
                          (event.key === 'ArrowDown' ? 1 : items.length - 1)) %
                        items.length
                  ]?.focus();
                }
              }}
            >
              <SearchField
                controls={resultsOpen && query.trim() ? resultsId : undefined}
                label="Tag members by name or number"
                value={query}
                disabled={busy}
                onChange={(value) => {
                  setQuery(value);
                  setResultsOpen(!!value.trim());
                }}
              />
              {resultsOpen && !!query.trim() && (
                <AnchoredResults
                  anchor={memberSearch}
                  id={resultsId}
                  label="Matching members"
                  onClose={() => dismissResults()}
                >
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
                        dismissResults(true);
                      }}
                    >
                      {g.fullName}
                      <small>{g.uniqueNumber}</small>
                    </button>
                  ))}
                  {query.trim() && !pages.items.length && (
                    <p className="muted">
                      No members found on this device. Try another name or
                      number.
                    </p>
                  )}
                  {pages.pageCount > 1 && (
                    <Pagination
                      label="Tag member pages"
                      page={pages.page}
                      pageCount={pages.pageCount}
                      onPrevious={pages.previous}
                      onNext={pages.next}
                    />
                  )}
                </AnchoredResults>
              )}
            </div>
            <small className="muted">
              Up to 10 members or groups. Notes stay private to you.
            </small>
          </div>
        )}
      </div>
      <div className="note-editor-option">
        <button
          type="button"
          className="note-option-toggle"
          disabled={busy}
          aria-label="Reminder"
          aria-expanded={scheduling}
          aria-controls={`${id}-reminder`}
          onClick={() => setScheduling(!scheduling)}
        >
          <Icon name="calendar" />
          <span>
            <strong>Reminder</strong>
            {!scheduling && (
              <small>
                {reminder.kind === 'once' && !Number.isFinite(reminder.at)
                  ? 'Choose a date and time'
                  : reminderLabel(reminder) || 'No reminder'}
              </small>
            )}
          </span>
          <Icon name={scheduling ? 'chevron-up' : 'chevron-right'} />
        </button>
        {scheduling && (
          <div className="note-option-body" id={`${id}-reminder`}>
            <div className="reminder-choice" role="group" aria-label="Repeat">
              {(['none', 'once', 'weekly'] as const).map((kind) => (
                <button
                  type="button"
                  key={kind}
                  aria-pressed={reminder.kind === kind}
                  disabled={busy}
                  onClick={() =>
                    onReminder(
                      kind === 'none'
                        ? { kind }
                        : kind === 'once'
                          ? {
                              kind,
                              at:
                                Math.ceil((Date.now() + 3600000) / 60000) *
                                60000,
                            }
                          : { kind, day: 1, minute: 540 },
                    )
                  }
                >
                  {kind === 'none'
                    ? 'None'
                    : kind === 'once'
                      ? 'Once'
                      : 'Weekly'}
                </button>
              ))}
            </div>
            <div className="reminder-fields">
              {reminder.kind === 'once' && (
                <label className="reminder-once">
                  Date and time (EAT)
                  <input
                    id={`${id}-date`}
                    type="datetime-local"
                    disabled={busy}
                    value={
                      Number.isFinite(reminder.at)
                        ? localDateTime(reminder.at)
                        : ''
                    }
                    aria-invalid={reminderError || undefined}
                    aria-describedby={reminderError ? `${id}-error` : undefined}
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
                    Repeat on
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
            </div>
            {reminderError && (
              <p className="field-error" id={`${id}-error`}>
                {error}
              </p>
            )}
            {reminder.kind !== 'none' && (
              <small className="muted">
                {reminder.kind === 'weekly'
                  ? `Every ${['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][reminder.day]} · `
                  : ''}
                East Africa Time (EAT)
              </small>
            )}
          </div>
        )}
      </div>
    </>
  );
}

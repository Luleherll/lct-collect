import { useEffect, useMemo, useRef, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import SyncState from './SyncState';
import { useLocalVersion } from '../hooks/useLocal';
import { usePagination } from '../hooks/usePagination';
import { localState, changeLocal } from '../lib/local';
import { visible } from '../lib/projection';
import { db } from '../lib/firebase';
import type { AgentNote, Member, MemberTag } from '../lib/models';
import { dateTimeLabel } from '../lib/domain';
import { completeNote, deleteNote, savePrivateNote } from '../lib/notes';
import { enableReminders, permanentNotesURL } from '../lib/notifications';
import {
  agendaHeading,
  noteDay,
  noteOccurrence,
  noteTime,
  upcomingNotes,
} from '../lib/noteAgenda';
import { reminderLabel, type Reminder } from '../../functions/src/schedule';
import type { usePagedNotes } from '../hooks/usePagedNotes';
import Modal from './Modal';
import Pagination from './Pagination';
import NoteEditor from './NoteEditor';
import Icon from './Icon';

type Edit = {
  body: string;
  tags: MemberTag[];
  reminder: Reminder;
  revision: number;
};
export default function Notes({
  uid,
  notes,
  draft,
  onDraft,
  onDirty,
  protect,
  members,
  writable,
  busy,
  error,
  clearError,
  action,
}: {
  uid: string;
  notes: ReturnType<typeof usePagedNotes>;
  draft: string;
  onDraft: (v: string) => void;
  onDirty: (v: boolean) => void;
  protect: (
    fn: () => void,
    title?: string,
    body?: string,
    label?: string,
  ) => void;
  members: Member[];
  writable: boolean;
  busy: boolean;
  error: string;
  clearError: () => void;
  action: (fn: () => Promise<unknown>, success: string) => Promise<void>;
}) {
  const version = useLocalVersion();
  const [tab, setTab] = useState<'upcoming' | 'all'>('upcoming');
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const refresh = () => setNow(Date.now());
    const timer = setInterval(refresh, 60000);
    window.addEventListener('focus', refresh);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', refresh);
    };
  }, []);
  const [tags, setTags] = useState<MemberTag[]>(
    () => localState().drafts?.noteComposer?.tags ?? [],
  );
  const [reminder, setReminder] = useState<Reminder>(
    () => localState().drafts?.noteComposer?.reminder ?? { kind: 'none' },
  );
  const [composing, setComposing] = useState(
    () =>
      !new URLSearchParams(location.search).get('note') &&
      !localState().drafts?.noteEdit?.noteId &&
      (!!draft.trim() ||
        !!localState().drafts?.noteComposer?.tags?.length ||
        (localState().drafts?.noteComposer?.reminder?.kind ?? 'none') !==
          'none'),
  );
  const [selectedId, setSelectedId] = useState(
    () =>
      new URLSearchParams(location.search).get('note') ??
      localState().drafts?.noteEdit?.noteId ??
      '',
  );
  const [edit, setEdit] = useState<Edit | null>(() => {
    const saved = localState().drafts?.noteEdit;
    const linked = new URLSearchParams(location.search).get('note');
    return saved && (!linked || saved.noteId === linked) ? saved : null;
  });
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [settings, setSettings] = useState(false);
  const [localError, setLocalError] = useState('');
  const [enabled, setEnabled] = useState(false);
  const [enabling, setEnabling] = useState(false);
  const createId = useRef(
    localState().drafts?.noteComposer?.createId ?? crypto.randomUUID(),
  );
  const mutationId = useRef('');
  const deleteMutation = useRef('');
  const deleting = useRef(false);
  const selected = useMemo(
    () =>
      visible(localState().records, localState().commands, uid)[
        `users/${uid}/notes/${selectedId}`
      ] as AgentNote | undefined,
    [version, uid, selectedId],
  );
  useEffect(() => {
    if (draft.trim() && !selectedId) setComposing(true);
  }, [draft]);
  // Notification/deep links can arrive before the selected record is downloaded.
  useEffect(() => {
    if (selected && !edit) {
      setComposing(false);
      setEdit({
        body: selected.body,
        tags: selected.tags ?? [],
        reminder: selected.reminder ?? { kind: 'none' },
        revision: selected.revision ?? 0,
      });
    }
  }, [selectedId, !!selected]);
  const editDirty = !!(
    edit &&
    (!selected ||
      edit.body !== selected.body ||
      JSON.stringify(edit.tags) !== JSON.stringify(selected.tags ?? []) ||
      JSON.stringify(edit.reminder) !==
        JSON.stringify(selected.reminder ?? { kind: 'none' }))
  );
  const dirtyEdit = useRef(editDirty);
  dirtyEdit.current = editDirty;
  useEffect(
    () => onDirty(tags.length > 0 || reminder.kind !== 'none' || editDirty),
    [tags, reminder, editDirty],
  );
  useEffect(() => {
    const noteId = createId.current;
    const timer = setTimeout(
      () =>
        void changeLocal((s) => {
          if (
            s.commands.some(
              (p) =>
                p.command.kind === 'note' &&
                p.command.data.noteId === noteId &&
                p.command.data.action === 'save',
            )
          )
            return;
          s.drafts = {
            ...s.drafts,
            noteComposer: { tags, reminder, createId: noteId },
          };
        }).catch(() => {}),
      150,
    );
    return () => clearTimeout(timer);
  }, [tags, reminder]);
  useEffect(() => {
    if (edit && selectedId)
      void changeLocal((s) => {
        s.drafts = { ...s.drafts, noteEdit: { noteId: selectedId, ...edit } };
      }).catch(() => {});
  }, [edit, selectedId]);
  useEffect(() => {
    if (!selectedId) return;
    return onSnapshot(
      doc(db(), 'users', uid, 'notes', selectedId),
      { includeMetadataChanges: true },
      (snap) => {
        if (snap.metadata.fromCache) return;
        void changeLocal((s) => {
          const path = `users/${uid}/notes/${selectedId}`;
          if (snap.exists()) s.records[path] = snap.data();
          else if (
            !s.commands.some(
              (p) =>
                p.command.kind === 'note' &&
                p.command.data.noteId === selectedId &&
                p.command.data.action === 'save',
            )
          ) {
            delete s.records[path];
            if (dirtyEdit.current && !deleting.current) {
              setLocalError(
                'This note is unavailable. Copy your changes before closing.',
              );
              return;
            }
            if (s.drafts && s.drafts.noteEdit?.noteId === selectedId)
              delete s.drafts.noteEdit;
            setSelectedId('');
            setEdit(null);
            setConfirmDelete(false);
            if (location.search)
              history.replaceState(null, '', location.pathname);
            if (!deleting.current) setLocalError('This note is unavailable.');
          }
        }).catch(() =>
          setLocalError('Could not update the saved note on this device.'),
        );
      },
      () => setLocalError('This note is unavailable to this account.'),
    );
  }, [selectedId, uid]);
  useEffect(() => {
    const open = (e: Event) => openNote((e as CustomEvent<string>).detail);
    window.addEventListener('open-reminder', open);
    return () => window.removeEventListener('open-reminder', open);
  });
  function clearComposer() {
    onDraft('');
    setTags([]);
    setReminder({ kind: 'none' });
    createId.current = crypto.randomUUID();
    void changeLocal((s) => {
      if (s.drafts) {
        delete s.drafts.noteComposer;
        if (s.drafts.collection) s.drafts.collection.noteDraft = '';
      }
    }).catch(() => {});
  }
  function openNote(noteId: string) {
    const open = () => {
      clearError();
      mutationId.current = '';
      setLocalError('');
      setSelectedId(noteId);
      const note = visible(localState().records, localState().commands, uid)[
        `users/${uid}/notes/${noteId}`
      ] as AgentNote | undefined;
      setEdit(
        note
          ? {
              body: note.body,
              tags: note.tags ?? [],
              reminder: note.reminder ?? { kind: 'none' },
              revision: note.revision ?? 0,
            }
          : null,
      );
    };
    if (composing && (draft.trim() || tags.length || reminder.kind !== 'none'))
      protect(
        () => {
          clearComposer();
          setComposing(false);
          open();
        },
        'Discard this note?',
        'Your note has not been saved. Keep writing, or discard it.',
        'Discard note',
      );
    else open();
  }
  function close() {
    if (busy) return;
    const finish = () => {
      if (composing) clearComposer();
      setComposing(false);
      setSelectedId('');
      setEdit(null);
      mutationId.current = '';
      void changeLocal((s) => {
        if (s.drafts) delete s.drafts.noteEdit;
      }).catch(() => {});
      if (location.search) history.replaceState(null, '', location.pathname);
    };
    if (
      (composing &&
        (draft.trim() || tags.length || reminder.kind !== 'none')) ||
      editDirty
    )
      protect(
        finish,
        'Discard this note?',
        'Your changes have not been saved. Keep writing, or discard them.',
        'Discard note',
      );
    else finish();
  }
  function save() {
    if (!writable || busy) return;
    if (!mutationId.current) mutationId.current = crypto.randomUUID();
    void action(
      async () => {
        if (composing) {
          await savePrivateNote(
            createId.current,
            draft,
            tags,
            reminder,
            0,
            mutationId.current,
          );
          clearComposer();
        } else {
          if (!selected || !edit)
            throw new Error(
              'This note is unavailable. Your changes are still here.',
            );
          await savePrivateNote(
            selected.noteId,
            edit.body,
            edit.tags,
            edit.reminder,
            edit.revision,
            mutationId.current,
          );
        }
        mutationId.current = '';
        setComposing(false);
        setSelectedId('');
        setEdit(null);
        void changeLocal((s) => {
          if (s.drafts) delete s.drafts.noteEdit;
        }).catch(() => {});
        if (location.search) history.replaceState(null, '', location.pathname);
      },
      composing
        ? 'Note added. Saved on this device.'
        : 'Note updated. Saved on this device.',
    );
  }
  function done(note: AgentNote, value: boolean) {
    void action(
      async () => {
        await completeNote(note, value, crypto.randomUUID());
        if (selectedId === note.noteId)
          setEdit((current) =>
            current ? { ...current, revision: (note.revision ?? 0) + 1 } : null,
          );
      },
      value ? 'Note completed.' : 'Note reopened.',
    );
  }
  const scheduled = useMemo(() => upcomingNotes(notes.data), [notes.data]);
  const pages = usePagination(
    tab === 'all' ? notes.data : scheduled,
    `${uid}:${tab}`,
  );
  const without = usePagination(
    notes.data.filter((n) => !n.done && noteOccurrence(n) === null),
    uid,
  );
  function row(note: AgentNote, agenda = false) {
    const at = noteOccurrence(note);
    const timeColumn = agenda && at !== null && noteDay(at) === noteDay(now);
    return (
      <article
        className={`note-list-row ${note.done ? 'is-done' : ''} ${agenda ? 'agenda-row' : ''}`}
        data-note-id={note.noteId}
        key={note.noteId}
      >
        {timeColumn && at !== null && (
          <time className="agenda-time" dateTime={new Date(at).toISOString()}>
            {noteTime(at)}
          </time>
        )}
        <label className="note-check">
          <input
            type="checkbox"
            aria-label={`Mark ${note.body.slice(0, 60)} ${note.done ? 'not done' : 'done'}`}
            checked={!!note.done}
            disabled={!writable}
            onChange={(e) => done(note, e.target.checked)}
          />
          <Icon name="check2" />
        </label>
        <button className="note-row" onClick={() => openNote(note.noteId)}>
          <span>{note.body}</span>
          <small>
            {note.tags
              ?.map((t) =>
                t.fullName === t.uniqueNumber
                  ? t.uniqueNumber
                  : `${t.fullName} · ${t.uniqueNumber}`,
              )
              .join(', ')}
            {agenda &&
              !timeColumn &&
              note.reminder?.kind === 'once' &&
              at !== null && (
                <>
                  {note.tags?.length ? ' · ' : ''}
                  {noteTime(at)}
                </>
              )}
            {!agenda &&
              (reminderLabel(note.reminder) ||
                dateTimeLabel(note.createdAt)) && (
                <>
                  {note.tags?.length ? ' · ' : ''}
                  {reminderLabel(note.reminder) ||
                    dateTimeLabel(note.createdAt)}
                </>
              )}
            {agenda && note.reminder?.kind === 'weekly' && (
              <>
                {note.tags?.length ? ' · ' : ''}
                {reminderLabel(note.reminder)}
              </>
            )}
          </small>
          <SyncState noteId={note.noteId} />
        </button>
      </article>
    );
  }
  const groups = new Map<string, AgentNote[]>();
  for (const note of tab === 'upcoming' ? pages.items : []) {
    const day = noteDay(noteOccurrence(note)!);
    groups.set(day, [...(groups.get(day) ?? []), note]);
  }
  return (
    <div className="notes-page">
      <div className="notes-heading">
        <a
          className="icon-button"
          href="/agent/"
          aria-label="Back to collection"
        >
          <Icon name="arrow-left" />
        </a>
        <div>
          <h1>Notes</h1>
          <p>
            {new Intl.DateTimeFormat('en-UG', {
              weekday: 'long',
              day: 'numeric',
              month: 'long',
              year: 'numeric',
              timeZone: 'Africa/Kampala',
            }).format(now)}
          </p>
        </div>
        <button
          className="icon-button notes-bell"
          aria-label="Notification settings"
          onClick={() => setSettings(true)}
        >
          <Icon name="bell" />
        </button>
      </div>
      <div className="notes-tabs" role="group" aria-label="Note view">
        <button
          type="button"
          aria-pressed={tab === 'upcoming'}
          onClick={() => setTab('upcoming')}
        >
          Upcoming
        </button>
        <button
          type="button"
          aria-pressed={tab === 'all'}
          onClick={() => setTab('all')}
        >
          All notes
        </button>
      </div>
      {localError && (
        <p className="field-error" role="alert">
          {localError}
        </p>
      )}
      <section
        id="note-results"
        tabIndex={-1}
        aria-label="Saved notes"
        aria-busy={notes.loading}
      >
        {tab === 'all'
          ? pages.items.map((n) => row(n))
          : Array.from(groups, ([key, items]) => (
              <section
                className="agenda-group"
                key={key}
                aria-label={agendaHeading(noteOccurrence(items[0])!, now)}
              >
                <h2>{agendaHeading(noteOccurrence(items[0])!, now)}</h2>
                {items.map((n) => row(n, true))}
              </section>
            ))}
        {!pages.items.length && (
          <p className="notes-empty" role="status">
            {notes.loading
              ? 'Loading notes…'
              : notes.unavailable
                ? 'Saved notes are not downloaded on this device. Connect to load them. You can still add a note.'
                : tab === 'upcoming'
                  ? 'No upcoming reminders. Add a note to plan your next visit.'
                  : 'No notes yet. Add your first note.'}
          </p>
        )}
      </section>
      {pages.pageCount > 1 && (
        <Pagination
          label="Note pages"
          page={pages.page}
          hasNext={pages.page < pages.pageCount}
          hasPrevious={pages.page > 1}
          onPrevious={pages.previous}
          onNext={pages.next}
          busy={busy}
          focusTarget="note-results"
        />
      )}
      {tab === 'upcoming' && without.items.length > 0 && (
        <details className="notes-without">
          <summary>
            <Icon name="chevron-down" />
            Without a reminder{' '}
            <small>
              {
                notes.data.filter((n) => !n.done && noteOccurrence(n) === null)
                  .length
              }
            </small>
          </summary>
          <section
            id="unscheduled-notes"
            tabIndex={-1}
            aria-label="Notes without a reminder"
          >
            {without.items.map((n) => row(n))}
          </section>
          {without.pageCount > 1 && (
            <Pagination
              label="Notes without reminder pages"
              page={without.page}
              pageCount={without.pageCount}
              onPrevious={without.previous}
              onNext={without.next}
              focusTarget="unscheduled-notes"
            />
          )}
        </details>
      )}
      <div className="notes-new-bar">
        <button
          className="button"
          onClick={() => {
            clearError();
            setLocalError('');
            mutationId.current = '';
            setComposing(true);
          }}
        >
          <Icon name="plus-lg" />
          New note
        </button>
      </div>
      {(composing || selectedId) && (
        <Modal
          variant="sheet"
          title={composing ? 'New note' : 'Edit note'}
          onClose={close}
          headerActions={
            !composing && selected ? (
              <details className="note-actions">
                <summary aria-label="Note actions">
                  <Icon name="more" />
                </summary>
                <div>
                  <button
                    type="button"
                    disabled={!writable}
                    onClick={() => done(selected, !selected.done)}
                  >
                    {selected.done ? 'Reopen' : 'Mark done'}
                  </button>
                  <button
                    type="button"
                    className="note-delete-action"
                    disabled={!writable}
                    onClick={() => {
                      deleteMutation.current = crypto.randomUUID();
                      setConfirmDelete(true);
                    }}
                  >
                    <Icon name="trash" />
                    Delete note
                  </button>
                </div>
              </details>
            ) : undefined
          }
        >
          {composing || edit ? (
            <form
              className="note-sheet-form"
              noValidate
              onSubmit={(e) => {
                e.preventDefault();
                save();
              }}
            >
              <div className="sheet-body">
                {localError && (
                  <p className="field-error" role="alert">
                    {localError}
                  </p>
                )}
                {error && (
                  <p className="field-error" role="alert">
                    {error}
                  </p>
                )}
                <NoteEditor
                  id={composing ? 'new-note' : 'edit-note'}
                  body={composing ? draft : edit!.body}
                  onBody={(value) =>
                    composing
                      ? onDraft(value)
                      : setEdit({ ...edit!, body: value })
                  }
                  tags={composing ? tags : edit!.tags}
                  onTags={(value) =>
                    composing
                      ? setTags(value)
                      : setEdit({ ...edit!, tags: value })
                  }
                  reminder={composing ? reminder : edit!.reminder}
                  onReminder={(value) =>
                    composing
                      ? setReminder(value)
                      : setEdit({ ...edit!, reminder: value })
                  }
                  members={members}
                  busy={busy}
                  error={error}
                />
              </div>
              <div className="sheet-footer">
                <button
                  className="text-button"
                  type="button"
                  disabled={busy}
                  onClick={close}
                >
                  Cancel
                </button>
                <button
                  className="button"
                  disabled={
                    !writable ||
                    !(composing ? draft : edit!.body).trim() ||
                    (!composing && !selected)
                  }
                  aria-busy={busy}
                >
                  {busy ? 'Saving…' : composing ? 'Save note' : 'Save changes'}
                </button>
              </div>
            </form>
          ) : (
            <p className="sheet-body" role="status">
              Loading note…
            </p>
          )}
        </Modal>
      )}
      {confirmDelete && selected && (
        <Modal
          title="Delete note?"
          onClose={() => {
            if (!busy) setConfirmDelete(false);
          }}
        >
          <p className="note-delete-preview">{selected.body}</p>
          <p>
            This note will be removed from your list and its reminders
            cancelled. A private copy will be retained.
          </p>
          {error && (
            <p className="field-error" role="alert">
              {error}
            </p>
          )}
          <div className="actions">
            <button
              className="button outline"
              autoFocus
              disabled={busy}
              onClick={() => setConfirmDelete(false)}
            >
              Keep note
            </button>
            <button
              className="button danger"
              disabled={!writable}
              aria-busy={busy}
              onClick={() => {
                deleting.current = true;
                void action(async () => {
                  try {
                    await deleteNote(selected, deleteMutation.current);
                    setConfirmDelete(false);
                    setSelectedId('');
                    setEdit(null);
                    void changeLocal((s) => {
                      if (s.drafts) delete s.drafts.noteEdit;
                    }).catch(() => {});
                    if (location.search)
                      history.replaceState(null, '', location.pathname);
                    requestAnimationFrame(() =>
                      document.getElementById('note-results')?.focus(),
                    );
                  } finally {
                    deleting.current = false;
                  }
                }, 'Note deleted.');
              }}
            >
              {busy ? 'Deleting…' : 'Delete note'}
            </button>
          </div>
        </Modal>
      )}
      {settings && (
        <Modal
          title="Notification settings"
          onClose={() => {
            if (!enabling) setSettings(false);
          }}
        >
          <p>
            Get a notification when a reminder is due. Your notes and reminders
            work even when notifications are unavailable.
          </p>
          {localError && (
            <p className="field-error" role="alert">
              {localError}
            </p>
          )}
          <div className="notification-actions">
            <button
              className="button"
              disabled={enabling || enabled}
              aria-busy={enabling}
              onClick={() => {
                setLocalError('');
                setEnabling(true);
                void enableReminders(uid)
                  .then(() => setEnabled(true))
                  .catch((e) => setLocalError(e.message))
                  .finally(() => setEnabling(false));
              }}
            >
              {enabling
                ? 'Enabling…'
                : enabled
                  ? 'Reminders enabled'
                  : 'Enable reminders'}
            </button>
            <a href={permanentNotesURL()} target="_blank" rel="noopener">
              Open permanent app
            </a>
          </div>
        </Modal>
      )}
    </div>
  );
}

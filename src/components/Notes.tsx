import SyncState from './SyncState';
import { useLocalVersion } from '../hooks/useLocal';
import { localState, changeLocal } from '../lib/local';
import { visible } from '../lib/projection';
import { useEffect, useRef, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../lib/firebase';
import type { AgentNote, Member, MemberTag } from '../lib/models';
import { dateTimeLabel } from '../lib/domain';
import { completeNote, deleteNote, savePrivateNote } from '../lib/notes';
import { enableReminders, permanentNotesURL } from '../lib/notifications';
import { reminderLabel, type Reminder } from '../../functions/src/schedule';
import type { usePagedNotes } from '../hooks/usePagedNotes';
import Modal from './Modal';
import Pagination from './Pagination';
import NoteEditor from './NoteEditor';
import Icon from './Icon';
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
  action,
}: {
  uid: string;
  notes: ReturnType<typeof usePagedNotes>;
  draft: string;
  onDraft: (v: string) => void;
  onDirty: (v: boolean) => void;
  protect: (fn: () => void) => void;
  members: Member[];
  writable: boolean;
  busy: boolean;
  error: string;
  action: (fn: () => Promise<unknown>, success: string) => Promise<void>;
}) {
  const localVersion = useLocalVersion();

  const [tags, setTags] = useState<MemberTag[]>(
      () => localState().drafts?.noteComposer?.tags ?? [],
    ),
    [reminder, setReminder] = useState<Reminder>(
      () => localState().drafts?.noteComposer?.reminder ?? { kind: 'none' },
    );
  const [selectedId, setSelectedId] = useState(
      () =>
        new URLSearchParams(location.search).get('note') ??
        localState().drafts?.noteEdit?.noteId ??
        '',
    ),
    [selected, setSelected] = useState<AgentNote | null>(null),
    [confirmDelete, setConfirmDelete] = useState(false),
    [editing, setEditing] = useState(!!localState().drafts?.noteEdit),
    [edit, setEdit] = useState<{
      body: string;
      tags: MemberTag[];
      reminder: Reminder;
      revision: number;
    } | null>(() => localState().drafts?.noteEdit ?? null),
    [localError, setLocalError] = useState(''),
    [enabled, setEnabled] = useState(false);
  useEffect(() => {
    const data = visible(localState().records, localState().commands, uid)[
      `users/${uid}/notes/${selectedId}`
    ];
    setSelected(data ?? null);
  }, [localVersion, selectedId, uid]);
  useEffect(() => {
    if (editing && edit)
      void changeLocal((s) => {
        s.drafts = { ...s.drafts, noteEdit: { noteId: selectedId, ...edit } };
      }).catch(() => {});
  }, [editing, edit, selectedId]);
  const createId = useRef(
      localState().drafts?.noteComposer?.createId ?? crypto.randomUUID(),
    ),
    mutationId = useRef(''),
    deleting = useRef(false),
    deleteMutation = useRef('');
  useEffect(() => {
    const noteId = createId.current;
    const timer = setTimeout(
      () =>
        void changeLocal((s) => {
          if (
            noteId &&
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
    if (confirmDelete) document.getElementById('keep-note')?.focus();
  }, [confirmDelete]);
  useEffect(() => {
    const open = (e: Event) => setSelectedId((e as CustomEvent<string>).detail);
    window.addEventListener('open-reminder', open);
    return () => window.removeEventListener('open-reminder', open);
  }, []);
  const editDirty = !!(
    editing &&
    edit &&
    selected &&
    (edit.body !== selected.body ||
      JSON.stringify(edit.tags) !== JSON.stringify(selected.tags ?? []) ||
      JSON.stringify(edit.reminder) !==
        JSON.stringify(selected.reminder ?? { kind: 'none' }))
  );
  useEffect(() => {
    onDirty(tags.length > 0 || reminder.kind !== 'none' || editDirty);
  }, [tags, reminder, editDirty]);
  useEffect(() => {
    if (!selectedId) {
      setSelected(null);
      return;
    }
    return onSnapshot(
      doc(db(), 'users', uid, 'notes', selectedId),
      { includeMetadataChanges: true },
      (snap) => {
        if (snap.exists() && !snap.metadata.fromCache)
          void changeLocal((s) => {
            s.records[`users/${uid}/notes/${selectedId}`] = snap.data();
          });
        else if (!snap.metadata.fromCache) {
          void changeLocal((s) => {
            delete s.records[`users/${uid}/notes/${selectedId}`];
          });
          setSelected(null);
          setSelectedId('');
          setConfirmDelete(false);
          setEditing(false);
          setEdit(null);
          if (location.search)
            history.replaceState(null, '', location.pathname);
          if (!deleting.current) setLocalError('This note is unavailable.');
        }
      },
      () => setLocalError('This note is unavailable to this account.'),
    );
  }, [selectedId, uid]);
  function close() {
    if (busy) return;
    const closeNow = () => {
      void changeLocal((s) => {
        if (s.drafts) delete s.drafts.noteEdit;
      }).catch(() => {});
      setConfirmDelete(false);
      setSelectedId('');
      setEditing(false);
      setEdit(null);
      if (location.search) history.replaceState(null, '', location.pathname);
    };
    if (editDirty) protect(closeNow);
    else closeNow();
  }
  const save = () => {
    if (!createId.current) createId.current = crypto.randomUUID();
    if (!mutationId.current) mutationId.current = crypto.randomUUID();
    void action(async () => {
      await savePrivateNote(
        createId.current,
        draft,
        tags,
        reminder,
        0,
        mutationId.current,
      );
      createId.current = crypto.randomUUID();
      mutationId.current = '';
      onDraft('');
      setTags([]);
      setReminder({ kind: 'none' });
      document.getElementById('new-note')?.focus();
    }, 'Note added.');
  };
  function done(note: AgentNote, value: boolean) {
    void action(
      () => completeNote(note, value, crypto.randomUUID()),
      value ? 'Note completed.' : 'Note reopened.',
    );
  }
  return (
    <>
      <div className="heading-actions">
        <h1>Notes</h1>
        <a className="back-link" href="/agent/">
          Back to collection
        </a>
      </div>
      <div className="reminder-permission">
        <button
          className="text-button"
          disabled={busy || enabled}
          onClick={() => {
            setLocalError('');
            void enableReminders(uid)
              .then(() => setEnabled(true))
              .catch((e) => setLocalError(e.message));
          }}
        >
          {enabled ? 'Reminders enabled' : 'Enable reminders'}
        </button>
        <a href={permanentNotesURL()} target="_blank" rel="noopener">
          Open permanent app
        </a>
      </div>
      {localError && (
        <p className="field-error" role="alert">
          {localError}
        </p>
      )}
      <form
        className="note-composer"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (writable && draft.trim()) save();
        }}
      >
        <NoteEditor
          body={draft}
          onBody={onDraft}
          tags={tags}
          onTags={setTags}
          reminder={reminder}
          onReminder={setReminder}
          members={members}
          busy={busy}
        />
        <button
          className="button small"
          disabled={!writable || !draft.trim()}
          aria-busy={busy}
        >
          {busy ? 'Saving…' : 'Add note'}
        </button>
      </form>
      <section
        aria-busy={busy}
        id="note-results"
        tabIndex={-1}
        aria-label="Saved notes"
      >
        {notes.data.map((note) => (
          <article
            className={`note-list-row ${note.done ? 'is-done' : ''}`}
            data-note-id={note.noteId}
            key={note.noteId}
          >
            <label className="note-check">
              <input
                type="checkbox"
                aria-label={`Mark ${note.body.slice(0, 60)} ${note.done ? 'not done' : 'done'}`}
                checked={!!note.done}
                disabled={!writable}
                onChange={(e) => done(note, e.target.checked)}
              />
            </label>
            <button
              className="note-row"
              onClick={() => {
                setSelectedId(note.noteId);
                setEditing(false);
              }}
            >
              <span>{note.body}</span>
              <SyncState noteId={note.noteId} />
              <small>
                {reminderLabel(note.reminder) || dateTimeLabel(note.createdAt)}
                {note.tags?.length
                  ? ` · ${note.tags.map((t) => t.uniqueNumber).join(', ')}`
                  : ''}
              </small>
            </button>
            <button
              className="icon-button note-delete"
              aria-label={`Delete note: ${note.body.slice(0, 60)}`}
              title="Delete note"
              disabled={!writable}
              onClick={() => {
                deleteMutation.current = crypto.randomUUID();
                setSelected(note);
                setSelectedId(note.noteId);
                setEditing(false);
                setConfirmDelete(true);
              }}
            >
              <Icon name="trash" />
            </button>
          </article>
        ))}
        {!notes.data.length && !notes.loading && (
          <p className="muted">No notes yet. Add your first note above.</p>
        )}
      </section>
      <Pagination
        label="Note pages"
        page={notes.page}
        hasNext={notes.hasNext}
        hasPrevious={notes.page > 1}
        onPrevious={notes.previous}
        onNext={notes.next}
        busy={notes.loading || busy}
        focusTarget="note-results"
      />
      {selected && (
        <Modal
          title={
            confirmDelete ? 'Delete note?' : editing ? 'Edit note' : 'Note'
          }
          onClose={close}
        >
          {error && (
            <p className="field-error" role="alert">
              {error}
            </p>
          )}
          {confirmDelete ? (
            <>
              <p>
                This note will be removed from your list and its reminders
                cancelled. A private copy will be retained.
              </p>
              <div className="actions">
                <button
                  id="keep-note"
                  className="button outline"
                  disabled={busy}
                  onClick={close}
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
                        setSelectedId('');
                        setSelected(null);
                        setConfirmDelete(false);
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
            </>
          ) : editing && edit ? (
            <form
              noValidate
              onSubmit={(e) => {
                e.preventDefault();
                if (!mutationId.current)
                  mutationId.current = crypto.randomUUID();
                void action(async () => {
                  await savePrivateNote(
                    selected.noteId,
                    edit.body,
                    edit.tags,
                    edit.reminder,
                    edit.revision,
                    mutationId.current,
                  );
                  mutationId.current = '';
                  setEditing(false);
                  setEdit(null);
                }, 'Note updated.');
              }}
            >
              <NoteEditor
                id="edit-note"
                body={edit.body}
                onBody={(body) => setEdit({ ...edit, body })}
                tags={edit.tags}
                onTags={(tags) => setEdit({ ...edit, tags })}
                reminder={edit.reminder}
                onReminder={(reminder) => setEdit({ ...edit, reminder })}
                members={members}
                busy={busy}
              />
              <div className="actions">
                <button
                  type="button"
                  className="button outline"
                  disabled={busy}
                  onClick={() =>
                    protect(() => {
                      setEditing(false);
                      setEdit(null);
                    })
                  }
                >
                  Cancel
                </button>
                <button
                  className="button"
                  disabled={!writable || !edit.body.trim()}
                >
                  {busy ? 'Saving…' : 'Save changes'}
                </button>
              </div>
            </form>
          ) : (
            <>
              <p className="note-body">{selected.body}</p>
              <p className="muted">
                {reminderLabel(selected.reminder) ||
                  dateTimeLabel(selected.createdAt)}
              </p>
              <div className="note-tags">
                {selected.tags?.map((t) => (
                  <span key={t.uniqueNumber}>
                    {t.fullName} · {t.uniqueNumber}
                  </span>
                ))}
              </div>
              <div className="actions">
                <button
                  className="button outline"
                  disabled={!writable}
                  onClick={() => done(selected, !selected.done)}
                >
                  {selected.done ? 'Reopen' : 'Mark done'}
                </button>
                <button
                  className="button"
                  disabled={!writable}
                  onClick={() => {
                    mutationId.current = '';
                    setEdit({
                      body: selected.body,
                      tags: selected.tags ?? [],
                      reminder: selected.reminder ?? { kind: 'none' },
                      revision: selected.revision ?? 0,
                    });
                    setEditing(true);
                    requestAnimationFrame(() =>
                      document.getElementById('edit-note')?.focus(),
                    );
                  }}
                >
                  Edit note
                </button>
              </div>
            </>
          )}
        </Modal>
      )}
    </>
  );
}

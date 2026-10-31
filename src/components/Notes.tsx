import { useRef, useState } from 'react';
import type { AgentNote } from '../lib/models';
import { dateTimeLabel } from '../lib/domain';
import { saveNote } from '../lib/operations';
import type { usePagedNotes } from '../hooks/usePagedNotes';
import Modal from './Modal';
import Pagination from './Pagination';
export default function Notes({
  uid,
  notes,
  draft,
  onDraft,
  writable,
  busy,
  action,
}: {
  uid: string;
  notes: ReturnType<typeof usePagedNotes>;
  draft: string;
  onDraft: (value: string) => void;
  writable: boolean;
  busy: boolean;
  action: (fn: () => Promise<unknown>, success: string) => Promise<void>;
}) {
  const [selected, setSelected] = useState<AgentNote | null>(null);
  const id = useRef('');
  const input = useRef<HTMLTextAreaElement>(null);
  return (
    <>
      <div className="heading-actions">
        <h1>Notes</h1>
        <a className="back-link" href="/agent/">
          Back to collection
        </a>
      </div>
      <form
        className="note-composer"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (!draft.trim() || !writable) return;
          if (!id.current) id.current = crypto.randomUUID();
          void action(async () => {
            await saveNote(uid, id.current, draft);
            id.current = '';
            onDraft('');
            input.current?.focus();
          }, 'Note added.');
        }}
      >
        <label htmlFor="new-note">
          New note{' '}
          <textarea
            className="resize-none"
            ref={input}
            id="new-note"
            maxLength={2000}
            placeholder="What would you like to remember?"
            value={draft}
            disabled={busy}
            onChange={(e) => onDraft(e.target.value)}
          />
        </label>
        <button
          className="button small"
          disabled={!writable || !draft.trim()}
          aria-busy={busy}
        >
          {busy ? 'Saving…' : 'Add note'}
        </button>
      </form>
      <section id="note-results" tabIndex={-1} aria-label="Saved notes">
        {notes.data.map((note) => (
          <button
            className="note-row"
            key={note.noteId}
            onClick={() => setSelected(note)}
          >
            <span>{note.body}</span>
            <small>{dateTimeLabel(note.createdAt)}</small>
          </button>
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
        <Modal title="Note" onClose={() => setSelected(null)}>
          <p className="note-body">{selected.body}</p>
          <p className="muted">{dateTimeLabel(selected.createdAt)}</p>
        </Modal>
      )}
    </>
  );
}

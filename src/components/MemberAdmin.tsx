import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Member } from '../lib/models';
import type { ImportPlan } from '../lib/import';
import { applyDirectory, previewDirectory } from '../lib/directory';
import { message } from '../lib/errors';
import { Account } from './Account';
import SearchField from './SearchField';
import Icon from './Icon';
export default function MemberAdmin({
  members,
  cached,
  writable,
  busy,
  action,
}: {
  members: Member[];
  cached: boolean;
  writable: boolean;
  busy: boolean;
  action: (fn: () => Promise<unknown>, success: string) => Promise<void>;
}) {
  const [plan, setPlan] = useState<ImportPlan | null>(null),
    [name, setName] = useState(''),
    [error, setError] = useState(''),
    [reading, setReading] = useState(false),
    [progress, setProgress] = useState(''),
    [q, setQ] = useState(''),
    [page, setPage] = useState(1);
  const serial = useRef(0);
  async function read(file?: File) {
    if (!file) return;
    const request = ++serial.current;
    setReading(true);
    setPlan(null);
    setError('');
    setProgress('');
    setName(file.name);
    try {
      if (!file.name.toLowerCase().endsWith('.csv') || file.size > 2_000_000)
        throw new Error('Choose a CSV export up to 2 MB.');
      const next = await previewDirectory(await file.text());
      if (request === serial.current) setPlan(next);
    } catch (e) {
      if (request === serial.current) setError(message(e));
    } finally {
      if (request === serial.current) setReading(false);
    }
  }
  const matches = members.filter((m) =>
    `${m.fullName} ${m.memberId} ${m.accountNumber}`
      .toLowerCase()
      .includes(q.toLowerCase().trim()),
  );
  const pageCount = Math.max(1, Math.ceil(matches.length / 50));
  const currentPage = Math.min(page, pageCount);
  function changePage(next: number) {
    setPage(next);
    requestAnimationFrame(() => {
      document
        .getElementById('directory-title')
        ?.focus({ preventScroll: true });
      window.scrollTo({ top: 0, behavior: 'instant' });
    });
  }
  return (
    <>
      {document.getElementById('owner-header-actions') &&
        createPortal(
          <label className="button upload-label header-upload">
            <Icon name="upload" />
            {reading ? 'Checking…' : 'Choose CSV'}
            <input
              aria-label="Choose CSV"
              type="file"
              accept=".csv,text/csv"
              disabled={!writable || reading}
              onChange={(e) => {
                void read(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
          </label>,
          document.getElementById('owner-header-actions')!,
        )}
      {reading && (
        <p role="status">Comparing {name} with the current directory…</p>
      )}
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
      {plan && (
        <section className="card">
          <h2>Review import</h2>
          <div className="import-counts">
            {(['Add', 'Update', 'Unchanged'] as const).map((a) => (
              <span key={a}>
                <strong>
                  {plan.rows.filter((r) => r.action === a).length}
                </strong>{' '}
                {a}
              </span>
            ))}
          </div>
          {!!plan.errors.length && (
            <div className="alert error" role="alert">
              <strong>Resolve these issues before importing:</strong>
              <ul>
                {plan.errors.slice(0, 20).map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
              </ul>
              {plan.errors.length > 20 && (
                <p>
                  {plan.errors.length - 20} more issues. Correct the file and
                  preview again.
                </p>
              )}
            </div>
          )}
          <div className="table-scroll">
            <table>
              <caption className="sr-only">Preview of account changes</caption>
              <thead>
                <tr>
                  <th>Account ID</th>
                  <th>Account number</th>
                  <th>Name</th>
                  <th>Change</th>
                </tr>
              </thead>
              <tbody>
                {plan.rows.slice(0, 30).map((r) => (
                  <tr key={r.memberId}>
                    <td>{r.memberId}</td>
                    <td>
                      {r.previous &&
                        r.previous.accountNumber !== r.accountNumber && (
                          <del>
                            {r.previous.accountNumber}
                            <br />
                          </del>
                        )}
                      {r.accountNumber}
                    </td>
                    <td>
                      {r.previous && r.previous.fullName !== r.fullName && (
                        <del>
                          {r.previous.fullName}
                          <br />
                        </del>
                      )}
                      {r.fullName}
                    </td>
                    <td>{r.action}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {plan.rows.length > 30 && (
            <p>Showing 30 of {plan.rows.length} validated accounts.</p>
          )}
          <p className="muted">
            Changes are confirmed in small chunks. If an import stops, re-upload
            the same file to preview remaining changes.
          </p>
          <div className="actions">
            <button
              className="button outline"
              disabled={busy}
              onClick={() => {
                setPlan(null);
                setName('');
                setProgress('');
              }}
            >
              Cancel
            </button>
            <button
              className="button"
              disabled={!writable || !!plan.errors.length}
              onClick={() =>
                void action(async () => {
                  await applyDirectory(plan, setProgress);
                  setPlan(null);
                  setName('');
                }, 'Member directory updated.')
              }
            >
              {busy ? 'Importing…' : 'Apply updates'}
            </button>
          </div>
          {progress && <p role="status">{progress}</p>}
        </section>
      )}
      <section className="directory-section">
        <div className="heading-actions">
          <h1 id="directory-title" tabIndex={-1}>
            Member directory
          </h1>
          <span className="muted">
            {members.length} {cached ? 'saved ' : ''}accounts
          </span>
        </div>
        <SearchField
          label="Search directory"
          value={q}
          onChange={(value) => {
            setQ(value);
            setPage(1);
          }}
        />
        <div className="directory-list">
          {matches.slice((currentPage - 1) * 50, currentPage * 50).map((m) => (
            <div key={m.memberId}>
              <Account
                name={m.fullName}
                number={m.accountNumber}
                id={m.memberId}
              />
              {!m.active && <span className="status">Inactive</span>}
            </div>
          ))}
        </div>
        <nav className="pagination" aria-label="Directory pages">
          <button
            className="button outline small"
            disabled={currentPage === 1}
            onClick={() => changePage(currentPage - 1)}
          >
            Previous
          </button>
          <span role="status">
            {matches.length
              ? `${(currentPage - 1) * 50 + 1}–${Math.min(currentPage * 50, matches.length)} of ${matches.length}`
              : 'No matches'}{' '}
            · Page {currentPage} of {pageCount}
          </span>
          <button
            className="button outline small"
            disabled={currentPage === pageCount}
            onClick={() => changePage(currentPage + 1)}
          >
            Next
          </button>
        </nav>
        {!matches.length && (
          <p className="muted">
            No matching accounts. Try a different name, account ID or number.
          </p>
        )}
      </section>
      <p className="muted">
        The owner manages login accounts and access profiles separately in
        Firebase.
      </p>
    </>
  );
}

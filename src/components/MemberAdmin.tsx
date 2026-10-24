import { useRef, useState } from 'react';
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
    [q, setQ] = useState('');
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
  return (
    <>
      <div className="page-heading">
        <h1>Member directory</h1>
        <p>
          Add new accounts and update names or numbers from your Ssentezo CSV
          export.
        </p>
      </div>
      <section className="card upload-card">
        <Icon name="file-earmark-spreadsheet" />
        <h2>Update from CSV</h2>
        <p>
          Uses Account Id, Account Number and Account Name. Missing accounts
          stay in the directory; past entries keep their original details.
        </p>
        <label className="button upload-label">
          <Icon name="upload" />
          {reading ? 'Checking file…' : 'Choose CSV'}
          <input
            type="file"
            accept=".csv,text/csv"
            disabled={!writable || reading}
            onChange={(e) => {
              void read(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
        </label>
        {name && <p>{name}</p>}
        {reading && (
          <p role="status">Comparing the file with the current directory…</p>
        )}
        {error && (
          <p className="field-error" role="alert">
            {error}
          </p>
        )}
      </section>
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
      <section className="card">
        <h2>
          {members.length} {cached ? 'saved ' : ''}accounts
        </h2>
        <SearchField label="Search directory" value={q} onChange={setQ} />
        <div className="directory-list">
          {matches.slice(0, 50).map((m) => (
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
        <p className="muted">
          {matches.length
            ? `Showing ${Math.min(50, matches.length)} of ${matches.length} matches. Refine your search to find an account.`
            : 'No matching accounts. Try a different name, account ID or number.'}
        </p>
      </section>
      <p className="muted">
        The owner manages login accounts and access profiles separately in
        Firebase.
      </p>
    </>
  );
}

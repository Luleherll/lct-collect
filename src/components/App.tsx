import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  type User,
} from 'firebase/auth';
import {
  collection,
  doc,
  getDocsFromServer,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  where,
  type QueryConstraint,
} from 'firebase/firestore';
import { auth, db, logout } from '../lib/firebase';
import {
  amount,
  dayLabel,
  money,
  searchMembers,
  timeLabel,
  usernameEmail,
  workday,
} from '../lib/domain';
import {
  flatten,
  LABELS,
  TYPES,
  type Entry,
  type LineType,
  type Member,
  type Profile,
  type Row,
  type Session,
} from '../lib/models';
import {
  findSubmission,
  saveEntry,
  setRecorded,
  startSession,
  voidEntryLine,
} from '../lib/operations';
import { planImport, type ImportPlan } from '../lib/import';
import Icon from './Icon';

const HOME = { agent: '/agent/', viewer: '/viewer/', admin: '/admin/' };
const EMPTY_AMOUNTS = { deposit: '', withdrawal: '', loanInstalment: '' };
const message = (error: unknown) => {
  const code = (error as { code?: string })?.code ?? '';
  if (code.includes('permission-denied'))
    return 'Access was denied. Ask the owner to check your account permissions and active status.';
  if (code.includes('auth/'))
    return 'Sign-in failed. Check your username and password, or contact the owner.';
  return error instanceof Error
    ? error.message
    : 'Could not complete this action. Check your connection and try again.';
};
function useRecords<T>(
  name: string,
  constraints: QueryConstraint[],
  key: string,
  enabled: boolean,
) {
  const [result, setResult] = useState<{
    data: T[];
    loading: boolean;
    cached: boolean;
    error: string;
  }>({ data: [], loading: true, cached: true, error: '' });
  useEffect(() => {
    setResult({ data: [], loading: enabled, cached: true, error: '' });
    if (!enabled) return;
    return onSnapshot(
      query(collection(db(), name), ...constraints),
      { includeMetadataChanges: true },
      (snap) => {
        // Never expose a financial/status change until its server acknowledgement.
        if (snap.metadata.hasPendingWrites) return;
        setResult({
          data: snap.docs.map((d) => d.data() as T),
          loading: false,
          cached: snap.metadata.fromCache,
          error: '',
        });
      },
      (e) =>
        setResult({
          data: [],
          loading: false,
          cached: true,
          error: message(e),
        }),
    );
    // Query identity is represented by key; arrays are rebuilt on render.
  }, [name, key, enabled]);
  return result;
}
function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    d?.showModal();
    const cancel = (e: Event) => {
      e.preventDefault();
      onClose();
    };
    d?.addEventListener('cancel', cancel);
    return () => {
      d?.removeEventListener('cancel', cancel);
      d?.close();
    };
  }, []);
  return (
    <dialog ref={ref} aria-labelledby="modal-title">
      <div className="dialog-head">
        <h2 id="modal-title">{title}</h2>
        <button
          className="icon-button"
          aria-label="Close dialog"
          onClick={onClose}
        >
          <Icon name="x-lg" />
        </button>
      </div>
      {children}
    </dialog>
  );
}
const Account = ({
  name,
  number,
  id,
}: {
  name: string;
  number: string;
  id: string;
}) => (
  <div className="account">
    <strong>{name}</strong>
    <span>Account no. {number}</span>
    <span>Account ID {id}</span>
  </div>
);
const Status = ({ row }: { row: Row }) => (
  <span
    className={`status ${row.line.state === 'voided' ? 'voided' : row.line.recorded ? 'recorded' : ''}`}
  >
    {row.line.state === 'voided'
      ? 'Voided'
      : row.line.recorded
        ? 'Recorded'
        : 'Unrecorded'}
  </span>
);

export default function App({ route }: { route: string }) {
  const [user, setUser] = useState<User | null>(null),
    [profile, setProfile] = useState<Profile | null>(null),
    [authReady, setAuthReady] = useState(false),
    [profileError, setProfileError] = useState('');
  const [today, setToday] = useState(workday()),
    [date, setDate] = useState(workday()),
    [historyDay, setHistoryDay] = useState('');
  const [network, setNetwork] = useState(navigator.onLine),
    [lastSync, setLastSync] = useState('');
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const [modal, setModal] = useState<'review' | 'line' | 'undo' | null>(null),
    [selectedRow, setSelectedRow] = useState<Row | null>(null),
    [reason, setReason] = useState('');
  const [member, setMember] = useState<Member | null>(null),
    [memberQuery, setMemberQuery] = useState(''),
    [values, setValues] = useState({ ...EMPTY_AMOUNTS });
  const [reviewValues, setReviewValues] = useState<Record<LineType, number>>({
    deposit: 0,
    withdrawal: 0,
    loanInstalment: 0,
  });
  const [reviewSessionId, setReviewSessionId] = useState('');
  const pendingId = useRef(''),
    [uncertain, setUncertain] = useState(false);
  const [q, setQ] = useState(''),
    [type, setType] = useState('all'),
    [status, setStatus] = useState(route === 'viewer' ? 'unrecorded' : 'all'),
    [agent, setAgent] = useState('all');
  const [importPlan, setImportPlan] = useState<ImportPlan | null>(null),
    [importName, setImportName] = useState(''),
    [importProgress, setImportProgress] = useState('');
  const authorized = !!user && !!profile?.active;
  useEffect(
    () =>
      onAuthStateChanged(auth, (u) => {
        setUser(u);
        setProfile(null);
        setProfileError('');
        setAuthReady(true);
      }),
    [],
  );
  useEffect(() => {
    if (authReady && !user && route !== 'login')
      window.location.replace('/login/');
  }, [authReady, user, route]);
  useEffect(() => {
    if (!user) return;
    return onSnapshot(
      doc(db(), 'users', user.uid),
      (snap) => {
        if (!snap.exists()) {
          setProfileError(
            'Your login has no application profile yet. Ask the owner to finish account setup.',
          );
          return;
        }
        const p = snap.data() as Profile;
        if (!['agent', 'viewer', 'admin'].includes(p.role) || !p.active) {
          setProfile(null);
          setProfileError(
            'Your account is inactive or has no assigned role. Contact the owner.',
          );
          return;
        }
        setProfile(p);
        const allowed =
          p.role === 'agent'
            ? ['agent', 'recent', 'history']
            : p.role === 'viewer'
              ? ['viewer']
              : ['admin'];
        if (!allowed.includes(route)) window.location.replace(HOME[p.role]);
      },
      (e) => setProfileError(message(e)),
    );
  }, [user?.uid]);
  useEffect(() => {
    const update = () => {
      setNetwork(navigator.onLine);
      setToday(workday());
    };
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    window.addEventListener('focus', update);
    const interval = window.setInterval(update, 15000);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
      window.removeEventListener('focus', update);
      clearInterval(interval);
    };
  }, []);
  useEffect(() => {
    if (user) {
      const id = sessionStorage.getItem(`lct-pending-${user.uid}`);
      if (id) {
        pendingId.current = id;
        setUncertain(true);
      }
    }
  }, [user?.uid]);
  const isAgent = profile?.role === 'agent',
    isViewer = profile?.role === 'viewer',
    isAdmin = profile?.role === 'admin';
  const members = useRecords<Member>(
    'members',
    isAdmin ? [] : [where('active', '==', true)],
    `${user?.uid}/${profile?.role}`,
    authorized,
  );
  const sessions = useRecords<Session>(
    'sessions',
    [where('agentId', '==', user?.uid ?? ''), orderBy('workday', 'desc')],
    `${user?.uid}`,
    authorized && isAgent,
  );
  const entryDay = route === 'history' ? historyDay : isViewer ? date : today;
  const constraints: QueryConstraint[] = [
    ...(isAgent ? [where('agentId', '==', user?.uid ?? '')] : []),
    ...(entryDay ? [where('workday', '==', entryDay)] : []),
  ];
  const entries = useRecords<Entry>(
    'entries',
    constraints,
    `${user?.uid}/${entryDay}/${route}`,
    authorized && !isAdmin,
  );
  const session = sessions.data.find((s) => s.workday === today);
  const cached = isAdmin
    ? members.cached
    : isViewer
      ? entries.cached
      : members.cached || sessions.cached || entries.cached;
  const writable = network && !cached && !busy;
  useEffect(() => {
    if (!cached)
      setLastSync(
        new Intl.DateTimeFormat('en-UG', {
          hour: '2-digit',
          minute: '2-digit',
          timeZone: 'Africa/Kampala',
        }).format(new Date()),
      );
  }, [cached, members.data, entries.data, sessions.data]);
  async function action(fn: () => Promise<unknown>, success: string) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await fn();
      setNotice(success);
      setModal(null);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  async function signOutNow() {
    setProfile(null);
    setBusy(true);
    try {
      await logout();
    } catch (e) {
      setError(message(e));
      setBusy(false);
    }
  }
  function review() {
    setError('');
    setNotice('');
    try {
      if (!member) throw new Error('Select a member account first.');
      if (!session) throw new Error('Start a session first.');
      const parsed = {
        deposit: amount(values.deposit, true),
        withdrawal: amount(values.withdrawal, true),
        loanInstalment: amount(values.loanInstalment, true),
      };
      if (!TYPES.some((t) => parsed[t] > 0))
        throw new Error('Enter at least one amount.');
      if (
        session.expectedCash +
          parsed.deposit +
          parsed.loanInstalment -
          parsed.withdrawal <
        0
      )
        throw new Error('Withdrawal exceeds expected cash available.');
      if (!pendingId.current) pendingId.current = crypto.randomUUID();
      setReviewValues(parsed);
      setReviewSessionId(session.sessionId);
      setModal('review');
    } catch (e) {
      setError(message(e));
    }
  }
  function clearForm() {
    if (user) sessionStorage.removeItem(`lct-pending-${user.uid}`);
    setMember(null);
    setMemberQuery('');
    setValues({ ...EMPTY_AMOUNTS });
    pendingId.current = '';
    setError('');
    setNotice('');
    document.getElementById('member-search')?.focus();
  }
  async function commit() {
    if (!member || !user || !profile) return;
    if (!session || session.sessionId !== reviewSessionId) {
      setModal(null);
      setError(
        "This session has ended. Start today's session and review the entry again.",
      );
      return;
    }
    setBusy(true);
    setError('');
    sessionStorage.setItem(`lct-pending-${user.uid}`, pendingId.current);
    try {
      await saveEntry(
        pendingId.current,
        session.sessionId,
        member,
        reviewValues,
        user.uid,
        profile,
      );
      sessionStorage.removeItem(`lct-pending-${user.uid}`);
      setUncertain(false);
      setModal(null);
      clearForm();
      setNotice('Entry saved.');
    } catch (e) {
      setUncertain(true);
      setModal(null);
      setError(
        `Save not confirmed. Check its status before retrying. ${message(e)}`,
      );
    } finally {
      setBusy(false);
    }
  }
  async function checkSave() {
    await action(async () => {
      if (await findSubmission(pendingId.current)) {
        sessionStorage.removeItem(`lct-pending-${user!.uid}`);
        setUncertain(false);
        clearForm();
      } else {
        setUncertain(false);
        throw new Error(
          'No saved entry found. Your original submission ID is retained; review and retry when ready.',
        );
      }
    }, 'Previous entry is saved.');
  }
  function showLine(row: Row) {
    setSelectedRow(row);
    setReason('');
    setError('');
    setModal('line');
  }
  const allRows = flatten(entries.data).sort(
    (a, b) =>
      (b.entry.createdAt?.toMillis() ?? 0) -
      (a.entry.createdAt?.toMillis() ?? 0),
  );
  const validRows = allRows.filter((r) => r.line.state === 'active');
  const filtered = allRows.filter(
    (r) =>
      (!isViewer || r.line.state === 'active') &&
      (type === 'all' || r.type === type) &&
      (status === 'all' ||
        (status === 'recorded'
          ? r.line.recorded
          : r.line.state === 'active' && !r.line.recorded)) &&
      (agent === 'all' || r.entry.agentId === agent) &&
      `${r.entry.memberNameSnapshot} ${r.entry.memberId} ${r.entry.accountNumberSnapshot}`
        .toLowerCase()
        .includes(q.toLowerCase().trim()),
  );
  const agents = Array.from(
    new Map(
      entries.data.map((e) => [e.agentId, e.agentNameSnapshot]),
    ).entries(),
  );
  function Filters({ viewer = false }: { viewer?: boolean }) {
    // Defined outside the JSX call below so input state stays in the page component.
    return (
      <>
        <div className="filter-grid">
          <label className="search-field">
            <span className="sr-only">Search entries</span>
            <Icon name="search" />
            <input
              aria-label="Search entries"
              placeholder="Search name, account ID or number"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </label>
          <label>
            Status
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="all">All statuses</option>
              <option value="unrecorded">Unrecorded</option>
              <option value="recorded">Recorded</option>
            </select>
          </label>
          {viewer && (
            <label>
              Agent
              <select value={agent} onChange={(e) => setAgent(e.target.value)}>
                <option value="all">All agents</option>
                {agents.map(([id, name]) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
        <div className="chips" aria-label="Transaction type">
          {['all', ...TYPES].map((t) => (
            <button
              key={t}
              className={type === t ? 'chip selected' : 'chip'}
              aria-pressed={type === t}
              onClick={() => setType(t)}
            >
              {t === 'all' ? 'All' : LABELS[t as LineType]}
            </button>
          ))}
        </div>
      </>
    );
  }
  function rowsView(rows: Row[], viewer = false) {
    if (entries.loading) return <p className="empty">Loading entries…</p>;
    if (!rows.length)
      return (
        <div className="empty">
          <Icon name="list-ul" />
          <h3>
            {cached ? 'No matching saved records' : 'No matching entries'}
          </h3>
          <p>
            {cached
              ? 'Saved data may be incomplete. Connect to load this workday.'
              : 'Try another search, date or status filter.'}
          </p>
        </div>
      );
    return (
      <div className={viewer ? 'register' : 'entry-list'}>
        {viewer && (
          <div className="register-head">
            <span>Member account</span>
            <span>Type / agent</span>
            <span>Amount</span>
            <span>Status</span>
            <span>Action</span>
          </div>
        )}
        {rows.map((row) => (
          <article
            className="entry-row"
            key={`${row.entry.entryId}:${row.type}`}
          >
            <button className="entry-identity" onClick={() => showLine(row)}>
              <strong>{row.entry.memberNameSnapshot}</strong>
              <span>
                {row.entry.accountNumberSnapshot} · ID {row.entry.memberId}
              </span>
              <span>
                {timeLabel(row.entry.createdAt)}
                {viewer ? ' · ' + row.entry.agentNameSnapshot : ''}
              </span>
            </button>
            <div className="entry-kind">
              {LABELS[row.type]}
              {viewer && <small>{row.entry.agentNameSnapshot}</small>}
            </div>
            <strong className="row-money">UGX {money(row.line.amount)}</strong>
            <Status row={row} />
            {viewer ? (
              <button
                className={
                  row.line.recorded ? 'button outline small' : 'button small'
                }
                disabled={!writable}
                onClick={() => {
                  if (row.line.recorded) {
                    setSelectedRow(row);
                    setModal('undo');
                  } else
                    void action(
                      () =>
                        setRecorded(
                          row.entry.entryId,
                          row.type,
                          true,
                          user!.uid,
                        ),
                      'Marked recorded in Ssentezo.',
                    );
                }}
              >
                <Icon
                  name={row.line.recorded ? 'arrow-counterclockwise' : 'check2'}
                />
                {row.line.recorded ? 'Undo' : 'Mark recorded'}
              </button>
            ) : (
              <button
                className="icon-button"
                aria-label={`View ${LABELS[row.type]} details`}
                onClick={() => showLine(row)}
              >
                <Icon name="chevron-right" />
              </button>
            )}
          </article>
        ))}
      </div>
    );
  }
  async function readFile(file?: File) {
    if (!file) return;
    setError('');
    setImportPlan(null);
    setImportName(file.name);
    try {
      if (!file.name.toLowerCase().endsWith('.csv') || file.size > 2_000_000)
        throw new Error('Choose a CSV export up to 2 MB.');
      const [text, existing] = await Promise.all([
        file.text(),
        getDocsFromServer(collection(db(), 'members')),
      ]);
      setImportPlan(
        planImport(
          text,
          existing.docs.map((d) => d.data() as Member),
        ),
      );
    } catch (e) {
      setError(message(e));
    }
  }
  async function applyImport() {
    if (!importPlan || importPlan.errors.length) return;
    const rows = importPlan.rows.filter((r) => r.action !== 'Unchanged');
    await action(async () => {
      for (let offset = 0; offset < rows.length; offset += 50) {
        if (!navigator.onLine)
          throw new Error(
            `Connection lost. ${offset} accounts applied; upload the file again to preview the remaining changes.`,
          );
        const group = rows.slice(offset, offset + 50);
        await runTransaction(db(), async (tx) => {
          const refs = group.map((r) => doc(db(), 'members', r.memberId));
          const snaps = await Promise.all(refs.map((ref) => tx.get(ref)));
          group.forEach((r, i) =>
            tx.set(refs[i], {
              memberId: r.memberId,
              accountNumber: r.accountNumber,
              fullName: r.fullName,
              searchName: r.fullName.toLowerCase(),
              active: snaps[i].exists() ? snaps[i].data()!.active : true,
              updatedAt: serverTimestamp(),
            }),
          );
        });
        setImportProgress(
          `${Math.min(offset + 50, rows.length)} of ${rows.length} accounts updated`,
        );
      }
      setImportPlan(null);
      setImportName('');
    }, 'Member directory updated.');
  }
  if (!authReady)
    return <div className="loading">Connecting to LCT Collect…</div>;
  if (!user) return <Login notice={profileError} />;
  if (!profile)
    return (
      <main className="login-shell">
        <h1>LCT Collect</h1>
        <p role="status">{profileError || 'Loading your access…'}</p>
        <button className="button" disabled={busy} onClick={signOutNow}>
          Sign out
        </button>
      </main>
    );
  const headerDay = isViewer ? date : historyDay || today;
  const queryError = members.error || sessions.error || entries.error;
  return (
    <>
      <header className="app-header">
        <div className="header-inner">
          <div className="brand">
            <a href={HOME[profile.role]}>LCT Collect</a>
            <p>
              {profile.displayName} · {dayLabel(headerDay)}
            </p>
            {import.meta.env.PUBLIC_APP_ENV !== 'production' && (
              <span className="environment">Staging</span>
            )}
          </div>
          <nav aria-label="Main navigation">
            {isAgent ? (
              <>
                <a
                  className={route === 'history' ? 'active' : ''}
                  href="/agent/history/"
                >
                  <Icon name="clock-history" />
                  <span>History</span>
                </a>
                <a
                  className={route === 'recent' ? 'active' : ''}
                  href="/agent/recent/"
                >
                  <Icon name="list-ul" />
                  <span>Recent entries</span>
                </a>
              </>
            ) : (
              <a href={HOME[profile.role]}>
                <Icon name={isViewer ? 'list-ul' : 'people'} />
                <span>{isViewer ? 'Register' : 'Members'}</span>
              </a>
            )}
          </nav>
        </div>
      </header>
      <main className={isViewer || isAdmin ? 'page wide' : 'page'}>
        {(cached || !network) && (
          <div className="connection" role="status">
            <Icon name="wifi-off" />
            <span>
              {!network
                ? 'Offline — viewing saved records. Connect to make changes.'
                : 'Connecting — showing saved records; results may be incomplete.'}
            </span>
          </div>
        )}
        {error && (
          <div className="alert error" role="alert">
            {error}
          </div>
        )}
        {queryError && (
          <div className="alert error" role="alert">
            {queryError}
          </div>
        )}
        {notice && (
          <div className="alert success" role="status">
            {notice}
          </div>
        )}
        {uncertain && (
          <div className="alert">
            <strong>Previous save needs checking.</strong>
            <p>Keep the same submission ID to avoid a duplicate.</p>
            <button
              className="button outline"
              disabled={!writable}
              onClick={checkSave}
            >
              Check save status
            </button>
          </div>
        )}
        {isAgent && route === 'agent' && (
          <>
            {sessions.loading ? (
              <p className="empty">Loading your session…</p>
            ) : !session ? (
              <section className="card start-card">
                <span className="eyebrow">{dayLabel(today)}</span>
                <h1>Start today's session</h1>
                <p>
                  Enter the physical cash you are taking into the field. Zero is
                  valid.
                </p>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    const field = new FormData(e.currentTarget).get(
                      'opening',
                    ) as string;
                    void action(async () => {
                      await startSession(user.uid, amount(field, true));
                    }, 'Session started.');
                  }}
                >
                  <label>
                    Opening cash (UGX)
                    <input
                      name="opening"
                      inputMode="numeric"
                      defaultValue="0"
                      required
                    />
                  </label>
                  <button className="button full" disabled={!writable}>
                    {busy ? 'Starting…' : 'Start session'}
                  </button>
                </form>
              </section>
            ) : (
              <>
                <section
                  className="cash-summary"
                  aria-label="Expected physical cash"
                >
                  <h1>Expected cash</h1>
                  <div className="cash-number">
                    UGX {money(session.expectedCash)}
                  </div>
                  <p>
                    {cached
                      ? 'Saved cash estimate'
                      : `Up to date${lastSync ? ' · ' + lastSync : ''}`}
                  </p>
                  <details>
                    <summary>Cash breakdown</summary>
                    <dl>
                      <div>
                        <dt>Opening cash</dt>
                        <dd>{money(session.openingCash)}</dd>
                      </div>
                      <div>
                        <dt>Deposits</dt>
                        <dd>+ {money(session.totalDeposits)}</dd>
                      </div>
                      <div>
                        <dt>Loan instalments</dt>
                        <dd>+ {money(session.totalLoanInstalments)}</dd>
                      </div>
                      <div>
                        <dt>Withdrawals</dt>
                        <dd>− {money(session.totalWithdrawals)}</dd>
                      </div>
                    </dl>
                  </details>
                </section>
                <section className="card find-card">
                  <h2>Find member</h2>
                  <label className="search-field">
                    <span className="sr-only">
                      Search member by name, account ID or number
                    </span>
                    <Icon name="search" />
                    <input
                      id="member-search"
                      placeholder="Search name, account ID or number"
                      value={memberQuery}
                      disabled={uncertain || busy}
                      onChange={(e) => setMemberQuery(e.target.value)}
                      autoComplete="off"
                    />
                  </label>
                  {memberQuery.trim() && (
                    <ul className="suggestions" aria-label="Matching accounts">
                      {searchMembers(members.data, memberQuery).map((m) => (
                        <li key={m.memberId}>
                          <button
                            disabled={busy || uncertain}
                            onClick={() => {
                              setMember(m);
                              setMemberQuery('');
                              document.getElementById('deposit')?.focus();
                            }}
                          >
                            <Account
                              name={m.fullName}
                              number={m.accountNumber}
                              id={m.memberId}
                            />
                            <Icon name="chevron-right" />
                          </button>
                        </li>
                      ))}
                      {!searchMembers(members.data, memberQuery).length && (
                        <li className="no-match">
                          Member not found.
                          {members.cached
                            ? ' Connect to refresh the directory.'
                            : ''}
                        </li>
                      )}
                    </ul>
                  )}
                </section>
                <section className="card entry-card">
                  <h2>New entry</h2>
                  {member ? (
                    <Account
                      name={member.fullName}
                      number={member.accountNumber}
                      id={member.memberId}
                    />
                  ) : (
                    <p className="muted">
                      Find and select a member account above to begin.
                    </p>
                  )}
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      review();
                    }}
                  >
                    {TYPES.map((t) => (
                      <div className="amount-row" key={t}>
                        <label htmlFor={t}>
                          <strong>{LABELS[t]}</strong>
                          <span>
                            {t === 'deposit'
                              ? 'Amount received from member'
                              : t === 'withdrawal'
                                ? 'Amount paid to member'
                                : 'Amount received for loan repayment'}
                          </span>
                        </label>
                        <div className="currency-input">
                          <span>UGX</span>
                          <input
                            id={t}
                            inputMode="numeric"
                            aria-label={`${LABELS[t]} in UGX`}
                            placeholder="0"
                            disabled={!member || busy || uncertain}
                            value={values[t]}
                            onChange={(e) =>
                              setValues((v) => ({ ...v, [t]: e.target.value }))
                            }
                            onBlur={() => {
                              try {
                                if (values[t])
                                  setValues((v) => ({
                                    ...v,
                                    [t]: money(amount(v[t], true)),
                                  }));
                              } catch {
                                /* Validation is displayed on confirmation. */
                              }
                            }}
                          />
                        </div>
                      </div>
                    ))}
                    <div className="actions">
                      <button
                        type="button"
                        className="button outline"
                        onClick={clearForm}
                        disabled={busy || uncertain}
                      >
                        Cancel
                      </button>
                      <button
                        className="button"
                        disabled={!writable || !member || uncertain}
                      >
                        Confirm
                      </button>
                    </div>
                  </form>
                </section>
              </>
            )}
          </>
        )}
        {isAgent && route === 'recent' && (
          <>
            <a className="back-link" href="/agent/">
              <Icon name="arrow-left" />
              Back to collection
            </a>
            <div className="page-heading">
              <h1>Recent entries</h1>
              <p>{dayLabel(today)} · Your current workday</p>
            </div>
            {Filters({})}
            {rowsView(filtered)}
          </>
        )}
        {isAgent && route === 'history' && (
          <>
            <a className="back-link" href="/agent/">
              <Icon name="arrow-left" />
              Back to collection
            </a>
            <div className="page-heading">
              <h1>Session history</h1>
              <p>
                Previous workdays are read-only. Office recording can continue.
              </p>
            </div>
            {historyDay ? (
              <>
                <button
                  className="text-button"
                  onClick={() => {
                    setHistoryDay('');
                    setQ('');
                    setType('all');
                    setStatus('all');
                  }}
                >
                  All sessions
                </button>
                <h2>{dayLabel(historyDay)}</h2>
                {Filters({})}
                {rowsView(filtered)}
              </>
            ) : (
              <div className="session-list">
                {sessions.loading ? (
                  <p>Loading sessions…</p>
                ) : !sessions.data.length ? (
                  <p className="empty">No saved sessions yet.</p>
                ) : (
                  sessions.data.map((s) => {
                    const rows = flatten(
                      entries.data.filter((e) => e.sessionId === s.sessionId),
                    ).filter((r) => r.line.state === 'active');
                    return (
                      <button
                        className="session-card"
                        key={s.sessionId}
                        onClick={() => setHistoryDay(s.workday)}
                      >
                        <div className="session-title">
                          <strong>{dayLabel(s.workday)}</strong>
                          <span className="status">
                            {s.workday === today ? 'Current' : 'Read-only'}
                          </span>
                        </div>
                        <dl className="session-totals">
                          <div>
                            <dt>Opening</dt>
                            <dd>{money(s.openingCash)}</dd>
                          </div>
                          <div>
                            <dt>Deposits</dt>
                            <dd>{money(s.totalDeposits)}</dd>
                          </div>
                          <div>
                            <dt>Withdrawals</dt>
                            <dd>{money(s.totalWithdrawals)}</dd>
                          </div>
                          <div>
                            <dt>Loan instalments</dt>
                            <dd>{money(s.totalLoanInstalments)}</dd>
                          </div>
                        </dl>
                        <div className="session-bottom">
                          <span>
                            Expected closing cash{' '}
                            <strong>UGX {money(s.expectedCash)}</strong>
                          </span>
                          <span>
                            {rows.length} lines ·{' '}
                            {rows.filter((r) => !r.line.recorded).length}{' '}
                            {entries.cached ? 'saved ' : ''}outstanding
                          </span>
                          <Icon name="chevron-right" />
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            )}
          </>
        )}
        {isViewer && (
          <>
            <div className="page-heading">
              <span className="eyebrow">Office checklist</span>
              <h1>Ssentezo register</h1>
              <p>Mark each line only after entering it in Ssentezo.</p>
            </div>
            <label className="date-control">
              Operational date
              <input
                type="date"
                value={date}
                onChange={(e) => {
                  if (e.target.value) setDate(e.target.value);
                }}
              />
            </label>
            <p className="summary-caption">
              {cached
                ? 'Saved totals — may be incomplete'
                : 'Workday totals · all valid lines'}
            </p>
            <div className="totals">
              {TYPES.map((t) => (
                <div key={t}>
                  <span>{LABELS[t]}s</span>
                  <strong>
                    <small>UGX </small>
                    {money(
                      validRows
                        .filter((r) => r.type === t)
                        .reduce((sum, r) => sum + r.line.amount, 0),
                    )}
                  </strong>
                </div>
              ))}
            </div>
            <div className="register-counts">
              <span>
                {validRows.filter((r) => !r.line.recorded).length} unrecorded
              </span>
              <span>
                {validRows.filter((r) => r.line.recorded).length} recorded
              </span>
            </div>
            {Filters({ viewer: true })}
            <p className="muted">
              {filtered.length} matching lines
              {cached ? ' · saved records only' : ''}
            </p>
            {rowsView(filtered, true)}
          </>
        )}
        {isAdmin && (
          <>
            <div className="page-heading">
              <span className="eyebrow">Owner administration</span>
              <h1>Member directory</h1>
              <p>
                Upload a Ssentezo CSV export to add accounts and update names or
                numbers.
              </p>
            </div>
            <section className="card upload-card">
              <Icon name="file-earmark-spreadsheet" />
              <h2>Update from CSV</h2>
              <p>
                Only Account Id, Account Number and Account Name are used.
                Existing accounts absent from a file are kept.
              </p>
              <label className="button upload-label">
                <Icon name="upload" />
                Choose CSV
                <input
                  type="file"
                  accept=".csv,text/csv"
                  disabled={!writable}
                  onChange={(e) => void readFile(e.target.files?.[0])}
                />
              </label>
              {importName && <p>{importName}</p>}
            </section>
            {importPlan && (
              <section className="card">
                <h2>Review import</h2>
                <div className="import-counts">
                  {(['Add', 'Update', 'Unchanged'] as const).map((a) => (
                    <span key={a}>
                      <strong>
                        {importPlan.rows.filter((r) => r.action === a).length}
                      </strong>{' '}
                      {a}
                    </span>
                  ))}
                </div>
                {!!importPlan.errors.length && (
                  <div className="alert error">
                    <strong>Resolve these issues before importing:</strong>
                    <ul>
                      {importPlan.errors.slice(0, 20).map((e, i) => (
                        <li key={i}>{e}</li>
                      ))}
                    </ul>
                  </div>
                )}
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Account ID</th>
                        <th>Account number</th>
                        <th>Name</th>
                        <th>Change</th>
                      </tr>
                    </thead>
                    <tbody>
                      {importPlan.rows.slice(0, 30).map((r) => (
                        <tr key={r.memberId}>
                          <td>{r.memberId}</td>
                          <td>{r.accountNumber}</td>
                          <td>{r.fullName}</td>
                          <td>{r.action}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {importPlan.rows.length > 30 && (
                  <p>
                    Showing the first 30 of {importPlan.rows.length} validated
                    rows.
                  </p>
                )}
                <div className="actions">
                  <button
                    className="button outline"
                    disabled={busy}
                    onClick={() => setImportPlan(null)}
                  >
                    Cancel
                  </button>
                  <button
                    className="button"
                    disabled={!writable || !!importPlan.errors.length}
                    onClick={applyImport}
                  >
                    {busy ? 'Importing…' : 'Apply updates'}
                  </button>
                </div>
                {importProgress && <p role="status">{importProgress}</p>}
              </section>
            )}
            <section className="card">
              <h2>
                {members.data.length} {members.cached ? 'saved ' : ''}accounts
              </h2>
              <label className="search-field">
                <Icon name="search" />
                <input
                  aria-label="Search directory"
                  placeholder="Search name, account ID or number"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                />
              </label>
              <div className="directory-list">
                {members.data
                  .filter((m) =>
                    `${m.fullName} ${m.memberId} ${m.accountNumber}`
                      .toLowerCase()
                      .includes(q.toLowerCase()),
                  )
                  .slice(0, 50)
                  .map((m) => (
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
                Showing up to 50 matches. Historical entry details are preserved
                when this directory changes.
              </p>
            </section>
            <p className="muted">
              User accounts and access profiles are managed manually in Firebase
              by the owner.
            </p>
          </>
        )}
        <footer>
          <span>
            {profile.role === 'admin'
              ? 'Owner'
              : profile.role === 'viewer'
                ? 'Viewer'
                : 'Agent'}{' '}
            · {profile.username}
          </span>
          <button className="text-button" disabled={busy} onClick={signOutNow}>
            <Icon name="box-arrow-right" />
            Sign out
          </button>
        </footer>
      </main>
      {modal === 'review' && member && (
        <Modal title="Review entry" onClose={() => !busy && setModal(null)}>
          <Account
            name={member.fullName}
            number={member.accountNumber}
            id={member.memberId}
          />
          <dl className="review-lines">
            {TYPES.filter((t) => reviewValues[t] > 0).map((t) => (
              <div key={t}>
                <dt>{LABELS[t]}</dt>
                <dd>UGX {money(reviewValues[t])}</dd>
              </div>
            ))}
            <div>
              <dt>Cash received</dt>
              <dd>
                {money(reviewValues.deposit + reviewValues.loanInstalment)}
              </dd>
            </div>
            <div>
              <dt>Cash paid out</dt>
              <dd>{money(reviewValues.withdrawal)}</dd>
            </div>
            <div className="net">
              <dt>Net cash change</dt>
              <dd>
                UGX{' '}
                {money(
                  reviewValues.deposit +
                    reviewValues.loanInstalment -
                    reviewValues.withdrawal,
                )}
              </dd>
            </div>
          </dl>
          <div className="actions">
            <button
              className="button outline"
              disabled={busy}
              onClick={() => setModal(null)}
            >
              Back / edit
            </button>
            <button className="button" disabled={!writable} onClick={commit}>
              {busy ? 'Saving…' : 'Confirm & save'}
            </button>
          </div>
        </Modal>
      )}
      {modal === 'undo' && selectedRow && (
        <Modal
          title="Undo recording check?"
          onClose={() => !busy && setModal(null)}
        >
          <Account
            name={selectedRow.entry.memberNameSnapshot}
            number={selectedRow.entry.accountNumberSnapshot}
            id={selectedRow.entry.memberId}
          />
          <p>
            {LABELS[selectedRow.type]} · UGX {money(selectedRow.line.amount)}
          </p>
          <p>
            This changes the checklist only. It does not reverse anything in
            Ssentezo.
          </p>
          {error && (
            <div className="alert error" role="alert">
              {error}
            </div>
          )}
          <div className="actions">
            <button
              className="button outline"
              disabled={busy}
              onClick={() => setModal(null)}
            >
              Keep recorded
            </button>
            <button
              className="button"
              disabled={!writable}
              onClick={() =>
                void action(
                  () =>
                    setRecorded(
                      selectedRow.entry.entryId,
                      selectedRow.type,
                      false,
                      user.uid,
                    ),
                  'Recording check undone.',
                )
              }
            >
              Undo check
            </button>
          </div>
        </Modal>
      )}
      {modal === 'line' && selectedRow && (
        <Modal title="Entry details" onClose={() => !busy && setModal(null)}>
          <Account
            name={selectedRow.entry.memberNameSnapshot}
            number={selectedRow.entry.accountNumberSnapshot}
            id={selectedRow.entry.memberId}
          />
          <div className="detail-amount">
            {LABELS[selectedRow.type]}
            <strong>UGX {money(selectedRow.line.amount)}</strong>
          </div>
          <Status row={selectedRow} />
          <dl>
            <div>
              <dt>Operational date</dt>
              <dd>{dayLabel(selectedRow.entry.workday)}</dd>
            </div>
            <div>
              <dt>Agent</dt>
              <dd>{selectedRow.entry.agentNameSnapshot}</dd>
            </div>
            <div>
              <dt>Time</dt>
              <dd>{timeLabel(selectedRow.entry.createdAt)}</dd>
            </div>
            {selectedRow.line.recorded && (
              <div>
                <dt>Recorded by</dt>
                <dd className="break">
                  {selectedRow.line.recordedBy} ·{' '}
                  {timeLabel(selectedRow.line.recordedAt)}
                </dd>
              </div>
            )}
          </dl>
          {selectedRow.line.state === 'voided' && (
            <div className="alert">
              <strong>Void reason</strong>
              <p>{selectedRow.line.voidReason}</p>
            </div>
          )}
          {isAgent &&
          route !== 'history' &&
          selectedRow.entry.workday === today &&
          selectedRow.line.state === 'active' &&
          !selectedRow.line.recorded ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void action(
                  () =>
                    voidEntryLine(
                      selectedRow.entry,
                      selectedRow.type,
                      reason,
                      user.uid,
                    ),
                  'Line voided.',
                );
              }}
            >
              <label>
                Reason for voiding
                <textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  minLength={3}
                  maxLength={500}
                  required
                />
              </label>
              <p className="muted">
                The line remains in the log and its cash effect is reversed.
              </p>
              <button
                className="button danger full"
                disabled={!writable || reason.trim().length < 3}
              >
                Void this line
              </button>
            </form>
          ) : (
            isAgent && (
              <p className="muted">
                This line is read-only
                {selectedRow.line.recorded
                  ? ' because it is recorded in Ssentezo'
                  : '.'}
                .
              </p>
            )
          )}
          {!!selectedRow.line.recordingRevision && (
            <details>
              <summary>Recording audit history</summary>
              <ol className="audit">
                {Object.entries(selectedRow.line.recordingHistory)
                  .sort(([a], [b]) => Number(b) - Number(a))
                  .map(([id, event]) => (
                    <li key={id}>
                      <strong>
                        {event.recorded ? 'Marked recorded' : 'Check undone'}
                      </strong>
                      <span>
                        {timeLabel(event.at)} · {event.by}
                      </span>
                    </li>
                  ))}
              </ol>
            </details>
          )}
          {error && (
            <div className="alert error" role="alert">
              {error}
            </div>
          )}
        </Modal>
      )}
    </>
  );
}

function Login({ notice }: { notice: string }) {
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [show, setShow] = useState(false);
  const [cacheWarning] = useState(() => {
    const warning = sessionStorage.getItem('lct-cache-warning') ?? '';
    sessionStorage.removeItem('lct-cache-warning');
    return warning;
  });
  return (
    <div className="login-page">
      <header className="login-brand">
        <span>LCT Collect</span>
        <p>Lusaze Community Traders SACCO</p>
      </header>
      <main className="login-shell">
        <span className="eyebrow">Field collections, clearly recorded</span>
        <h1>Welcome back</h1>
        <p>Sign in with your assigned username.</p>
        {(error || notice || cacheWarning) && (
          <div className="alert error" role="alert">
            {error || notice || cacheWarning}
          </div>
        )}
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setError('');
            setBusy(true);
            const data = new FormData(e.currentTarget);
            try {
              const email = usernameEmail(data.get('username') as string);
              localStorage.setItem(
                'lct-trusted-device',
                data.get('trusted') ? 'yes' : 'no',
              );
              await signInWithEmailAndPassword(
                auth,
                email,
                data.get('password') as string,
              );
            } catch (err) {
              setError(message(err));
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            Username
            <input
              name="username"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              required
              placeholder="Your username"
            />
          </label>
          <label>
            Password
            <div className="password-input">
              <input
                name="password"
                type={show ? 'text' : 'password'}
                autoComplete="current-password"
                required
                placeholder="Your password"
              />
              <button
                type="button"
                className="icon-button"
                aria-label={show ? 'Hide password' : 'Show password'}
                onClick={() => setShow((v) => !v)}
              >
                <Icon name="eye" />
              </button>
            </div>
          </label>
          <label className="checkbox-label">
            <input name="trusted" type="checkbox" />
            <span>
              Save records for offline viewing on this trusted, non-shared
              device.
            </span>
          </label>
          <p className="small-note">
            Saved records can remain accessible on a disconnected device. Only
            enable this on a device you trust.
          </p>
          <button className="button full" disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
            <Icon name="arrow-right" />
          </button>
        </form>
        <p className="login-help">
          Need an account or a password reset? Contact the SACCO owner.
        </p>
        {import.meta.env.PUBLIC_APP_ENV !== 'production' && (
          <span className="environment">Staging environment</span>
        )}
      </main>
    </div>
  );
}

import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import {
  doc,
  onSnapshot,
  orderBy,
  limit,
  where,
  type QueryConstraint,
} from 'firebase/firestore';
import { auth, db, logout, memoryOnlySession } from '../lib/firebase';
import {
  amount,
  dayLabel,
  money,
  searchMembers,
  timeLabel,
  dateTimeLabel,
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

import Icon from './Icon';
import Modal from './Modal';
import { Account, Status } from './Account';
import { useRecords } from '../hooks/useRecords';
import { storage } from '../lib/storage';
import { message } from '../lib/errors';
import SearchField from './SearchField';
const Login = lazy(() => import('./Login'));
const MemberAdmin = lazy(() => import('./MemberAdmin'));

const HOME = { agent: '/agent/', viewer: '/viewer/', admin: '/admin/' };
type Receipt = Pick<
  Entry,
  | 'entryId'
  | 'memberId'
  | 'memberNameSnapshot'
  | 'accountNumberSnapshot'
  | 'agentNameSnapshot'
  | 'workday'
> & {
  createdAt?: Entry['createdAt'];
  lines: Partial<Record<LineType, { amount: number }>>;
};
const EMPTY_AMOUNTS = { deposit: '', withdrawal: '', loanInstalment: '' };
export default function App({ route: initialRoute }: { route: string }) {
  const [route, setRoute] = useState(initialRoute);
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
  const [fieldErrors, setFieldErrors] = useState<
    Partial<Record<LineType, string>>
  >({});
  const [guard, setGuard] = useState<{
    title: string;
    body: string;
    label: string;
    run: () => void;
  } | null>(null);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [undoRow, setUndoRow] = useState<Row | null>(null);
  const [historyCount, setHistoryCount] = useState(20);
  const dirty = TYPES.some((t) => values[t].trim() !== '');
  const depositRef = useRef<HTMLInputElement>(null);
  const mutation = useRef(false);
  const allowUnload = useRef(false);
  useEffect(() => {
    if (member && !uncertain) depositRef.current?.focus();
  }, [member?.memberId]);
  function protect(
    run: () => void,
    title = 'Discard this entry?',
    body = 'These amounts have not been saved. Stay to finish the entry, or discard them.',
    label = 'Discard entry',
  ) {
    if (busy || uncertain) {
      setError(
        uncertain
          ? 'Check the previous save before leaving this screen.'
          : 'Please wait while this change is confirmed.',
      );
      return;
    }
    if (dirty) setGuard({ title, body, label, run });
    else run();
  }
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!allowUnload.current && (dirty || busy || uncertain)) {
        event.preventDefault();
        Reflect.set(event, 'returnValue', '');
      }
    };
    const navigate = (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        event.altKey
      )
        return;
      const anchor = (event.target as Element).closest?.(
        'a[href]',
      ) as HTMLAnchorElement | null;
      if (
        !anchor ||
        anchor.target === '_blank' ||
        anchor.hasAttribute('download') ||
        (!dirty && !busy && !uncertain)
      )
        return;
      if (
        anchor.hash &&
        anchor.origin === window.location.origin &&
        anchor.pathname === window.location.pathname &&
        anchor.search === window.location.search
      )
        return;
      event.preventDefault();
      protect(() => {
        allowUnload.current = true;
        window.location.assign(anchor.href);
      });
    };
    window.addEventListener('beforeunload', beforeUnload);
    document.addEventListener('click', navigate, true);
    return () => {
      window.removeEventListener('beforeunload', beforeUnload);
      document.removeEventListener('click', navigate, true);
    };
  }, [dirty, busy, uncertain]);
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
          setProfile(null);
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
        if (!allowed.includes(route)) {
          // Complete sign-in without destroying an in-memory Auth session.
          if (route === 'login') {
            window.history.replaceState(null, '', HOME[p.role]);
            setRoute(p.role);
            setStatus(p.role === 'viewer' ? 'unrecorded' : 'all');
            document.title = 'LCT Collect';
          } else window.location.replace(HOME[p.role]);
        }
      },
      (e) => {
        setProfile(null);
        setProfileError(message(e));
      },
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
      const id = storage.get('session', `lct-pending-${user.uid}`);
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
    authorized && (isAgent || isAdmin),
  );
  const sessions = useRecords<Session>(
    'sessions',
    [
      where('agentId', '==', user?.uid ?? ''),
      ...(route === 'history'
        ? [orderBy('workday', 'desc'), limit(historyCount)]
        : [where('workday', '==', today)]),
    ],
    `${user?.uid}/${route}/${today}/${historyCount}`,
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
    authorized && !isAdmin && !!entryDay,
  );
  const session = sessions.data.find((s) => s.workday === today);
  const cached = isAdmin
    ? members.cached
    : isViewer
      ? entries.cached
      : members.cached || sessions.cached || (!!entryDay && entries.cached);
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
    if (mutation.current) return;
    mutation.current = true;
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
      mutation.current = false;
      setBusy(false);
    }
  }
  async function signOutNow() {
    allowUnload.current = true;
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
      const parsed = { deposit: 0, withdrawal: 0, loanInstalment: 0 };
      const errors: Partial<Record<LineType, string>> = {};
      for (const t of TYPES) {
        try {
          parsed[t] = amount(values[t], true);
        } catch (e) {
          errors[t] = message(e);
        }
      }
      setFieldErrors(errors);
      const invalid = TYPES.find((t) => errors[t]);
      if (invalid) {
        document.getElementById(invalid)?.focus();
        return;
      }
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
    if (user) storage.remove('session', `lct-pending-${user.uid}`);
    setMember(null);
    setMemberQuery('');
    setValues({ ...EMPTY_AMOUNTS });
    setFieldErrors({});
    pendingId.current = '';
    setError('');
    setNotice('');
    document.getElementById('member-search')?.focus();
  }
  async function commit() {
    if (!member || !user || !profile || mutation.current) return;
    if (!session || session.sessionId !== reviewSessionId) {
      setModal(null);
      setError(
        "This session has ended. Start today's session and review the entry again.",
      );
      return;
    }
    if (!storage.set('session', `lct-pending-${user.uid}`, pendingId.current)) {
      setError(
        'This browser cannot retain a save reference. Enable site storage before saving money, then review again.',
      );
      return;
    }
    mutation.current = true;
    setBusy(true);
    setError('');
    try {
      await saveEntry(
        pendingId.current,
        session.sessionId,
        member,
        reviewValues,
        user.uid,
        profile,
      );
      storage.remove('session', `lct-pending-${user.uid}`);
      setUncertain(false);
      setModal(null);
      const savedId = pendingId.current;
      clearForm();
      const savedLines = Object.fromEntries(
        TYPES.filter((t) => reviewValues[t] > 0).map((t) => [
          t,
          { amount: reviewValues[t], state: 'active', recorded: false },
        ]),
      );
      setReceipt({
        entryId: savedId,
        memberId: member.memberId,
        memberNameSnapshot: member.fullName,
        accountNumberSnapshot: member.accountNumber,
        agentNameSnapshot: profile.displayName,
        workday: session.workday,
        lines: savedLines,
      });
      setNotice('Entry saved.');
    } catch (e) {
      setUncertain(true);
      setModal(null);
      setError(
        `Save not confirmed. Check its status before retrying. ${message(e)}`,
      );
    } finally {
      mutation.current = false;
      setBusy(false);
    }
  }
  async function checkSave() {
    await action(async () => {
      const saved = await findSubmission(pendingId.current);
      if (saved) {
        setReceipt(saved);
        storage.remove('session', `lct-pending-${user!.uid}`);
        setUncertain(false);
        clearForm();
      } else {
        setUncertain(false);
        throw new Error(
          'No saved entry was found. Your amounts have not been sent again. Review the entry to retry safely.',
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
  const liveSelected =
    selectedRow &&
    allRows.find(
      (r) =>
        r.entry.entryId === selectedRow.entry.entryId &&
        r.type === selectedRow.type,
    );
  const detailRow = liveSelected ?? selectedRow;
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
          <SearchField value={q} onChange={setQ} label="Search entries" />
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
                {''}
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
                      async () => {
                        await setRecorded(
                          row.entry.entryId,
                          row.type,
                          true,
                          user!.uid,
                          profile!.displayName,
                        );
                        setUndoRow(row);
                      },
                      `Recorded: ${row.entry.memberNameSnapshot} · ${LABELS[row.type]} · UGX ${money(row.line.amount)}.`,
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
  if (!authReady)
    return <div className="loading">Connecting to LCT Collect…</div>;
  if (!user)
    return (
      <Suspense fallback={<p role="status">Loading sign in…</p>}>
        <Login notice={profileError} />
      </Suspense>
    );
  if (!profile)
    return (
      <main tabIndex={-1} id="main-content" className="login-shell">
        <h1>LCT Collect</h1>
        <p role="status">{profileError || 'Loading your access…'}</p>
        <button
          className="button"
          disabled={busy}
          onClick={() => protect(() => void signOutNow())}
        >
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
      <main
        tabIndex={-1}
        id="main-content"
        className={isViewer || isAdmin ? 'page wide' : 'page'}
      >
        {memoryOnlySession && (
          <p className="alert" role="status">
            Site storage is unavailable. Sign-in lasts while this page is open.
            Enable site storage to save collection entries or stay signed in
            when changing pages.
          </p>
        )}
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
        {undoRow && (
          <div className="receipt" role="status">
            <p>
              Last recorded: <strong>{undoRow.entry.memberNameSnapshot}</strong>{' '}
              · {LABELS[undoRow.type]} · UGX {money(undoRow.line.amount)}
            </p>
            <button
              className="button outline small"
              disabled={!writable}
              onClick={() => {
                setSelectedRow(undoRow);
                setModal('undo');
                setUndoRow(null);
              }}
            >
              Undo recording check
            </button>
          </div>
        )}
        {receipt && (
          <section className="receipt" aria-label="Saved entry receipt">
            <div className="receipt-heading">
              <Icon name="check2" />
              <h2>Entry saved</h2>
              <button
                className="icon-button"
                aria-label="Dismiss saved entry"
                onClick={() => setReceipt(null)}
              >
                <Icon name="x-lg" />
              </button>
            </div>
            <Account
              name={receipt.memberNameSnapshot}
              number={receipt.accountNumberSnapshot}
              id={receipt.memberId}
            />
            <ul>
              {TYPES.filter((t) => receipt.lines[t]).map((t) => (
                <li key={t}>
                  {LABELS[t]}{' '}
                  <strong>UGX {money(receipt.lines[t]!.amount)}</strong>
                </li>
              ))}
            </ul>
            <p>
              {dayLabel(receipt.workday)}
              {receipt.createdAt
                ? ` · ${timeLabel(receipt.createdAt)}`
                : ' · Saved just now'}
            </p>
            <a className="back-link" href="/agent/recent/">
              View recent entries <Icon name="chevron-right" />
            </a>
          </section>
        )}
        {uncertain && (
          <div className="alert">
            <strong>Previous save needs checking.</strong>
            <p>
              Check whether your previous entry reached the notebook before
              entering that money again.
            </p>
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
                  noValidate
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
                    <span>UGX</span>{' '}
                    <strong>{money(session.expectedCash)}</strong>
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
                  <SearchField
                    id="member-search"
                    value={memberQuery}
                    onChange={setMemberQuery}
                    label="Search members"
                    disabled={uncertain || busy}
                  />
                  {memberQuery.trim() && (
                    <ul className="suggestions" aria-label="Matching accounts">
                      {searchMembers(members.data, memberQuery).map((m) => (
                        <li key={m.memberId}>
                          <button
                            disabled={busy || uncertain}
                            onClick={() => {
                              const select = () => {
                                if (member?.memberId !== m.memberId) {
                                  setValues({ ...EMPTY_AMOUNTS });
                                  setFieldErrors({});
                                  pendingId.current = '';
                                }
                                setMember(m);
                                setMemberQuery('');
                              };
                              if (member?.memberId === m.memberId) {
                                setMemberQuery('');
                                depositRef.current?.focus();
                              } else
                                protect(
                                  select,
                                  'Change member account?',
                                  'Changing accounts discards the amounts entered for the current member. No money has been saved.',
                                  'Discard & change member',
                                );
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
                    noValidate
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
                            ref={t === 'deposit' ? depositRef : undefined}
                            aria-invalid={!!fieldErrors[t]}
                            aria-describedby={
                              fieldErrors[t] ? `${t}-error` : undefined
                            }
                            inputMode="numeric"
                            aria-label={`${LABELS[t]} in UGX`}
                            placeholder="0"
                            disabled={!member || busy || uncertain}
                            value={values[t]}
                            onChange={(e) => {
                              setValues((v) => ({ ...v, [t]: e.target.value }));
                              setFieldErrors((errors) => ({
                                ...errors,
                                [t]: undefined,
                              }));
                            }}
                            onBlur={(event) => {
                              try {
                                const text = event.currentTarget.value;
                                const formatted = text
                                  ? money(amount(text, true))
                                  : '';
                                setValues((v) => ({ ...v, [t]: formatted }));
                                setFieldErrors((e) => ({
                                  ...e,
                                  [t]: undefined,
                                }));
                              } catch (e) {
                                setFieldErrors((errors) => ({
                                  ...errors,
                                  [t]: message(e),
                                }));
                              }
                            }}
                          />
                        </div>
                        {fieldErrors[t] && (
                          <p className="field-error" id={`${t}-error`}>
                            {fieldErrors[t]}
                          </p>
                        )}
                      </div>
                    ))}
                    <div className="actions">
                      <button
                        type="button"
                        className="button outline"
                        onClick={() => protect(clearForm)}
                        disabled={busy || uncertain}
                      >
                        Cancel
                      </button>
                      <button
                        className="button"
                        disabled={!writable || !member || uncertain}
                      >
                        Review entry
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
                    return (
                      <button
                        className="session-card"
                        key={s.sessionId}
                        onClick={() => {
                          setHistoryDay(s.workday);
                          setQ('');
                          setType('all');
                          setStatus('all');
                        }}
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
                          <span>View this workday’s entries</span>
                          <Icon name="chevron-right" />
                        </div>
                      </button>
                    );
                  })
                )}
                {sessions.data.length >= historyCount && (
                  <button
                    className="button outline full"
                    disabled={sessions.loading}
                    onClick={() => setHistoryCount((n) => n + 20)}
                  >
                    Load older sessions
                  </button>
                )}
              </div>
            )}
          </>
        )}
        {isViewer && (
          <>
            <div className="page-heading">
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
          <Suspense
            fallback={<p role="status">Loading member administration…</p>}
          >
            <MemberAdmin
              writable={writable}
              busy={busy}
              members={members.data}
              cached={members.cached}
              action={action}
            />
          </Suspense>
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
          <button
            className="text-button"
            disabled={busy}
            onClick={() => protect(() => void signOutNow())}
          >
            <Icon name="box-arrow-right" />
            Sign out
          </button>
        </footer>
      </main>
      {guard && (
        <Modal title={guard.title} onClose={() => setGuard(null)}>
          <p>{guard.body}</p>
          <div className="actions">
            <button
              className="button outline"
              autoFocus
              onClick={() => setGuard(null)}
            >
              Keep entry
            </button>
            <button
              className="button danger"
              onClick={() => {
                const run = guard.run;
                setGuard(null);
                run();
              }}
            >
              {guard.label}
            </button>
          </div>
        </Modal>
      )}
      {modal === 'review' && member && (
        <Modal title="Review entry" onClose={() => !busy && setModal(null)}>
          <Account
            name={member.fullName}
            number={member.accountNumber}
            id={member.memberId}
          />
          {error && (
            <p className="alert error" role="alert">
              {error}
            </p>
          )}
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
      {modal === 'undo' && detailRow && (
        <Modal
          title="Undo recording check?"
          onClose={() => !busy && setModal(null)}
        >
          <Account
            name={detailRow.entry.memberNameSnapshot}
            number={detailRow.entry.accountNumberSnapshot}
            id={detailRow.entry.memberId}
          />
          <p>
            {LABELS[detailRow.type]} · UGX {money(detailRow.line.amount)}
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
                      detailRow.entry.entryId,
                      detailRow.type,
                      false,
                      user.uid,
                      profile.displayName,
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
      {modal === 'line' && detailRow && (
        <Modal title="Entry details" onClose={() => !busy && setModal(null)}>
          <Account
            name={detailRow.entry.memberNameSnapshot}
            number={detailRow.entry.accountNumberSnapshot}
            id={detailRow.entry.memberId}
          />
          <div className="detail-amount">
            {LABELS[detailRow.type]}
            <strong>UGX {money(detailRow.line.amount)}</strong>
          </div>
          <Status row={detailRow} />
          <dl>
            <div>
              <dt>Operational date</dt>
              <dd>{dayLabel(detailRow.entry.workday)}</dd>
            </div>
            <div>
              <dt>Agent</dt>
              <dd>{detailRow.entry.agentNameSnapshot}</dd>
            </div>
            <div>
              <dt>Time</dt>
              <dd>{timeLabel(detailRow.entry.createdAt)}</dd>
            </div>
            {detailRow.line.recorded && (
              <div>
                <dt>Recorded by</dt>
                <dd className="break">
                  {detailRow.line.recordingHistory[
                    String(detailRow.line.recordingRevision)
                  ]?.actorName || `User ${detailRow.line.recordedBy}`}{' '}
                  · {dateTimeLabel(detailRow.line.recordedAt)}
                </dd>
              </div>
            )}
          </dl>
          {detailRow.line.state === 'voided' && (
            <div className="alert">
              <strong>Void reason</strong>
              <p>{detailRow.line.voidReason}</p>
            </div>
          )}
          {isAgent &&
          route !== 'history' &&
          detailRow.entry.workday === today &&
          detailRow.line.state === 'active' &&
          !detailRow.line.recorded ? (
            <form
              noValidate
              onSubmit={(e) => {
                e.preventDefault();
                void action(
                  () =>
                    voidEntryLine(
                      detailRow.entry,
                      detailRow.type,
                      reason,
                      user.uid,
                    ),
                  'Line voided.',
                );
              }}
            >
              <label>
                Reason for voiding (3–500 characters)
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
                {detailRow.line.recorded
                  ? ' because it is recorded in Ssentezo'
                  : '.'}
                .
              </p>
            )
          )}
          {!!detailRow.line.recordingRevision && (
            <details>
              <summary>Recording audit history</summary>
              <ol className="audit">
                {Object.entries(detailRow.line.recordingHistory)
                  .sort(([a], [b]) => Number(b) - Number(a))
                  .map(([id, event]) => (
                    <li key={id}>
                      <strong>
                        {event.recorded ? 'Marked recorded' : 'Check undone'}
                      </strong>
                      <span>
                        {dateTimeLabel(event.at)} ·{' '}
                        {event.actorName || `User ${event.by}`}
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

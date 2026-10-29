import { matchesAccount, groupAccounts } from '../lib/account';
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { doc, onSnapshot, orderBy, limit, where } from 'firebase/firestore';
import {
  auth,
  db,
  logout,
  memoryOnlySession,
  recordCacheAvailable,
} from '../lib/firebase';
import {
  amount,
  dayLabel,
  money,
  timeLabel,
  dateTimeLabel,
  workday,
} from '../lib/domain';
import {
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
import Pagination from './Pagination';
import LoadingOverlay from './LoadingOverlay';
import Brand from './Brand';
import { usePagination } from '../hooks/usePagination';
import MemberResults from './MemberResults';
import Modal from './Modal';
import { Account, Status } from './Account';
import { usePagedEntries } from '../hooks/usePagedEntries';
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
  | 'uniqueNumberSnapshot'
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
  const [modal, setModal] = useState<
      'review' | 'line' | 'undo' | 'cash' | null
    >(null),
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
    [agent, setAgent] = useState('all'),
    [agentLabel, setAgentLabel] = useState('');
  const [fieldErrors, setFieldErrors] = useState<
    Partial<Record<LineType, string>>
  >({});
  const [guard, setGuard] = useState<{
    title: string;
    body: string;
    label: string;
    run: () => void;
  } | null>(null);
  const [openingValue, setOpeningValue] = useState('0');
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [markingRow, setMarkingRow] = useState('');
  const [undoRow, setUndoRow] = useState<Row | null>(null);
  const [connectionWaited, setConnectionWaited] = useState(false);
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
  function navigateTo(path: string, replace = false) {
    const routes: Record<string, string> = {
      '/agent/': 'agent',
      '/agent/recent/': 'recent',
      '/agent/history/': 'history',
      '/viewer/': 'viewer',
      '/admin/': 'admin',
      '/login/': 'login',
    };
    const next = routes[path];
    if (!next) {
      window.location.assign(path);
      return;
    }
    window.history[replace ? 'replaceState' : 'pushState'](null, '', path);
    setRoute(next);
    setQ('');
    setType('all');
    setStatus(next === 'viewer' ? 'unrecorded' : 'all');
    setHistoryDay('');
    setError('');
    setModal(null);
    if (next !== 'agent') {
      setMember(null);
      setValues({ ...EMPTY_AMOUNTS });
    }
    document.title = `${next === 'recent' ? 'Recent entries' : next === 'history' ? 'Session history' : 'LCT Collect'} · LCT Collect`;
    window.scrollTo({ top: 0, behavior: 'instant' });
    requestAnimationFrame(() =>
      document.getElementById('main-content')?.focus({ preventScroll: true }),
    );
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
        anchor.origin !== location.origin ||
        anchor.hash
      )
        return;
      if (
        ![
          '/agent/',
          '/agent/recent/',
          '/agent/history/',
          '/viewer/',
          '/admin/',
          '/login/',
        ].includes(anchor.pathname)
      )
        return;
      event.preventDefault();
      if (anchor.pathname !== location.pathname)
        protect(() => navigateTo(anchor.pathname));
    };
    const back = () => {
      const target = location.pathname;
      const current = {
        agent: '/agent/',
        recent: '/agent/recent/',
        history: '/agent/history/',
        viewer: '/viewer/',
        admin: '/admin/',
        login: '/login/',
      }[route];
      // Fragment navigation (including the skip link) keeps the current screen.
      if (target === current) return;
      if (dirty || busy || uncertain) {
        history.pushState(null, '', current);
        protect(() => navigateTo(target, true));
      } else navigateTo(target, true);
    };
    window.addEventListener('beforeunload', beforeUnload);
    window.addEventListener('popstate', back);
    document.addEventListener('click', navigate);
    return () => {
      window.removeEventListener('beforeunload', beforeUnload);
      window.removeEventListener('popstate', back);
      document.removeEventListener('click', navigate);
    };
  }, [dirty, busy, uncertain, route]);
  useEffect(() => {
    if (!receipt) return;
    const timer = window.setTimeout(() => setReceipt(null), 6000);
    return () => clearTimeout(timer);
  }, [receipt]);
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => {
      setNotice('');
      setUndoRow(null);
    }, 6000);
    return () => clearTimeout(timer);
  }, [notice]);
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
      ...(isViewer ? [] : [where('agentId', '==', user?.uid ?? '')]),
      ...(isViewer
        ? [where('workday', '==', date)]
        : route === 'history'
          ? [orderBy('workday', 'desc'), limit(5)]
          : [where('workday', '==', today)]),
    ],
    `${user?.uid}/${isViewer ? date : route === 'history' ? 'latest-five' : 'current'}/${today}`,
    authorized && (isAgent || isViewer),
  );
  const entryDay = route === 'history' ? historyDay : isViewer ? date : today;
  const showingEntries =
    isViewer ||
    (isAgent && (route === 'recent' || (route === 'history' && !!historyDay)));
  const entries = usePagedEntries(
    entryDay,
    `${user?.uid}/${profile?.role}/${route}`,
    authorized && showingEntries,
    isAgent ? user?.uid : undefined,
  );
  const searchPages = usePagination(
    groupAccounts(members.data, memberQuery, true),
    memberQuery,
  );
  const session = sessions.data.find((s) => s.workday === today);
  const cached = isAdmin
    ? members.cached
    : isViewer
      ? entries.cached || sessions.cached
      : members.cached || sessions.cached || (showingEntries && entries.cached);
  const waitingForData = !!(
    authorized &&
    (isAgent || isAdmin) &&
    network &&
    cached &&
    !(members.error || sessions.error || entries.error)
  );
  const waitKey = `${user?.uid}/${route}/${entryDay}`;
  useEffect(() => {
    setConnectionWaited(false);
    if (!waitingForData) return;
    const timer = window.setTimeout(() => setConnectionWaited(true), 8000);
    return () => window.clearTimeout(timer);
  }, [waitKey, waitingForData]);
  const loadingData = waitingForData && !connectionWaited;
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
    setUndoRow(null);
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
        ...(member.uniqueNumber
          ? { uniqueNumberSnapshot: member.uniqueNumber }
          : {}),
        agentNameSnapshot: profile.displayName,
        workday: session.workday,
        lines: savedLines,
      });
      setNotice('');
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
    }, '');
  }
  function showLine(row: Row) {
    setSelectedRow(row);
    setReason('');
    setError('');
    setModal('line');
  }
  const allRows = [...entries.rows].sort(
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
  const filtered = allRows.filter(
    (r) =>
      (!isViewer || r.line.state === 'active') &&
      (type === 'all' || r.type === type) &&
      (status === 'all' ||
        (status === 'recorded'
          ? r.line.recorded
          : r.line.state === 'active' && !r.line.recorded)) &&
      (agent === 'all' || r.entry.agentId === agent) &&
      matchesAccount(
        r.entry.memberNameSnapshot,
        r.entry.accountNumberSnapshot,
        q,
        r.entry.uniqueNumberSnapshot,
      ),
  );
  const agents = Array.from(
    new Map(
      entries.data.map((e) => [e.agentId, e.agentNameSnapshot]),
    ).entries(),
  );
  if (agent !== 'all' && !agents.some(([id]) => id === agent))
    agents.push([agent, agentLabel]);
  function Filters({ viewer = false }: { viewer?: boolean }) {
    // Defined outside the JSX call below so input state stays in the page component.
    return (
      <>
        <div className="filter-grid">
          <SearchField
            value={q}
            onChange={setQ}
            label={viewer ? 'Search this page' : 'Search entries'}
            placeholder="Search this page"
          />
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
              Type
              <select value={type} onChange={(e) => setType(e.target.value)}>
                <option value="all">All types</option>
                {TYPES.map((t) => (
                  <option key={t} value={t}>
                    {LABELS[t]}
                  </option>
                ))}
              </select>
            </label>
          )}
          {viewer && (agents.length > 1 || agent !== 'all') && (
            <label>
              Agent
              <select
                value={agent}
                onChange={(e) => {
                  setAgent(e.target.value);
                  setAgentLabel(e.target.selectedOptions[0].text);
                }}
              >
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
        {!viewer && (
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
        )}
      </>
    );
  }
  function entryPagination(label: string) {
    return (
      <Pagination
        label={label}
        focusTarget="entry-results"
        page={entries.page + 1}
        hasPrevious={entries.page > 0}
        hasNext={entries.hasNext}
        onPrevious={entries.previous}
        onNext={entries.next}
        busy={busy || entries.loading}
      />
    );
  }
  function rowsView(rows: Row[], viewer = false) {
    if (entries.loading) return <p className="empty">Loading entries…</p>;
    if (!rows.length)
      return (
        <div className="empty" id="entry-results" tabIndex={-1}>
          <Icon name="list-ul" />
          <h3>
            {cached ? 'No matching saved records' : 'No matching entries'}
          </h3>
          <p>
            {cached
              ? 'Saved data may be incomplete. Connect to load this workday.'
              : viewer
                ? 'Try another page, date or filter.'
                : 'Try another search, date or status filter.'}
          </p>
        </div>
      );
    return (
      <div
        id="entry-results"
        tabIndex={-1}
        role="region"
        aria-label="Entry results"
        className={viewer ? 'register' : 'entry-list'}
      >
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
            <button
              className="entry-identity"
              aria-label={`View ${row.entry.memberNameSnapshot}, ${LABELS[row.type]}, account ${row.entry.accountNumberSnapshot}`}
              onClick={() => showLine(row)}
            >
              <strong>{row.entry.memberNameSnapshot}</strong>
              <span>{row.entry.accountNumberSnapshot}</span>
              <span>
                {timeLabel(row.entry.createdAt)} <Status row={row} />
              </span>
            </button>
            <div className="entry-kind">
              {LABELS[row.type]}
              {viewer && <small>{row.entry.agentNameSnapshot}</small>}
            </div>
            <strong className="row-money">UGX {money(row.line.amount)}</strong>
            {viewer && <Status row={row} />}
            {viewer ? (
              <button
                className={
                  row.line.recorded ? 'button outline small' : 'button small'
                }
                disabled={!writable}
                aria-busy={markingRow === `${row.entry.entryId}:${row.type}`}
                onClick={() => {
                  if (row.line.recorded) {
                    setSelectedRow(row);
                    setModal('undo');
                  } else {
                    setMarkingRow(`${row.entry.entryId}:${row.type}`);
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
                    ).finally(() => setMarkingRow(''));
                  }
                }}
              >
                {markingRow === `${row.entry.entryId}:${row.type}` ? (
                  <>
                    <span className="button-spinner" aria-hidden="true" />
                    Recording…
                  </>
                ) : (
                  <>
                    <Icon
                      name={
                        row.line.recorded ? 'arrow-counterclockwise' : 'check2'
                      }
                    />
                    {row.line.recorded ? 'Undo' : 'Mark recorded'}
                  </>
                )}
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
    return (
      <div className="boot-shell">
        <header className="app-header" inert={loadingData}>
          <div className="header-inner">
            <div className="brand">
              <Brand />
            </div>
          </div>
        </header>
        <p className="loading" role="status">
          Opening your notebook…
        </p>
      </div>
    );
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
      <header className="app-header" inert={loadingData}>
        <div className="header-inner">
          <div className="brand">
            <Brand href={HOME[profile.role]} />
            <p>
              {profile.displayName} · {dayLabel(headerDay)}
            </p>
          </div>
          <nav aria-label="Main navigation">
            {isAgent ? (
              <>
                <a
                  aria-current={route === 'recent' ? 'page' : undefined}
                  className={route === 'recent' ? 'active' : ''}
                  href="/agent/recent/"
                >
                  <Icon name="list-ul" />
                  <span>Recent entries</span>
                </a>
                <a
                  aria-current={route === 'history' ? 'page' : undefined}
                  className={route === 'history' ? 'active' : ''}
                  href="/agent/history/"
                >
                  <Icon name="clock-history" />
                  <span>History</span>
                </a>
              </>
            ) : isAdmin ? (
              <div id="owner-header-actions" />
            ) : null}
          </nav>
        </div>
      </header>
      <main
        inert={loadingData}
        aria-busy={loadingData}
        tabIndex={-1}
        id="main-content"
        className={`${isViewer || isAdmin ? 'page wide' : 'page'} ${route}-page`}
      >
        {(memoryOnlySession || !recordCacheAvailable) && (
          <p className="alert" role="status">
            Site storage is limited. Offline viewing is limited to this open
            page.
            {memoryOnlySession &&
              ' Sign-in lasts while this page is open. Enable site storage to save collection entries.'}
          </p>
        )}
        {(cached || !network) && !loadingData && (
          <div
            className={
              isAgent || isAdmin
                ? 'connection compact-connection'
                : 'connection'
            }
            role="status"
          >
            <Icon name="wifi-off" />
            <span>
              {isAgent || isAdmin
                ? !network
                  ? 'You’re offline · saved data may be outdated.'
                  : 'Can’t connect · saved data may be outdated.'
                : !network
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
          <div
            className="save-toast"
            role="status"
            aria-label="Activity update"
          >
            <Icon name="check2" />
            <div>{notice}</div>
            {undoRow && isViewer && (
              <button
                className="text-button"
                disabled={!writable}
                onClick={() => {
                  setSelectedRow(undoRow);
                  setModal('undo');
                  setUndoRow(null);
                }}
                aria-label="Undo recording check"
              >
                Undo
              </button>
            )}
            <button
              className="icon-button"
              aria-label="Dismiss update"
              onClick={() => {
                setNotice('');
                setUndoRow(null);
              }}
            >
              <Icon name="x-lg" />
            </button>
          </div>
        )}

        {receipt && (
          <div
            className="save-toast"
            role="status"
            aria-label="Saved entry receipt"
          >
            <Icon name="check2" />
            <div>
              <strong>Saved · {receipt.memberNameSnapshot}</strong>
              <span>
                Account {receipt.accountNumberSnapshot} ·{' '}
                {TYPES.filter((t) => receipt.lines[t])
                  .map(
                    (t) =>
                      `${LABELS[t]} UGX ${money(receipt.lines[t]!.amount)}`,
                  )
                  .join(' · ')}
              </span>
            </div>
            <button
              className="icon-button"
              aria-label="Dismiss saved entry"
              onClick={() => setReceipt(null)}
            >
              <Icon name="x-lg" />
            </button>
          </div>
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
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9,]*"
                      onChange={(e) => {
                        if (/^[0-9,]*$/.test(e.currentTarget.value))
                          setOpeningValue(e.currentTarget.value);
                      }}
                      value={openingValue}
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
                    <>
                      <MemberResults
                        groups={searchPages.items}
                        searching
                        disabled={uncertain || busy}
                        onSelect={(m) => {
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
                              'Changing accounts discards the amounts entered for the current account. No money has been saved.',
                              'Discard & change member',
                            );
                        }}
                      />
                      {searchPages.pageCount > 1 && (
                        <Pagination
                          label="Member search pages"
                          page={searchPages.page}
                          pageCount={searchPages.pageCount}
                          summary={searchPages.summary}
                          onPrevious={searchPages.previous}
                          onNext={searchPages.next}
                          busy={busy || uncertain}
                        />
                      )}
                      {!searchPages.items.length && (
                        <p className="no-match">
                          Member not found.
                          {members.cached
                            ? ' Connect to refresh the directory.'
                            : ''}
                        </p>
                      )}
                    </>
                  )}
                </section>
                <section className="card entry-card">
                  <h2>New entry</h2>
                  {member ? (
                    <Account
                      name={member.fullName}
                      number={member.accountNumber}
                      memberNumber={member.uniqueNumber}
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
                            type="text"
                            inputMode="numeric"
                            pattern="[0-9,]*"
                            autoComplete="off"
                            aria-label={`${LABELS[t]} in UGX`}
                            placeholder="0"
                            disabled={!member || busy || uncertain}
                            value={values[t]}
                            onChange={(e) => {
                              const text = e.currentTarget.value;
                              if (!/^[0-9,]*$/.test(text)) return;
                              setValues((v) => ({ ...v, [t]: text }));
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
              <div className="heading-actions">
                <h1>Recent entries</h1>
                <button
                  className="button outline small"
                  disabled={!session}
                  onClick={() => setModal('cash')}
                >
                  Cash breakdown
                </button>
              </div>
              <p>{dayLabel(today)} · Your current workday</p>
            </div>
            {Filters({})}
            <p className="list-summary">
              {filtered.length} lines match on this page
            </p>
            {rowsView(filtered)}
            {entryPagination('Recent entry pages')}
          </>
        )}
        {isAgent && route === 'history' && (
          <>
            <div className="history-navigation">
              <a className="back-link" href="/agent/">
                <Icon name="arrow-left" />
                Back to collection
              </a>
              {historyDay && (
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
              )}
            </div>
            <div className="page-heading">
              <h1>{historyDay ? dayLabel(historyDay) : 'Recent workdays'}</h1>
              <p>
                {historyDay
                  ? 'Previous workdays are read-only. Amounts in UGX.'
                  : 'Your latest five workdays · amounts in UGX'}
              </p>
            </div>
            {historyDay ? (
              <>
                {Filters({})}
                <p className="list-summary">
                  {filtered.length} lines match on this page
                </p>
                {rowsView(filtered)}
                {entryPagination('Workday entry pages')}
              </>
            ) : (
              <div className="session-list">
                {sessions.loading ? (
                  <p role="status">Loading workdays…</p>
                ) : !sessions.data.length ? (
                  <p className="empty">No saved workdays yet.</p>
                ) : (
                  sessions.data.map((s) => (
                    <button
                      className="session-card compact-session"
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
                        <Icon name="chevron-right" />
                      </div>
                      <dl className="session-totals">
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
                        <span>Opening {money(s.openingCash)}</span>
                        <span>
                          Expected cash <strong>{money(s.expectedCash)}</strong>
                        </span>
                      </div>
                    </button>
                  ))
                )}
              </div>
            )}
          </>
        )}
        {isViewer && (
          <>
            <div className="viewer-heading">
              <div>
                <h1>Ssentezo register</h1>
                <p>Mark after entering in Ssentezo.</p>
              </div>
              <label className="date-control">
                Workday
                <input
                  type="date"
                  value={date}
                  onChange={(e) => {
                    if (e.target.value) {
                      setDate(e.target.value);
                      setAgent('all');
                      setQ('');
                    }
                  }}
                />
              </label>
            </div>
            <details className="viewer-totals">
              <summary>
                Workday totals{sessions.cached ? ' · saved data' : ''}
              </summary>
              <div className="totals">
                {TYPES.map((t) => (
                  <div key={t}>
                    <span>{LABELS[t]}s</span>
                    <strong>
                      <small>UGX </small>
                      {money(
                        sessions.data.reduce(
                          (sum, session) =>
                            sum +
                            session[
                              t === 'deposit'
                                ? 'totalDeposits'
                                : t === 'withdrawal'
                                  ? 'totalWithdrawals'
                                  : 'totalLoanInstalments'
                            ],
                          0,
                        ),
                      )}
                    </strong>
                  </div>
                ))}
              </div>
            </details>
            <div className="viewer-filters">{Filters({ viewer: true })}</div>
            <div className="viewer-page-info">
              <span>
                {filtered.length} lines match on this page
                {cached ? ' · saved records' : ''}
              </span>
              <span>Up to 50 lines per page</span>
            </div>
            {rowsView(filtered, true)}
            {entryPagination('Register pages')}
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
      {loadingData && <LoadingOverlay />}
      {modal === 'cash' && session && (
        <Modal title="Cash breakdown" onClose={() => setModal(null)}>
          <p>
            {dayLabel(today)}
            {cached ? ' · Saved estimate' : ''}
          </p>
          <dl className="review-lines">
            <div>
              <dt>Opening cash</dt>
              <dd>UGX {money(session.openingCash)}</dd>
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
            <div className="net">
              <dt>Expected cash</dt>
              <dd>UGX {money(session.expectedCash)}</dd>
            </div>
          </dl>
        </Modal>
      )}
      {modal === 'review' && member && (
        <Modal title="Review entry" onClose={() => !busy && setModal(null)}>
          <Account
            name={member.fullName}
            number={member.accountNumber}
            memberNumber={member.uniqueNumber}
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
            memberNumber={detailRow.entry.uniqueNumberSnapshot}
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
              {busy ? 'Undoing…' : 'Undo check'}
            </button>
          </div>
        </Modal>
      )}
      {modal === 'line' && detailRow && (
        <Modal title="Entry details" onClose={() => !busy && setModal(null)}>
          <Account
            name={detailRow.entry.memberNameSnapshot}
            number={detailRow.entry.accountNumberSnapshot}
            memberNumber={detailRow.entry.uniqueNumberSnapshot}
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

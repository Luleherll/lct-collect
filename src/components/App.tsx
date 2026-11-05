import SyncQueue from './SyncQueue';
import { useOfflinePreparation } from '../hooks/useOfflinePreparation';
import SyncState from './SyncState';
import {
  matchesAccount,
  groupAccounts,
  type MemberGroup,
} from '../lib/account';
import { lazy, Suspense, useEffect, useRef, useState, useMemo } from 'react';
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
  ACCOUNT_TYPES,
  entryAccountLabel,
  type AccountType,
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
import {
  durableStorageAvailable,
  openLocal,
  changeLocal,
  localState,
  closeLocal,
} from '../lib/local';
import { useLocalVersion } from '../hooks/useLocal';
import { startSync } from '../lib/sync';
import Login from './Login';
import Brand from './Brand';
import HeaderMenu from './HeaderMenu';
import { usePagination } from '../hooks/usePagination';
import MemberResults from './MemberResults';
import Notes from './Notes';
import { restoreReminders } from '../lib/notifications';
import { usePagedNotes } from '../hooks/usePagedNotes';
import Modal from './Modal';
import { Account, Status } from './Account';
import { usePagedEntries } from '../hooks/usePagedEntries';
import { useRecords } from '../hooks/useRecords';
import { storage } from '../lib/storage';
import { message } from '../lib/errors';
import SearchField from './SearchField';

const MemberAdmin = lazy(() => import('./MemberAdmin'));

const HOME = { agent: '/agent/', viewer: '/viewer/', admin: '/admin/' };
type Receipt = Pick<
  Entry,
  | 'accountSelection'
  | 'entryId'
  | 'memberId'
  | 'memberNameSnapshot'
  | 'accountNumberSnapshot'
  | 'agentNameSnapshot'
  | 'workday'
  | 'uniqueNumberSnapshot'
> & {
  createdAt?: Entry['createdAt'];
  lines: Partial<
    Record<LineType, { amount: number; accountType?: AccountType }>
  >;
};
const EMPTY_AMOUNTS = { deposit: '', withdrawal: '', loanInstalment: '' };
export default function App({ route: initialRoute }: { route: string }) {
  useLocalVersion();
  const [localReady, setLocalReady] = useState(false);
  const [route, setRoute] = useState(initialRoute);
  const [user, setUser] = useState<User | null>(null),
    [profile, setProfile] = useState<Profile | null>(null),
    [authReady, setAuthReady] = useState(false),
    [profileError, setProfileError] = useState('');
  const [today, setToday] = useState(workday()),
    [date, setDate] = useState(workday()),
    [historyDay, setHistoryDay] = useState('');
  const [network, setNetwork] = useState(navigator.onLine);
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
  const [otherAccountId, setOtherAccountId] = useState('');
  const [accountTypes, setAccountTypes] = useState<
    Partial<Record<LineType, AccountType>>
  >({});
  const [entryNote, setEntryNote] = useState('');
  const [noteDraft, setNoteDraft] = useState('');
  const [noteExtraDirty, setNoteExtraDirty] = useState(false);
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

  const dirty =
    TYPES.some((t) => values[t].trim() !== '') ||
    !!entryNote.trim() ||
    (route === 'notes' && (!!noteDraft.trim() || noteExtraDirty));
  const draftLoaded = useRef('');
  useEffect(() => {
    if (!localReady || !user || draftLoaded.current === user.uid) return;
    draftLoaded.current = user.uid;
    const d = localState().drafts?.collection;
    if (d) {
      pendingId.current =
        d.submissionId ?? (d.member ? crypto.randomUUID() : '');
      setMember(d.member ?? null);
      setValues(d.values ?? { ...EMPTY_AMOUNTS });
      setEntryNote(d.entryNote ?? '');
      setAccountTypes(d.accountTypes ?? {});
      setOtherAccountId(d.otherAccountId ?? '');
      setNoteDraft(d.noteDraft ?? '');
    }
  }, [localReady, user?.uid]);
  useEffect(() => {
    if (!localReady || !user || draftLoaded.current !== user.uid) return;
    const submissionId = pendingId.current;
    const timer = setTimeout(() => {
      void changeLocal((s) => {
        if (
          submissionId &&
          (s.commands.some((p) => p.command.id === submissionId) ||
            s.receipts[submissionId])
        )
          return;
        s.drafts = {
          ...s.drafts,
          collection: {
            submissionId,
            member,
            values,
            entryNote,
            accountTypes,
            otherAccountId,
            noteDraft,
          },
        };
      }).catch((e) => setError(message(e)));
    }, 150);
    return () => clearTimeout(timer);
  }, [
    localReady,
    user?.uid,
    member,
    values,
    entryNote,
    accountTypes,
    otherAccountId,
    noteDraft,
  ]);
  const depositRef = useRef<HTMLInputElement>(null);
  const mutation = useRef(false);
  const allowUnload = useRef(false);
  useEffect(() => {
    if (member && !uncertain) {
      if (otherAccountId)
        document.getElementById('deposit-account-type')?.focus();
      else depositRef.current?.focus();
    }
  }, [member?.memberId, otherAccountId]);
  function protect(
    run: () => void,
    title = 'Discard this entry?',
    body = 'Your changes have not been saved. Stay to finish, or discard them.',
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
  const routeViews = useRef(
    new Map<
      string,
      {
        q: string;
        type: string;
        status: string;
        agent: string;
        agentLabel: string;
        historyDay: string;
        scroll: number;
      }
    >(),
  );
  function navigateTo(path: string, replace = false) {
    const routes: Record<string, string> = {
      '/agent/': 'agent',
      '/agent/recent/': 'recent',
      '/agent/history/': 'history',
      '/agent/notes/': 'notes',
      '/viewer/': 'viewer',
      '/admin/': 'admin',
      '/login/': 'login',
    };
    const next = routes[path];
    if (!next) {
      window.location.assign(path);
      return;
    }
    routeViews.current.set(route, {
      q,
      type,
      status,
      agent,
      agentLabel,
      historyDay,
      scroll: window.scrollY,
    });
    const remembered = routeViews.current.get(next);
    window.history[replace ? 'replaceState' : 'pushState'](null, '', path);
    setRoute(next);
    setQ(remembered?.q ?? '');
    setType(remembered?.type ?? 'all');
    setStatus(remembered?.status ?? (next === 'viewer' ? 'unrecorded' : 'all'));
    setAgent(remembered?.agent ?? 'all');
    setAgentLabel(remembered?.agentLabel ?? '');
    setHistoryDay(remembered?.historyDay ?? '');
    setError('');
    setModal(null);
    setEntryNote('');
    setNoteDraft('');
    void changeLocal((s) => {
      if (s.drafts) {
        delete s.drafts.noteComposer;
        delete s.drafts.noteEdit;
      }
    }).catch(() => {});
    setNoteExtraDirty(false);
    setAccountTypes({});
    setOtherAccountId('');
    if (next !== 'agent') {
      setMember(null);
      setValues({ ...EMPTY_AMOUNTS });
    }
    document.title = `${next === 'recent' ? 'Recent entries' : next === 'history' ? 'Session history' : next === 'notes' ? 'Notes' : 'LCT Collect'} · LCT Collect`;
    window.scrollTo({ top: remembered?.scroll ?? 0, behavior: 'instant' });
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
          '/agent/notes/',
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
        notes: '/agent/notes/',
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
  const authorized = !!user && !!profile?.active && localReady;
  useEffect(
    () =>
      onAuthStateChanged(auth, (u) => {
        routeViews.current.clear();
        setMember(null);
        setValues({ ...EMPTY_AMOUNTS });
        setEntryNote('');
        setNoteDraft('');
        setAccountTypes({});
        setOtherAccountId('');
        setReceipt(null);
        setModal(null);
        setSelectedRow(null);
        setQ('');
        setMemberQuery('');
        setUncertain(false);
        pendingId.current = '';
        draftLoaded.current = '';
        setUser(u);
        setProfile(null);
        setLocalReady(false);
        closeLocal();
        setProfileError('');
        setAuthReady(true);
      }),
    [],
  );
  useEffect(() => {
    if (authReady && !user && route !== 'login') {
      const noteId = new URLSearchParams(location.search).get('note');
      if (route === 'notes' && noteId && /^[A-Za-z0-9_-]{8,100}$/.test(noteId))
        storage.set('session', 'lct-note-destination', noteId);
      history.replaceState(null, '', '/login/');
      setRoute('login');
    }
  }, [authReady, user, route]);
  useEffect(() => {
    if (!user) return;
    const timeout = setTimeout(() => {
      if (!localState().records[`users/${user.uid}`])
        setProfileError(
          'Connect to load your access. Your saved work remains on this device.',
        );
    }, 10000);
    let cancelled = false,
      stop: (() => void) | undefined;
    const apply = (p: Profile) => {
      if (cancelled) return;
      if (!p.active || !['agent', 'viewer', 'admin'].includes(p.role)) {
        setProfile(null);
        setProfileError(
          'Your account is inactive or has no assigned role. Contact the owner.',
        );
        return;
      }
      const allowed =
        p.role === 'agent'
          ? ['agent', 'recent', 'history', 'notes']
          : p.role === 'viewer'
            ? ['viewer']
            : ['admin'];
      const pathRoute =
        (
          {
            '/agent/': 'agent',
            '/agent/recent/': 'recent',
            '/agent/history/': 'history',
            '/agent/notes/': 'notes',
            '/viewer/': 'viewer',
            '/admin/': 'admin',
            '/login/': 'login',
          } as Record<string, string>
        )[location.pathname] ?? 'index';
      if (!allowed.includes(pathRoute)) {
        const destination = storage.get('session', 'lct-note-destination');
        storage.remove('session', 'lct-note-destination');
        const noteId =
          p.role === 'agent' &&
          destination &&
          /^[A-Za-z0-9_-]{8,100}$/.test(destination)
            ? destination
            : null;
        const target = noteId ? `/agent/notes/?note=${noteId}` : HOME[p.role];
        history.replaceState(null, '', target);
        setRoute(noteId ? 'notes' : p.role);
        setStatus(p.role === 'viewer' ? 'unrecorded' : 'all');
      }
      setProfileError('');
      setProfile(p);
    };
    void openLocal(user.uid, String(auth.app.options.projectId))
      .then(() => {
        if (cancelled) return;
        const cached = localState().records[`users/${user.uid}`];
        if (cached) apply(cached);
        setLocalReady(true);
        stop = onSnapshot(
          doc(db(), 'users', user.uid),
          { includeMetadataChanges: true },
          (snap) => {
            if (cancelled || snap.metadata.fromCache) return;
            if (!snap.exists()) {
              void changeLocal((s) => {
                delete s.records[`users/${user.uid}`];
              }).catch(() => {});
              setProfile(null);
              setProfileError(
                'Your login has no application profile. Contact the owner.',
              );
              return;
            }
            const p = snap.data() as Profile;
            apply(p);
            void changeLocal((s) => {
              s.records[`users/${user.uid}`] = p;
            }).catch((e) => setError(message(e)));
          },
          (e) => {
            if (!cancelled) {
              setProfile(null);
              setProfileError(message(e));
            }
          },
        );
      })
      .catch((e) => {
        if (!cancelled) setProfileError(message(e));
      });
    return () => {
      cancelled = true;
      clearTimeout(timeout);
      stop?.();
    };
  }, [user?.uid]);
  useEffect(() => {
    if (!localReady || !profile?.active) return;
    return startSync();
  }, [localReady, user?.uid, profile?.active, profile?.role]);
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
  useEffect(() => {
    if (!user || !isAgent) return;
    const refresh = () => void restoreReminders(user.uid).catch(() => {});
    refresh();
    window.addEventListener('focus', refresh);
    const timer = window.setInterval(refresh, 24 * 3600000);
    return () => {
      window.removeEventListener('focus', refresh);
      window.clearInterval(timer);
    };
  }, [user?.uid, isAgent]);
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    const receive = (event: MessageEvent) => {
      if (event.data?.type !== 'OPEN_REMINDER') return;
      const url = new URL(event.data.path, location.origin);
      const noteId = url.searchParams.get('note');
      if (
        url.origin !== location.origin ||
        url.pathname !== '/agent/notes/' ||
        !noteId ||
        !/^[A-Za-z0-9_-]{8,100}$/.test(noteId)
      )
        return;
      protect(() => {
        navigateTo('/agent/notes/');
        history.replaceState(null, '', url.pathname + url.search);
        window.dispatchEvent(
          new CustomEvent('open-reminder', { detail: noteId }),
        );
      });
    };
    navigator.serviceWorker.addEventListener('message', receive);
    return () =>
      navigator.serviceWorker.removeEventListener('message', receive);
  }, [dirty, busy, uncertain, route]);
  useOfflinePreparation(user?.uid ?? '', authorized && isAgent);
  const members = useRecords<Member>(
    'members',
    isAdmin ? [] : [where('active', '==', true)],
    `${user?.uid}/${profile?.role}`,
    authorized && (isAgent || isAdmin),
    { matches: (m) => isAdmin || m.active },
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
    {
      matches: (s) =>
        isViewer
          ? s.workday === date
          : s.agentId === user?.uid &&
            (route === 'history' || s.workday === today),
      compare: (a, b) => b.workday.localeCompare(a.workday),
      limit: route === 'history' ? 5 : undefined,
    },
  );
  const entryDay = route === 'history' ? historyDay : isViewer ? date : today;
  const showingEntries =
    isViewer ||
    (isAgent && (route === 'recent' || (route === 'history' && !!historyDay)));
  const entries = usePagedEntries(
    entryDay,
    `${user?.uid}/${profile?.role}`,
    authorized && showingEntries,
    isAgent ? user?.uid : undefined,
  );
  const searchPages = usePagination(
    useMemo(
      () => groupAccounts(members.data, memberQuery, true),
      [members.data, memberQuery],
    ),
    memberQuery,
  );
  const session = sessions.data.find(
    (s) => s.workday === today && s.agentId === user?.uid,
  );
  const notes = usePagedNotes(
    user?.uid ?? '',
    authorized && isAgent && route === 'notes',
  );
  const cached =
    route === 'notes'
      ? notes.cached
      : isAdmin
        ? members.cached
        : isViewer
          ? entries.cached || sessions.cached
          : members.cached ||
            sessions.cached ||
            (showingEntries && entries.cached);
  const loadingData = false;
  const writable =
    authorized &&
    durableStorageAvailable() &&
    !busy &&
    (!isAdmin || (network && !members.cached));
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
  async function signOutNow(preservePending = false) {
    if (!preservePending && localState().commands.length) {
      setGuard({
        title: 'Sign out with unsynced work?',
        body: 'Your changes have not reached the office. You can stay to sync or export a recovery copy. Signing out will keep this work on this device for your next sign-in.',
        label: 'Sign out and keep work',
        run: () => void signOutNow(true),
      });
      return;
    }

    allowUnload.current = true;
    setBusy(true);
    try {
      await logout(preservePending);
      setBusy(false);
      allowUnload.current = false;
    } catch (e) {
      allowUnload.current = false;
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
          if (
            otherAccountId &&
            t !== 'loanInstalment' &&
            parsed[t] > 0 &&
            !accountTypes[t]
          )
            errors[t] = 'Choose Fixed or Saving.';
        } catch (e) {
          errors[t] = message(e);
        }
      }
      setFieldErrors(errors);
      const invalid = TYPES.find((t) => errors[t]);
      if (invalid) {
        document
          .getElementById(
            otherAccountId &&
              invalid !== 'loanInstalment' &&
              parsed[invalid] > 0 &&
              !accountTypes[invalid]
              ? `${invalid}-account-type`
              : invalid,
          )
          ?.focus();
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
  function selectGroup(group: MemberGroup) {
    const run = () => {
      setValues({ ...EMPTY_AMOUNTS });
      setFieldErrors({});
      setEntryNote('');
      setAccountTypes({});
      pendingId.current = crypto.randomUUID();
      setOtherAccountId(group.accounts[1]?.memberId ?? '');
      setMember(group.accounts[0]);
      setMemberQuery('');
    };
    protect(
      run,
      'Change member?',
      'Changing members discards the unsaved entry.',
      'Discard & change member',
    );
  }
  function clearForm() {
    if (user) storage.remove('session', `lct-pending-${user.uid}`);
    setMember(null);
    setOtherAccountId('');
    setAccountTypes({});
    setEntryNote('');
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
        {
          otherAccountId: otherAccountId || undefined,
          accountTypes,
          note: entryNote,
        },
      );
      storage.remove('session', `lct-pending-${user.uid}`);
      setUncertain(false);
      setModal(null);
      const savedId = pendingId.current;
      clearForm();
      const savedLines = Object.fromEntries(
        TYPES.filter((t) => reviewValues[t] > 0).map((t) => [
          t,
          {
            amount: reviewValues[t],
            state: 'active',
            recorded: false,
            ...(otherAccountId && t !== 'loanInstalment'
              ? { accountType: accountTypes[t] }
              : {}),
          },
        ]),
      );
      setReceipt({
        entryId: savedId,
        memberId: member.memberId,
        memberNameSnapshot: member.fullName,
        accountNumberSnapshot: otherAccountId ? '' : member.accountNumber,
        ...(otherAccountId ? { accountSelection: 'type' as const } : {}),
        ...(member.uniqueNumber
          ? { uniqueNumberSnapshot: member.uniqueNumber }
          : {}),
        agentNameSnapshot: profile.displayName,
        workday: session.workday,
        lines: savedLines,
      });
      setNotice('');
    } catch (e) {
      storage.remove('session', `lct-pending-${user.uid}`);
      setError(message(e));
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
        busy={busy || entries.loading || loadingData}
      />
    );
  }
  function rowsView(rows: Row[], viewer = false) {
    if (entries.loading)
      return (
        <p className="empty" role="status">
          Loading entries…
        </p>
      );
    if (entries.unavailable)
      return (
        <p className="empty">
          This workday has not been downloaded. Connect to load its entries.
        </p>
      );
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
            <span>Member / account</span>
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
              aria-label={`View ${row.entry.memberNameSnapshot}, ${LABELS[row.type]}, ${entryAccountLabel(row.entry, row.line, row.type)}`}
              onClick={() => showLine(row)}
            >
              <strong>{row.entry.memberNameSnapshot}</strong>
              <span>
                {row.entry.uniqueNumberSnapshot
                  ? `${row.entry.uniqueNumberSnapshot} · `
                  : ''}
                {entryAccountLabel(row.entry, row.line, row.type)}
                {row.entry.note && ' · Note'}
              </span>
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
  if (!authReady || (user && !profile && !profileError && route !== 'login'))
    return (
      <div className="boot-shell">
        <header className="app-header">
          <Brand />
        </header>
        <main id="main-content" aria-busy="true">
          <div className="page">
            <p role="status">Opening your notebook…</p>
          </div>
        </main>
      </div>
    );
  if (!user || (!profile && route === 'login'))
    return <Login notice={profileError} pending={!!user && !profileError} />;
  if (!profile)
    return (
      <main id="main-content" className="login-shell">
        <h1>Access unavailable</h1>
        <p role="alert">{profileError}</p>
        <button className="button" onClick={() => void signOutNow()}>
          Sign out
        </button>
      </main>
    );
  const headerDay = isViewer ? date : historyDay || today;
  const queryError =
    members.error || sessions.error || entries.error || notes.error;
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
                  aria-current={route === 'notes' ? 'page' : undefined}
                  className={route === 'notes' ? 'active' : ''}
                  href="/agent/notes/"
                >
                  <Icon name="note" />
                  <span>Notes</span>
                </a>
              </>
            ) : isAdmin ? (
              <div id="owner-header-actions" />
            ) : null}
            <HeaderMenu
              agent={isAgent}
              route={route}
              busy={busy}
              onSignOut={() => protect(() => void signOutNow())}
            />
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
        {(memoryOnlySession ||
          !recordCacheAvailable ||
          !durableStorageAvailable()) && (
          <p className="alert" role="status">
            Site storage is limited. Offline viewing is limited to this open
            page.
            {memoryOnlySession &&
              ' Sign-in lasts while this page is open. Enable site storage to save collection entries.'}
          </p>
        )}
        {!network && (
          <div className="connection compact-connection" role="status">
            <Icon name="wifi-off" />
            <span>
              {!network
                ? 'You’re offline · saved data may be outdated.'
                : 'Can’t connect · saved data may be outdated.'}
            </span>
          </div>
        )}
        <SyncQueue />
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
              <strong>
                Saved on this device · {receipt.memberNameSnapshot}
              </strong>
              <SyncState entryId={receipt.entryId} />
              <span>
                {receipt.accountSelection === 'type'
                  ? receipt.uniqueNumberSnapshot
                  : `Account ${receipt.accountNumberSnapshot}`}{' '}
                ·{' '}
                {TYPES.filter((t) => receipt.lines[t])
                  .map(
                    (t) =>
                      `${LABELS[t]}${receipt.lines[t]!.accountType ? ` (${ACCOUNT_TYPES[receipt.lines[t]!.accountType!]})` : ''} UGX ${money(receipt.lines[t]!.amount)}`,
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
            {sessions.unavailable && isViewer ? (
              <p className="empty">
                Session data is unavailable on this device. Connect to prepare
                it before starting a session.
              </p>
            ) : sessions.loading ? (
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
                        onSelectGroup={selectGroup}
                        onSelect={(m) => {
                          const select = () => {
                            if (
                              member?.memberId !== m.memberId ||
                              otherAccountId
                            ) {
                              setOtherAccountId('');
                              setAccountTypes({});
                              setEntryNote('');
                              setValues({ ...EMPTY_AMOUNTS });
                              setFieldErrors({});
                              pendingId.current = '';
                            }
                            setMember(m);
                            setMemberQuery('');
                          };
                          if (
                            member?.memberId === m.memberId &&
                            !otherAccountId
                          ) {
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
                      number={otherAccountId ? '' : member.accountNumber}
                      accountCount={
                        otherAccountId
                          ? groupAccounts(members.data).find((g) =>
                              g.accounts.some(
                                (a) => a.memberId === member.memberId,
                              ),
                            )?.accounts.length
                          : undefined
                      }
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
                    <p className="amount-currency muted">
                      Amounts in UGX
                      {otherAccountId
                        ? ' · choose an account type per amount'
                        : ''}
                    </p>
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
                          {t === 'loanInstalment' ? (
                            <span>UGX</span>
                          ) : (
                            <select
                              id={`${t}-account-type`}
                              aria-invalid={!!fieldErrors[t]}
                              aria-describedby={
                                fieldErrors[t] ? `${t}-error` : undefined
                              }
                              aria-label={`${LABELS[t]} account type`}
                              value={accountTypes[t] ?? ''}
                              disabled={!otherAccountId || busy || uncertain}
                              onChange={(e) => {
                                if (!e.target.value)
                                  setValues((v) => ({ ...v, [t]: '' }));
                                setAccountTypes((v) => ({
                                  ...v,
                                  [t]: e.target.value as AccountType,
                                }));
                                setFieldErrors((v) => ({
                                  ...v,
                                  [t]: undefined,
                                }));
                              }}
                            >
                              <option value="">Account type</option>
                              <option value="fixed">Fixed</option>
                              <option value="saving">Saving</option>
                            </select>
                          )}
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
                            disabled={
                              !member ||
                              busy ||
                              uncertain ||
                              (!!otherAccountId &&
                                t !== 'loanInstalment' &&
                                !accountTypes[t])
                            }
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
                    <label className="entry-note" htmlFor="entry-note">
                      Notes <span className="muted">Optional</span>
                      <textarea
                        id="entry-note"
                        maxLength={2000}
                        rows={2}
                        placeholder="Anything to note about this collection"
                        value={entryNote}
                        disabled={!member || busy || uncertain}
                        onChange={(e) => setEntryNote(e.target.value)}
                      />
                    </label>
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
                <section
                  className="cash-summary"
                  aria-label="Expected physical cash"
                >
                  <h1>Expected cash</h1>
                  <div className="cash-number">
                    <span>UGX</span>{' '}
                    <strong>{money(session.expectedCash)}</strong>
                  </div>
                  <SyncState sessionId={session.sessionId} />
                </section>
              </>
            )}
          </>
        )}
        {isAgent && route === 'notes' && (
          <Notes
            uid={user.uid}
            error={error}
            notes={notes}
            clearError={() => setError('')}
            members={members.data}
            onDirty={setNoteExtraDirty}
            protect={protect}
            draft={noteDraft}
            onDraft={setNoteDraft}
            writable={writable}
            busy={busy}
            action={action}
          />
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
                {sessions.unavailable ? (
                  <p className="empty">
                    Session data is unavailable on this device. Connect to
                    prepare it before starting a session.
                  </p>
                ) : sessions.loading ? (
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
              <summary>Workday totals</summary>
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
              {guard.label === 'Discard note' ? 'Keep writing' : 'Keep entry'}
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

      {modal === 'cash' && session && (
        <Modal title="Cash breakdown" onClose={() => setModal(null)}>
          <p>
            {dayLabel(today)}
            {session && <SyncState sessionId={session.sessionId} />}
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
            number={otherAccountId ? '' : member.accountNumber}
            accountCount={
              otherAccountId
                ? groupAccounts(members.data).find((g) =>
                    g.accounts.some((a) => a.memberId === member.memberId),
                  )?.accounts.length
                : undefined
            }
            memberNumber={member.uniqueNumber}
          />
          {error && (
            <p className="alert error" role="alert">
              {error}
            </p>
          )}
          {entryNote.trim() && (
            <div className="entry-note-preview">
              <strong>Note</strong>
              <p className="note-body">{entryNote.trim()}</p>
            </div>
          )}
          <dl className="review-lines">
            {TYPES.filter((t) => reviewValues[t] > 0).map((t) => (
              <div key={t}>
                <dt>
                  {LABELS[t]}
                  {otherAccountId && t !== 'loanInstalment' && accountTypes[t]
                    ? ` · ${ACCOUNT_TYPES[accountTypes[t]!]}`
                    : ''}
                </dt>
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
            number={
              detailRow.type === 'loanInstalment'
                ? ''
                : detailRow.entry.accountNumberSnapshot
            }
            accountType={entryAccountLabel(
              detailRow.entry,
              detailRow.line,
              detailRow.type,
            )}
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
            number={
              detailRow.type === 'loanInstalment'
                ? ''
                : detailRow.entry.accountNumberSnapshot
            }
            accountType={entryAccountLabel(
              detailRow.entry,
              detailRow.line,
              detailRow.type,
            )}
            memberNumber={detailRow.entry.uniqueNumberSnapshot}
          />
          <div className="detail-amount">
            {LABELS[detailRow.type]}
            <strong>UGX {money(detailRow.line.amount)}</strong>
          </div>
          {detailRow.entry.note && (
            <section className="entry-note-preview">
              <strong>Note</strong>
              <p className="note-body">{detailRow.entry.note}</p>
            </section>
          )}
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

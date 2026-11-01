import { useState } from 'react';
import { useLocalVersion } from '../hooks/useLocal';
import { localState } from '../lib/local';
import {
  exportPending,
  flush,
  prepareRetry,
  resolveCommand,
} from '../lib/sync';
import { LABELS, TYPES } from '../lib/models';
import { amount, money } from '../lib/domain';
import Modal from './Modal';
export default function SyncQueue() {
  useLocalVersion();
  const [selected, setSelected] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [proposal, setProposal] = useState<Record<string, any> | null>(null),
    [amounts, setAmounts] = useState<Record<string, string>>({});
  const items = localState().commands,
    item = items.find((p) => p.command.id === selected),
    d = proposal ?? item?.command.data;
  const close = () => {
    if (!busy) {
      setSelected('');
      setError('');
      setProposal(null);
    }
  };
  if (!items.length) return null;
  return (
    <section className="connection" aria-label="Unsynced work">
      <details>
        <summary>{items.length} unsynced changes</summary>
        <div className="actions">
          <button className="button small" onClick={() => void flush(true)}>
            Retry sync
          </button>
          <button className="button outline small" onClick={exportPending}>
            Export recovery copy
          </button>
        </div>
        <p className="muted">
          A recovery copy contains private data. Keep it safe; it is not proof
          that work reached the office.
        </p>
        {items.map((p) => (
          <div key={p.command.id}>
            <p>
              {p.command.data.member?.fullName ??
                (p.command.kind === 'note'
                  ? 'Private note'
                  : p.command.kind === 'session'
                    ? 'Opening cash'
                    : p.command.kind === 'record'
                      ? 'Recording check'
                      : 'Void request')}{' '}
              ·{' '}
              {p.state === 'attention'
                ? 'Needs attention'
                : p.state === 'syncing'
                  ? 'Syncing'
                  : 'Pending sync'}
              {p.error && ` · ${p.error}`}
            </p>
            {p.state === 'attention' && (
              <button
                className="text-button"
                onClick={() => {
                  setProposal(null);
                  setSelected(p.command.id);
                }}
              >
                Review change
              </button>
            )}
          </div>
        ))}
      </details>
      {item && d && (
        <Modal title="Review unsynced change" onClose={close}>
          <p>{item.error}</p>
          {d.member && (
            <p>
              <strong>{d.member.fullName}</strong> ·{' '}
              {d.member.uniqueNumber ?? d.member.accountNumber}
            </p>
          )}
          {d.workday && <p>Workday: {d.workday}</p>}
          {d.values &&
            TYPES.map((type) => (
              <p key={type}>
                {LABELS[type]}: UGX {money(d.values[type] ?? 0)}
              </p>
            ))}
          {d.openingCash !== undefined && (
            <p>Opening cash: UGX {money(d.openingCash)}</p>
          )}
          {d.reason && <p>Reason: {d.reason}</p>}
          {d.body && <p className="note-body">{d.body}</p>}
          {proposal && (
            <form
              noValidate
              onSubmit={async (e) => {
                e.preventDefault();
                setBusy(true);
                setError('');
                try {
                  const data = { ...proposal };
                  if (data.values)
                    data.values = Object.fromEntries(
                      TYPES.map((t) => [t, amount(amounts[t] ?? '', true)]),
                    );
                  await resolveCommand(item.command.id, data);
                  setSelected('');
                  setProposal(null);
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {d.values &&
                TYPES.map((type) => (
                  <label key={type}>
                    {LABELS[type]} (UGX)
                    <input
                      inputMode="numeric"
                      value={amounts[type] ?? ''}
                      onChange={(e) =>
                        setAmounts((v) => ({ ...v, [type]: e.target.value }))
                      }
                    />
                  </label>
                ))}
              {item.command.kind === 'note' && d.action === 'save' && (
                <label>
                  Note text
                  <textarea
                    className="resize-none"
                    value={proposal.body}
                    onChange={(e) =>
                      setProposal({ ...proposal, body: e.target.value })
                    }
                  />
                </label>
              )}
              <p>
                Check the refreshed details before retrying. The original
                rejected change remains in the recovery history.
              </p>
              <button className="button" disabled={busy}>
                Queue reviewed retry
              </button>
            </form>
          )}
          {!proposal && (
            <button
              className="button"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setError('');
                try {
                  const data = await prepareRetry(item.command.id);
                  setProposal(data);
                  setAmounts(
                    Object.fromEntries(
                      TYPES.map((t) => [t, String(data.values?.[t] ?? 0)]),
                    ),
                  );
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              Refresh details
            </button>
          )}
          {error && <p role="alert">{error}</p>}
          <p>
            Financial corrections that are no longer eligible require the
            office.
          </p>
          <button className="button outline" onClick={exportPending}>
            Export recovery copy
          </button>
        </Modal>
      )}
    </section>
  );
}

import type { Member } from '../lib/models';
import type { MemberGroup } from '../lib/account';
import Icon from './Icon';
export default function MemberResults({
  groups,
  onSelect,
  disabled = false,
  searching = false,
}: {
  groups: MemberGroup[];
  onSelect?: (account: Member) => void;
  disabled?: boolean;
  searching?: boolean;
}) {
  return (
    <div className="member-results" aria-label="Matching members">
      {groups.map((g) => (
        <details
          className="member-result"
          key={g.key}
          open={searching && groups.length === 1 ? true : undefined}
        >
          <summary>
            <div className="member-result-identity">
              <strong>{g.fullName}</strong>
              <span>
                {g.uniqueNumber ?? 'Member number pending import'}
                {g.group && <span className="group-chip">Group</span>}
              </span>
            </div>
            <span className="account-count">
              {g.accounts.length}{' '}
              {g.accounts.length === 1 ? 'account' : 'accounts'}
            </span>
            <Icon name="chevron-right" />
          </summary>
          <div className="member-accounts">
            {g.accounts.map((a) => (
              <div className="member-account" key={a.memberId}>
                {onSelect ? (
                  <button
                    disabled={disabled || !a.active}
                    className="account-choice"
                    onClick={() => onSelect(a)}
                    aria-label={`Select account ${a.accountNumber} for ${g.fullName}`}
                  >
                    <span>
                      Account no. <strong>{a.accountNumber}</strong>
                    </span>
                    <Icon name="chevron-right" />
                  </button>
                ) : (
                  <span>
                    Account no. <strong>{a.accountNumber}</strong>
                  </span>
                )}
                {!a.active && <span className="status">Inactive</span>}
              </div>
            ))}
          </div>
        </details>
      ))}
    </div>
  );
}

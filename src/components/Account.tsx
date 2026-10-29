import type { Row } from '../lib/models';
export const Account = ({
  name,
  number,
  memberNumber,
}: {
  name: string;
  number: string;
  memberNumber?: string;
}) => (
  <div className="account">
    <strong>{name}</strong>
    {memberNumber && (
      <span>
        {memberNumber}{' '}
        {memberNumber.startsWith('ABC') && (
          <span className="group-chip">Group</span>
        )}
      </span>
    )}
    <span>Account no. {number}</span>
  </div>
);
export const Status = ({ row }: { row: Row }) => (
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

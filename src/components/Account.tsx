import type { Row } from '../lib/models';
export const Account = ({ name, number }: { name: string; number: string }) => (
  <div className="account">
    <strong>{name}</strong>
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

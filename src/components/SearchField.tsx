import { useRef } from 'react';
import Icon from './Icon';
export default function SearchField({
  value,
  onChange,
  label,
  id,
  disabled = false,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
  id?: string;
  disabled?: boolean;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <label className="search-field">
      <span className="sr-only">{label}</span>
      <Icon name="search" />
      <input
        ref={ref}
        id={id}
        aria-label={label}
        placeholder="Search name or LCT account number"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        autoComplete="off"
      />
      {value && (
        <button
          type="button"
          className="icon-button"
          aria-label={`Clear ${label.toLowerCase()}`}
          disabled={disabled}
          onClick={() => {
            onChange('');
            ref.current?.focus();
          }}
        >
          <Icon name="x-lg" />
        </button>
      )}
    </label>
  );
}

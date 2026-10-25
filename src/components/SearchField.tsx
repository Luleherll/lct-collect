import { useRef } from 'react';
import Icon from './Icon';
export default function SearchField({
  value,
  onChange,
  label,
  id,
  disabled = false,
  placeholder = 'Name or account number',
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
  id?: string;
  disabled?: boolean;
  placeholder?: string;
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
        placeholder={placeholder}
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

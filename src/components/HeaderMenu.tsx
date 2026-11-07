import { useEffect, useRef, useState } from 'react';
import Icon from './Icon';
export default function HeaderMenu({
  agent,
  route,
  busy,
  onSignOut,
}: {
  agent: boolean;
  route: string;
  busy: boolean;
  onSignOut: () => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null),
    trigger = useRef<HTMLButtonElement>(null),
    panel = useRef<HTMLDivElement>(null);
  function close(restore = false) {
    setOpen(false);
    if (restore) trigger.current?.focus();
  }
  function show(last = false) {
    setOpen(true);
    requestAnimationFrame(() => {
      const items =
        panel.current?.querySelectorAll<HTMLElement>('[role="menuitem"]');
      items?.[last ? items.length - 1 : 0]?.focus();
    });
  }
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) close();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close(true);
      }
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);
  return (
    <div
      className="header-menu"
      ref={root}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null))
          close();
      }}
    >
      <button
        ref={trigger}
        type="button"
        className="menu-trigger"
        aria-label="More actions"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? 'header-menu' : undefined}
        onClick={() => (open ? close(true) : show())}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            show(event.key === 'ArrowUp');
          }
        }}
      >
        <Icon name="more" />
        <span>More</span>
      </button>
      {open && (
        <div
          className="menu-panel"
          id="header-menu"
          ref={panel}
          role="menu"
          aria-label="More actions"
          onKeyDown={(event) => {
            const items = Array.from(
              event.currentTarget.querySelectorAll<HTMLElement>(
                '[role="menuitem"]',
              ),
            );
            const index = items.indexOf(document.activeElement as HTMLElement);
            let next: number | undefined;
            if (event.key === 'ArrowDown') next = (index + 1) % items.length;
            if (event.key === 'ArrowUp')
              next = (index + items.length - 1) % items.length;
            if (event.key === 'Home') next = 0;
            if (event.key === 'End') next = items.length - 1;
            if (next !== undefined) {
              event.preventDefault();
              items[next]?.focus();
            }
          }}
        >
          {agent && (
            <>
              <a
                role="menuitem"
                tabIndex={-1}
                aria-current={route === 'recent' ? 'page' : undefined}
                href="/agent/recent/"
                onClick={() => close(true)}
              >
                <Icon name="list-ul" />
                Recent entries
              </a>
              <a
                role="menuitem"
                tabIndex={-1}
                aria-current={route === 'history' ? 'page' : undefined}
                href="/agent/history/"
                onClick={() => close(true)}
              >
                <Icon name="clock-history" />
                History
              </a>
            </>
          )}
          <button
            type="button"
            role="menuitem"
            tabIndex={-1}
            disabled={busy}
            onClick={() => {
              close(true);
              onSignOut();
            }}
          >
            <Icon name="box-arrow-right" />
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}

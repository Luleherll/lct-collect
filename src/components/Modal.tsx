import { useEffect, useRef, useId, type ReactNode } from 'react';
import Icon from './Icon';
export default function Modal({
  title,
  children,
  onClose,
  variant = 'dialog',
  headerActions,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  variant?: 'dialog' | 'sheet';
  headerActions?: ReactNode;
}) {
  const titleId = useId();
  const ref = useRef<HTMLDialogElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const d = ref.current;
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    d?.showModal();
    (
      d?.querySelector(
        variant === 'sheet'
          ? '.dialog-head h2'
          : '[autofocus], .button.outline',
      ) as HTMLElement | null
    )?.focus();
    const cancel = (e: Event) => {
      e.preventDefault();
      close.current();
    };
    const trap = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || !d) return;
      const controls = Array.from(
        d.querySelectorAll<HTMLElement>(
          'a[href], button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), summary, [tabindex="0"]',
        ),
      ).filter((element) => element.getClientRects().length > 0);
      const first = controls[0],
        last = controls.at(-1);
      if (!first || !last) return;
      if (
        e.shiftKey &&
        (document.activeElement === first ||
          document.activeElement === d.querySelector('h2'))
      ) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    d?.addEventListener('cancel', cancel);
    d?.addEventListener('keydown', trap);
    return () => {
      d?.removeEventListener('cancel', cancel);
      d?.removeEventListener('keydown', trap);
      d?.close();
      document.body.style.overflow = overflow;
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  useEffect(() => {
    if (variant !== 'sheet') return;
    const viewport = window.visualViewport;
    const resize = () => {
      const available = viewport?.height ?? window.innerHeight;
      const height = Math.min(window.innerHeight * 0.67, available - 12);
      ref.current?.style.setProperty('--sheet-height', `${height}px`);
      ref.current?.style.setProperty(
        '--sheet-top',
        `${(viewport?.offsetTop ?? 0) + available - height}px`,
      );
    };
    resize();
    viewport?.addEventListener('resize', resize);
    viewport?.addEventListener('scroll', resize);
    window.addEventListener('resize', resize);
    return () => {
      viewport?.removeEventListener('resize', resize);
      viewport?.removeEventListener('scroll', resize);
      window.removeEventListener('resize', resize);
    };
  }, [variant]);
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      className={variant === 'sheet' ? 'bottom-sheet' : undefined}
    >
      {variant === 'sheet' && (
        <div className="sheet-handle" aria-hidden="true" />
      )}
      <div className="dialog-head">
        <h2 id={titleId} tabIndex={variant === 'sheet' ? -1 : undefined}>
          {title}
        </h2>
        {headerActions}
        <button
          className="icon-button"
          aria-label="Close dialog"
          onClick={onClose}
        >
          <Icon name="x-lg" />
        </button>
      </div>
      {children}
    </dialog>
  );
}

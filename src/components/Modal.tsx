import { useEffect, useRef, type ReactNode } from 'react';
import Icon from './Icon';
export default function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
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
      d?.querySelector('[autofocus], .button.outline') as HTMLElement | null
    )?.focus();
    const cancel = (e: Event) => {
      e.preventDefault();
      close.current();
    };
    d?.addEventListener('cancel', cancel);
    return () => {
      d?.removeEventListener('cancel', cancel);
      d?.close();
      document.body.style.overflow = overflow;
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  return (
    <dialog ref={ref} aria-labelledby="modal-title">
      <div className="dialog-head">
        <h2 id="modal-title">{title}</h2>
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

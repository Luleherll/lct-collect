import {
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';

/** Keep search results inside the visible surface without clipping them to its scroller. */
export default function AnchoredResults({
  anchor,
  id,
  label,
  children,
  onClose,
}: {
  anchor: RefObject<HTMLElement | null>;
  id: string;
  label: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const [root, setRoot] = useState<HTMLElement | null>(null);
  const panel = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useLayoutEffect(() => {
    setRoot(anchor.current?.closest('dialog') ?? document.body);
  }, [anchor]);
  useLayoutEffect(() => {
    const input = anchor.current;
    const popup = panel.current;
    if (!root || !input || !popup) return;
    const dialog = input.closest('dialog');
    const header = dialog?.querySelector('.dialog-head');
    const footer = dialog?.querySelector('.sheet-footer');
    const viewport = window.visualViewport;
    let frame = 0;
    const update = () => {
      const rect = input.getBoundingClientRect();
      const surface = dialog?.getBoundingClientRect();
      const top =
        Math.max(
          (viewport?.offsetTop ?? 0) + 8,
          header?.getBoundingClientRect().bottom ?? surface?.top ?? 0,
        ) + 8;
      const bottom =
        Math.min(
          (viewport?.offsetTop ?? 0) + (viewport?.height ?? innerHeight) - 8,
          footer?.getBoundingClientRect().top ?? surface?.bottom ?? innerHeight,
        ) - 8;
      if (rect.bottom <= top || rect.top >= bottom || bottom <= top) {
        popup.style.visibility = 'hidden';
        return;
      }
      const above = Math.max(0, rect.top - top - 6);
      const below = Math.max(0, bottom - rect.bottom - 6);
      const side = above >= below ? 'above' : 'below';
      const left = Math.max((viewport?.offsetLeft ?? 0) + 8, rect.left);
      const width = Math.min(
        rect.width,
        (viewport?.offsetLeft ?? 0) +
          (viewport?.width ?? innerWidth) -
          8 -
          left,
      );
      popup.style.width = `${Math.max(0, width)}px`;
      popup.style.left = `${left}px`;
      popup.style.maxHeight = `${Math.min(280, side === 'above' ? above : below)}px`;
      popup.style.top = `${side === 'above' ? rect.top - 6 - popup.getBoundingClientRect().height : rect.bottom + 6}px`;
      popup.dataset.side = side;
      popup.style.visibility = 'visible';
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(update);
    };
    const outside = (event: PointerEvent) => {
      if (
        !input.contains(event.target as Node) &&
        !popup.contains(event.target as Node)
      )
        close.current();
    };
    update();
    const observer = new ResizeObserver(schedule);
    for (const element of [input, popup, dialog, header, footer])
      if (element) observer.observe(element);
    window.addEventListener('resize', schedule);
    document.addEventListener('scroll', schedule, true);
    document.addEventListener('pointerdown', outside);
    viewport?.addEventListener('resize', schedule);
    viewport?.addEventListener('scroll', schedule);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener('resize', schedule);
      document.removeEventListener('scroll', schedule, true);
      document.removeEventListener('pointerdown', outside);
      viewport?.removeEventListener('resize', schedule);
      viewport?.removeEventListener('scroll', schedule);
    };
  }, [root, anchor, children]);
  return root
    ? createPortal(
        <div
          ref={panel}
          id={id}
          className="anchored-results"
          role="region"
          aria-label={label}
          style={{ visibility: 'hidden' }}
        >
          {children}
        </div>,
        root,
      )
    : null;
}

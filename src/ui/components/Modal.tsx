import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { IconX } from '../icons';

export function Modal(props: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  footer?: ReactNode;
  width?: number;
  children: ReactNode;
}) {
  const { onClose } = props;
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeRef.current();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    // Focus the first enabled field once, so the dialog is keyboard-ready.
    if (ref.current?.contains(document.activeElement)) return;
    ref.current?.querySelector<HTMLElement>('input:not([disabled]), textarea, select')?.focus();
  }, []);

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={ref}
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={props.title}
        style={props.width ? { width: `min(${props.width}px, 100%)` } : undefined}
      >
        <div className="modal-head">
          <div>
            <h2>{props.title}</h2>
            {props.subtitle && <p>{props.subtitle}</p>}
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <IconX />
          </button>
        </div>
        <div className="modal-body">{props.children}</div>
        {props.footer && <div className="modal-foot">{props.footer}</div>}
      </div>
    </div>
  );
}

interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
}

/** Promise-based confirm dialog: `if (await confirm({...})) …` */
export function useConfirm() {
  const [pending, setPending] = useState<(ConfirmOptions & { resolve: (ok: boolean) => void }) | null>(null);

  const confirm = useCallback(
    (opts: ConfirmOptions) => new Promise<boolean>((resolve) => setPending({ ...opts, resolve })),
    [],
  );

  const close = useCallback(
    (ok: boolean) => {
      pending?.resolve(ok);
      setPending(null);
    },
    [pending],
  );

  const element = pending ? (
    <Modal
      title={pending.title}
      onClose={() => close(false)}
      width={420}
      footer={
        <>
          <button className="btn btn-ghost" onClick={() => close(false)}>
            Cancel
          </button>
          <button className={`btn ${pending.danger ? 'btn-danger' : 'btn-primary'}`} onClick={() => close(true)} autoFocus>
            {pending.confirmLabel ?? 'Confirm'}
          </button>
        </>
      }
    >
      <p className="muted" style={{ margin: 0 }}>
        {pending.message}
      </p>
    </Modal>
  ) : null;

  return { confirm, element };
}

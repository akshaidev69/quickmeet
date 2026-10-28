import {
  useEffect,
  useId,
  useRef,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
} from 'react';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  loading?: boolean;
};

export function Button({ variant = 'primary', loading, className = '', children, disabled, ...props }: ButtonProps) {
  const kind = variant === 'ghost' ? 'textbtn' : variant === 'danger' ? 'primary danger-btn' : variant;
  return (
    <button type="button" className={`${kind} ${className}`.trim()} disabled={disabled || loading} {...props}>
      {loading ? <span className="auth-spinner" aria-hidden="true" /> : null}
      {children}
    </button>
  );
}

type FieldProps = InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  error?: string;
};

export function Input({ label, error, id, className = '', ...props }: FieldProps) {
  const autoId = useId();
  const inputId = id || autoId;
  return (
    <label className={`field ${className}`.trim()} htmlFor={inputId}>
      <span>{label}</span>
      <input id={inputId} aria-invalid={Boolean(error)} {...props} />
      {error ? <p className="field-error">{error}</p> : null}
    </label>
  );
}

type SelectProps = SelectHTMLAttributes<HTMLSelectElement> & {
  label: string;
  error?: string;
};

export function Select({ label, error, id, children, ...props }: SelectProps) {
  const autoId = useId();
  const selectId = id || autoId;
  return (
    <label className="field" htmlFor={selectId}>
      <span>{label}</span>
      <select id={selectId} aria-invalid={Boolean(error)} {...props}>
        {children}
      </select>
      {error ? <p className="field-error">{error}</p> : null}
    </label>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
}) {
  return (
    <label className="ui-toggle">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

export function Badge({ children }: { children: ReactNode }) {
  return <span className="ui-badge">{children}</span>;
}

export function Avatar({ name, src, size = 36 }: { name: string; src?: string | null; size?: number }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || '')
    .join('');
  return (
    <span className="ui-avatar" style={{ width: size, height: size }} aria-hidden={!src}>
      {src ? <img src={src} alt="" /> : initials || '?'}
    </span>
  );
}

export function EmptyState({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return (
    <div className="ui-empty">
      <h3>{title}</h3>
      <p>{body}</p>
      {action}
    </div>
  );
}

export function Skeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div className="ui-skeleton" aria-hidden="true">
      {Array.from({ length: lines }, (_, index) => (
        <span key={index} />
      ))}
    </div>
  );
}

export function Modal({
  title,
  onClose,
  children,
  labelledBy,
}: {
  title?: string;
  onClose: () => void;
  children: ReactNode;
  labelledBy?: string;
}) {
  const titleId = labelledBy || 'ui-modal-title';
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-back" role="presentation" onMouseDown={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : labelledBy}
        onMouseDown={(event) => event.stopPropagation()}
      >
        {title ? (
          <header className="modal-head">
            <h2 id={titleId}>{title}</h2>
            <button type="button" className="textbtn" onClick={onClose}>
              Close
            </button>
          </header>
        ) : null}
        {children}
      </div>
    </div>
  );
}

export function Sheet({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <>
      <div className="sheet-back" onClick={onClose} />
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title}>
        <header className="sheet-head">
          <strong>{title}</strong>
          <button type="button" className="textbtn" onClick={onClose}>
            Close
          </button>
        </header>
        {children}
      </div>
    </>
  );
}

export function useOutsideDismiss(onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function onPointer(event: PointerEvent) {
      if (!ref.current?.contains(event.target as Node)) onClose();
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    document.addEventListener('pointerdown', onPointer);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);
  return ref;
}

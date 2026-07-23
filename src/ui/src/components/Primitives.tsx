import {
  useEffect,
  useRef,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
} from "react";
import { ApiError } from "../api/apiClient";

export function Button({
  variant = "primary",
  className = "",
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "quiet";
}) {
  return (
    <button
      {...props}
      type={type}
      className={`button button--${variant} ${className}`.trim()}
    />
  );
}

export function FormField({
  label,
  hint,
  error,
  id,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & {
  id: string;
  label: string;
  hint?: string;
  error?: string;
}) {
  const helpId = hint || error ? `${id}-help` : undefined;

  return (
    <div className="form-field">
      <label htmlFor={id}>{label}</label>
      <input
        {...props}
        id={id}
        aria-describedby={helpId}
        aria-invalid={error ? "true" : undefined}
      />
      {(hint || error) && (
        <p id={helpId} className={error ? "field-error" : "field-hint"}>
          {error ?? hint}
        </p>
      )}
    </div>
  );
}

export function StatusBadge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "positive" | "warning" | "neutral";
}) {
  return <span className={`status-badge status-badge--${tone}`}>{children}</span>;
}

export function InlineBanner({
  children,
  tone = "info",
}: {
  children: ReactNode;
  tone?: "info" | "warning" | "error";
}) {
  return (
    <div
      className={`inline-banner inline-banner--${tone}`}
      role={tone === "error" ? "alert" : "status"}
    >
      <span className="banner-dot" aria-hidden="true" />
      <div>{children}</div>
    </div>
  );
}

export function Toast({
  children,
  onDismiss,
}: {
  children: ReactNode;
  onDismiss: () => void;
}) {
  return (
    <div className="toast" role="status">
      <span>{children}</span>
      <Button variant="quiet" onClick={onDismiss} aria-label="Dismiss notification">
        ×
      </Button>
    </div>
  );
}

export function Skeleton({ label = "Loading content" }: { label?: string }) {
  return (
    <div className="skeleton-card" role="status">
      <span className="visually-hidden">{label}</span>
      <span className="skeleton-line skeleton-line--short" />
      <span className="skeleton-line" />
      <span className="skeleton-line skeleton-line--medium" />
    </div>
  );
}

export function EmptyState({
  title,
  message,
  action,
}: {
  title: string;
  message: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <h2>{title}</h2>
      <p>{message}</p>
      {action}
    </div>
  );
}

export function ApiErrorState({
  error,
  onRetry,
}: {
  error: unknown;
  onRetry?: () => void;
}) {
  const apiError = error instanceof ApiError ? error : null;
  const message =
    apiError?.message ??
    "Something went wrong while loading this part of GrapeScrape.";

  return (
    <div className="empty-state" role="alert">
      <h2>We could not load this</h2>
      <p>{message}</p>
      {apiError?.requestId && (
        <p className="request-id">Request {apiError.requestId}</p>
      )}
      {onRetry && (
        <Button variant="secondary" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

export function Modal({
  open,
  title,
  children,
  onClose,
}: {
  open: boolean;
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;

    if (open && !dialog?.open) {
      dialog?.showModal();
    } else if (!open && dialog?.open) {
      dialog.close();
    }
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      className="modal"
      onCancel={onClose}
      onClose={onClose}
      aria-labelledby="modal-title"
    >
      <div className="overlay-heading">
        <h2 id="modal-title">{title}</h2>
        <Button variant="quiet" onClick={onClose} aria-label="Close dialog">
          ×
        </Button>
      </div>
      {children}
    </dialog>
  );
}

export function DetailDrawer({
  open,
  title,
  children,
  onClose,
}: {
  open: boolean;
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  if (!open) {
    return null;
  }

  return (
    <div className="drawer-layer">
      <button
        className="drawer-backdrop"
        onClick={onClose}
        aria-label="Close details"
      />
      <aside className="detail-drawer" role="dialog" aria-modal="true" aria-labelledby="drawer-title">
        <div className="overlay-heading">
          <h2 id="drawer-title">{title}</h2>
          <Button variant="quiet" onClick={onClose} aria-label="Close details">
            ×
          </Button>
        </div>
        {children}
      </aside>
    </div>
  );
}

export function WineCard({
  name,
  vintage,
  details,
  aside,
  children,
}: {
  name: string;
  vintage: string;
  details: string;
  aside?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <article className="wine-card">
      <div>
        <h2>
          {name} <span>{vintage}</span>
        </h2>
        <p>{details}</p>
      </div>
      {aside && <div className="wine-card__aside">{aside}</div>}
      {children && <div className="wine-card__body">{children}</div>}
    </article>
  );
}

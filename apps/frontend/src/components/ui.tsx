import { cloneElement, isValidElement, useId, type ReactElement, type ReactNode } from 'react';
import { Link } from 'react-router-dom';

export function BackHome() {
  return <Link className="back-home" to="/">← Back to Home</Link>;
}

export function Page({ title, subtitle, children, className, backHome }: {
  title: string; subtitle?: string; children: ReactNode; className?: string; backHome?: boolean;
}) {
  return (
    <div className={className ? `page ${className}` : 'page'}>
      {backHome && <BackHome />}
      <h1 className="page-title">{title}</h1>
      {subtitle && <p className="page-subtitle">{subtitle}</p>}
      {children}
    </div>
  );
}

export function Card({ children, rotate = 0 }: { children: ReactNode; rotate?: number }) {
  return (
    <div className="paper" style={{ borderRadius: '0.75rem', padding: '1rem', transform: rotate ? `rotate(${rotate}deg)` : undefined }}>
      {children}
    </div>
  );
}

export function FormField({ label, children }: { label: string; children: ReactNode }) {
  // Programmatic association with no visual change: a single
  // input/select/textarea child gets an id and the label points at
  // it via htmlFor. A multi-control child (e.g. the quiz option
  // editor, whose inputs already carry their own aria-labels) keeps
  // the previous plain label — no id is invented for a group.
  const generatedId = useId();
  let control = children;
  let controlId: string | undefined;
  if (isValidElement(children) && (children.type === 'input' || children.type === 'select' || children.type === 'textarea')) {
    const props = children.props as { id?: string };
    controlId = props.id ?? generatedId;
    control = cloneElement(children as ReactElement<{ id?: string }>, { id: controlId });
  }
  return (
    <div style={{ marginBottom: '0.8rem' }}>
      <label htmlFor={controlId}>{label}</label>
      {control}
    </div>
  );
}

export function ErrorBox({ message }: { message: string | null }) {
  if (!message) return null;
  return <p className="error" role="alert">{message}</p>;
}

/** Page-level loading state — replaces bare "Loading…" text. */
export function LoadingState({ label = 'Loading your little place…' }: { label?: string }) {
  return (
    <div className="state-box" role="status" aria-live="polite">
      <p><span className="loading-dots">◦ ◦ ◦</span></p>
      <p>{label}</p>
    </div>
  );
}

/** Page-level empty state — plain, with no fake sample content. */
export function EmptyState({ title = 'Nothing here yet', message = 'Nothing has been added yet. This is an empty space waiting for a first entry — no sample content has been added for you.' }: {
  title?: string; message?: string;
}) {
  return (
    <div className="state-box">
      <h2>{title}</h2>
      <p>{message}</p>
    </div>
  );
}

/** Page-level error state with an optional retry action. */
export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="state-box" role="alert">
      <h2>Something went wrong</h2>
      <p>{message}</p>
      {onRetry && <button className="btn" type="button" onClick={onRetry}>Try again</button>}
    </div>
  );
}

export function fmtDate(value: unknown): string {
  if (!value || typeof value !== 'string') return '';
  return value.slice(0, 10);
}

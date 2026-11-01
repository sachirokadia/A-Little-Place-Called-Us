import type { ReactNode } from 'react';

export function Page({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <div style={{ maxWidth: 860, margin: '0 auto', padding: '1.5rem 1rem 4rem' }}>
      <h1 style={{ fontSize: '2rem', marginBottom: '0.25rem' }}>{title}</h1>
      {subtitle && <p style={{ marginTop: 0, color: '#6b5646' }}>{subtitle}</p>}
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
  return (
    <div style={{ marginBottom: '0.8rem' }}>
      <label>{label}</label>
      {children}
    </div>
  );
}

export function ErrorBox({ message }: { message: string | null }) {
  if (!message) return null;
  return <p className="error" role="alert">{message}</p>;
}

export function fmtDate(value: unknown): string {
  if (!value || typeof value !== 'string') return '';
  return value.slice(0, 10);
}

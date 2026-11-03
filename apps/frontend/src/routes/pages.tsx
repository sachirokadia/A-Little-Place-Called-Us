import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { api, applyMotionPreference, DEFAULT_PREFERENCES, getPreferences, getSpace, listItems, savePreferences, setCsrf, type AnyItem, type Me, type MotionPreference, type Preferences, type Space } from '../lib/api.js';
import { Card, EmptyState, ErrorBox, ErrorState, FormField, LoadingState, Page, fmtDate } from '../components/ui.js';
import { ArcadeContent } from './arcade.js';
import styles from './home.module.css';

export function useList(spaceId: string | null, plural: string, query = '') {
  const [items, setItems] = useState<AnyItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const refresh = async () => {
    if (!spaceId) return;
    setLoading(true);
    try {
      const data = await listItems(spaceId, plural, query);
      setItems(data);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { void refresh(); }, [spaceId, plural, query]);
  return { items, error, loading, refresh };
}

async function softDelete(singular: string, id: string) {
  await api(`/${singular}/${id}/soft-delete`, { method: 'POST', body: {} });
}
async function favourite(singular: string, id: string) {
  await api(`/${singular}/${id}/favourite`, { method: 'POST', body: {} });
}

function EditForm({ item, singular, onDone, onCancel }: { item: AnyItem; singular: string; onDone: () => void; onCancel: () => void }) {
  const [values, setValues] = useState<Record<string, string>>(() => {
    const out: Record<string, string> = {};
    for (const key of ['title', 'caption', 'story', 'body', 'text', 'detail', 'forName', 'mood', 'location', 'category']) {
      if (typeof item[key] === 'string') out[key] = item[key] as string;
    }
    // Kind (reminders: note|prompt; appreciations:
    // appreciation|achievement) is editable as a select, like the
    // create form's kind select, rather than free text.
    if (typeof item.kind === 'string') out.kind = item.kind as string;
    // Memory tags: stored as an array, edited as comma-separated text.
    if (singular === 'memory' && Array.isArray(item.tags)) {
      out.tags = (item.tags as unknown[]).filter((t): t is string => typeof t === 'string').join(', ');
    }
    // Letter visibility + release: edited together so a letter can
    // move between shared / private draft / scheduled. revealAt is
    // converted to datetime-local form (YYYY-MM-DDTHH:mm) for the
    // input and converted back to ISO on submit.
    if (singular === 'letter') {
      if (typeof item.visibility === 'string') out.visibility = item.visibility as string;
      out.revealAt = typeof item.revealAt === 'string' ? (item.revealAt as string).slice(0, 16) : '';
    }
    // Dates the update schemas already accept but the form omitted:
    // happenedOn (memories) and targetDate (plans), mirroring the
    // revealAt handling above. The server still strictly validates
    // them as real YYYY-MM-DD calendar dates.
    // Always present (blank when unset) so a date can be added to a
    // dateless memory/plan as well as changed on a dated one.
    if (singular === 'memory') {
      out.happenedOn = typeof item.happenedOn === 'string' ? (item.happenedOn as string).slice(0, 10) : '';
    }
    if (singular === 'plan') {
      out.targetDate = typeof item.targetDate === 'string' ? (item.targetDate as string).slice(0, 10) : '';
    }
    return out;
  });
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // Synchronous in-flight guard: React `submitting` state only takes
  // effect after a re-render, so two submits dispatched in the same
  // tick would both pass the state check. This ref is set
  // synchronously, so the second same-tick submit returns at once.
  const inFlightRef = useRef(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (submitting || inFlightRef.current) return;
    setError(null);
    inFlightRef.current = true;
    setSubmitting(true);
    try {
      const body: Record<string, unknown> = { ...values };
      if ('tags' in values) {
        body.tags = values.tags.split(',').map((t) => t.trim()).filter(Boolean);
        // Note: tags is sent as an array (the server schema expects
        // string[]); the text form exists only in this edit form.
      }
      if ('revealAt' in values) {
        body.revealAt = values.revealAt ? new Date(values.revealAt).toISOString() : null;
      }
      // Clearing a date sends null (the server accepts nullable
      // dates); an empty string would fail its strict date check.
      if ('happenedOn' in values) {
        body.happenedOn = values.happenedOn ? values.happenedOn : null;
      }
      if ('targetDate' in values) {
        body.targetDate = values.targetDate ? values.targetDate : null;
      }
      await api(`/${singular}/${item.id}`, { method: 'PATCH', body });
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save');
    } finally {
      inFlightRef.current = false;
      setSubmitting(false);
    }
  };
  return (
    <form onSubmit={submit}>
      <ErrorBox message={error} />
      {Object.entries(values).map(([key, value]) => (
        <FormField key={key} label={key === 'tags' ? 'Tags (comma-separated)' : key === 'revealAt' ? 'Release date and time (for scheduled letters)' : key === 'visibility' ? 'Visibility' : key === 'happenedOn' ? 'Date it happened' : key === 'targetDate' ? 'Target date' : key}>
          {key === 'body' || key === 'story' || key === 'detail' || key === 'text' ? (
            <textarea className="field" rows={4} value={value} onChange={(e) => setValues({ ...values, [key]: e.target.value })} />
          ) : key === 'visibility' ? (
            <select className="field" value={value} onChange={(e) => setValues({ ...values, [key]: e.target.value })}>
              <option value="shared">shared</option>
              <option value="private_draft">private_draft</option>
              <option value="scheduled">scheduled</option>
            </select>
          ) : key === 'kind' ? (
            <select className="field" value={value} onChange={(e) => setValues({ ...values, [key]: e.target.value })}>
              {singular === 'reminder' ? (<><option value="note">note</option><option value="prompt">prompt</option></>)
                : singular === 'appreciation' ? (<><option value="appreciation">appreciation</option><option value="achievement">achievement</option></>)
                : (<option value={value}>{value}</option>)}
            </select>
          ) : key === 'revealAt' ? (
            <input className="field" type="datetime-local" value={value} onChange={(e) => setValues({ ...values, [key]: e.target.value })} />
          ) : key === 'happenedOn' || key === 'targetDate' ? (
            <input className="field" type="date" value={value} onChange={(e) => setValues({ ...values, [key]: e.target.value })} />
          ) : (
            <input type="text" className="field" value={value} onChange={(e) => setValues({ ...values, [key]: e.target.value })} />
          )}
        </FormField>
      ))}
      <button className="btn" type="submit" disabled={submitting}>{submitting ? 'Saving…' : 'Save'}</button>{' '}
      <button className="btn quiet" type="button" onClick={onCancel} disabled={submitting}>Cancel</button>
    </form>
  );
}

function ItemCard({ item, singular, me, onRefresh, extra, envelopeMode, polaroidMode, galleryMode }: { item: AnyItem; singular: string; me: Me; onRefresh: () => void; extra?: React.ReactNode; envelopeMode?: boolean; polaroidMode?: boolean; galleryMode?: boolean }) {
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const isAuthor = item.authorId === me.id;
  // Gallery cards have no title: falling back to the note text made
  // the heading and the card body render the same text twice. In
  // gallery mode the heading is the recipient instead.
  const title = (item.title as string) ?? (galleryMode && item.forName ? `For ${item.forName as string}` : (item.text as string) ?? '');
  if (editing) return <Card><EditForm item={item} singular={singular} onDone={() => { setEditing(false); onRefresh(); }} onCancel={() => setEditing(false)} /></Card>;
  const bodyText = (item.body as string) ?? '';
  const storyText = (item.story as string) ?? '';
  // Envelope mode: the body stays folded away until the reader opens it.
  // This is a presentation animation only — what a partner may see is
  // decided by the server, which never lists an undelivered scheduled
  // letter to anyone but its author.
  const bodyNode = envelopeMode ? (
    <div className={open ? 'envelope-open' : ''}>
      <button className="btn quiet" type="button" aria-expanded={open} onClick={() => setOpen(!open)}>
        {open ? 'Fold the letter away' : 'Open the envelope'}
      </button>
      <div className="envelope-body"><p style={{ whiteSpace: 'pre-wrap' }}>{bodyText}</p></div>
    </div>
  ) : item.body ? <p style={{ whiteSpace: 'pre-wrap' }}>{bodyText}</p> : null;
  const storyNode = polaroidMode ? (
    <div>
      <button className="btn quiet" type="button" aria-expanded={open} onClick={() => setOpen(!open)}>
        {open ? 'Put the story back' : 'Read the story'}
      </button>
      {open && <div className="detail-panel"><p style={{ whiteSpace: 'pre-wrap' }}>{storyText}</p></div>}
    </div>
  ) : item.story ? <p>{storyText}</p> : null;
  const galleryText = (item.text as string) ?? '';
  const galleryNode = galleryMode ? (
    <div>
      <p>{open ? galleryText : galleryText.slice(0, 120) + (galleryText.length > 120 ? '…' : '')}</p>
      <button className="btn quiet" type="button" aria-expanded={open} onClick={() => setOpen(!open)}>
        {open ? 'Put the card back' : 'Revisit this card'}
      </button>
      {open && <div className="detail-panel"><p><small>For {item.forName as string} · {(item.kind as string) ?? ''}</small></p></div>}
    </div>
  ) : null;
  return (
    <Card>
      <ErrorBox message={error} />
      <h3 style={{ marginTop: 0 }}>{title}</h3>
      {typeof item.visibility === 'string' && singular === 'letter' ? (
        <p className="visibility-line"><small>
          {item.visibility === 'shared' ? 'Shared — both partners can read this'
            : item.visibility === 'private_draft' ? 'Private draft — only you can see this'
            : item.visibility === 'scheduled' && item.revealAt && (item.revealAt as string) > new Date().toISOString()
              ? `Scheduled — opens on ${(item.revealAt as string).replace('T', ' ').slice(0, 16)}`
              : item.visibility === 'scheduled' ? 'Delivered — was scheduled, now open'
              : item.visibility as string}
        </small></p>
      ) : null}
      {Array.isArray(item.tags) && (item.tags as unknown[]).length > 0 ? (
        <p className="tag-row" aria-label="Tags">
          {(item.tags as unknown[]).filter((t): t is string => typeof t === 'string').map((t) => (
            <span key={t} className="tag-chip">{t}</span>
          ))}
        </p>
      ) : null}
      {item.caption ? <p className={polaroidMode ? 'polaroid-caption' : undefined}>{item.caption as string}</p> : null}
      {galleryNode}
      {!galleryMode && bodyNode}
      {!galleryMode && storyNode}
      {/* No separate text paragraph: when an item has no title, the
          heading above already renders its text (title falls back to
          text), so a second paragraph would duplicate it verbatim —
          that was the Reminder Room title/body duplication. */}
      {item.detail ? <p>{item.detail as string}</p> : null}
      {item.happenedOn ? <p><small>Date: {fmtDate(item.happenedOn)}</small></p> : null}
      {polaroidMode && item.happenedOn ? <div className="ticket-stub" aria-hidden="true"><span>✂ ticket</span><span>{fmtDate(item.happenedOn)}</span></div> : null}
      {item.targetDate ? <p><small>Planned for: {fmtDate(item.targetDate)}</small></p> : null}
      {item.visibility === 'scheduled' && item.revealAt && (item.revealAt as string) > new Date().toISOString() ? <p><small>Sealed until {(item.revealAt as string).replace('T', ' ').slice(0, 16)}</small></p> : null}
      {item.status ? <p><small>Status: {item.status as string}</small></p> : null}
      {item.kind ? <p><span className="quality-badge">{item.kind as string}</span>{item.forName ? <span> · for {item.forName as string}</span> : null}</p> : null}
      {extra}
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: '0.5rem' }}>
        {isAuthor && <button className="btn quiet" onClick={() => setEditing(true)}>Edit</button>}
        {isAuthor && <button className="btn quiet" onClick={async () => { if (!window.confirm('Move this item to Deleted? You can restore it from Deleted.')) return; setError(null); try { await softDelete(singular, item.id); onRefresh(); } catch (e) { setError(e instanceof Error ? e.message : 'Could not delete'); } }}>Move to Deleted</button>}
        <button className="btn quiet" onClick={async () => { setError(null); try { await favourite(singular, item.id); onRefresh(); } catch (e) { setError(e instanceof Error ? e.message : 'Could not favourite'); } }}>♥ Favourite</button>
      </div>
    </Card>
  );
}

function CreateForm({ fields, onCreate, submitLabel = 'Add' }: { fields: { name: string; label: string; kind?: 'text' | 'textarea' | 'date' | 'datetime-local' | 'select'; options?: string[] }[]; onCreate: (values: Record<string, string>, idempotencyKey: string) => Promise<void>; submitLabel?: string }) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  // Synchronous in-flight guard: React `submitting` state only takes
  // effect after a re-render, so two submits dispatched in the same
  // tick would both pass the state check (and each would mint a fresh
  // idempotency key, so the server could not dedupe them). This ref
  // is set synchronously, so the second same-tick submit returns at
  // once. Normal submits are unchanged: a fresh key per attempt, and
  // on failure the ref is cleared, the button re-enables, and the
  // error stays visible — no silent retry.
  const inFlightRef = useRef(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (submitting || inFlightRef.current) return;
    // An entirely blank submit used to reach the server and fail with
    // a cryptic "Invalid request" (or look like a silent no-op). Say
    // so plainly instead, before any request is made.
    if (fields.every((f) => !(values[f.name] ?? '').trim())) {
      setError('Please add something before saving — a title, a note, or a story.');
      setSaved(false);
      return;
    }
    setError(null);
    setSaved(false);
    inFlightRef.current = true;
    setSubmitting(true);
    try {
      // A fresh key per submit attempt: a retried or double request
      // replays instead of creating a duplicate (server-side support).
      await onCreate(values, crypto.randomUUID());
      setValues({});
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save');
    } finally {
      inFlightRef.current = false;
      setSubmitting(false);
    }
  };
  return (
    <form onSubmit={submit} className="paper" style={{ borderRadius: '0.75rem', padding: '1rem', marginBottom: '1.5rem' }}>
      <ErrorBox message={error} />
      {saved && <p className="notice" role="status">Saved — it is on the page now.</p>}
      {fields.map((f) => (
        <FormField key={f.name} label={f.label}>
          {f.kind === 'textarea' ? (
            <textarea className="field" rows={4} value={values[f.name] ?? ''} onChange={(e) => setValues({ ...values, [f.name]: e.target.value })} />
          ) : f.kind === 'select' ? (
            <select className="field" value={values[f.name] ?? ''} onChange={(e) => setValues({ ...values, [f.name]: e.target.value })}>
              <option value="">—</option>
              {(f.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          ) : (
            <input className="field" type={f.kind === 'date' ? 'date' : f.kind === 'datetime-local' ? 'datetime-local' : 'text'} value={values[f.name] ?? ''} onChange={(e) => setValues({ ...values, [f.name]: e.target.value })} />
          )}
        </FormField>
      ))}
      <button className="btn" type="submit" disabled={submitting}>{submitting ? 'Saving…' : submitLabel}</button>
    </form>
  );
}

export function ListPage({ me, space, plural, singular, title, subtitle, createFields, onCreate, extraForItem, favouritedOnly = false, layout, groupBy, sortByTargetDate = false, pageClassName, envelopeMode, polaroidMode, galleryMode, headerExtra, filterFn, filterBar, emptyTitle, emptyMessage, onCreated }: {
  me: Me; space: Space; plural: string; singular: string; title: string; subtitle: string;
  createFields: { name: string; label: string; kind?: 'text' | 'textarea' | 'date' | 'datetime-local' | 'select'; options?: string[] }[];
  onCreate: (spaceId: string, values: Record<string, string>, idempotencyKey?: string) => Promise<void>;
  extraForItem?: (item: AnyItem, refresh: () => void) => React.ReactNode;
  favouritedOnly?: boolean;
  layout?: string;
  groupBy?: 'date-year' | 'letter-state';
  sortByTargetDate?: boolean;
  pageClassName?: string;
  envelopeMode?: boolean;
  polaroidMode?: boolean;
  galleryMode?: boolean;
  headerExtra?: React.ReactNode;
  filterFn?: (item: AnyItem) => boolean;
  // Optional filter UI built from the loaded items (e.g. Memory Wall
  // tag chips). Rendered above the list once items have loaded.
  filterBar?: (items: AnyItem[]) => React.ReactNode;
  emptyTitle?: string;
  emptyMessage?: string;
  onCreated?: () => void;
}) {
  const query = favouritedOnly ? '?favourited=true' : '';
  const { items, error, loading, refresh } = useList(space.id, plural, query);
  const sorted = sortByTargetDate ? [...items].sort((a, b) => {
    const ad = a.targetDate as string | undefined;
    const bd = b.targetDate as string | undefined;
    if (!ad && !bd) return 0;
    if (!ad) return 1;
    if (!bd) return -1;
    return ad < bd ? -1 : ad > bd ? 1 : 0;
  }) : items;
  const renderItem = (item: AnyItem) => {
    const card = <ItemCard key={item.id} item={item} singular={singular} me={me} onRefresh={refresh} extra={extraForItem ? extraForItem(item, refresh) : undefined} envelopeMode={envelopeMode} polaroidMode={polaroidMode} galleryMode={galleryMode} />;
    if (layout !== 'post-office') return card;
    const now = new Date().toISOString();
    const isSealed = item.visibility === 'scheduled' && item.revealAt && (item.revealAt as string) > now;
    const isPrivate = item.visibility === 'private_draft';
    const cls = isSealed ? 'envelope envelope-sealed' : isPrivate ? 'envelope envelope-private' : 'envelope';
    const badge = isSealed ? <span className="seal">Sealed</span> : isPrivate ? <span className="seal seal-private">Private draft — only you can see this</span> : <span className="seal seal-shared">Shared</span>;
    return <div key={item.id} className={cls}><div className="envelope-head">{badge}<span className="stamp" aria-hidden="true">POST</span></div>{card}</div>;
  };
  const pageCls = [pageClassName, layout ? `layout-${layout}` : ''].filter(Boolean).join(' ') || undefined;
  const visible = filterFn ? sorted.filter(filterFn) : sorted;
  let list: React.ReactNode = <div className="list-grid">{visible.map(renderItem)}</div>;
  if (groupBy === 'date-year') {
    const groups = new Map<string, AnyItem[]>();
    for (const item of visible) {
      const year = item.happenedOn && typeof item.happenedOn === 'string' ? item.happenedOn.slice(0, 4) : 'No date yet';
      const arr = groups.get(year) ?? [];
      arr.push(item);
      groups.set(year, arr);
    }
    const ordered = [...groups.entries()].sort(([a], [b]) => (a === 'No date yet' ? 1 : b === 'No date yet' ? -1 : b.localeCompare(a)));
    list = <>{ordered.map(([year, group]) => (
      <section key={year}>
        <h2 className="timeline-marker">{year === 'No date yet' ? 'No date yet' : year}</h2>
        <div className="list-grid">{group.map(renderItem)}</div>
      </section>
    ))}</>;
  } else if (groupBy === 'letter-state') {
    const now = new Date().toISOString();
    const groups: { key: string; label: string; note: string; items: AnyItem[] }[] = [
      { key: 'sealed', label: 'Sealed letters', note: 'Scheduled letters, still sealed until their release date.', items: visible.filter((i) => i.visibility === 'scheduled' && i.revealAt && (i.revealAt as string) > now) },
      { key: 'shared', label: 'Shared letters', note: 'Open letters both partners can read.', items: visible.filter((i) => i.visibility === 'shared' || (i.visibility === 'scheduled' && !(i.revealAt && (i.revealAt as string) > now))) },
      { key: 'private', label: 'Private drafts', note: 'Visible only to their author.', items: visible.filter((i) => i.visibility === 'private_draft') },
    ];
    list = <>{groups.filter((g) => g.items.length > 0).map((g) => (
      <section key={g.key} className="pigeonhole">
        <h2>{g.label}</h2>
        <p><small>{g.note}</small></p>
        <div className="list-grid">{g.items.map(renderItem)}</div>
      </section>
    ))}</>;
  }
  return (
    <Page title={title} subtitle={subtitle} backHome className={pageCls}>
      {headerExtra}
      {createFields.length > 0 && <CreateForm fields={createFields} onCreate={async (v, key) => { await onCreate(space.id, v, key); await refresh(); onCreated?.(); }} />}
      {!loading && !error && filterBar ? filterBar(items) : null}
      {error ? <ErrorState message={error} onRetry={refresh} />
        : loading ? <LoadingState />
        : visible.length === 0 ? <EmptyState title={emptyTitle} message={emptyMessage} />
        : list}
    </Page>
  );
}

function MediaStrip({ linkedType, linkedId, canDelete = false, onDeleted }: { linkedType: string; linkedId: string; canDelete?: boolean; onDeleted?: () => void }) {
  const [assets, setAssets] = useState<AnyItem[]>([]);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  useEffect(() => {
    api<AnyItem[]>(`/media/for/${linkedType}/${linkedId}`).then(setAssets).catch(() => setAssets([]));
  }, [linkedType, linkedId]);
  if (assets.length === 0) return null;
  // Owner-only delete, mirroring the item soft-delete flow (a
  // confirm step, then refresh). The button is only rendered for
  // the owner; the server still enforces owner-only deletion, so a
  // partner never deletes through this UI even if it were shown.
  const deleteAsset = async (id: string) => {
    if (!window.confirm('Delete this photo or recording? It will be removed from this item.')) return;
    setDeleteError(null);
    try {
      await api(`/media/${id}`, { method: 'DELETE' });
      setAssets((prev) => prev.filter((a) => a.id !== id));
      onDeleted?.();
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : 'Could not delete');
    }
  };
  return (
    <div>
      <ErrorBox message={deleteError} />
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
        {assets.map((a) => (
          <span key={a.id} style={{ display: 'inline-flex', flexDirection: 'column', gap: '0.25rem', alignItems: 'flex-start' }}>
            {(a.mimeType as string)?.startsWith('image/') ? (
              // Display-size variant (?size=display): same auth/visibility
              // checks as the full stream, aspect preserved, max 1200px
              // on the longest side. width/height come from the stored
              // asset dimensions so the browser reserves the right ratio
              // and layout shift stays small. Proportions are never
              // cropped: .polaroid-photo has no object-fit / fixed height.
              <img src={`/api/v1/media/${a.id}?size=display`} alt="Memory photo" className="polaroid-photo" style={{ maxWidth: 220 }} loading="lazy" decoding="async" width={typeof a.width === 'number' ? a.width : undefined} height={typeof a.height === 'number' ? a.height : undefined} />
            ) : (
              <audio controls src={`/api/v1/media/${a.id}`} />
            )}
            {canDelete && (
              <button className="btn quiet" type="button" onClick={() => void deleteAsset(a.id)}>Delete this file</button>
            )}
          </span>
        ))}
      </div>
    </div>
  );
}

function UploadForm({ linkedType, linkedId, onDone }: { linkedType: string; linkedId: string; onDone: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [spaceId, setSpaceId] = useState<string>('');
  useEffect(() => { getSpace().then((s) => setSpaceId(s?.id ?? '')).catch(() => undefined); }, []);
  // Client-side checks mirror the server ALLOWED lists and size
  // caps (photos 10 MB, audio 25 MB) so a bad file fails fast with
  // a friendly message. The server remains authoritative: its
  // errors still surface below if a check is ever bypassed.
  const validateFile = (f: File): string | null => {
    const imageTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    const audioTypes = ['audio/mpeg', 'audio/wav', 'audio/webm', 'audio/ogg', 'audio/mp4'];
    const type = f.type.toLowerCase();
    if (imageTypes.includes(type)) {
      if (f.size > 10 * 1024 * 1024) return 'That photo is over 10 MB — please choose a smaller photo.';
      return null;
    }
    if (audioTypes.includes(type)) {
      if (f.size > 25 * 1024 * 1024) return 'That audio file is over 25 MB — please choose a shorter or smaller recording.';
      return null;
    }
    return 'That file type is not supported — please choose a photo (JPEG, PNG, WebP, GIF) or audio (MP3, WAV, WebM, OGG, M4A).';
  };
  return (
    <form onSubmit={async (e) => {
      e.preventDefault();
      if (!file || !spaceId || submitting) return;
      const clientError = validateFile(file);
      if (clientError) { setError(clientError); return; }
      setError(null);
      setSubmitting(true);
      const form = new FormData();
      form.append('linkedType', linkedType);
      form.append('linkedId', linkedId);
      form.append('file', file);
      try {
        await api(`/spaces/${spaceId}/media`, { method: 'POST', form });
        setFile(null);
        onDone();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Upload failed');
      } finally {
        setSubmitting(false);
      }
    }}>
      <ErrorBox message={error} />
      <input type="file" accept="image/jpeg,image/png,image/webp,image/gif,audio/mpeg,audio/wav,audio/webm,audio/ogg,audio/mp4" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />{' '}
      <button className="btn quiet" type="submit" disabled={!file || submitting}>{submitting ? 'Uploading…' : 'Upload'}</button>
    </form>
  );
}

export function MemoriesPage({ me, space }: { me: Me; space: Space }) {
  const [tagFilter, setTagFilter] = useState('');
  return (
    <ListPage
      me={me} space={space} plural="memories" singular="memory" layout="scrapbook" groupBy="date-year" polaroidMode
      title="Memory Wall" subtitle="A layered scrapbook. Photos are pinned here by both of you; nothing here is sample content. Open a polaroid to read its story, and use the ticket stub to see its date at a glance."
      emptyTitle="The scrapbook is blank — and that is an invitation"
      emptyMessage="Pin your first memory below: a title, a handwritten caption, and the date it happened. Add a photo to it afterwards with the upload control on the card. Nothing here is pre-filled, so the first page will genuinely be yours."
      createFields={[
        { name: 'title', label: 'Title' },
        { name: 'caption', label: 'Caption', kind: 'textarea' },
        { name: 'story', label: 'Journal entry', kind: 'textarea' },
        { name: 'happenedOn', label: 'Date it happened', kind: 'date' },
        { name: 'tags', label: 'Tags (comma-separated, optional)' },
      ]}
      onCreate={async (spaceId, v, key) => { await api(`/spaces/${spaceId}/memories`, { method: 'POST', body: { title: v.title, caption: v.caption ?? '', story: v.story ?? '', happenedOn: v.happenedOn || null, tags: (v.tags ?? '').split(',').map((t) => t.trim()).filter(Boolean) }, idempotencyKey: key }); }}
      filterFn={tagFilter ? (i) => Array.isArray(i.tags) && (i.tags as unknown[]).includes(tagFilter) : undefined}
      filterBar={(loaded) => {
        const tags = Array.from(new Set(loaded.flatMap((i) => Array.isArray(i.tags) ? (i.tags as unknown[]).filter((t): t is string => typeof t === 'string') : []))).sort();
        if (tags.length === 0) return null;
        return (
          <div className="chip-row" role="group" aria-label="Filter memories by tag">
            <button className={`chip${!tagFilter ? ' active' : ''}`} type="button" onClick={() => setTagFilter('')}>All tags</button>
            {tags.map((t) => (
              <button key={t} className={`chip${tagFilter === t ? ' active' : ''}`} type="button" onClick={() => setTagFilter(t)}>{t}</button>
            ))}
          </div>
        );
      }}
      extraForItem={(item, refresh) => (
        <div>
          <MediaStrip linkedType="memory" linkedId={item.id} canDelete={item.authorId === me.id} onDeleted={refresh} />
          {item.authorId === me.id ? <UploadForm linkedType="memory" linkedId={item.id} onDone={refresh} /> : null}
        </div>
      )}
    />
  );
}

export function LettersPage({ me, space }: { me: Me; space: Space }) {
  return (
    <ListPage
      me={me} space={space} plural="letters" singular="letter" layout="post-office" groupBy="letter-state" envelopeMode
      title="Letters — a little post office" subtitle="Private drafts stay visible only to their author. Scheduled letters stay sealed until their release date, judged by the server's clock, not yours. Open an envelope to unfold it — the fold is only an animation; who may read it is decided by the server."
      createFields={[
        { name: 'title', label: 'Title' },
        { name: 'body', label: 'Letter', kind: 'textarea' },
        { name: 'visibility', label: 'Kind', kind: 'select', options: ['shared', 'private_draft', 'scheduled'] },
        { name: 'revealAt', label: 'Release date and time (for scheduled letters)', kind: 'datetime-local' },
        { name: 'memoryId', label: 'Link to a memory (optional — paste a memory id)', kind: 'text' },
      ]}
      onCreate={async (spaceId, v, key) => {
        await api(`/spaces/${spaceId}/letters`, {
          method: 'POST',
          body: {
            title: v.title, body: v.body, visibility: v.visibility || 'shared',
            revealAt: v.revealAt ? new Date(v.revealAt).toISOString() : null,
            memoryId: v.memoryId || null,
          },
          idempotencyKey: key,
        });
      }}
    />
  );
}

// Quiet Room gentle prompts: a short, fixed, built-in list stored
// once in code. NOT database content, NOT user content, NOT a
// message from either partner — the label in the UI says so plainly.
// Cycling is client-side only; nothing is written, counted, or
// required, and the section never autoplays or animates.
const GENTLE_THOUGHTS = [
  'You do not have to finish anything here. Sitting quietly counts.',
  'A small kindness to yourself today is enough.',
  'Breathe out a little longer than you breathed in, if that feels good.',
  'Whatever today held, you made room for a quiet moment — that matters.',
  'There is no rush to feel better. You can simply be here for a while.',
  'Notice one soft thing around you: light, warmth, a familiar sound.',
];

export function QuietPage({ me, space }: { me: Me; space: Space }) {
  const { items, error, loading, refresh } = useList(space.id, 'journals');
  const [breathingOn, setBreathingOn] = useState(true);
  const [rainOn, setRainOn] = useState(true);
  const [gentleIndex, setGentleIndex] = useState(0);
  const [moodFilter, setMoodFilter] = useState('');
  const moods = Array.from(new Set(items.map((i) => (i.mood as string) ?? '').filter(Boolean)));
  const shown = moodFilter ? items.filter((i) => (i.mood as string) === moodFilter) : items;
  return (
    <Page title="Quiet Room" subtitle="A calm corner. Journals here are private to their author — your partner cannot see them, count them, or guess their titles. No streaks, no scores, no pressure." backHome className="layout-quiet">
      <div className="quiet-scene" aria-label="A peaceful illustrated room with a window, rain, warm lamplight, and a comfortable chair">
        <div className="quiet-window" aria-hidden="true">{rainOn && <div className="quiet-rain" />}</div>
        <div className="quiet-lamp" aria-hidden="true" />
        <div className="quiet-chair" aria-hidden="true" />
      </div>
      <div className="chip-row" role="group" aria-label="Rain">
        <button className="chip" type="button" aria-pressed={rainOn} onClick={() => setRainOn(!rainOn)}>{rainOn ? 'Rain on — turn it off' : 'Rain off — turn it on'}</button>
      </div>
      <div className="breathing-wrap">
        {breathingOn && <div className="breathing-circle" aria-hidden="true" />}
        <p>Breathe in, breathe out. There is no timer here and nothing to complete — stop whenever you like.</p>
        <button className="btn quiet" type="button" onClick={() => setBreathingOn(!breathingOn)} aria-pressed={breathingOn}>
          {breathingOn ? 'Pause the breathing animation' : 'Show the breathing animation'}
        </button>
      </div>
      <section className="paper" style={{ borderRadius: '0.75rem', padding: '1rem', marginBottom: '1.5rem' }} aria-label="A gentle thought">
        <h2 style={{ marginTop: 0 }}>A gentle thought</h2>
        <p><small>A gentle prompt — built-in, not a message from your partner.</small></p>
        <p style={{ fontFamily: 'Georgia, "Times New Roman", serif', fontStyle: 'italic', fontSize: '1.05rem' }}>{GENTLE_THOUGHTS[gentleIndex]}</p>
        <button className="btn quiet" type="button" onClick={() => setGentleIndex((i) => (i + 1) % GENTLE_THOUGHTS.length)}>Another gentle thought</button>
        <p><small>Optional, always — you do not have to do anything with this.</small></p>
      </section>
      <CreateForm fields={[
        { name: 'title', label: 'Title' },
        { name: 'body', label: 'Journal entry', kind: 'textarea' },
        { name: 'mood', label: 'Mood (optional)' },
      ]} onCreate={async (v, key) => { await api(`/spaces/${space.id}/journals`, { method: 'POST', body: v, idempotencyKey: key }); await refresh(); }} />
      {moods.length > 0 && (
        <div className="chip-row" role="group" aria-label="Filter journals by mood">
          <button className={`chip${!moodFilter ? ' active' : ''}`} type="button" onClick={() => setMoodFilter('')}>All moods</button>
          {moods.map((m) => (
            <button key={m} className={`chip${moodFilter === m ? ' active' : ''}`} type="button" onClick={() => setMoodFilter(m)}>{m}</button>
          ))}
        </div>
      )}
      {error ? <ErrorState message={error} onRetry={refresh} />
        : loading ? <LoadingState />
        : shown.length === 0 ? <EmptyState title="No journal entries yet" message="This room is empty on purpose — write the first private entry above when you want to. It stays yours alone, and nothing here counts, scores, or streaks it." />
        : <div className="list-grid">{shown.map((item) => <ItemCard key={item.id} item={item} singular="journal" me={me} onRefresh={refresh} />)}</div>}
      <section style={{ marginTop: '3rem' }}>
        <h2>Comforting notes</h2>
        <p>Saved comforting voice notes. Upload an audio file to a voice note you create below.</p>
        <p>Voice notes here are private to their author, like journals — your partner cannot see them.</p>
        <VoiceNotes space={space} me={me} />
      </section>
    </Page>
  );
}

function VoiceNoteCard({ item, me, onRefresh }: { item: AnyItem; me: Me; onRefresh: () => void }) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // Voice-note lists are author-only server-side, so these cards
  // are always the caller's own — the check below mirrors ItemCard
  // and keeps the buttons off any row that is not the author's.
  const isAuthor = item.authorId === me.id;
  if (editing) {
    return (
      <Card>
        <ErrorBox message={error} />
        <FormField label="Voice note title">
          <input type="text" className="field" value={title} onChange={(e) => setTitle(e.target.value)} />
        </FormField>
        <p style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
          <button className="btn" type="button" disabled={saving || !title.trim()} onClick={async () => { if (saving) return; setSaving(true); setError(null); try { await api(`/voice-note/${item.id}`, { method: 'PATCH', body: { title: title.trim() } }); setEditing(false); onRefresh(); } catch (e) { setError(e instanceof Error ? e.message : 'Could not save'); } finally { setSaving(false); } }}>
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button className="btn quiet" type="button" onClick={() => setEditing(false)}>Cancel</button>
        </p>
      </Card>
    );
  }
  return (
    <Card>
      <ErrorBox message={error} />
      <h3 style={{ marginTop: 0 }}>{item.title as string}</h3>
      <MediaStrip linkedType="voiceNote" linkedId={item.id} canDelete={isAuthor} onDeleted={onRefresh} />
      <UploadForm linkedType="voiceNote" linkedId={item.id} onDone={onRefresh} />
      {isAuthor && (
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: '0.5rem' }}>
          <button className="btn quiet" onClick={() => { setTitle((item.title as string) ?? ''); setError(null); setEditing(true); }}>Edit title</button>
          <button className="btn quiet" onClick={async () => { if (!window.confirm('Move this voice note to Deleted? You can restore it from Deleted.')) return; setError(null); try { await api(`/voice-note/${item.id}/soft-delete`, { method: 'POST', body: {} }); onRefresh(); } catch (e) { setError(e instanceof Error ? e.message : 'Could not delete'); } }}>Move to Deleted</button>
        </div>
      )}
    </Card>
  );
}

function VoiceNotes({ space, me }: { space: Space; me: Me }) {
  const { items, error, loading, refresh } = useList(space.id, 'voice-notes');
  const [title, setTitle] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  return (
    <div>
      <form onSubmit={async (e) => { e.preventDefault(); if (!title || submitting) return; setFormError(null); setSubmitting(true); try { await api(`/spaces/${space.id}/voice-notes`, { method: 'POST', body: { title }, idempotencyKey: crypto.randomUUID() }); setTitle(''); await refresh(); } catch (err) { setFormError(err instanceof Error ? err.message : 'Could not save'); } finally { setSubmitting(false); } }} className="paper" style={{ borderRadius: '0.75rem', padding: '1rem', marginBottom: '1rem' }}>
        <ErrorBox message={formError} />
        <FormField label="Voice note title"><input type="text" className="field" value={title} onChange={(e) => setTitle(e.target.value)} /></FormField>
        <button className="btn" type="submit" disabled={submitting}>{submitting ? 'Saving…' : 'Add voice note'}</button>
      </form>
      {error ? <ErrorState message={error} onRetry={refresh} />
        : loading ? <LoadingState />
        : items.length === 0 ? <EmptyState title="No voice notes yet" />
        : <div style={{ display: 'grid', gap: '1rem' }}>
          {items.map((item) => (
            <VoiceNoteCard key={item.id} item={item} me={me} onRefresh={refresh} />
          ))}
        </div>}
    </div>
  );
}

export function RemindersPage({ me, space }: { me: Me; space: Space }) {
  const [random, setRandom] = useState<AnyItem | null>(null);
  return (
    <ListPage
      me={me} space={space} plural="reminders" singular="reminder"
      title="Reminder Room" subtitle="Little supportive notes for each other, with no reply expected. Leave one, revisit one, or let a random one find you — there is nothing to answer, no streak to keep, and no response to track."
      emptyTitle="No reminders yet"
      emptyMessage="This room starts empty on purpose. Leave the first supportive note below — a kind thought, a gentle prompt, a small thing to remember together. No reply is expected, ever."
      headerExtra={(
        <div style={{ marginBottom: '1rem' }}>
          <button className="btn secondary" type="button" onClick={async () => { const r = await api<AnyItem | null>(`/spaces/${space.id}/reminders/random`); setRandom(r); }}>Show me a random reminder</button>
          {random && <div style={{ marginTop: '1rem' }}><Card><p style={{ margin: 0 }}>{random.text as string}</p><p><small>{(random.kind as string) ?? 'note'} · a supportive note, no reply expected</small></p></Card></div>}
          {!random && <p><small>Random reminders are picked only from reminders you have actually saved — never invented.</small></p>}
        </div>
      )}
      createFields={[
        { name: 'text', label: 'Reminder', kind: 'textarea' },
        { name: 'kind', label: 'Kind', kind: 'select', options: ['note', 'prompt'] },
      ]}
      onCreate={async (spaceId, v, key) => { if (!(v.text ?? '').trim()) throw new Error('Please write a reminder before saving.'); await api(`/spaces/${spaceId}/reminders`, { method: 'POST', body: { text: v.text, kind: v.kind || 'note' }, idempotencyKey: key }); }}
    />
  );
}

export function AppreciationsPage({ me, space }: { me: Me; space: Space }) {
  const [random, setRandom] = useState<AnyItem | null>(null);
  const [kindFilter, setKindFilter] = useState('');
  const [sortOrder, setSortOrder] = useState<'newest' | 'oldest'>('newest');
  const { items, error, loading, refresh } = useList(space.id, 'appreciations');
  const filtered = kindFilter ? items.filter((i) => (i.kind as string) === kindFilter) : items;
  // Chronological browsing, client-side over the loaded cards, so it
  // composes with the kind filter above. Default is newest first.
  const shown = [...filtered].sort((a, b) => {
    const ac = (a.createdAt as string) ?? '';
    const bc = (b.createdAt as string) ?? '';
    if (ac === bc) return sortOrder === 'newest' ? (b.id < a.id ? -1 : 1) : (a.id < b.id ? -1 : 1);
    return sortOrder === 'newest' ? (ac < bc ? 1 : -1) : (ac < bc ? -1 : 1);
  });
  return (
    <Page title="Things I See in You" subtitle="A gallery of little things — appreciations and moments of courage. Nothing here is scored or ranked. Open a card to revisit it in full." backHome className="layout-gallery">
      <CreateForm fields={[
        { name: 'text', label: 'Note', kind: 'textarea' },
        { name: 'kind', label: 'Kind', kind: 'select', options: ['appreciation', 'achievement'] },
        { name: 'forName', label: 'For (name)' },
      ]} onCreate={async (v, key) => { await api(`/spaces/${space.id}/appreciations`, { method: 'POST', body: v, idempotencyKey: key }); await refresh(); }} />
      <div className="chip-row" role="group" aria-label="Filter cards by kind">
        <button className={`chip${!kindFilter ? ' active' : ''}`} type="button" onClick={() => setKindFilter('')}>All cards</button>
        <button className={`chip${kindFilter === 'appreciation' ? ' active' : ''}`} type="button" onClick={() => setKindFilter('appreciation')}>Appreciations</button>
        <button className={`chip${kindFilter === 'achievement' ? ' active' : ''}`} type="button" onClick={() => setKindFilter('achievement')}>Achievements</button>
      </div>
      <div className="chip-row" role="group" aria-label="Sort cards by date">
        <button className={`chip${sortOrder === 'newest' ? ' active' : ''}`} type="button" onClick={() => setSortOrder('newest')}>Newest first</button>
        <button className={`chip${sortOrder === 'oldest' ? ' active' : ''}`} type="button" onClick={() => setSortOrder('oldest')}>Oldest first</button>
      </div>
      {error ? <ErrorState message={error} onRetry={refresh} />
        : loading ? <LoadingState />
        : shown.length === 0 ? <EmptyState title="No cards yet" message="This gallery starts empty on purpose. Write the first card above — a quality you admire, a moment of courage, a small thing that mattered. No scores, no rankings, just cards to come back to." />
        : <div className="list-grid">{shown.map((item) => <ItemCard key={item.id} item={item} singular="appreciation" me={me} onRefresh={refresh} galleryMode />)}</div>}
      <div style={{ marginTop: '2rem' }}>
        <button className="btn secondary" onClick={async () => { const r = await api<AnyItem | null>(`/spaces/${space.id}/appreciations/random`); setRandom(r); }}>Show me a random card</button>
        {random && <div style={{ marginTop: '1rem' }}><Card><p>{random.text as string}</p><p><small>For {random.forName as string}</small></p></Card></div>}
        <p><Link to="/appreciations/favourites">Revisit favourite cards →</Link></p>
      </div>
    </Page>
  );
}

export function FavouritesPage({ me, space }: { me: Me; space: Space }) {
  return (
    <ListPage
      me={me} space={space} plural="appreciations" singular="appreciation" layout="gallery" galleryMode
      title="Favourite cards" subtitle="Cards you marked as favourites."
      createFields={[]}
      onCreate={async () => undefined}
      favouritedOnly
    />
  );
}

export function FuturePage({ me, space }: { me: Me; space: Space }) {
  const [category, setCategory] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const { items: mapPlans, refresh: refreshMap } = useList(space.id, 'plans');
  const { items: memories, refresh: refreshMemories } = useList(space.id, 'memories');
  const selected = mapPlans.find((p) => p.id === selectedId) ?? null;
  const keepsakeFor = (planId: string) => memories.find((m) => (m.sourcePlanId as string) === planId);
  const categories = ['trip', 'date', 'meal', 'activity', 'home', 'other'];
  return (
    <div>
      <ListPage
        me={me} space={space} plural="plans" singular="plan" layout="journey" sortByTargetDate
        title="Our Future — an adventure map" subtitle="Plans are drawn as journeys, not checklists. Target dates are hopes, not deadlines — a date can move, and the plan is still the plan. Tap an island on the map to open its quest card. Completing one can create a scrapbook memory in the same step, so it is never duplicated."
        headerExtra={(
          <div>
            <div className="future-map" aria-label="An illustrated adventure map with a winding path, islands, and food stalls">
              <svg viewBox="0 0 600 60" aria-hidden="true" style={{ width: '100%', height: 60 }}>
                <path d="M10 30 Q 110 5 210 30 T 410 30 T 590 30" fill="none" stroke="#c07856" strokeWidth="3" strokeDasharray="8 6" />
                <circle cx="60" cy="28" r="10" fill="#7d8b6a" /><circle cx="300" cy="28" r="10" fill="#c48b8b" /><circle cx="520" cy="28" r="10" fill="#f6d87a" />
                <text x="60" y="52" textAnchor="middle" fontSize="11">island</text>
                <text x="300" y="52" textAnchor="middle" fontSize="11">food stall</text>
                <text x="520" y="52" textAnchor="middle" fontSize="11">destination</text>
              </svg>
              <div className="chip-row" style={{ marginBottom: 0 }}>
                {mapPlans.length === 0 ? <p style={{ margin: 0 }}><small>No destinations on the map yet — add the first quest card below.</small></p> : mapPlans.map((p) => (
                  <button key={p.id} className={`map-island${selectedId === p.id ? ' selected' : ''}`} type="button" onClick={() => setSelectedId(p.id)}>
                    {(p.title as string) ?? 'Quest'}
                  </button>
                ))}
              </div>
              {selected && (
                <div className="detail-panel">
                  <h3 style={{ marginTop: 0 }}>{selected.title as string}</h3>
                  <p>{selected.detail as string}</p>
                  <p><small>{(selected.category as string) ?? ''}{selected.location ? ` · ${selected.location as string}` : ''}{selected.targetDate ? ` · planned for ${fmtDate(selected.targetDate)}` : ''} · status: {(selected.status as string) ?? 'planned'}</small></p>
                  {selected.status === 'done' && keepsakeFor(selected.id) ? (
                    <p><Link to="/memories">View its Memory Wall keepsake →</Link></p>
                  ) : selected.status === 'done' ? (
                    <p><small>Completed without a keepsake — complete a future quest with the keepsake box ticked to link it here.</small></p>
                  ) : null}
                </div>
              )}
            </div>
            <div className="chip-row" role="group" aria-label="Filter quests by category">
              <button className={`chip${!category ? ' active' : ''}`} type="button" onClick={() => setCategory('')}>All quests</button>
              {categories.map((c) => (
                <button key={c} className={`chip${category === c ? ' active' : ''}`} type="button" onClick={() => setCategory(c)}>{c}</button>
              ))}
            </div>
          </div>
        )}
        filterFn={category ? (i) => (i.category as string) === category : undefined}
        onCreated={refreshMap}
        createFields={[
          { name: 'title', label: 'Title' },
          { name: 'detail', label: 'Notes', kind: 'textarea' },
          { name: 'category', label: 'Category', kind: 'select', options: ['trip', 'date', 'meal', 'activity', 'home', 'other'] },
          { name: 'targetDate', label: 'Target date', kind: 'date' },
          { name: 'location', label: 'Location (optional)' },
        ]}
        onCreate={async (spaceId, v, key) => { await api(`/spaces/${spaceId}/plans`, { method: 'POST', body: { title: v.title, detail: v.detail ?? '', category: v.category || 'other', targetDate: v.targetDate || null, location: v.location ?? '' }, idempotencyKey: key }); }}
        extraForItem={(item, refresh) => (
          <>
            <p><span className="journey-category">{(item.category as string) ?? 'other'}</span>{item.location ? <span> · {item.location as string}</span> : null}</p>
            {item.status === 'planned' ? (
              <form onSubmit={async (e) => { e.preventDefault(); const form = e.target as HTMLFormElement; const createMemory = (form.elements.namedItem('createMemory') as HTMLInputElement).checked; const caption = (form.elements.namedItem('memoryCaption') as HTMLInputElement).value; await api(`/plan/${item.id}/complete`, { method: 'POST', body: { createMemory, memoryTitle: item.title as string, memoryCaption: caption } }); refresh(); refreshMemories(); }}>
                <label><input type="checkbox" name="createMemory" defaultChecked /> Also create a Memory Wall keepsake</label>{' '}
                <FormField label="Keepsake caption (optional)"><input type="text" className="field" name="memoryCaption" /></FormField>
                <button className="btn secondary" type="submit">Mark complete ✓</button>
              </form>
            ) : (
              <p><span className="completed-stamp">Completed</span>{keepsakeFor(item.id) ? <span> · <Link to="/memories">View its Memory Wall keepsake →</Link></span> : null}</p>
            )}
          </>
        )}
      />
    </div>
  );
}

export function DeletedPage({ me, space }: { me: Me; space: Space }) {
  const types: { plural: string; singular: string; label: string }[] = [
    { plural: 'memories', singular: 'memory', label: 'Memories' },
    { plural: 'letters', singular: 'letter', label: 'Letters' },
    { plural: 'journals', singular: 'journal', label: 'Journals' },
    { plural: 'appreciations', singular: 'appreciation', label: 'Appreciations' },
    { plural: 'plans', singular: 'plan', label: 'Plans' },
    { plural: 'reminders', singular: 'reminder', label: 'Reminders' },
    { plural: 'voice-notes', singular: 'voice-note', label: 'Voice notes' },
  ];
  return (
    <Page title="Deleted" subtitle="Your own soft-deleted items. Restore returns them; permanent delete is a second, explicit act and cannot be undone." backHome>
      {types.map((t) => <DeletedList key={t.plural} me={me} space={space} plural={t.plural} singular={t.singular} label={t.label} />)}
    </Page>
  );
}

function DeletedList({ me, space, plural, singular, label }: { me: Me; space: Space; plural: string; singular: string; label: string }) {
  const { items, refresh } = useList(space.id, plural, '?deleted=true');
  if (items.length === 0) return null;
  return (
    <div style={{ marginBottom: '1.5rem' }}>
      <h2>{label}</h2>
      <div style={{ display: 'grid', gap: '1rem' }}>
        {items.map((item) => (
          <Card key={item.id}>
            <h3 style={{ marginTop: 0 }}>{(item.title as string) ?? (item.text as string)}</h3>
            <button className="btn quiet" onClick={async () => { await api(`/${singular}/${item.id}/restore`, { method: 'POST', body: {} }); await refresh(); }}>Restore</button>{' '}
            <button className="btn quiet" onClick={async () => { if (window.confirm('Permanently delete this item? This cannot be undone.')) { await api(`/${singular}/${item.id}`, { method: 'DELETE' }); await refresh(); } }}>Delete permanently</button>
          </Card>
        ))}
      </div>
    </div>
  );
}

const MAX_PATH_FLOWERS = 12;
const FLOWER_COLOURS = ['#c48b8b', '#c07856', '#7d8b6a'];

function PathFlower({ colour, rotate }: { colour: string; rotate: number }) {
  return (
    <svg className={styles.flower} viewBox="0 0 24 24" aria-hidden="true" style={{ transform: `rotate(${rotate}deg)` }}>
      <line x1="12" y1="14" x2="12" y2="23" stroke="#7d8b6a" strokeWidth="1.6" />
      <circle cx="12" cy="6" r="3.2" fill={colour} />
      <circle cx="6.5" cy="10" r="3.2" fill={colour} />
      <circle cx="17.5" cy="10" r="3.2" fill={colour} />
      <circle cx="8" cy="14.5" r="3.2" fill={colour} />
      <circle cx="16" cy="14.5" r="3.2" fill={colour} />
      <circle cx="12" cy="10.5" r="2.4" fill="#f6d87a" />
    </svg>
  );
}

export function HomePage({ me, space, onSpaceChange }: { me: Me; space: Space | null; onSpaceChange: () => void }) {
  const navigate = useNavigate();
  const [introDismissed, setIntroDismissed] = useState(() => {
    try { return localStorage.getItem('lp-intro-dismissed') === '1'; } catch { return false; }
  });
  const [introOpen, setIntroOpen] = useState(() => {
    try { return localStorage.getItem('lp-intro-dismissed') !== '1'; } catch { return true; }
  });
  const dismissIntro = () => {
    try { localStorage.setItem('lp-intro-dismissed', '1'); } catch { /* ignore */ }
    setIntroDismissed(true);
    setIntroOpen(false);
  };
  // Gift first-visit entrance (Phase 7). Deliberately separate from the
  // Home intro above (lp-intro-dismissed) and from /welcome onboarding
  // (server onboardingSeen): it is a device-local, always-skippable
  // entrance only, it never gates any room, and it says nothing beyond
  // the rooms themselves — the recipient discovers the world by
  // exploring. Reopening it from Home is for that visit only; the
  // stored flag still makes the next visit skip it.
  const [giftOpen, setGiftOpen] = useState(() => {
    try { return localStorage.getItem('lp-gift-intro-seen') !== '1'; } catch { return true; }
  });
  const dismissGift = () => {
    try { localStorage.setItem('lp-gift-intro-seen', '1'); } catch { /* ignore */ }
    setGiftOpen(false);
  };
  const [doorOpen, setDoorOpen] = useState(false);
  const destinations = [
    { to: '/memories', label: 'Memory Wall', note: 'Our scrapbook' },
    { to: '/letters', label: 'Letters', note: 'A little post office' },
    { to: '/quiet', label: 'Quiet Room', note: 'A safe little corner' },
    { to: '/appreciations', label: 'Things I See in You', note: 'A gallery of little things' },
    { to: '/future', label: 'Our Future', note: 'An adventure map' },
    { to: '/arcade', label: 'Secret Arcade', note: 'A playful pixel arcade — Memory Match, Detective Mini-Mystery, a sample Relationship Quiz, Property-Trading Board, Photo Memory Match, How Well Do You Know Us?, Catch the Hearts, Guess My Answer, Unlock the Chest, The Rooftop Adventure and Our Little World' },
  ];
  // Real garden data: one flower per saved shared memory, capped for
  // display, with the true count always stated in words. When the
  // space has no memories, no flowers are faked.
  const { items: memories } = useList(space ? space.id : null, 'memories');
  // Arcade unlocks decorate Home only: they are read from the server
  // when a space exists, and nothing extra renders when there are none.
  const [homeUnlocks, setHomeUnlocks] = useState<string[]>([]);
  useEffect(() => {
    if (!space) { setHomeUnlocks([]); return; }
    let cancelled = false;
    api<{ progress?: { unlocks?: unknown }; unlocks?: unknown }>(`/spaces/${space.id}/game-progress/arcade-unlocks`)
      .then((res) => {
        if (cancelled) return;
        const raw = res?.progress?.unlocks ?? res?.unlocks;
        setHomeUnlocks(Array.isArray(raw) ? raw.filter((u): u is string => typeof u === 'string') : []);
      })
      .catch(() => { if (!cancelled) setHomeUnlocks([]); });
    return () => { cancelled = true; };
  }, [space]);
  const UNLOCK_LABELS: Record<string, string> = {
    'golden-star': '★ Golden star',
    'lantern': 'Lantern',
    'banner': 'Bunting banner',
    'pixel-cat': 'Pixel cat',
    'pixel-fox': 'Pixel fox',
  };
  const memoryCount = space ? memories.length : 0;
  const visibleFlowers = Math.min(memoryCount, MAX_PATH_FLOWERS);
  const flowerText = !space
    ? 'No space yet, so no flowers yet — the first flower will bloom with your first shared memory.'
    : memoryCount === 0
      ? 'No flowers yet — the first flower will bloom with your first shared memory.'
      : memoryCount === 1
        ? '1 flower for 1 memory.'
        : visibleFlowers < memoryCount
          ? `${visibleFlowers} flowers for ${memoryCount} memories.`
          : `${memoryCount} ${memoryCount === 1 ? 'flower' : 'flowers'} for ${memoryCount} ${memoryCount === 1 ? 'memory' : 'memories'}.`;
  if (giftOpen) {
    return (
      <div className="page">
        <section className={styles.gift} aria-label="A first-visit entrance to this little world">
          <div className={styles.giftVignette} aria-hidden="true">
            <div className={styles.sky}>
              <div className={styles.sun} />
              <div className={styles.cloud} />
            </div>
            <div className={styles.giftGround} />
            <div className={styles.giftCottage}>
              <div className={styles.roof} />
              <div className={styles.house}>
                <div className={styles.window} />
                <div className={styles.door}>⌂</div>
                <div className={styles.window} />
              </div>
            </div>
          </div>
          <h1 className={styles.giftTitle}>A Little Place Called Us</h1>
          <p className={styles.giftTagline}>A little world, made of our memories, our letters, and all the days still waiting for us.</p>
          <p className={styles.giftHandNote}>I made a little place for all the things I never want us to forget.</p>
          <p className={styles.giftSecondary}>Somewhere in this little world, I've kept the things I wish you could see through my eyes.</p>
          <p className={styles.giftRooms}>Rooms to wander, in any order, whenever you like.</p>
          <div className={styles.giftActions}>
            <button className="btn" type="button" onClick={dismissGift}>Come on in.</button>
            <button className="btn quiet" type="button" onClick={dismissGift}>Skip</button>
          </div>
          <p className={styles.giftSmall}>You can see this entrance again any time from the Home page.</p>
        </section>
      </div>
    );
  }
  return (
    <div className="page">
      {introOpen && (
        <div className={`notice ${styles.intro}`} role="region" aria-label="Welcome introduction">
          <p style={{ marginTop: 0 }}>Welcome to your little place. This is a private world for two people: shared memories and plans live here, private journals and drafts stay yours alone, and scheduled letters open only when their time arrives.</p>
          <div className={styles.introActions}>
            <button className="btn" type="button" onClick={dismissIntro}>Got it — don&apos;t show this again</button>
            <button className="btn quiet" type="button" onClick={dismissIntro}>Skip</button>
          </div>
        </div>
      )}
      <section className={styles.scene} aria-label="A little illustrated cottage scene">
        <div className={styles.sky} aria-hidden="true">
          <div className={styles.sun} />
          <div className={styles.cloud} />
        </div>
        <div className={styles.signWrap}>
          <h1 className={styles.sign}>A Little Place Called Us</h1>
          <p className={styles.tagline}>A little world, made of our memories, our letters, and all the days still waiting for us.</p>
        </div>
        <p className={styles.handNote}>Welcome home — this little world is yours, together.</p>
        <div className={styles.cottage} aria-label="A tiny cottage with warm glowing windows, a garden path, and a mailbox">
          <div className={styles.roof} aria-hidden="true" />
          <div className={styles.house}>
            <div className={styles.window} aria-hidden="true" />
            <button className={styles.door} type="button" onClick={() => setDoorOpen(!doorOpen)} aria-expanded={doorOpen} aria-controls="cottage-destinations" aria-label="Front door — open the room-selection panel">⌂</button>
            <div className={styles.window} aria-hidden="true" />
          </div>
          <div className={styles.fence} aria-hidden="true">| | | | |</div>
          <div className={styles.pathWrap}>
            <div className={styles.path} aria-hidden="true" />
            <div className={styles.flowers} aria-hidden="true">
              {Array.from({ length: visibleFlowers }, (_, i) => (
                <PathFlower key={i} colour={FLOWER_COLOURS[i % FLOWER_COLOURS.length]!} rotate={i % 2 === 0 ? -8 : 8} />
              ))}
            </div>
            <p className={styles.flowerCount}>{flowerText}</p>
          </div>
        </div>
        {homeUnlocks.length > 0 && (
          <div aria-label="Decorations unlocked in the Secret Arcade, beside the cottage" style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: '0.5rem', margin: '0.75rem auto 0', maxWidth: 560 }}>
            {homeUnlocks.filter((u) => UNLOCK_LABELS[u]).map((u) => (
              <span key={u} style={{ background: '#fffdf6', border: '1px solid #d9cbb2', borderRadius: 999, padding: '0.4rem 0.8rem', fontSize: '0.92rem' }}>{UNLOCK_LABELS[u]} — unlocked in the Secret Arcade</span>
            ))}
          </div>
        )}
        <div className={styles.hotspots}>
          <button className={styles.mailbox} type="button" onClick={() => navigate('/letters')} aria-label="Mailbox — open Letters">✉ Mailbox — Letters</button>
          <button className={styles.comeIn} type="button" onClick={() => setDoorOpen(true)} aria-label="Come on in — open the room-selection panel">Come on in.</button>
          <button className={styles.garden} type="button" onClick={() => navigate('/memories')} aria-label="Garden — open Memory Wall">❦ Garden — Memory Wall</button>
          <button className={styles.mailbox} type="button" onClick={() => { try { localStorage.setItem('lp-hidden-step', 'home'); } catch { /* ignore */ } navigate('/arcade'); }} aria-label="Brass star — follow it to the Secret Arcade">★ Brass star — follow it to the Secret Arcade</button>
        </div>
        <p className={styles.sceneHint}>A brass star is painted beside the cottage door. Its matching star is waiting in the Secret Arcade — follow it there.</p>
        {doorOpen && (
          <div id="cottage-destinations" className="cottage-destinations">
            <h2 style={{ marginTop: 0 }}>Inside the cottage</h2>
            <p>Every room is here — step through any door you like. Nothing here is a preview; each link goes to a real destination.</p>
            <ul>
              {destinations.map((d) => (
                <li key={d.to}><Link to={d.to}>{d.label}</Link> — {d.note}</li>
              ))}
            </ul>
            <button className="btn quiet" type="button" onClick={() => setDoorOpen(false)}>Close the door</button>
          </div>
        )}
        <p className={styles.sceneHint}>Tap the mailbox for Letters, the garden for the Memory Wall, or the door — or “Come on in.” — to peek inside the cottage.</p>
      </section>
      {!introOpen && (
        <button className={`btn quiet ${styles.revisit}`} type="button" onClick={() => setIntroOpen(true)}>Show the welcome again</button>
      )}{' '}
      <button className={`btn quiet ${styles.revisit}`} type="button" onClick={() => setGiftOpen(true)}>See the gift entrance again</button>
      <div className={styles.destinations}>
        {destinations.map((d) => (
          <Link key={d.to} to={d.to} style={{ textDecoration: 'none', color: 'inherit' }}>
            <Card><h3 style={{ marginTop: 0 }}>{d.label}</h3><p style={{ marginBottom: 0 }}>{d.note}</p></Card>
          </Link>
        ))}
      </div>
      {space && <RemindersSection space={space} />}
      {!space && (
        <div className="notice" style={{ marginTop: '1.5rem' }}>
          You are not in a space yet. <Link to="/space">Create a space or join one</Link> to start sharing.
        </div>
      )}
    </div>
  );
}

function RemindersSection({ space }: { space: Space }) {
  const { items, refresh } = useList(space.id, 'reminders');
  const [text, setText] = useState('');
  const [random, setRandom] = useState<AnyItem | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  return (
    <div style={{ marginTop: '2rem' }}>
      <h2>Little reminders</h2>
      <p><small>Supportive notes with no reply expected — just little things left for each other. <Link to="/reminders">Open the Reminder Room →</Link></small></p>
      <form onSubmit={async (e) => { e.preventDefault(); if (!text || submitting) return; setFormError(null); setSubmitting(true); try { await api(`/spaces/${space.id}/reminders`, { method: 'POST', body: { text, kind: 'note' }, idempotencyKey: crypto.randomUUID() }); setText(''); await refresh(); } catch (err) { setFormError(err instanceof Error ? err.message : 'Could not save'); } finally { setSubmitting(false); } }} className="paper" style={{ borderRadius: '0.75rem', padding: '1rem', marginBottom: '1rem' }}>
        <ErrorBox message={formError} />
        <FormField label="A note for both of you"><input type="text" className="field" value={text} onChange={(e) => setText(e.target.value)} /></FormField>
        <button className="btn" type="submit" disabled={submitting}>{submitting ? 'Saving…' : 'Leave a reminder'}</button>{' '}
        <button className="btn quiet" type="button" onClick={async () => { const r = await api<AnyItem | null>(`/spaces/${space.id}/reminders/random`); setRandom(r); }}>Random reminder</button>
      </form>
      {random && <Card><p>{random.text as string}</p></Card>}
      <div style={{ display: 'grid', gap: '0.75rem', marginTop: '1rem' }}>
        {items.map((item) => <Card key={item.id}><p style={{ margin: 0 }}>{item.text as string}</p></Card>)}
      </div>
    </div>
  );
}

export function NotFoundPage() {
  return (
    <Page title="That little corner isn't here" subtitle="The page you were looking for doesn't exist in this little world.">
      <EmptyState title="Nothing at this address" message="This address doesn't lead to a room. Choose a real destination below — every link here works." />
      <ul style={{ marginTop: '1.5rem' }}>
        <li><Link to="/">The Home</Link></li>
        <li><Link to="/memories">Memory Wall</Link></li>
        <li><Link to="/letters">Letters</Link></li>
        <li><Link to="/quiet">Quiet Room</Link></li>
        <li><Link to="/appreciations">Things I See in You</Link></li>
        <li><Link to="/future">Our Future</Link></li>
        <li><Link to="/arcade">Secret Arcade</Link></li>
      </ul>
    </Page>
  );
}

export function ArcadePage({ me, space }: { me: Me; space: Space }) {
  // Phase 4: the real arcade page lives in arcade.tsx. Game progress
  // never gates any other room — Home, Memory Wall, Letters, Quiet
  // Room, Appreciations and Future all work with zero game progress.
  return <ArcadeContent space={space} me={me} />;
}

export function AuthPage({ mode, onSignedIn }: { mode: 'login' | 'register'; onSignedIn: () => Promise<void> }) {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      const data = await api<{ csrfToken: string }>(`/auth/${mode}`, {
        method: 'POST',
        body: mode === 'register' ? { email, password, displayName } : { email, password },
      });
      // The API returns a fresh session-bound CSRF token on login/register.
      setCsrf(data.csrfToken);
      // Await the refresh before navigating: navigating while App
      // still has me=null makes the /welcome route render its
      // signed-out redirect to /login, which then bounces the
      // now-signed-in user to /. Awaiting first lets the destination
      // render with settled state.
      await onSignedIn();
      // Register goes through onboarding; login goes straight home.
      navigate(mode === 'register' ? '/welcome' : '/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not sign in');
    } finally {
      setSubmitting(false);
    }
  };
  return (
    <Page title={mode === 'login' ? 'Welcome back' : 'Create your account'} subtitle="Each partner has their own account. A space holds exactly two people.">
      <ErrorBox message={error} />
      <form onSubmit={submit} className="paper" style={{ borderRadius: '0.75rem', padding: '1rem', maxWidth: 480 }}>
        <FormField label="Email"><input className="field" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></FormField>
        {mode === 'register' && <FormField label="Display name"><input type="text" className="field" value={displayName} onChange={(e) => setDisplayName(e.target.value)} required /></FormField>}
        <FormField label="Password (at least 10 characters)"><input className="field" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required /></FormField>
        <button className="btn" type="submit" disabled={submitting}>{submitting ? 'Saving…' : mode === 'login' ? 'Sign in' : 'Create account'}</button>
      </form>
      <p>{mode === 'login' ? <>New here? <Link to="/register">Create an account</Link></> : <>Already have an account? <Link to="/login">Sign in</Link></>}</p>
      <p><small>Password reset by email is not available yet — no email provider has been chosen (R3). If you lose your password, this build has no recovery path yet; that is a known Phase 1A limitation, not a hidden one.</small></p>
    </Page>
  );
}

/** Create-a-space and join-with-invitation forms, shared by SpacePage
 * and WelcomePage: one implementation, same API calls, same behaviour.
 * On success the caller is taken to /welcome so step 3 is seen. */
export function SpaceForms({ onSpaceChange }: { onSpaceChange: () => Promise<void> }) {
  const [name, setName] = useState('A Little Place Called Us');
  const [token, setToken] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [joining, setJoining] = useState(false);
  const navigate = useNavigate();
  return (
    <div>
      <ErrorBox message={error} />
      {notice && <p className="notice">{notice}</p>}
      <form onSubmit={async (e) => { e.preventDefault(); if (creating) return; setError(null); setCreating(true); try { await api('/spaces', { method: 'POST', body: { name } }); setNotice('Space created.'); await onSpaceChange(); navigate('/welcome'); } catch (err) { setError(err instanceof Error ? err.message : 'Could not create a space'); } finally { setCreating(false); } }} className="paper" style={{ borderRadius: '0.75rem', padding: '1rem', marginBottom: '1rem' }}>
        <FormField label="Space name"><input type="text" className="field" value={name} onChange={(e) => setName(e.target.value)} /></FormField>
        <button className="btn" type="submit" disabled={creating}>{creating ? 'Saving…' : 'Create a space'}</button>
      </form>
      <form onSubmit={async (e) => { e.preventDefault(); if (joining) return; setError(null); setJoining(true); try { await api('/spaces/invitations/join', { method: 'POST', body: { token } }); setNotice('Joined!'); await onSpaceChange(); navigate('/welcome'); } catch (err) { setError(err instanceof Error ? err.message : 'Could not join'); } finally { setJoining(false); } }} className="paper" style={{ borderRadius: '0.75rem', padding: '1rem' }}>
        <FormField label="Invitation token"><input type="text" className="field" value={token} onChange={(e) => setToken(e.target.value)} /></FormField>
        <button className="btn secondary" type="submit" disabled={joining}>{joining ? 'Saving…' : 'Join a space'}</button>
      </form>
      <p><small>Invitation tokens are long, single-use tokens in Phase 1A. A short-code option is still undecided (R4).</small></p>
    </div>
  );
}

export function SpacePage({ me, onSpaceChange }: { me: Me; onSpaceChange: () => Promise<void> }) {
  void me;
  return (
    <Page title="Your space" subtitle="One space, two people. An invitation token is shown once — share it directly with your partner, and it cannot be reused after they join." backHome>
      <SpaceForms onSpaceChange={onSpaceChange} />
    </Page>
  );
}

export function WelcomePage({ me, space, onSpaceChange }: { me: Me; space: Space | null; onSpaceChange: () => Promise<void> }) {
  const navigate = useNavigate();
  const [prefs, setPrefs] = useState<Preferences | null>(null);
  const [loadingPrefs, setLoadingPrefs] = useState(true);
  const [finishError, setFinishError] = useState<string | null>(null);
  const [finishing, setFinishing] = useState(false);
  useEffect(() => {
    let cancelled = false;
    getPreferences()
      .then((data) => { if (!cancelled) setPrefs({ ...DEFAULT_PREFERENCES, ...data }); })
      .catch(() => { if (!cancelled) setPrefs(null); })
      .finally(() => { if (!cancelled) setLoadingPrefs(false); });
    return () => { cancelled = true; };
  }, []);
  // Returning users skip onboarding: a seen flag sends them home.
  if (!loadingPrefs && prefs?.onboardingSeen) return <Navigate to="/" replace />;
  const takeMeHome = async () => {
    if (finishing) return;
    setFinishError(null);
    setFinishing(true);
    try {
      const base = prefs ?? DEFAULT_PREFERENCES;
      await savePreferences({ ...base, onboardingSeen: true });
      navigate('/');
    } catch (err) {
      setFinishError(err instanceof Error ? err.message : 'Could not save');
    } finally {
      setFinishing(false);
    }
  };
  return (
    <Page title="Welcome to your little place" subtitle="Three short steps, and then you are home.">
      {loadingPrefs && <LoadingState label="Loading your welcome…" />}
      <section className="paper" style={{ borderRadius: '0.75rem', padding: '1rem', marginBottom: '1rem' }}>
        <h2 style={{ marginTop: 0 }}>1 · Your account is ready</h2>
        <p>You are already signed in as {me.displayName} ({me.email}) — no credentials are asked again here. This place is made for two partner accounts, each registering themselves; nobody else is added for you.</p>
        <p><span role="img" aria-label="Complete">✓</span> Done</p>
      </section>
      <section className="paper" style={{ borderRadius: '0.75rem', padding: '1rem', marginBottom: '1rem' }}>
        <h2 style={{ marginTop: 0 }}>2 · Your space</h2>
        {space ? (
          <p><span role="img" aria-label="Complete">✓</span> Done — you are in the space “{space.name}”.</p>
        ) : (
          <p>Create a space, or join one with an invitation token from your partner.</p>
        )}
        {!space && <SpaceForms onSpaceChange={onSpaceChange} />}
      </section>
      <section className="paper" style={{ borderRadius: '0.75rem', padding: '1rem', marginBottom: '1rem' }}>
        <h2 style={{ marginTop: 0 }}>3 · Welcome — how this place works</h2>
        <p><strong>Shared areas</strong> — memories, published letters, appreciation cards, and future plans. Both partners see these.</p>
        <p><strong>Private areas</strong> — your drafts and journals. Only you see these; your partner cannot see them, count them, or guess their titles.</p>
        <p><strong>Scheduled letters</strong> — sealed until their release date. They open only when that date arrives, judged by the server&apos;s clock.</p>
        <ErrorBox message={finishError} />
        <button className="btn" type="button" onClick={() => void takeMeHome()} disabled={finishing}>{finishing ? 'Saving…' : 'Take me Home'}</button>
      </section>
    </Page>
  );
}

function PreferencesSection() {
  const navigate = useNavigate();
  const [prefs, setPrefs] = useState<Preferences | null>(null);
  const [revisiting, setRevisiting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const load = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await getPreferences();
      setPrefs({ ...DEFAULT_PREFERENCES, ...data });
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not load preferences');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { void load(); }, []);
  if (loading) return (
    <section className="paper" style={{ borderRadius: '0.75rem', padding: '1rem', marginBottom: '1rem' }}>
      <h3 style={{ marginTop: 0 }}>Preferences</h3>
      <LoadingState label="Loading preferences…" />
    </section>
  );
  if (loadError || !prefs) return (
    <section className="paper" style={{ borderRadius: '0.75rem', padding: '1rem', marginBottom: '1rem' }}>
      <h3 style={{ marginTop: 0 }}>Preferences</h3>
      <ErrorBox message={loadError ?? 'Could not load preferences'} />
      <button className="btn" type="button" onClick={() => void load()}>Try again</button>
    </section>
  );
  const motionOptions: { value: MotionPreference; label: string }[] = [
    { value: 'system', label: 'Follow my device (recommended)' },
    { value: 'reduce', label: 'Reduce motion' },
    { value: 'full', label: 'Full motion' },
  ];
  return (
    <section className="paper" style={{ borderRadius: '0.75rem', padding: '1rem', marginBottom: '1rem' }}>
      <h3 style={{ marginTop: 0 }}>Preferences</h3>
      <ErrorBox message={saveError} />
      {saved && <p className="notice" role="status">Preferences saved.</p>}
      <form onSubmit={async (e) => { e.preventDefault(); if (saving) return; setSaveError(null); setSaved(false); setSaving(true); try { const updated = await savePreferences(prefs); setPrefs({ ...DEFAULT_PREFERENCES, ...updated }); applyMotionPreference(updated.motion); setSaved(true); } catch (err) { setSaveError(err instanceof Error ? err.message : 'Could not save preferences'); } finally { setSaving(false); } }}>
        <fieldset style={{ border: 0, padding: 0, margin: '0 0 1rem' }}>
          <legend style={{ fontWeight: 700, marginBottom: '0.5rem' }}>Motion</legend>
          {motionOptions.map((o) => (
            <label key={o.value} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '0.4rem' }}>
              <input type="radio" name="motion" value={o.value} checked={prefs.motion === o.value} onChange={() => setPrefs({ ...prefs, motion: o.value })} />
              {o.label}
            </label>
          ))}
        </fieldset>
        <label style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '1rem' }}>
          <input type="checkbox" checked={prefs.soundEnabled} onChange={(e) => setPrefs({ ...prefs, soundEnabled: e.target.checked })} />
          Arcade sound
        </label>
        <p><small>This is the same preference the arcade uses: turning it on here turns the Secret Arcade sound on, and vice versa. Sound stays off unless you turn it on.</small></p>
        <p><small>Preferences are saved to your account and follow you to another device.</small></p>
        <button className="btn" type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save preferences'}</button>
      </form>
      <p style={{ marginTop: '1rem' }}>
        <button
          className="btn quiet"
          type="button"
          disabled={revisiting}
          onClick={async () => {
            if (revisiting) return;
            setRevisiting(true);
            setSaveError(null);
            try {
              const updated = await savePreferences({ ...prefs, onboardingSeen: false });
              setPrefs({ ...DEFAULT_PREFERENCES, ...updated });
              navigate('/welcome');
            } catch (err) {
              setSaveError(err instanceof Error ? err.message : 'Could not save preferences');
            } finally {
              setRevisiting(false);
            }
          }}
        >
          {revisiting ? 'Opening…' : 'Revisit the welcome'}
        </button>{' '}
        <small>Shows the three-step welcome again. Returning visits still skip it by default afterwards.</small>
      </p>
    </section>
  );
}

function ExportSection({ space }: { space: Space }) {
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [downloaded, setDownloaded] = useState(false);
  const download = async () => {
    if (downloading) return;
    setError(null);
    setDownloaded(false);
    setDownloading(true);
    try {
      const raw = await api<Record<string, unknown>>(`/spaces/${space.id}/export`, { raw: true });
      const data = (raw as { data?: unknown }).data ?? raw;
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `little-place-export-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setDownloaded(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not download the export');
    } finally {
      setDownloading(false);
    }
  };
  return (
    <section className="paper" style={{ borderRadius: '0.75rem', padding: '1rem', marginBottom: '1rem' }}>
      <h3 style={{ marginTop: 0 }}>Export / back up</h3>
      <ErrorBox message={error} />
      {downloaded && <p className="notice" role="status">Export downloaded.</p>}
      <p>This export contains shared records only. Private drafts and private journals are never included, and scheduled letters appear only after their release date.</p>
      <button className="btn" type="button" onClick={() => void download()} disabled={downloading}>{downloading ? 'Preparing…' : 'Download export'}</button>
      {error && <>{' '}<button className="btn quiet" type="button" onClick={() => void download()} disabled={downloading}>Try again</button></>}
    </section>
  );
}

// Avatar presets: exactly the avatarKey values PATCH /auth/me
// already accepts. The badge renders the chosen animal emoji, so a
// picker choice is always visible — here and in the members list
// below — never a value that changes nothing on screen.
const AVATAR_OPTIONS = [
  { key: 'bunny', label: 'Bunny', emoji: '🐰' },
  { key: 'fox', label: 'Fox', emoji: '🦊' },
  { key: 'owl', label: 'Owl', emoji: '🦉' },
  { key: 'bear', label: 'Bear', emoji: '🐻' },
  { key: 'cat', label: 'Cat', emoji: '🐱' },
  { key: 'dog', label: 'Dog', emoji: '🐶' },
] as const;

function AvatarBadge({ avatarKey, displayName }: { avatarKey: string; displayName: string }) {
  const option = AVATAR_OPTIONS.find((o) => o.key === avatarKey) ?? AVATAR_OPTIONS[0]!;
  return (
    <span
      role="img"
      aria-label={`${displayName}'s avatar: ${option.label}`}
      title={`${displayName} — ${option.label}`}
      style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '2rem', height: '2rem', borderRadius: '50%', border: '1px solid #d9cbb2', background: '#fffdf6', fontSize: '1.1rem', flexShrink: 0 }}
    >
      {option.emoji}
    </span>
  );
}

export function SettingsPage({ me, space, onSignedOut, onSpaceChange }: { me: Me; space: Space | null; onSignedOut: () => void; onSpaceChange?: () => Promise<void> }) {
  const navigate = useNavigate();
  const [displayName, setDisplayName] = useState(me.displayName);
  const [avatarKey, setAvatarKey] = useState(me.avatarKey);
  const [spaceName, setSpaceName] = useState(space?.name ?? '');
  const [newPassword, setNewPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [inviteToken, setInviteToken] = useState<string | null>(null);
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingSpaceName, setSavingSpaceName] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);
  const isOwner = space?.members.find((m) => m.id === me.id)?.role === 'owner';
  return (
    <Page title="Settings" subtitle="Your profile, your sessions, and your space's invitations." backHome>
      <ErrorBox message={error} />
      {notice && <p className="notice">{notice}</p>}
      <form onSubmit={async (e) => { e.preventDefault(); if (savingProfile) return; setSavingProfile(true); try { await api('/auth/me', { method: 'PATCH', body: { displayName, avatarKey } }); setNotice('Profile saved.'); } catch (err) { setError(err instanceof Error ? err.message : 'Could not save'); } finally { setSavingProfile(false); } }} className="paper" style={{ borderRadius: '0.75rem', padding: '1rem', marginBottom: '1rem' }}>
        <FormField label="Display name"><input type="text" className="field" value={displayName} onChange={(e) => setDisplayName(e.target.value)} /></FormField>
        <fieldset style={{ border: 0, padding: 0, margin: '0 0 1rem' }}>
          <legend style={{ fontWeight: 700, marginBottom: '0.5rem' }}>Avatar</legend>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
            {AVATAR_OPTIONS.map((o) => (
              <label key={o.key} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', border: avatarKey === o.key ? '2px solid #7d8b6a' : '1px solid #d9cbb2', borderRadius: '999px', padding: '0.3rem 0.7rem', cursor: 'pointer' }}>
                <input type="radio" name="avatar" value={o.key} checked={avatarKey === o.key} onChange={() => setAvatarKey(o.key)} style={{ position: 'absolute', opacity: 0, width: 1, height: 1 }} />
                <span role="img" aria-label={o.label}>{o.emoji}</span> {o.label}
              </label>
            ))}
          </div>
          <p><small>Your avatar shows beside your name in the members list below.</small></p>
        </fieldset>
        <button className="btn" type="submit" disabled={savingProfile}>{savingProfile ? 'Saving…' : 'Save profile'}</button>
      </form>
      {space && (
        <form onSubmit={async (e) => { e.preventDefault(); if (savingSpaceName || !spaceName.trim()) return; setSavingSpaceName(true); try { await api(`/spaces/${space.id}`, { method: 'PATCH', body: { name: spaceName.trim() } }); setNotice('Space renamed.'); await onSpaceChange?.(); } catch (err) { setError(err instanceof Error ? err.message : 'Could not rename the space'); } finally { setSavingSpaceName(false); } }} className="paper" style={{ borderRadius: '0.75rem', padding: '1rem', marginBottom: '1rem' }}>
          <FormField label="Space name"><input type="text" className="field" value={spaceName} onChange={(e) => setSpaceName(e.target.value)} /></FormField>
          <p><small>Either partner may rename the space.</small></p>
          <button className="btn" type="submit" disabled={savingSpaceName || !spaceName.trim()}>{savingSpaceName ? 'Saving…' : 'Rename space'}</button>
        </form>
      )}
      {space && (
        <section className="paper" style={{ borderRadius: '0.75rem', padding: '1rem', marginBottom: '1rem' }}>
          <h3 style={{ marginTop: 0 }}>Space members</h3>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: '0.5rem' }}>
            {space.members.map((m) => (
              <li key={m.id} style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                <AvatarBadge avatarKey={m.id === me.id ? avatarKey : m.avatarKey} displayName={m.displayName} />
                <span>{m.displayName}{m.id === me.id ? ' (you)' : ''} · {m.role}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      <form onSubmit={async (e) => { e.preventDefault(); if (changingPassword) return; setChangingPassword(true); try { const data = await api<{ csrfToken: string }>('/auth/password-change', { method: 'POST', body: { password: newPassword } }); setCsrf(data.csrfToken); setNotice('Password changed. Other sessions were signed out.'); setNewPassword(''); } catch (err) { setError(err instanceof Error ? err.message : 'Could not change password'); } finally { setChangingPassword(false); } }} className="paper" style={{ borderRadius: '0.75rem', padding: '1rem', marginBottom: '1rem' }}>
        <FormField label="New password (at least 10 characters)"><input className="field" type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} /></FormField>
        <button className="btn" type="submit" disabled={changingPassword}>{changingPassword ? 'Saving…' : 'Change password'}</button>
      </form>
      <PreferencesSection />
      {space && <ExportSection space={space} />}
      {space && isOwner && (
        <div className="paper" style={{ borderRadius: '0.75rem', padding: '1rem', marginBottom: '1rem' }}>
          <h3 style={{ marginTop: 0 }}>Invitations</h3>
          <button className="btn secondary" onClick={async () => { try { const data = await api<{ token: string }>(`/spaces/${space.id}/invitations`, { method: 'POST', body: {} }); setInviteToken(data.token); } catch (err) { setError(err instanceof Error ? err.message : 'Could not create an invitation'); } }}>Create invitation</button>{' '}
          <button className="btn quiet" onClick={async () => { try { const data = await api<{ token: string }>(`/spaces/${space.id}/invitations/rotate`, { method: 'POST', body: {} }); setInviteToken(data.token); } catch (err) { setError(err instanceof Error ? err.message : 'Could not rotate'); } }}>Rotate invitation</button>
          {inviteToken && <p>Invitation token (shown once — copy it now, then share it directly with your partner):<br /><code style={{ wordBreak: 'break-all' }}>{inviteToken}</code></p>}
        </div>
      )}
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
        <button className="btn quiet" onClick={async () => { await api('/auth/logout', { method: 'POST', body: {} }); onSignedOut(); navigate('/login'); }}>Sign out</button>
        <button className="btn quiet" onClick={async () => { await api('/auth/logout-all', { method: 'POST', body: {} }); onSignedOut(); navigate('/login'); }}>Sign out everywhere</button>
        <Link to="/deleted">Deleted items →</Link>
      </div>
    </Page>
  );
}

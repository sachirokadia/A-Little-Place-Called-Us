import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, getSpace, listItems, setCsrf, type AnyItem, type Me, type Space } from '../lib/api.js';
import { Card, EmptyState, ErrorBox, ErrorState, FormField, LoadingState, Page, fmtDate } from '../components/ui.js';
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
    for (const key of ['title', 'caption', 'story', 'body', 'text', 'detail', 'forName', 'mood', 'location']) {
      if (typeof item[key] === 'string') out[key] = item[key] as string;
    }
    return out;
  });
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await api(`/${singular}/${item.id}`, { method: 'PATCH', body: values });
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save');
    }
  };
  return (
    <form onSubmit={submit}>
      <ErrorBox message={error} />
      {Object.entries(values).map(([key, value]) => (
        <FormField key={key} label={key}>
          {key === 'body' || key === 'story' || key === 'detail' || key === 'text' ? (
            <textarea className="field" rows={4} value={value} onChange={(e) => setValues({ ...values, [key]: e.target.value })} />
          ) : (
            <input className="field" value={value} onChange={(e) => setValues({ ...values, [key]: e.target.value })} />
          )}
        </FormField>
      ))}
      <button className="btn" type="submit">Save</button>{' '}
      <button className="btn quiet" type="button" onClick={onCancel}>Cancel</button>
    </form>
  );
}

function ItemCard({ item, singular, me, onRefresh, extra }: { item: AnyItem; singular: string; me: Me; onRefresh: () => void; extra?: React.ReactNode }) {
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isAuthor = item.authorId === me.id;
  const title = (item.title as string) ?? (item.text as string) ?? '';
  if (editing) return <Card><EditForm item={item} singular={singular} onDone={() => { setEditing(false); onRefresh(); }} onCancel={() => setEditing(false)} /></Card>;
  return (
    <Card>
      <ErrorBox message={error} />
      <h3 style={{ marginTop: 0 }}>{title}</h3>
      {item.caption ? <p>{item.caption as string}</p> : null}
      {item.story ? <p>{item.story as string}</p> : null}
      {item.body ? <p style={{ whiteSpace: 'pre-wrap' }}>{item.body as string}</p> : null}
      {item.text && !item.title ? <p>{item.text as string}</p> : null}
      {item.detail ? <p>{item.detail as string}</p> : null}
      {item.happenedOn ? <p><small>Date: {fmtDate(item.happenedOn)}</small></p> : null}
      {item.targetDate ? <p><small>Planned for: {fmtDate(item.targetDate)}</small></p> : null}
      {item.visibility === 'scheduled' && item.revealAt ? <p><small>Sealed until {(item.revealAt as string).replace('T', ' ').slice(0, 16)}</small></p> : null}
      {item.status ? <p><small>Status: {item.status as string}</small></p> : null}
      {extra}
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: '0.5rem' }}>
        {isAuthor && <button className="btn quiet" onClick={() => setEditing(true)}>Edit</button>}
        {isAuthor && <button className="btn quiet" onClick={async () => { setError(null); try { await softDelete(singular, item.id); onRefresh(); } catch (e) { setError(e instanceof Error ? e.message : 'Could not delete'); } }}>Move to Deleted</button>}
        <button className="btn quiet" onClick={async () => { try { await favourite(singular, item.id); onRefresh(); } catch { /* favourite is optional */ } }}>♥ Favourite</button>
      </div>
    </Card>
  );
}

function CreateForm({ fields, onCreate, submitLabel = 'Add' }: { fields: { name: string; label: string; kind?: 'text' | 'textarea' | 'date' | 'select'; options?: string[] }[]; onCreate: (values: Record<string, string>) => Promise<void>; submitLabel?: string }) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await onCreate(values);
      setValues({});
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save');
    }
  };
  return (
    <form onSubmit={submit} className="paper" style={{ borderRadius: '0.75rem', padding: '1rem', marginBottom: '1.5rem' }}>
      <ErrorBox message={error} />
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
            <input className="field" type={f.kind === 'date' ? 'date' : 'text'} value={values[f.name] ?? ''} onChange={(e) => setValues({ ...values, [f.name]: e.target.value })} />
          )}
        </FormField>
      ))}
      <button className="btn" type="submit">{submitLabel}</button>
    </form>
  );
}

export function ListPage({ me, space, plural, singular, title, subtitle, createFields, onCreate, extraForItem, favouritedOnly = false, layout, groupBy, sortByTargetDate = false, pageClassName }: {
  me: Me; space: Space; plural: string; singular: string; title: string; subtitle: string;
  createFields: { name: string; label: string; kind?: 'text' | 'textarea' | 'date' | 'select'; options?: string[] }[];
  onCreate: (spaceId: string, values: Record<string, string>) => Promise<void>;
  extraForItem?: (item: AnyItem, refresh: () => void) => React.ReactNode;
  favouritedOnly?: boolean;
  layout?: string;
  groupBy?: 'date-year' | 'letter-state';
  sortByTargetDate?: boolean;
  pageClassName?: string;
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
    const card = <ItemCard key={item.id} item={item} singular={singular} me={me} onRefresh={refresh} extra={extraForItem ? extraForItem(item, refresh) : undefined} />;
    if (layout !== 'post-office') return card;
    const now = new Date().toISOString();
    const isSealed = item.visibility === 'scheduled' && item.revealAt && (item.revealAt as string) > now;
    const isPrivate = item.visibility === 'private_draft';
    const cls = isSealed ? 'envelope envelope-sealed' : isPrivate ? 'envelope envelope-private' : 'envelope';
    const badge = isSealed ? <span className="seal">Sealed</span> : isPrivate ? <span className="seal seal-private">Private draft — only you can see this</span> : <span className="seal seal-shared">Shared</span>;
    return <div key={item.id} className={cls}>{badge}{card}</div>;
  };
  const pageCls = [pageClassName, layout ? `layout-${layout}` : ''].filter(Boolean).join(' ') || undefined;
  let list: React.ReactNode = <div className="list-grid">{sorted.map(renderItem)}</div>;
  if (groupBy === 'date-year') {
    const groups = new Map<string, AnyItem[]>();
    for (const item of sorted) {
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
      { key: 'sealed', label: 'Sealed letters', note: 'Scheduled letters, still sealed until their release date.', items: sorted.filter((i) => i.visibility === 'scheduled' && i.revealAt && (i.revealAt as string) > now) },
      { key: 'shared', label: 'Shared letters', note: 'Open letters both partners can read.', items: sorted.filter((i) => i.visibility === 'shared' || (i.visibility === 'scheduled' && !(i.revealAt && (i.revealAt as string) > now))) },
      { key: 'private', label: 'Private drafts', note: 'Visible only to their author.', items: sorted.filter((i) => i.visibility === 'private_draft') },
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
      {createFields.length > 0 && <CreateForm fields={createFields} onCreate={async (v) => { await onCreate(space.id, v); await refresh(); }} />}
      {error ? <ErrorState message={error} onRetry={refresh} />
        : loading ? <LoadingState />
        : sorted.length === 0 ? <EmptyState />
        : list}
    </Page>
  );
}

function MediaStrip({ linkedType, linkedId }: { linkedType: string; linkedId: string }) {
  const [assets, setAssets] = useState<AnyItem[]>([]);
  useEffect(() => {
    api<AnyItem[]>(`/media/for/${linkedType}/${linkedId}`).then(setAssets).catch(() => setAssets([]));
  }, [linkedType, linkedId]);
  if (assets.length === 0) return null;
  return (
    <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
      {assets.map((a) => (
        (a.mimeType as string)?.startsWith('image/') ? (
          <img key={a.id} src={`/api/v1/media/${a.id}`} alt="Memory photo" className="polaroid-photo" style={{ maxWidth: 220 }} />
        ) : (
          <audio key={a.id} controls src={`/api/v1/media/${a.id}`} />
        )
      ))}
    </div>
  );
}

function UploadForm({ linkedType, linkedId, onDone }: { linkedType: string; linkedId: string; onDone: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [spaceId, setSpaceId] = useState<string>('');
  useEffect(() => { getSpace().then((s) => setSpaceId(s?.id ?? '')).catch(() => undefined); }, []);
  return (
    <form onSubmit={async (e) => {
      e.preventDefault();
      if (!file || !spaceId) return;
      setError(null);
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
      }
    }}>
      <ErrorBox message={error} />
      <input type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />{' '}
      <button className="btn quiet" type="submit" disabled={!file}>Upload</button>
    </form>
  );
}

export function MemoriesPage({ me, space }: { me: Me; space: Space }) {
  return (
    <ListPage
      me={me} space={space} plural="memories" singular="memory" layout="scrapbook" groupBy="date-year"
      title="Memory Wall" subtitle="A layered scrapbook. Photos are pinned here by both of you; nothing here is sample content."
      createFields={[
        { name: 'title', label: 'Title' },
        { name: 'caption', label: 'Caption', kind: 'textarea' },
        { name: 'story', label: 'Journal entry', kind: 'textarea' },
        { name: 'happenedOn', label: 'Date it happened', kind: 'date' },
      ]}
      onCreate={async (spaceId, v) => { await api(`/spaces/${spaceId}/memories`, { method: 'POST', body: { title: v.title, caption: v.caption ?? '', story: v.story ?? '', happenedOn: v.happenedOn || null } }); }}
      extraForItem={(item, refresh) => (
        <div>
          <MediaStrip linkedType="memory" linkedId={item.id} />
          <UploadForm linkedType="memory" linkedId={item.id} onDone={refresh} />
        </div>
      )}
    />
  );
}

export function LettersPage({ me, space }: { me: Me; space: Space }) {
  return (
    <ListPage
      me={me} space={space} plural="letters" singular="letter" layout="post-office" groupBy="letter-state"
      title="Letters — a little post office" subtitle="Private drafts stay visible only to their author. Scheduled letters stay sealed until their release date, judged by the server's clock, not yours."
      createFields={[
        { name: 'title', label: 'Title' },
        { name: 'body', label: 'Letter', kind: 'textarea' },
        { name: 'visibility', label: 'Kind', kind: 'select', options: ['shared', 'private_draft', 'scheduled'] },
        { name: 'revealAt', label: 'Release date and time (for scheduled letters)' },
        { name: 'memoryId', label: 'Link to a memory (optional — paste a memory id)', kind: 'text' },
      ]}
      onCreate={async (spaceId, v) => {
        await api(`/spaces/${spaceId}/letters`, {
          method: 'POST',
          body: {
            title: v.title, body: v.body, visibility: v.visibility || 'shared',
            revealAt: v.revealAt ? new Date(v.revealAt).toISOString() : null,
            memoryId: v.memoryId || null,
          },
        });
      }}
    />
  );
}

export function QuietPage({ me, space }: { me: Me; space: Space }) {
  const { items, error, loading, refresh } = useList(space.id, 'journals');
  const [breathingOn, setBreathingOn] = useState(true);
  return (
    <Page title="Quiet Room" subtitle="A calm corner. Journals here are private to their author — your partner cannot see them, count them, or guess their titles. No streaks, no scores, no pressure." backHome className="layout-quiet">
      <div className="breathing-wrap">
        {breathingOn && <div className="breathing-circle" aria-hidden="true" />}
        <p>Breathe in, breathe out. There is no timer here and nothing to complete — stop whenever you like.</p>
        <button className="btn quiet" type="button" onClick={() => setBreathingOn(!breathingOn)} aria-pressed={breathingOn}>
          {breathingOn ? 'Pause the breathing animation' : 'Show the breathing animation'}
        </button>
      </div>
      <CreateForm fields={[
        { name: 'title', label: 'Title' },
        { name: 'body', label: 'Journal entry', kind: 'textarea' },
        { name: 'mood', label: 'Mood (optional)' },
      ]} onCreate={async (v) => { await api(`/spaces/${space.id}/journals`, { method: 'POST', body: v }); await refresh(); }} />
      {error ? <ErrorState message={error} onRetry={refresh} />
        : loading ? <LoadingState />
        : items.length === 0 ? <EmptyState title="No journal entries yet" />
        : <div className="list-grid">{items.map((item) => <ItemCard key={item.id} item={item} singular="journal" me={me} onRefresh={refresh} />)}</div>}
      <section style={{ marginTop: '3rem' }}>
        <h2>Voice notes</h2>
        <p>Saved comforting voice notes. Upload an audio file to a voice note you create below.</p>
        <VoiceNotes space={space} />
      </section>
    </Page>
  );
}

function VoiceNotes({ space }: { space: Space }) {
  const { items, error, loading, refresh } = useList(space.id, 'voice-notes');
  const [title, setTitle] = useState('');
  return (
    <div>
      <form onSubmit={async (e) => { e.preventDefault(); if (!title) return; await api(`/spaces/${space.id}/voice-notes`, { method: 'POST', body: { title } }); setTitle(''); await refresh(); }} className="paper" style={{ borderRadius: '0.75rem', padding: '1rem', marginBottom: '1rem' }}>
        <FormField label="Voice note title"><input className="field" value={title} onChange={(e) => setTitle(e.target.value)} /></FormField>
        <button className="btn" type="submit">Add voice note</button>
      </form>
      {error ? <ErrorState message={error} onRetry={refresh} />
        : loading ? <LoadingState />
        : items.length === 0 ? <EmptyState title="No voice notes yet" />
        : <div style={{ display: 'grid', gap: '1rem' }}>
          {items.map((item) => (
            <Card key={item.id}>
              <h3 style={{ marginTop: 0 }}>{item.title as string}</h3>
              <MediaStrip linkedType="voiceNote" linkedId={item.id} />
              <UploadForm linkedType="voiceNote" linkedId={item.id} onDone={refresh} />
            </Card>
          ))}
        </div>}
    </div>
  );
}

export function AppreciationsPage({ me, space }: { me: Me; space: Space }) {
  const [random, setRandom] = useState<AnyItem | null>(null);
  return (
    <div>
      <ListPage
        me={me} space={space} plural="appreciations" singular="appreciation" layout="gallery"
        title="Things I See in You" subtitle="A gallery of little things — appreciations and moments of courage. Nothing here is scored or ranked."
        createFields={[
          { name: 'text', label: 'Note', kind: 'textarea' },
          { name: 'kind', label: 'Kind', kind: 'select', options: ['appreciation', 'achievement'] },
          { name: 'forName', label: 'For (name)' },
        ]}
        onCreate={async (spaceId, v) => { await api(`/spaces/${spaceId}/appreciations`, { method: 'POST', body: v }); }}
      />
      <div style={{ maxWidth: 860, margin: '0 auto', padding: '0 1rem 4rem' }}>
        <button className="btn secondary" onClick={async () => { const r = await api<AnyItem | null>(`/spaces/${space.id}/appreciations/random`); setRandom(r); }}>Show me a random card</button>
        {random && <div style={{ marginTop: '1rem' }}><Card><p>{random.text as string}</p><p><small>For {random.forName as string}</small></p></Card></div>}
        <p><Link to="/appreciations/favourites">Revisit favourite cards →</Link></p>
      </div>
    </div>
  );
}

export function FavouritesPage({ me, space }: { me: Me; space: Space }) {
  return (
    <ListPage
      me={me} space={space} plural="appreciations" singular="appreciation" layout="gallery"
      title="Favourite cards" subtitle="Cards you marked as favourites."
      createFields={[]}
      onCreate={async () => undefined}
      favouritedOnly
    />
  );
}

export function FuturePage({ me, space }: { me: Me; space: Space }) {
  return (
    <ListPage
      me={me} space={space} plural="plans" singular="plan" layout="journey" sortByTargetDate
      title="Our Future — an adventure map" subtitle="Plans are drawn as journeys, not checklists. Completing one can create a scrapbook memory in the same step, so it is never duplicated."
      createFields={[
        { name: 'title', label: 'Title' },
        { name: 'detail', label: 'Notes', kind: 'textarea' },
        { name: 'category', label: 'Category', kind: 'select', options: ['trip', 'date', 'meal', 'activity', 'home', 'other'] },
        { name: 'targetDate', label: 'Target date', kind: 'date' },
        { name: 'location', label: 'Location (optional)' },
      ]}
      onCreate={async (spaceId, v) => { await api(`/spaces/${spaceId}/plans`, { method: 'POST', body: { title: v.title, detail: v.detail ?? '', category: v.category || 'other', targetDate: v.targetDate || null, location: v.location ?? '' } }); }}
      extraForItem={(item, refresh) => (
        <>
            <p><span className="journey-category">{(item.category as string) ?? 'other'}</span>{item.location ? <span> · {item.location as string}</span> : null}</p>
            {item.status === 'planned' ? (
          <form onSubmit={async (e) => { e.preventDefault(); const form = e.target as HTMLFormElement; const createMemory = (form.elements.namedItem('createMemory') as HTMLInputElement).checked; await api(`/plan/${item.id}/complete`, { method: 'POST', body: { createMemory, memoryTitle: item.title as string } }); refresh(); }}>
            <label><input type="checkbox" name="createMemory" defaultChecked /> Also create a Memory Wall keepsake</label>{' '}
            <button className="btn secondary" type="submit">Mark complete ✓</button>
          </form>
        ) : <p><span className="completed-stamp">Completed</span></p>}
          </>
      )}
    />
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
  const [doorOpen, setDoorOpen] = useState(false);
  const destinations = [
    { to: '/memories', label: 'Memory Wall', note: 'Our scrapbook' },
    { to: '/letters', label: 'Letters', note: 'A little post office' },
    { to: '/quiet', label: 'Quiet Room', note: 'A safe little corner' },
    { to: '/appreciations', label: 'Things I See in You', note: 'A gallery of little things' },
    { to: '/future', label: 'Our Future', note: 'An adventure map' },
    { to: '/arcade', label: 'Secret Arcade', note: 'Playful universe — games arrive in Phase 1B' },
  ];
  // Real garden data: one flower per saved shared memory, capped for
  // display, with the true count always stated in words. When the
  // space has no memories, no flowers are faked.
  const { items: memories } = useList(space ? space.id : null, 'memories');
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
        <div className={styles.hotspots}>
          <button className={styles.mailbox} type="button" onClick={() => navigate('/letters')} aria-label="Mailbox — open Letters">✉ Mailbox — Letters</button>
          <button className={styles.comeIn} type="button" onClick={() => setDoorOpen(true)} aria-label="Come on in — open the room-selection panel">Come on in.</button>
          <button className={styles.garden} type="button" onClick={() => navigate('/memories')} aria-label="Garden — open Memory Wall">❦ Garden — Memory Wall</button>
        </div>
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
      )}
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
      <p style={{ textAlign: 'center', marginTop: '2rem', color: '#6b5646' }}>This little world grows when we both add to it.</p>
    </div>
  );
}

function RemindersSection({ space }: { space: Space }) {
  const { items, refresh } = useList(space.id, 'reminders');
  const [text, setText] = useState('');
  const [random, setRandom] = useState<AnyItem | null>(null);
  return (
    <div style={{ marginTop: '2rem' }}>
      <h2>Little reminders</h2>
      <form onSubmit={async (e) => { e.preventDefault(); if (!text) return; await api(`/spaces/${space.id}/reminders`, { method: 'POST', body: { text, kind: 'note' } }); setText(''); await refresh(); }} className="paper" style={{ borderRadius: '0.75rem', padding: '1rem', marginBottom: '1rem' }}>
        <FormField label="A note for both of you"><input className="field" value={text} onChange={(e) => setText(e.target.value)} /></FormField>
        <button className="btn" type="submit">Leave a reminder</button>{' '}
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

export function ArcadePage() {
  return (
    <Page title="Secret Arcade" subtitle="Our playful universe." backHome>
      <div className="arcade-note">
        <p style={{ marginTop: 0 }}>Games arrive in Phase 1B. This page is intentionally not a set of game buttons — there are no games to play here yet, and nothing here pretends otherwise.</p>
        <p style={{ marginBottom: 0 }}>When Phase 1B lands, it will bring a personalised detective mystery, a relationship board game, memory-match, and “how well do you know us?” quizzes — with game scores that never gate letters, memories, or support.</p>
      </div>
    </Page>
  );
}

export function AuthPage({ mode, onSignedIn }: { mode: 'login' | 'register'; onSignedIn: () => void }) {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const data = await api<{ csrfToken: string }>(`/auth/${mode}`, {
        method: 'POST',
        body: mode === 'register' ? { email, password, displayName } : { email, password },
      });
      // The API returns a fresh session-bound CSRF token on login/register.
      setCsrf(data.csrfToken);
      onSignedIn();
      navigate('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not sign in');
    }
  };
  return (
    <Page title={mode === 'login' ? 'Welcome back' : 'Create your account'} subtitle="Each partner has their own account. A space holds exactly two people.">
      <ErrorBox message={error} />
      <form onSubmit={submit} className="paper" style={{ borderRadius: '0.75rem', padding: '1rem', maxWidth: 480 }}>
        <FormField label="Email"><input className="field" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></FormField>
        {mode === 'register' && <FormField label="Display name"><input className="field" value={displayName} onChange={(e) => setDisplayName(e.target.value)} required /></FormField>}
        <FormField label="Password (at least 10 characters)"><input className="field" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required /></FormField>
        <button className="btn" type="submit">{mode === 'login' ? 'Sign in' : 'Create account'}</button>
      </form>
      <p>{mode === 'login' ? <>New here? <Link to="/register">Create an account</Link></> : <>Already have an account? <Link to="/login">Sign in</Link></>}</p>
      <p><small>Password reset by email is not available yet — no email provider has been chosen (R3). If you lose your password, this build has no recovery path yet; that is a known Phase 1A limitation, not a hidden one.</small></p>
    </Page>
  );
}

export function SpacePage({ me, onSpaceChange }: { me: Me; onSpaceChange: () => void }) {
  const [name, setName] = useState('A Little Place Called Us');
  const [token, setToken] = useState('');
  const [inviteToken, setInviteToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const navigate = useNavigate();
  return (
    <Page title="Your space" subtitle="One space, two people. An invitation token is shown once — share it directly with your partner, and it cannot be reused after they join." backHome>
      <ErrorBox message={error} />
      {notice && <p className="notice">{notice}</p>}
      <form onSubmit={async (e) => { e.preventDefault(); setError(null); try { await api('/spaces', { method: 'POST', body: { name } }); setNotice('Space created.'); onSpaceChange(); navigate('/'); } catch (err) { setError(err instanceof Error ? err.message : 'Could not create a space'); } }} className="paper" style={{ borderRadius: '0.75rem', padding: '1rem', marginBottom: '1rem' }}>
        <FormField label="Space name"><input className="field" value={name} onChange={(e) => setName(e.target.value)} /></FormField>
        <button className="btn" type="submit">Create a space</button>
      </form>
      <form onSubmit={async (e) => { e.preventDefault(); setError(null); try { await api('/spaces/invitations/join', { method: 'POST', body: { token } }); setNotice('Joined!'); onSpaceChange(); navigate('/'); } catch (err) { setError(err instanceof Error ? err.message : 'Could not join'); } }} className="paper" style={{ borderRadius: '0.75rem', padding: '1rem' }}>
        <FormField label="Invitation token"><input className="field" value={token} onChange={(e) => setToken(e.target.value)} /></FormField>
        <button className="btn secondary" type="submit">Join a space</button>
      </form>
      <p><small>Invitation tokens are long, single-use tokens in Phase 1A. A short-code option is still undecided (R4).</small></p>
    </Page>
  );
}

export function SettingsPage({ me, space, onSignedOut }: { me: Me; space: Space | null; onSignedOut: () => void }) {
  const navigate = useNavigate();
  const [displayName, setDisplayName] = useState(me.displayName);
  const [newPassword, setNewPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [inviteToken, setInviteToken] = useState<string | null>(null);
  const isOwner = space?.members.find((m) => m.id === me.id)?.role === 'owner';
  return (
    <Page title="Settings" subtitle="Your profile, your sessions, and your space's invitations." backHome>
      <ErrorBox message={error} />
      {notice && <p className="notice">{notice}</p>}
      <form onSubmit={async (e) => { e.preventDefault(); try { await api('/auth/me', { method: 'PATCH', body: { displayName } }); setNotice('Profile saved.'); } catch (err) { setError(err instanceof Error ? err.message : 'Could not save'); } }} className="paper" style={{ borderRadius: '0.75rem', padding: '1rem', marginBottom: '1rem' }}>
        <FormField label="Display name"><input className="field" value={displayName} onChange={(e) => setDisplayName(e.target.value)} /></FormField>
        <button className="btn" type="submit">Save profile</button>
      </form>
      <form onSubmit={async (e) => { e.preventDefault(); try { const data = await api<{ csrfToken: string }>('/auth/password-change', { method: 'POST', body: { password: newPassword } }); setCsrf(data.csrfToken); setNotice('Password changed. Other sessions were signed out.'); setNewPassword(''); } catch (err) { setError(err instanceof Error ? err.message : 'Could not change password'); } }} className="paper" style={{ borderRadius: '0.75rem', padding: '1rem', marginBottom: '1rem' }}>
        <FormField label="New password (at least 10 characters)"><input className="field" type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} /></FormField>
        <button className="btn" type="submit">Change password</button>
      </form>
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

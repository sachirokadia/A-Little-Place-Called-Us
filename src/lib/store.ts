import type {
  Appreciation, CollectionName, FuturePlan, JournalEntry, Letter, Memory,
  NewItem, PlaceData, Profile, Reminder, Space, VoiceNoteMeta,
} from './types';
import { fileToDataUrl, makeInviteCode, nowIso, todayIsoDate, uid } from './utils';
import { supabase, supabaseConfigured } from './supabase';
import { API_URL, apiConfigured, apiFetch } from './api';

export type AnyItem =
  | Reminder | Memory | Letter | JournalEntry | Appreciation | FuturePlan | VoiceNoteMeta;

const DEMO_KEY = 'our-place-demo-v1';

export const DEMO_PROFILES: Profile[] = [
  { id: 'demo-you', displayName: 'You', shortName: 'You' },
  { id: 'demo-partner', displayName: 'Partner', shortName: 'Partner' },
];

function seed(): PlaceData {
  const now = nowIso();
  const base = { spaceId: 'demo-space', createdAt: now, updatedAt: now, deletedAt: null, isFavorite: false };
  return {
    space: { id: 'demo-space', name: 'A Little Place Called Us', inviteCode: makeInviteCode(), createdAt: now },
    members: DEMO_PROFILES,
    reminders: [
      { ...base, id: uid(), authorId: 'demo-partner', authorName: 'Partner', kind: 'note', text: 'You handled today with more grace than you give yourself credit for.', isFavorite: true },
      { ...base, id: uid(), authorId: 'demo-you', authorName: 'You', kind: 'note', text: 'Take your time. There is nowhere else you need to be right now.' },
      { ...base, id: uid(), authorId: 'demo-partner', authorName: 'Partner', kind: 'prompt', text: 'Drink some water, stretch, and look out of the window for a minute.' },
    ],
    memories: [
      { ...base, id: uid(), authorId: 'demo-you', authorName: 'You', title: 'The walk home', caption: 'Rain, shared umbrella, nowhere to rush to.', story: 'Sample memory — replace this with one of yours. Add a photo, a date, and the small detail you do not want to forget.', happenedOn: todayIsoDate(), mediaUrl: null, mediaPath: null, mediaType: 'none', isFavorite: true },
    ],
    letters: [
      { ...base, id: uid(), authorId: 'demo-partner', authorName: 'Partner', title: 'For a quiet evening', body: 'Sample shared letter — write one in your own words when you are ready. Letters here are yours to keep, not to perform.', visibility: 'shared', revealAt: null },
      { ...base, id: uid(), authorId: 'demo-you', authorName: 'You', title: 'Draft: not finished yet', body: 'Sample private draft. Only you can see this until you choose to share it.', visibility: 'private_draft', revealAt: null },
    ],
    journals: [
      { ...base, id: uid(), authorId: 'demo-you', authorName: 'You', title: 'Sample journal entry (private)', body: 'Sample only — private journals are visible to their owner alone, in demo mode and under Supabase RLS.', mood: 'calm', visibility: 'private' },
    ],
    appreciations: [
      { ...base, id: uid(), authorId: 'demo-you', authorName: 'You', text: 'The way you listen properly, even when you are tired.', kind: 'appreciation', forName: 'Partner', isFavorite: true },
      { ...base, id: uid(), authorId: 'demo-partner', authorName: 'Partner', text: 'You finished the thing you kept putting off. That counts.', kind: 'achievement', forName: 'You' },
    ],
    plans: [
      { ...base, id: uid(), authorId: 'demo-you', authorName: 'You', title: 'Cook a meal together, no phones', detail: 'Pick a recipe neither of you has tried.', category: 'date', status: 'planned', completedAt: null, completionPhotoUrl: null, completionPhotoPath: null },
      { ...base, id: uid(), authorId: 'demo-partner', authorName: 'Partner', title: 'Watch the sunrise somewhere new', detail: 'Bring something warm to drink.', category: 'bucket', status: 'planned', completedAt: null, completionPhotoUrl: null, completionPhotoPath: null },
    ],
    voiceNotes: [],
  };
}

function loadDemo(): PlaceData {
  try {
    const raw = localStorage.getItem(DEMO_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as PlaceData;
      if (parsed && parsed.space && Array.isArray(parsed.memories)) return parsed;
    }
  } catch { /* fall through to seed */ }
  const s = seed();
  try { localStorage.setItem(DEMO_KEY, JSON.stringify(s)); } catch { /* private mode */ }
  return s;
}

function saveDemo(data: PlaceData) {
  try { localStorage.setItem(DEMO_KEY, JSON.stringify(data)); } catch { /* ignore */ }
}

export function clearDemoData() {
  try { localStorage.removeItem(DEMO_KEY); } catch { /* ignore */ }
}

/**
 * The data layer behind the whole app.
 * - Demo mode (no Supabase env vars): localStorage, two switchable profiles, same privacy rules applied in code.
 * - Supabase mode: the same methods run against Postgres + Storage, where RLS is the real enforcement.
 *   Demo-mode checks are a UX mirror, never a substitute for RLS.
 */
export class PlaceStore {
  mode: 'demo' | 'supabase' | 'api';
  version = 0;
  viewerId: string;
  viewerName: string;
  data: PlaceData;

  constructor(viewerId: string, viewerName: string) {
    this.mode = apiConfigured ? 'api' : supabaseConfigured ? 'supabase' : 'demo';
    this.viewerId = viewerId;
    this.viewerName = viewerName;
    this.data = loadDemo();
  }

  /** Demo-only: which profile is "signed in". Supabase mode uses the real auth session. */
  setViewer(id: string, name: string) {
    this.viewerId = id;
    this.viewerName = name;
    this.version++; // viewer change must recompute every memoised, privacy-filtered list
  }

  // ---------- shared views (privacy applied here, and again in SQL for Supabase) ----------
  visibleLetters(): Letter[] {
    return this.data.letters
      .filter((l) => !l.deletedAt)
      .filter((l) => {
        if (l.visibility === 'private_draft') return l.authorId === this.viewerId;
        return true; // shared + scheduled are space-visible; body is sealed separately
      });
  }

  visibleJournals(): JournalEntry[] {
    // Private journals: owner only. This filter is duplicated by RLS (author_id = auth.uid()).
    return this.data.journals.filter((j) => !j.deletedAt && j.authorId === this.viewerId);
  }

  shared<T extends { deletedAt: string | null }>(items: T[]): T[] {
    return items.filter((i) => !i.deletedAt);
  }

  deletedItems(): { collection: CollectionName; item: AnyItem }[] {
    const out: { collection: CollectionName; item: AnyItem }[] = [];
    const push = (collection: CollectionName, items: AnyItem[]) => {
      items.filter((i) => i.deletedAt).forEach((item) => out.push({ collection, item }));
    };
    push('reminders', this.data.reminders); push('memories', this.data.memories);
    push('letters', this.data.letters); push('journals', this.data.journals);
    push('appreciations', this.data.appreciations); push('plans', this.data.plans);
    push('voiceNotes', this.data.voiceNotes);
    return out.sort((a, b) => (b.item.deletedAt || '').localeCompare(a.item.deletedAt || ''));
  }

  // ---------- mutations (demo path persists locally; Supabase path below) ----------
  async create<T extends AnyItem>(collection: CollectionName, input: Record<string, unknown>): Promise<T> {
    const now = nowIso();
    const item = {
      ...input, id: uid(), createdAt: now, updatedAt: now, deletedAt: null,
      isFavorite: (input as { isFavorite?: boolean }).isFavorite ?? false,
    } as unknown as T;
    if (this.mode === 'supabase' && supabase) {
      // Never let a stale/demo viewer id reach the database: author identity
      // always comes from the live auth session in Supabase mode.
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Sign in first.');
      this.viewerId = user.id;
      (item as AnyItem).authorId = user.id;
      (item as AnyItem).spaceId = this.data.space.id;
      await this.supabaseInsert(collection, item as AnyItem);
    }
    (this.data[collection] as AnyItem[]).unshift(item as AnyItem);
    this.version++;
    saveDemo(this.data);
    return item;
  }

  async update(collection: CollectionName, id: string, patch: Partial<AnyItem>): Promise<void> {
    const item = (this.data[collection] as AnyItem[]).find((i) => i.id === id);
    if (!item) throw new Error('That item could not be found. It may have been deleted.');
    // Ownership rule for edits: you may edit what you wrote, or shared items in your space.
    // Private journals/drafts of the other person are never editable (and never listed) for you.
    if ((collection === 'journals' || (collection === 'letters' && (item as Letter).visibility === 'private_draft'))
      && item.authorId !== this.viewerId) {
      throw new Error('You can only edit your own private entries.');
    }
    if (this.mode === 'api') {
      const saved = await apiFetch(`/api/items/${collection}/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }) as unknown as AnyItem;
      Object.assign(item, saved);
      this.version++;
      saveDemo(this.data);
      return;
    }
    if (this.mode === 'supabase' && supabase) await this.supabaseUpdate(collection, id, patch);
    Object.assign(item, patch, { updatedAt: nowIso() });
    this.version++;
    saveDemo(this.data);
  }

  /** Soft delete: recoverable from the Deleted room. Permanent deletion is a separate, confirmed step. */
  async softDelete(collection: CollectionName, id: string): Promise<void> {
    await this.update(collection, id, { deletedAt: nowIso() } as Partial<AnyItem>);
  }

  async restore(collection: CollectionName, id: string): Promise<void> {
    if (this.mode === 'api') {
      const saved = await apiFetch(`/api/items/${collection}/${id}/restore`, { method: 'POST' }) as unknown as AnyItem;
      const item = (this.data[collection] as AnyItem[]).find((i) => i.id === id);
      if (item) Object.assign(item, saved);
      this.version++;
      return;
    }
    await this.update(collection, id, { deletedAt: null } as Partial<AnyItem>);
  }

  async purge(collection: CollectionName, id: string): Promise<void> {
    if (this.mode === 'api') {
      await apiFetch(`/api/items/${collection}/${id}`, { method: 'DELETE' });
      this.data[collection] = (this.data[collection] as AnyItem[]).filter((i) => i.id !== id) as never;
      this.version++;
      return;
    }
    if (this.mode === 'supabase' && supabase) await this.supabaseDelete(collection, id);
    this.data[collection] = (this.data[collection] as AnyItem[]).filter((i) => i.id !== id) as never;
    this.version++;
    saveDemo(this.data);
  }

  async toggleFavorite(collection: CollectionName, id: string): Promise<void> {
    const item = (this.data[collection] as AnyItem[]).find((i) => i.id === id);
    if (item) await this.update(collection, id, { isFavorite: !item.isFavorite });
  }

  // ---------- PostgreSQL API loading ----------
  async loadFromApi(): Promise<boolean> {
    const data = await apiFetch('/api/data') as PlaceData & { viewer: { id: string; displayName: string } };
    if (!data.space) return false;
    // Server returns camelCase rows already; normalise media/letter fields the same way the app expects.
    const normalise = (items: Record<string, unknown>[]) => items.map((i) => ({ ...i, body: (i.body as string | null) ?? '' }));
    this.data = {
      space: data.space,
      members: data.members,
      reminders: data.reminders,
      memories: data.memories,
      letters: normalise(data.letters as unknown as Record<string, unknown>[]) as Letter[],
      journals: data.journals,
      appreciations: data.appreciations,
      plans: data.plans,
      voiceNotes: data.voiceNotes,
    };
    this.viewerId = data.viewer.id;
    this.viewerName = data.viewer.displayName || 'You';
    this.version++;
    return true;
  }

  async createSpaceApi(name: string): Promise<Space> {
    const space = await apiFetch('/api/spaces', { method: 'POST', body: JSON.stringify({ name }) }) as Space;
    await this.loadFromApi();
    return space;
  }

  async joinSpaceApi(inviteCode: string): Promise<Space> {
    const space = await apiFetch('/api/spaces/join', { method: 'POST', body: JSON.stringify({ inviteCode }) }) as Space;
    await this.loadFromApi();
    return space;
  }

  // ---------- Supabase loading (only when configured + signed in) ----------
  async loadFromSupabase(): Promise<boolean> {
    if (!supabase) return false;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return false;
    // Resolve identity up front: even if the space load below fails, no later
    // create can fall back to the demo viewer id ('demo-you', not a UUID).
    this.viewerId = user.id;
    const { data: memberships } = await supabase.from('space_members').select('space_id, spaces(id, name, invite_code, created_at)').eq('user_id', user.id).limit(1);
    const membership = (memberships as { space_id: string; spaces: { id: string; name: string; invite_code: string; created_at: string } }[] | null)?.[0];
    if (!membership) return false;
    const space: Space = { id: membership.spaces.id, name: membership.spaces.name, inviteCode: membership.spaces.invite_code, createdAt: membership.spaces.created_at };
    const fetchTable = async (table: string) => {
      const { data, error } = await supabase!.from(table).select('*').eq('space_id', space.id).order('created_at', { ascending: false });
      if (error) throw new Error(error.message);
      return (data || []) as Record<string, unknown>[];
    };
    const mapBase = (r: Record<string, unknown>) => ({
      id: String(r.id), spaceId: String(r.space_id), authorId: String(r.author_id), authorName: String(r.author_name),
      createdAt: String(r.created_at), updatedAt: String(r.updated_at), deletedAt: r.deleted_at ? String(r.deleted_at) : null, isFavorite: Boolean(r.is_favorite),
    });
    // Letters are read through the sealed view when it exists (body masked until reveal_at for non-authors).
    // Fall back to the table if the view has not been created yet — the client still hides sealed bodies.
    let letterRows: Record<string, unknown>[] = [];
    const { data: viewRows, error: viewErr } = await supabase.from('letters_visible').select('*').eq('space_id', space.id).order('created_at', { ascending: false });
    letterRows = viewErr ? await fetchTable('letters') : ((viewRows as Record<string, unknown>[]) || []);
    const [remRows, memRows, jourRows, appRows, planRows, voiceRows, memberRes] = await Promise.all([
      fetchTable('reminders'), fetchTable('memories'), fetchTable('journal_entries'), fetchTable('appreciations'), fetchTable('future_plans'), fetchTable('voice_notes'),
      supabase.from('space_members').select('user_id').eq('space_id', space.id),
    ]);
    // NOTE: the query above returns a { data, error } response object, not an
    // array — mapping the response itself threw "(E || []).map is not a function"
    // and left the whole load (and the viewer id) on demo data.
    const memberRows = (memberRes.data || []) as { user_id: string }[];
    const signed = async (path: string | null) => {
      if (!path) return null;
      const { data } = await supabase!.storage.from('private-media').createSignedUrl(path, 60 * 60);
      return data?.signedUrl ?? null;
    };
    const memories: Memory[] = [];
    for (const r of memRows) memories.push({ ...mapBase(r), title: String(r.title), caption: String(r.caption), story: String(r.story || ''), happenedOn: String(r.happened_on), mediaPath: r.media_path ? String(r.media_path) : null, mediaUrl: await signed(r.media_path ? String(r.media_path) : null), mediaType: (r.media_type as 'photo' | 'none') || 'none' });
    const plans: FuturePlan[] = [];
    for (const r of planRows) plans.push({ ...mapBase(r), title: String(r.title), detail: String(r.detail || ''), category: r.category as FuturePlan['category'], status: r.status as FuturePlan['status'], completedAt: r.completed_at ? String(r.completed_at) : null, completionPhotoPath: r.completion_photo_path ? String(r.completion_photo_path) : null, completionPhotoUrl: await signed(r.completion_photo_path ? String(r.completion_photo_path) : null) });
    const voiceNotes: VoiceNoteMeta[] = [];
    for (const r of voiceRows) voiceNotes.push({ ...mapBase(r), title: String(r.title), durationSec: r.duration_sec ? Number(r.duration_sec) : null, mediaPath: r.media_path ? String(r.media_path) : null, mediaUrl: await signed(r.media_path ? String(r.media_path) : null), room: (r.room as VoiceNoteMeta['room']) || 'quiet', linkedId: r.linked_id ? String(r.linked_id) : null });
    this.data = {
      space,
      members: memberRows.map((m) => ({ id: m.user_id, displayName: m.user_id === user.id ? 'You' : 'Partner', shortName: m.user_id === user.id ? 'You' : 'Partner' })),
      reminders: remRows.map((r) => ({ ...mapBase(r), text: String(r.text), kind: r.kind as Reminder['kind'] })),
      memories,
      letters: letterRows.map((r) => ({ ...mapBase(r), title: String(r.title), body: String(r.body || ''), visibility: r.visibility as Letter['visibility'], revealAt: r.reveal_at ? String(r.reveal_at) : null })),
      journals: jourRows.map((r) => ({ ...mapBase(r), title: String(r.title), body: String(r.body), mood: String(r.mood || ''), visibility: 'private' as const })),
      appreciations: appRows.map((r) => ({ ...mapBase(r), text: String(r.text), kind: r.kind as Appreciation['kind'], forName: String(r.for_name || 'Partner') })),
      plans,
      voiceNotes,
    };
    this.viewerId = user.id;
    return true;
  }

  async createSpace(name: string): Promise<Space> {
    if (this.mode === 'api') return this.createSpaceApi(name);
    if (!supabase) throw new Error('Supabase is not configured.');
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Sign in first.');
    this.viewerId = user.id;
    const space: Space = { id: uid(), name: name.trim(), inviteCode: makeInviteCode(), createdAt: nowIso() };
    const { error } = await supabase.from('spaces').insert({ id: space.id, name: space.name, invite_code: space.inviteCode, created_by: user.id });
    if (error) throw new Error(error.message);
    const { error: mErr } = await supabase.from('space_members').insert({ space_id: space.id, user_id: user.id, role: 'owner' });
    if (mErr) throw new Error(mErr.message);
    this.data.space = space;
    this.data.members = [{ id: user.id, displayName: 'You', shortName: 'You' }];
    return space;
  }

  async joinSpace(inviteCode: string): Promise<Space> {
    if (this.mode === 'api') return this.joinSpaceApi(inviteCode);
    if (!supabase) throw new Error('Supabase is not configured.');
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Sign in first.');
    this.viewerId = user.id;
    // Joining must go through the join_space_by_code RPC (migration 0002):
    // a non-member cannot SELECT the space row under RLS, so a direct lookup
    // by invite code always fails for the joiner. The RPC (security definer)
    // looks the code up, enforces the two-member cap, and inserts the member.
    const { data: joinedId, error: rpcErr } = await supabase.rpc('join_space_by_code', { p_code: inviteCode.trim().toUpperCase() });
    if (rpcErr || !joinedId) throw new Error(rpcErr?.message || 'No space was found with that invite code.');
    // Now a member, the space row is visible under RLS.
    const { data, error } = await supabase.from('spaces').select('*').eq('id', joinedId).single();
    if (error || !data) throw new Error('Joined, but the space could not be loaded. Please reload.');
    const space: Space = { id: data.id, name: data.name, inviteCode: data.invite_code, createdAt: data.created_at };
    this.data.space = space;
    return space;
  }

  // ---------- Supabase persistence (table <-> app field mapping) ----------
  private tableFor(collection: CollectionName): string {
    return { reminders: 'reminders', memories: 'memories', letters: 'letters', journals: 'journal_entries', appreciations: 'appreciations', plans: 'future_plans', voiceNotes: 'voice_notes' }[collection];
  }

  private toRow(collection: CollectionName, item: AnyItem): Record<string, unknown> {
    const b = {
      id: item.id, space_id: item.spaceId, author_id: item.authorId, author_name: item.authorName,
      created_at: item.createdAt, updated_at: item.updatedAt, deleted_at: item.deletedAt, is_favorite: item.isFavorite,
    };
    if (collection === 'reminders') { const r = item as Reminder; return { ...b, text: r.text, kind: r.kind }; }
    if (collection === 'memories') { const m = item as Memory; return { ...b, title: m.title, caption: m.caption, story: m.story, happened_on: m.happenedOn, media_path: m.mediaPath, media_type: m.mediaType }; }
    if (collection === 'letters') { const l = item as Letter; return { ...b, title: l.title, body: l.body, visibility: l.visibility, reveal_at: l.revealAt }; }
    if (collection === 'journals') { const j = item as JournalEntry; return { ...b, title: j.title, body: j.body, mood: j.mood }; }
    if (collection === 'appreciations') { const a = item as Appreciation; return { ...b, text: a.text, kind: a.kind, for_name: a.forName }; }
    if (collection === 'plans') { const p = item as FuturePlan; return { ...b, title: p.title, detail: p.detail, category: p.category, status: p.status, completed_at: p.completedAt, completion_photo_path: p.completionPhotoPath }; }
    const v = item as VoiceNoteMeta; return { ...b, title: v.title, duration_sec: v.durationSec, media_path: v.mediaPath, room: v.room, linked_id: v.linkedId };
  }

  private async supabaseInsert(collection: CollectionName, item: AnyItem) {
    const { error } = await supabase!.from(this.tableFor(collection)).insert(this.toRow(collection, item));
    if (error) throw new Error(`Could not save that right now. ${error.message}`);
  }

  private async supabaseUpdate(collection: CollectionName, id: string, patch: Partial<AnyItem>) {
    const row = this.toRow(collection, { ...(this.data[collection] as AnyItem[]).find((i) => i.id === id)!, ...patch } as AnyItem);
    const { error } = await supabase!.from(this.tableFor(collection)).update(row).eq('id', id);
    if (error) throw new Error(`Could not save that change. ${error.message}`);
  }

  private async supabaseDelete(collection: CollectionName, id: string) {
    const { error } = await supabase!.from(this.tableFor(collection)).delete().eq('id', id);
    if (error) throw new Error(`Could not delete that permanently. ${error.message}`);
  }

  /** Upload to the private `private-media` bucket. Path is namespaced by space so RLS on storage can check it. */
  async uploadMedia(file: File, kind: 'photo' | 'voice'): Promise<{ path: string; url: string }> {
    if (this.mode === 'api') {
      const form = new FormData();
      form.append('file', file);
      form.append('kind', kind);
      const res = await fetch(`${API_URL}/api/upload`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${localStorage.getItem('our-place-api-token') || ''}` },
        body: form,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string }).error || 'Upload failed.');
      const url = (data as { url: string }).url;
      return { path: (data as { path: string }).path, url: url.startsWith('/') ? `${API_URL}${url}` : url };
    }
    if (this.mode === 'supabase' && supabase) {
      const ext = file.name.split('.').pop()?.toLowerCase() || (kind === 'photo' ? 'jpg' : 'webm');
      const path = `${this.data.space.id}/${kind}/${uid()}.${ext}`;
      const { error } = await supabase.storage.from('private-media').upload(path, file, { upsert: false });
      if (error) throw new Error(`Upload failed. ${error.message}`);
      const { data } = await supabase.storage.from('private-media').createSignedUrl(path, 60 * 60);
      return { path, url: data?.signedUrl ?? '' };
    }
    // Demo mode: keep a local data URL (no server, no sharing across devices — stated in the UI).
    return { path: '', url: await fileToDataUrl(file) };
  }
}

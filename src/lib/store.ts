import type {
  Appreciation, CollectionName, FuturePlan, JournalEntry, Letter, Memory,
  NewItem, PlaceData, Profile, Reminder, Space, VoiceNoteMeta,
} from './types';
import { fileToDataUrl, makeInviteCode, nowIso, todayIsoDate, uid, validateMediaSignature } from './utils';
import { supabase, supabaseConfigured } from './supabase';
import { API_URL, apiConfigured, apiFetch, getApiToken } from './api';

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
      { ...base, id: uid(), authorId: 'demo-you', authorName: 'You', title: 'The walk home', caption: 'Rain, shared umbrella, nowhere to rush to.', story: 'Sample memory — replace this with one of yours. Add a photo, a date, and the small detail you do not want to forget.', happenedOn: todayIsoDate(), mediaUrl: null, mediaPath: null, mediaType: 'none', tags: [], isFavorite: true },
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
      { ...base, id: uid(), authorId: 'demo-you', authorName: 'You', title: 'Cook a meal together, no phones', detail: 'Pick a recipe neither of you has tried.', category: 'date', status: 'planned', targetDate: null, completedAt: null, completionPhotoUrl: null, completionPhotoPath: null },
      { ...base, id: uid(), authorId: 'demo-partner', authorName: 'Partner', title: 'Watch the sunrise somewhere new', detail: 'Bring something warm to drink.', category: 'bucket', status: 'planned', targetDate: null, completedAt: null, completionPhotoUrl: null, completionPhotoPath: null },
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
    // Phase 3: signed-in modes start empty, never with demo samples. A real
    // user's first paint must not flash sample memories/letters, and real
    // synced content must never be written back into the demo localStorage
    // key (see the saveDemo guards below).
    this.data = this.mode === 'demo' ? loadDemo() : {
      space: { id: '', name: '', inviteCode: '', createdAt: '' },
      members: [], reminders: [], memories: [], letters: [], journals: [],
      appreciations: [], plans: [], voiceNotes: [],
    };
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
    // API branch (R0 fix): previously create() had no api branch, so API-mode
    // creates only entered local state, issued zero POST requests, and vanished
    // on reload. Post first and use the server row (server id, server-derived
    // media URL, author from the session), mirroring update().
    if (this.mode === 'api') {
      const saved = await apiFetch(`/api/items/${collection}`, { method: 'POST', body: JSON.stringify(input) }) as unknown as AnyItem;
      const row = saved as unknown as Record<string, unknown>;
      if (typeof row.mediaUrl === 'string' && row.mediaUrl.startsWith('/')) row.mediaUrl = `${API_URL}${row.mediaUrl}`;
      if (typeof row.completionPhotoUrl === 'string' && row.completionPhotoUrl.startsWith('/')) row.completionPhotoUrl = `${API_URL}${row.completionPhotoUrl}`;
      (this.data[collection] as AnyItem[]).unshift(saved as AnyItem);
      this.version++;
      return saved as unknown as T;
    }
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
      this.viewerName = (user.email || '').split('@')[0] || 'You';
      (item as AnyItem).authorId = user.id;
      (item as AnyItem).authorName = this.viewerName;
      (item as AnyItem).spaceId = this.data.space.id;
      await this.supabaseInsert(collection, item as AnyItem);
    }
    (this.data[collection] as AnyItem[]).unshift(item as AnyItem);
    this.version++;
    if (this.mode === 'demo') saveDemo(this.data);
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
      const r = saved as unknown as Record<string, unknown>;
      if (typeof r.mediaUrl === 'string' && r.mediaUrl.startsWith('/')) r.mediaUrl = `${API_URL}${r.mediaUrl}`;
      if (typeof r.completionPhotoUrl === 'string' && r.completionPhotoUrl.startsWith('/')) r.completionPhotoUrl = `${API_URL}${r.completionPhotoUrl}`;
      Object.assign(item, saved);
      this.version++;
      return; // API mode never writes to the demo localStorage key.
    }
    if (this.mode === 'supabase' && supabase) await this.supabaseUpdate(collection, id, patch);
    Object.assign(item, patch, { updatedAt: nowIso() });
    this.version++;
    if (this.mode === 'demo') saveDemo(this.data);
  }

  /** Soft delete: recoverable from the Deleted room. Permanent deletion is a separate, confirmed step. */
  async softDelete(collection: CollectionName, id: string): Promise<void> {
    await this.update(collection, id, { deletedAt: nowIso() } as Partial<AnyItem>);
  }

  async restore(collection: CollectionName, id: string): Promise<void> {
    if (this.mode === 'api') {
      const saved = await apiFetch(`/api/items/${collection}/${id}/restore`, { method: 'POST' }) as unknown as AnyItem;
      const r = saved as unknown as Record<string, unknown>;
      if (typeof r.mediaUrl === 'string' && r.mediaUrl.startsWith('/')) r.mediaUrl = `${API_URL}${r.mediaUrl}`;
      if (typeof r.completionPhotoUrl === 'string' && r.completionPhotoUrl.startsWith('/')) r.completionPhotoUrl = `${API_URL}${r.completionPhotoUrl}`;
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
    // Permanent deletion must also delete the stored file. Previously
    // purge() deleted only the database row, leaving the photo/voice
    // file in the bucket as an orphan retrievable by a retained path
    // or signed URL. The row delete happens first; the file delete is
    // best-effort (a file already gone must not block the purge).
    // Note: signed URLs issued before this point stay valid until
    // their 1-hour expiry — deleting the object does not revoke them.
    const item = (this.data[collection] as AnyItem[]).find((i) => i.id === id);
    const filePaths = item ? [ (item as { mediaPath?: string }).mediaPath, (item as { completionPhotoPath?: string }).completionPhotoPath ].filter((p): p is string => !!p) : [];
    if (this.mode === 'supabase' && supabase) {
      await this.supabaseDelete(collection, id);
      if (filePaths.length > 0) {
        await supabase.storage.from('private-media').remove(filePaths).then(() => { /* best effort */ });
      }
    }
    this.data[collection] = (this.data[collection] as AnyItem[]).filter((i) => i.id !== id) as never;
    this.version++;
    if (this.mode === 'demo') saveDemo(this.data);
  }

  async toggleFavorite(collection: CollectionName, id: string): Promise<void> {
    const item = (this.data[collection] as AnyItem[]).find((i) => i.id === id);
    if (item) await this.update(collection, id, { isFavorite: !item.isFavorite });
  }

  /**
   * Signed-in but space-less: drop the demo sample content so a real user
   * never sees sample memories/letters as if they were their own data.
   * Demo mode never calls this (it has no sign-in and no space setup).
   */
  clearToEmpty(): void {
    this.data = {
      space: { id: '', name: '', inviteCode: '', createdAt: '' },
      members: [],
      reminders: [],
      memories: [],
      letters: [],
      journals: [],
      appreciations: [],
      plans: [],
      voiceNotes: [],
    };
    this.version++;
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
    // R4 fix: the server returns media URLs as /api/media/... paths. In a split
    // deployment (frontend on one origin, API on another) a bare path resolves
    // against the frontend origin and 404s after reload. Prefix with API_URL,
    // mirroring uploadMedia(). Same-origin API mode is unaffected (API_URL is
    // the origin the paths were issued for).
    const prefixMedia = (items: AnyItem[]) => items.forEach((i) => {
      const r = i as unknown as Record<string, unknown>;
      if (typeof r.mediaUrl === 'string' && r.mediaUrl.startsWith('/')) r.mediaUrl = `${API_URL}${r.mediaUrl}`;
      if (typeof r.completionPhotoUrl === 'string' && r.completionPhotoUrl.startsWith('/')) r.completionPhotoUrl = `${API_URL}${r.completionPhotoUrl}`;
    });
    prefixMedia(this.data.memories); prefixMedia(this.data.voiceNotes); prefixMedia(this.data.plans);
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

  // ---------- Phase 3: profiles + invitations ----------
  // Phase 11: avatar is an optional preset key. Only the whitelisted keys
  // in ui.tsx are accepted; anything else falls back to the initial letter.
  async updateProfile(displayName: string, avatar?: string): Promise<void> {
    const name = displayName.trim().slice(0, 100);
    if (!name) throw new Error('Please enter a display name.');
    const avatarKey = ['bunny', 'fox', 'cat', 'hedgehog', 'frog', 'duck', 'flower', 'star'].includes(avatar ?? '') ? avatar : undefined;
    if (this.mode === 'api') {
      const saved = await apiFetch('/api/auth/me', { method: 'PATCH', body: JSON.stringify({ displayName: name, avatar: avatarKey ?? null }) }) as { displayName: string; avatar?: string };
      this.viewerName = saved.displayName;
    } else if (this.mode === 'supabase' && supabase) {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Sign in first.');
      const { error } = await supabase.from('profiles').upsert({ id: user.id, display_name: name, avatar_path: avatarKey ?? null, updated_at: new Date().toISOString() });
      if (error) throw new Error(error.message);
      this.viewerName = name;
    }
    this.data.members = this.data.members.map((m) => (m.id === this.viewerId ? { ...m, displayName: name, shortName: name, avatar: avatarKey } : m));
    this.version++;
    if (this.mode === 'demo') saveDemo(this.data);
  }

  async createInvitation(): Promise<{ code: string; expiresAt: string | null }> {
    if (this.mode === 'api') {
      const r = await apiFetch('/api/invitations', { method: 'POST', body: JSON.stringify({}) }) as { code: string; expiresAt: string };
      return { code: r.code, expiresAt: r.expiresAt };
    }
    if (this.mode === 'supabase' && supabase) {
      // create_invitation is a security-definer RPC: the code is generated
      // server-side, expires in 7 days, and is single-use (migration 0004).
      const { data, error } = await supabase.rpc('create_invitation', { p_space_id: this.data.space.id });
      if (error || !data) throw new Error(error?.message || 'Could not create an invite code.');
      return { code: String(data), expiresAt: null };
    }
    throw new Error('Invitations are only available in a signed-in space.');
  }

  // ---------- Supabase loading (only when configured + signed in) ----------
  async loadFromSupabase(): Promise<boolean> {
    if (!supabase) return false;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return false;
    // Resolve identity up front: even if the space load below fails, no later
    // create can fall back to the demo viewer id ('demo-you', not a UUID).
    // Display name comes from the sign-in email, so shared items are never
    // all labelled 'You' to the partner (the sealed-letter byline bug).
    this.viewerId = user.id;
    this.viewerName = (user.email || '').split('@')[0] || 'You';
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
    // Letters are read ONLY through the sealed view (body masked until reveal_at for non-authors).
    // There is deliberately no fallback to the raw letters table: the raw table's SELECT policy
    // returns sealed bodies to members (the masking lives in the view), so falling back on a
    // view error would silently hand a partner sealed letters before their reveal time.
    // If the view query fails, loading fails loudly instead, with the space-setup message.
    const { data: viewRows, error: viewErr } = await supabase.from('letters_visible').select('*').eq('space_id', space.id).order('created_at', { ascending: false });
    if (viewErr) throw new Error(viewErr.message);
    const letterRows: Record<string, unknown>[] = (viewRows as Record<string, unknown>[]) || [];
    const [remRows, memRows, jourRows, appRows, planRows, voiceRows, memberRes] = await Promise.all([
      fetchTable('reminders'), fetchTable('memories'), fetchTable('journal_entries'), fetchTable('appreciations'), fetchTable('future_plans'), fetchTable('voice_notes'),
      supabase.from('space_members').select('user_id').eq('space_id', space.id),
    ]);
    // NOTE: the query above returns a { data, error } response object, not an
    // array — mapping the response itself threw "(E || []).map is not a function"
    // and left the whole load (and the viewer id) on demo data.
    const memberRows = (memberRes.data || []) as { user_id: string }[];
    // Phase 3 profiles: use real display names where they exist (migration
    // 0004 creates a profile on sign-up; older accounts get one upserted
    // below). A partner's name is visible only because they share this
    // space — the profiles RLS policy allows exactly that, nothing more.
    const { data: profileRows } = await supabase.from('profiles').select('id, display_name, avatar_path').in('id', memberRows.map((m) => m.user_id));
    const profileById = new Map((profileRows || []).map((r) => [String(r.id), { name: String(r.display_name || ''), avatar: r.avatar_path ? String(r.avatar_path) : undefined }]));
    if (!profileById.get(user.id)?.name) {
      await supabase.from('profiles').upsert({ id: user.id, display_name: this.viewerName }).then(() => { /* best effort */ });
      profileById.set(user.id, { name: this.viewerName, avatar: profileById.get(user.id)?.avatar });
    }
    const memberProfiles: Profile[] = memberRows.map((m) => {
      const p = profileById.get(m.user_id);
      const name = p?.name || (m.user_id === user.id ? 'You' : 'Partner');
      return { id: m.user_id, displayName: name, shortName: m.user_id === user.id ? 'You' : name, avatar: p?.avatar };
    });
    const signed = async (path: string | null) => {
      if (!path) return null;
      const { data } = await supabase!.storage.from('private-media').createSignedUrl(path, 60 * 60);
      return data?.signedUrl ?? null;
    };
    const memories: Memory[] = [];
    for (const r of memRows) memories.push({ ...mapBase(r), title: String(r.title), caption: String(r.caption), story: String(r.story || ''), happenedOn: String(r.happened_on), mediaPath: r.media_path ? String(r.media_path) : null, mediaUrl: await signed(r.media_path ? String(r.media_path) : null), mediaType: (r.media_type as 'photo' | 'none') || 'none', tags: Array.isArray(r.tags) ? (r.tags as unknown[]).map(String) : [] });
    const plans: FuturePlan[] = [];
    for (const r of planRows) plans.push({ ...mapBase(r), title: String(r.title), detail: String(r.detail || ''), category: r.category as FuturePlan['category'], status: r.status as FuturePlan['status'], targetDate: r.target_date ? String(r.target_date).slice(0, 10) : null, completedAt: r.completed_at ? String(r.completed_at) : null, completionPhotoPath: r.completion_photo_path ? String(r.completion_photo_path) : null, completionPhotoUrl: await signed(r.completion_photo_path ? String(r.completion_photo_path) : null) });
    const voiceNotes: VoiceNoteMeta[] = [];
    for (const r of voiceRows) voiceNotes.push({ ...mapBase(r), title: String(r.title), durationSec: r.duration_sec ? Number(r.duration_sec) : null, mediaPath: r.media_path ? String(r.media_path) : null, mediaUrl: await signed(r.media_path ? String(r.media_path) : null), room: (r.room as VoiceNoteMeta['room']) || 'quiet', linkedId: r.linked_id ? String(r.linked_id) : null });
    this.data = {
      space,
      members: memberProfiles,
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
    this.viewerName = (user.email || '').split('@')[0] || 'You';
    // One space per user (the database trigger enforces this too).
    const { data: existing } = await supabase.from('space_members').select('space_id').eq('user_id', user.id).limit(1);
    if (existing && existing.length) throw new Error('You already belong to a space.');
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
    this.viewerName = (user.email || '').split('@')[0] || 'You';
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
    if (collection === 'memories') { const m = item as Memory; return { ...b, title: m.title, caption: m.caption, story: m.story, happened_on: m.happenedOn, media_path: m.mediaPath, media_type: m.mediaType, tags: m.tags ?? [] }; }
    if (collection === 'letters') { const l = item as Letter; return { ...b, title: l.title, body: l.body, visibility: l.visibility, reveal_at: l.revealAt }; }
    if (collection === 'journals') { const j = item as JournalEntry; return { ...b, title: j.title, body: j.body, mood: j.mood }; }
    if (collection === 'appreciations') { const a = item as Appreciation; return { ...b, text: a.text, kind: a.kind, for_name: a.forName }; }
    if (collection === 'plans') { const p = item as FuturePlan; return { ...b, title: p.title, detail: p.detail, category: p.category, status: p.status, target_date: p.targetDate, completed_at: p.completedAt, completion_photo_path: p.completionPhotoPath }; }
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

  /** Upload to the private `private-media` bucket. Path is namespaced by space so RLS on storage can check it.
   *  Upload validation runs here, in front of every backend, not only in the form that happened
   *  to call it. Layered checks: this client check (extension + MIME + size + file
   *  signature), the Storage extension/kind policy in migration 0009 (which blocks
   *  .html even via direct Storage API calls), and the API server's signature check
   *  (API mode only). Supabase mode has no trusted server that can decode media, so
   *  a direct Storage API call can still upload a correctly-named file with spoofed
   *  content — the residual risk is documented in the Phase 10 report, and is kept low
   *  because media is rendered only via <img>/<audio> and served with an image/audio
   *  content-type derived from the whitelisted extension. */
  async uploadMedia(file: File, kind: 'photo' | 'voice'): Promise<{ path: string; url: string }> {
    const ext = file.name.split('.').pop()?.toLowerCase() || '';
    if (kind === 'photo') {
      if (!file.type.startsWith('image/') || !['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif'].includes(ext)) {
        throw new Error('That file is not an allowed photo (JPG, PNG, GIF, WebP or AVIF).');
      }
    } else {
      if (!file.type.startsWith('audio/') || !['mp3', 'wav', 'ogg', 'm4a', 'webm'].includes(ext)) {
        throw new Error('That file is not an allowed audio file (MP3, WAV, OGG, M4A or WebM).');
      }
    }
    if (file.size > 25 * 1024 * 1024) throw new Error('That file is over 25 MB. Please choose a smaller one.');
    const sigErr = await validateMediaSignature(file, ext);
    if (sigErr) throw new Error(sigErr);
    if (this.mode === 'api') {
      const form = new FormData();
      form.append('file', file);
      form.append('kind', kind);
      const res = await fetch(`${API_URL}/api/upload`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${getApiToken() || ''}` },
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
      // Store the content type derived from the whitelisted extension,
      // NOT from File.type: a caller-supplied MIME type proves nothing
      // about content, and the stored type is what a direct fetch would
      // be served as. (The extension itself was already validated above,
      // and the file signature was verified against it.)
      const contentTypeByExt: Record<string, string> = {
        jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif',
        webp: 'image/webp', avif: 'image/avif',
        mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', m4a: 'audio/mp4', webm: 'audio/webm',
      };
      const { error } = await supabase.storage.from('private-media').upload(path, file, { upsert: false, contentType: contentTypeByExt[ext] });
      if (error) throw new Error(`Upload failed. ${error.message}`);
      const { data } = await supabase.storage.from('private-media').createSignedUrl(path, 60 * 60);
      return { path, url: data?.signedUrl ?? '' };
    }
    // Demo mode: keep a local data URL (no server, no sharing across devices — stated in the UI).
    return { path: '', url: await fileToDataUrl(file) };
  }
}

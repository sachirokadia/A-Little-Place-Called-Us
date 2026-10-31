export type RoomId = 'home' | 'reminders' | 'memories' | 'letters' | 'quiet' | 'appreciations' | 'future' | 'deleted' | 'settings';

export interface Profile {
  id: string;
  displayName: string;
  /** short label shown as author, e.g. "You" / partner name once set */
  shortName: string;
}

export interface Space {
  id: string;
  name: string;
  inviteCode: string;
  createdAt: string;
}

/** Visibility rules, enforced in SQL (see supabase/migrations) and mirrored in the demo store. */
export type LetterVisibility = 'shared' | 'private_draft' | 'scheduled';

export interface BaseItem {
  id: string;
  spaceId: string;
  authorId: string;
  authorName: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  isFavorite: boolean;
}

export interface Reminder extends BaseItem {
  text: string;
  /** "personal" = written for the partner to find; "random" pool is the same table, flagged here */
  kind: 'note' | 'prompt';
}

export interface Memory extends BaseItem {
  title: string;
  caption: string;
  story: string;
  happenedOn: string; // YYYY-MM-DD
  mediaUrl: string | null; // signed URL / data URL in demo mode
  mediaPath: string | null; // Supabase Storage path, null in demo mode
  mediaType: 'photo' | 'none';
}

export interface Letter extends BaseItem {
  title: string;
  body: string;
  visibility: LetterVisibility;
  /** ISO datetime; only meaningful when visibility === 'scheduled' */
  revealAt: string | null;
  /** Server/view-derived: true when a non-author may not read the body yet. Never trust the client alone in production. */
  sealed?: boolean;
}

export interface JournalEntry extends BaseItem {
  title: string;
  body: string;
  mood: string;
  /** Private journals are NEVER part of a shared query. In SQL, RLS is author_id = auth.uid(). */
  visibility: 'private';
}

export interface Appreciation extends BaseItem {
  text: string;
  kind: 'appreciation' | 'achievement' | 'encouragement';
  forName: string;
}

export interface FuturePlan extends BaseItem {
  title: string;
  detail: string;
  category: 'bucket' | 'date' | 'plan';
  status: 'planned' | 'done';
  completedAt: string | null;
  completionPhotoUrl: string | null;
  completionPhotoPath: string | null;
}

export interface VoiceNoteMeta extends BaseItem {
  title: string;
  durationSec: number | null;
  mediaPath: string | null;
  mediaUrl: string | null;
  /** Which room this note belongs to, so voice notes never leak across rooms. */
  room: 'quiet' | 'letters' | 'memories';
  linkedId: string | null;
}

export interface PlaceData {
  space: Space;
  members: Profile[];
  reminders: Reminder[];
  memories: Memory[];
  letters: Letter[];
  journals: JournalEntry[];
  appreciations: Appreciation[];
  plans: FuturePlan[];
  voiceNotes: VoiceNoteMeta[];
}

export type CollectionName = 'reminders' | 'memories' | 'letters' | 'journals' | 'appreciations' | 'plans' | 'voiceNotes';

export type NewItem<T> = Omit<T, 'id' | 'createdAt' | 'updatedAt' | 'deletedAt' | 'isFavorite'> & { isFavorite?: boolean };

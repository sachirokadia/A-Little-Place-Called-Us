// DB-backed shared final messages (the arcade's final star letter
// and the hero adventure's final message). Either space member may
// read and overwrite them; when no row exists the caller falls back
// to the code drafts, still labelled as drafts. A saved row is
// stored as one text string, with paragraphs separated by a blank
// line — the same shape the draft arrays join into.

import { api } from './api.js';

export type FinalMessageKind = 'star-letter' | 'hero-final';

export interface FinalMessage {
  kind: string;
  text: string;
  updatedById: string;
  updatedAt: string;
}

export const getFinalMessage = (spaceId: string, kind: FinalMessageKind) =>
  api<FinalMessage | null>(`/spaces/${spaceId}/final-messages/${kind}`);

export const saveFinalMessage = (spaceId: string, kind: FinalMessageKind, text: string) =>
  api<FinalMessage>(`/spaces/${spaceId}/final-messages/${kind}`, { method: 'PUT', body: { text } });

/** Split saved text back into display paragraphs (blank-line separated). */
export function splitParagraphs(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
}

/** Join display paragraphs into the single stored text string. */
export function joinParagraphs(paragraphs: string[]): string {
  return paragraphs.join('\n\n');
}

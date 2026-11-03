import { z } from 'zod';

export const uuid = z.string().uuid();
// Strict calendar-date check: Date.parse normalises impossible
// dates (2026-02-30 becomes 2026-03-02), so the parsed components
// must round-trip exactly, otherwise the date is rejected.
export const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a calendar date YYYY-MM-DD')
  .refine((s) => {
    const [y, m, d] = s.split('-').map(Number);
    const parsed = new Date(Date.UTC(y!, m! - 1, d!));
    return parsed.getUTCFullYear() === y && parsed.getUTCMonth() === m! - 1 && parsed.getUTCDate() === d;
  }, 'Not a real date');

const title = z.string().trim().min(1).max(200);
const shortText = z.string().trim().max(2000);
const bodyText = z.string().max(20000);
const storyText = z.string().max(5000);

export const registerSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(10).max(256),
  displayName: z.string().trim().min(1).max(100),
});
export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(1).max(256),
});
export const passwordChangeSchema = z.object({
  password: z.string().min(10).max(256),
});

export const spaceCreateSchema = z.object({ name: z.string().trim().min(1).max(100) });
export const invitationJoinSchema = z.object({ token: z.string().trim().min(16).max(256) });

export const memoryCreateSchema = z.object({
  title,
  caption: shortText.optional().default(''),
  story: storyText.optional().default(''),
  happenedOn: isoDate.nullable().optional(),
  tags: z.array(z.string().trim().min(1).max(50)).max(20).optional().default([]),
});
export const memoryUpdateSchema = memoryCreateSchema.partial();

export const letterVisibility = z.enum(['shared', 'private_draft', 'scheduled']);
export const letterCreateSchema = z.object({
  title,
  body: bodyText,
  visibility: letterVisibility,
  revealAt: z.string().datetime().nullable().optional(),
  memoryId: uuid.nullable().optional(),
}).refine(
  (v) => v.visibility !== 'scheduled' || !!v.revealAt,
  { message: 'A scheduled letter requires revealAt', path: ['revealAt'] },
);
export const letterUpdateSchema = z.object({
  title: title.optional(),
  body: bodyText.optional(),
  visibility: letterVisibility.optional(),
  revealAt: z.string().datetime().nullable().optional(),
  memoryId: uuid.nullable().optional(),
}).refine(
  (v) => !(v.visibility === 'scheduled' && v.revealAt === null),
  { message: 'A scheduled letter requires revealAt', path: ['revealAt'] },
);

export const journalCreateSchema = z.object({ title, body: bodyText, mood: z.string().trim().max(50).optional().default('') });
export const journalUpdateSchema = journalCreateSchema.partial();

export const appreciationKind = z.enum(['appreciation', 'achievement']);
export const appreciationCreateSchema = z.object({
  text: shortText,
  kind: appreciationKind,
  forName: z.string().trim().min(1).max(100),
});
export const appreciationUpdateSchema = appreciationCreateSchema.partial();

export const planCategory = z.enum(['trip', 'date', 'meal', 'activity', 'home', 'other']);
export const planCreateSchema = z.object({
  title,
  detail: shortText.optional().default(''),
  category: planCategory,
  targetDate: isoDate.nullable().optional(),
  location: z.string().trim().max(200).optional().default(''),
});
export const planUpdateSchema = z.object({
  title: title.optional(),
  detail: shortText.optional(),
  category: planCategory.optional(),
  targetDate: isoDate.nullable().optional(),
  location: z.string().trim().max(200).optional(),
  // 'status' must be declared here or validation strips it before the
  // handler ever sees it — which previously made PATCH {status:'done'}
  // return 200 while silently ignoring the field. Any supplied value
  // is rejected with a 400 pointing at the complete endpoint.
  status: z.string().optional().refine((v) => v === undefined, { message: 'Use the complete endpoint to mark a plan done' }),
});
export const planCompleteSchema = z.object({
  createMemory: z.boolean().optional().default(false),
  memoryTitle: title.optional(),
  memoryCaption: shortText.optional().default(''),
});

export const reminderKind = z.enum(['note', 'prompt']);
export const reminderCreateSchema = z.object({ text: z.string().trim().min(1).max(2000), kind: reminderKind });
export const reminderUpdateSchema = reminderCreateSchema.partial();

export const voiceNoteCreateSchema = z.object({ title });
// Update reuses the create schema in content.ts, which made 'title'
// required on every PATCH. Updates should accept a partial title.
export const voiceNoteUpdateSchema = z.object({ title: title.optional() });

export const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).optional().default(20),
  cursor: z.string().optional(),
  deleted: z.coerce.boolean().optional().default(false),
  favourited: z.coerce.boolean().optional().default(false),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;

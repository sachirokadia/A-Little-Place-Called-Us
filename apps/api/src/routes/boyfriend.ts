// Boyfriend Arcade routes.
//
// AUTHOR RULE (chosen, enforced server-side on every route below):
// quiz questions and chest riddles may be CREATED by either space
// member, but only the AUTHOR may PATCH or DELETE their own row —
// a partner's edit/delete attempt gets a generic 404, never a
// leak that the row exists or who owns it. The chest reward is
// SHARED config: either space member may set it (PUT upsert).
//
// MASKING RULES (also server-side, never frontend-only):
// - QuizQuestion.correctOption is write-only: it never appears in
//   any GET, POST, or PATCH response, nor in submission results
//   (only a boolean per question). The author gets no exception.
// - ChestRiddle.answer is write-only in the same way: never in
//   any GET, POST, or PATCH response.
// - GuessRound.answer is shown to the round's creator always, to
//   the other member only after reveal, and to nobody as null or
//   masked stars before reveal — the key is simply omitted.
//   guessText and correct are likewise only exposed after reveal
//   (guessText to both once revealed; correct is a boolean).
// - One guess total per round, enforced in the guess handler, not
//   just in the UI: a second guess is a 400.
// - Chest attempts are solve-in-order per player: all riddles
//   with a lower sortOrder must already be solved by THIS player.
// - Normalized comparison everywhere: trim + lowercase, with the
//   stored answer/guess kept as given.

import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { badRequest, notFound, unauthorized } from '../errors.js';
import { requireSpaceMember } from '../lib/membership.js';
import { validateBody } from '../middleware/validate.js';

export const boyfriendRouter = Router();

const nonBlank = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .refine((v) => v.trim().length >= 1, { message: 'Must not be blank' });

const questionField = nonBlank(300);
const answerField = nonBlank(200);
const optionsField = z.array(nonBlank(120)).min(2).max(6);

const quizCreateSchema = z
  .object({
    question: questionField,
    options: optionsField,
    correctOption: z.number().int().min(0),
  })
  .strict()
  .refine((v) => v.correctOption < v.options.length, { message: 'correctOption out of range' });

const quizPatchSchema = z
  .object({
    question: questionField.optional(),
    options: optionsField.optional(),
    correctOption: z.number().int().min(0).optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length >= 1, { message: 'At least one field is required' });

const quizSubmissionSchema = z
  .object({
    answers: z
      .array(
        z
          .object({ questionId: z.string().min(1), optionIndex: z.number().int().min(0) })
          .strict(),
      )
      .min(1)
      .max(200),
  })
  .strict();

const guessRoundCreateSchema = z
  .object({ question: questionField, answer: answerField })
  .strict();

const guessSchema = z.object({ guess: answerField }).strict();

const chestRiddleCreateSchema = z
  .object({
    question: questionField,
    answer: answerField,
    hint: z.string().max(200).nullable().optional(),
    sortOrder: z.number().int().min(0).optional(),
  })
  .strict();

const chestRiddlePatchSchema = z
  .object({
    question: questionField.optional(),
    answer: answerField.optional(),
    hint: z.string().max(200).nullable().optional(),
    sortOrder: z.number().int().min(0).optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length >= 1, { message: 'At least one field is required' });

const chestAttemptSchema = z.object({ guess: answerField }).strict();

const chestRewardSchema = z
  .object({
    message: z.string().max(1000),
    memoryId: z.string().min(1).nullable().optional(),
  })
  .strict();

function normalize(v: string): string {
  return v.trim().toLowerCase();
}

function requireUser(req: { user?: { id: string } }): string {
  if (!req.user) throw unauthorized();
  return req.user.id;
}

// Serialisers: these are the masking boundary. Nothing outside
// this file should return a quiz question, guess round, chest
// riddle, or chest reward row directly.
type QuizRow = {
  id: string;
  spaceId: string;
  authorId: string;
  question: string;
  options: string[];
  createdAt: Date;
};
function quizPublic(q: QuizRow) {
  return {
    id: q.id,
    spaceId: q.spaceId,
    authorId: q.authorId,
    question: q.question,
    options: q.options,
    createdAt: q.createdAt,
  };
}

type GuessRow = {
  id: string;
  spaceId: string;
  creatorId: string;
  question: string;
  answer: string;
  guesserId: string | null;
  guessText: string | null;
  revealed: boolean;
  correct: boolean | null;
  createdAt: Date;
};
function guessPublic(round: GuessRow, callerId: string) {
  const out: Record<string, unknown> = {
    id: round.id,
    spaceId: round.spaceId,
    creatorId: round.creatorId,
    question: round.question,
    status: round.revealed ? 'revealed' : 'open',
    revealed: round.revealed,
    guesserId: round.guesserId,
    createdAt: round.createdAt,
  };
  // Creator always sees the answer; the other member only after reveal.
  if (round.creatorId === callerId || round.revealed) out.answer = round.answer;
  // The guess itself is only exposed once revealed, to both members.
  if (round.revealed) {
    out.guessText = round.guessText;
    out.correct = round.correct;
  }
  return out;
}

type RiddleRow = {
  id: string;
  spaceId: string;
  authorId: string;
  sortOrder: number;
  question: string;
  hint: string | null;
  createdAt: Date;
};
function riddlePublic(r: RiddleRow) {
  return {
    id: r.id,
    spaceId: r.spaceId,
    authorId: r.authorId,
    sortOrder: r.sortOrder,
    question: r.question,
    hint: r.hint,
    createdAt: r.createdAt,
  };
}

async function scopedQuiz(spaceId: string, id: string) {
  const row = await prisma.quizQuestion.findFirst({ where: { id, spaceId } });
  if (!row) throw notFound();
  return row;
}

async function scopedRiddle(spaceId: string, id: string) {
  const row = await prisma.chestRiddle.findFirst({ where: { id, spaceId } });
  if (!row) throw notFound();
  return row;
}

function assertAuthor(authorId: string, callerId: string): void {
  // Generic 404 (never a 403 leak) for a non-author, matching the
  // rest of the API's author-only behaviour.
  if (authorId !== callerId) throw notFound();
}

// ---- Quiz questions ----

boyfriendRouter.get('/spaces/:spaceId/quiz-questions', async (req, res, next) => {
  try {
    const callerId = requireUser(req);
    const spaceId = req.params.spaceId ?? '';
    await requireSpaceMember(callerId, spaceId);
    const rows = await prisma.quizQuestion.findMany({
      where: { spaceId },
      orderBy: { createdAt: 'asc' },
    });
    return res.json({ data: rows.map(quizPublic) });
  } catch (e) {
    return next(e);
  }
});

boyfriendRouter.post(
  '/spaces/:spaceId/quiz-questions',
  validateBody(quizCreateSchema),
  async (req, res, next) => {
    try {
      const callerId = requireUser(req);
      const spaceId = req.params.spaceId ?? '';
      await requireSpaceMember(callerId, spaceId);
      const body = req.body as z.infer<typeof quizCreateSchema>;
      const row = await prisma.quizQuestion.create({
        data: {
          spaceId,
          authorId: callerId,
          question: body.question,
          options: body.options,
          correctOption: body.correctOption,
        },
      });
      return res.status(201).json({ data: quizPublic(row) });
    } catch (e) {
      return next(e);
    }
  },
);

boyfriendRouter.patch(
  '/spaces/:spaceId/quiz-questions/:id',
  validateBody(quizPatchSchema),
  async (req, res, next) => {
    try {
      const callerId = requireUser(req);
      const spaceId = req.params.spaceId ?? '';
      await requireSpaceMember(callerId, spaceId);
      const row = await scopedQuiz(spaceId, req.params.id ?? '');
      assertAuthor(row.authorId, callerId);
      const body = req.body as z.infer<typeof quizPatchSchema>;
      // Options/correctOption consistency against the merged row,
      // not just the patch: a new correctOption must fit the
      // (possibly new) options, and new options must still contain
      // the (possibly unchanged) correctOption.
      const mergedOptions = body.options ?? row.options;
      const mergedCorrect = body.correctOption ?? row.correctOption;
      if (mergedCorrect >= mergedOptions.length) throw badRequest('Invalid request: correctOption');
      const updated = await prisma.quizQuestion.update({
        where: { id: row.id },
        data: {
          ...(body.question !== undefined ? { question: body.question } : {}),
          ...(body.options !== undefined ? { options: body.options } : {}),
          ...(body.correctOption !== undefined ? { correctOption: body.correctOption } : {}),
        },
      });
      return res.json({ data: quizPublic(updated) });
    } catch (e) {
      return next(e);
    }
  },
);

boyfriendRouter.delete('/spaces/:spaceId/quiz-questions/:id', async (req, res, next) => {
  try {
    const callerId = requireUser(req);
    const spaceId = req.params.spaceId ?? '';
    await requireSpaceMember(callerId, spaceId);
    const row = await scopedQuiz(spaceId, req.params.id ?? '');
    assertAuthor(row.authorId, callerId);
    await prisma.quizQuestion.delete({ where: { id: row.id } });
    return res.json({ data: { deleted: true } });
  } catch (e) {
    return next(e);
  }
});

// ---- Quiz submissions (server-computed score) ----

boyfriendRouter.post(
  '/spaces/:spaceId/quiz-submissions',
  validateBody(quizSubmissionSchema),
  async (req, res, next) => {
    try {
      const callerId = requireUser(req);
      const spaceId = req.params.spaceId ?? '';
      await requireSpaceMember(callerId, spaceId);
      const body = req.body as z.infer<typeof quizSubmissionSchema>;
      const seen = new Set<string>();
      for (const a of body.answers) {
        if (seen.has(a.questionId)) throw badRequest('Invalid request: answers');
        seen.add(a.questionId);
      }
      const rows = await prisma.quizQuestion.findMany({
        where: { spaceId, id: { in: body.answers.map((a) => a.questionId) } },
      });
      if (rows.length !== body.answers.length) throw badRequest('Invalid request: answers');
      const byId = new Map(rows.map((r) => [r.id, r]));
      const results = body.answers.map((a) => {
        const row = byId.get(a.questionId);
        if (!row || a.optionIndex >= row.options.length) throw badRequest('Invalid request: answers');
        return { questionId: a.questionId, correct: a.optionIndex === row.correctOption };
      });
      const score = results.filter((r) => r.correct).length;
      return res.json({ data: { score, total: results.length, results } });
    } catch (e) {
      return next(e);
    }
  },
);

// ---- Guess rounds ----

boyfriendRouter.post(
  '/spaces/:spaceId/guess-rounds',
  validateBody(guessRoundCreateSchema),
  async (req, res, next) => {
    try {
      const callerId = requireUser(req);
      const spaceId = req.params.spaceId ?? '';
      await requireSpaceMember(callerId, spaceId);
      const body = req.body as z.infer<typeof guessRoundCreateSchema>;
      const row = await prisma.guessRound.create({
        data: { spaceId, creatorId: callerId, question: body.question, answer: body.answer },
      });
      // Uniform masking: the answer is omitted even for the
      // creator in this create response — the creator already
      // knows it, and the list endpoint is where the creator
      // view (with answer) lives.
      return res.status(201).json({
        data: {
          id: row.id,
          spaceId: row.spaceId,
          creatorId: row.creatorId,
          question: row.question,
          status: 'open',
          revealed: false,
          guesserId: row.guesserId,
          createdAt: row.createdAt,
        },
      });
    } catch (e) {
      return next(e);
    }
  },
);

boyfriendRouter.get('/spaces/:spaceId/guess-rounds', async (req, res, next) => {
  try {
    const callerId = requireUser(req);
    const spaceId = req.params.spaceId ?? '';
    await requireSpaceMember(callerId, spaceId);
    const rows = await prisma.guessRound.findMany({
      where: { spaceId },
      orderBy: { createdAt: 'desc' },
    });
    return res.json({ data: rows.map((r) => guessPublic(r, callerId)) });
  } catch (e) {
    return next(e);
  }
});

boyfriendRouter.post(
  '/spaces/:spaceId/guess-rounds/:id/guess',
  validateBody(guessSchema),
  async (req, res, next) => {
    try {
      const callerId = requireUser(req);
      const spaceId = req.params.spaceId ?? '';
      await requireSpaceMember(callerId, spaceId);
      const row = await prisma.guessRound.findFirst({ where: { id: req.params.id ?? '', spaceId } });
      if (!row) throw notFound();
      if (row.creatorId === callerId) throw badRequest('Invalid request');
      if (row.revealed) throw badRequest('Invalid request');
      const body = req.body as z.infer<typeof guessSchema>;
      const correct = normalize(body.guess) === normalize(row.answer);
      const updated = await prisma.guessRound.update({
        where: { id: row.id },
        data: { guesserId: callerId, guessText: body.guess, revealed: true, correct },
      });
      return res.json({ data: guessPublic(updated, callerId) });
    } catch (e) {
      return next(e);
    }
  },
);

// ---- Chest riddles ----

boyfriendRouter.get('/spaces/:spaceId/chest-riddles', async (req, res, next) => {
  try {
    const callerId = requireUser(req);
    const spaceId = req.params.spaceId ?? '';
    await requireSpaceMember(callerId, spaceId);
    const rows = await prisma.chestRiddle.findMany({
      where: { spaceId },
      orderBy: { sortOrder: 'asc' },
    });
    return res.json({ data: rows.map(riddlePublic) });
  } catch (e) {
    return next(e);
  }
});

boyfriendRouter.post(
  '/spaces/:spaceId/chest-riddles',
  validateBody(chestRiddleCreateSchema),
  async (req, res, next) => {
    try {
      const callerId = requireUser(req);
      const spaceId = req.params.spaceId ?? '';
      await requireSpaceMember(callerId, spaceId);
      const body = req.body as z.infer<typeof chestRiddleCreateSchema>;
      let sortOrder = body.sortOrder;
      if (sortOrder === undefined) {
        const top = await prisma.chestRiddle.findFirst({
          where: { spaceId },
          orderBy: { sortOrder: 'desc' },
        });
        sortOrder = (top?.sortOrder ?? -1) + 1;
      }
      const row = await prisma.chestRiddle.create({
        data: {
          spaceId,
          authorId: callerId,
          sortOrder,
          question: body.question,
          answer: body.answer,
          hint: body.hint ?? null,
        },
      });
      return res.status(201).json({ data: riddlePublic(row) });
    } catch (e) {
      return next(e);
    }
  },
);

boyfriendRouter.patch(
  '/spaces/:spaceId/chest-riddles/:id',
  validateBody(chestRiddlePatchSchema),
  async (req, res, next) => {
    try {
      const callerId = requireUser(req);
      const spaceId = req.params.spaceId ?? '';
      await requireSpaceMember(callerId, spaceId);
      const row = await scopedRiddle(spaceId, req.params.id ?? '');
      assertAuthor(row.authorId, callerId);
      const body = req.body as z.infer<typeof chestRiddlePatchSchema>;
      const updated = await prisma.chestRiddle.update({
        where: { id: row.id },
        data: {
          ...(body.question !== undefined ? { question: body.question } : {}),
          ...(body.answer !== undefined ? { answer: body.answer } : {}),
          ...(body.hint !== undefined ? { hint: body.hint } : {}),
          ...(body.sortOrder !== undefined ? { sortOrder: body.sortOrder } : {}),
        },
      });
      return res.json({ data: riddlePublic(updated) });
    } catch (e) {
      return next(e);
    }
  },
);

boyfriendRouter.delete('/spaces/:spaceId/chest-riddles/:id', async (req, res, next) => {
  try {
    const callerId = requireUser(req);
    const spaceId = req.params.spaceId ?? '';
    await requireSpaceMember(callerId, spaceId);
    const row = await scopedRiddle(spaceId, req.params.id ?? '');
    assertAuthor(row.authorId, callerId);
    // ChestSolve rows for this riddle are deleted by the FK
    // cascade, and are also removed explicitly first so the
    // delete holds even if the cascade is ever relaxed.
    await prisma.chestSolve.deleteMany({ where: { riddleId: row.id } });
    await prisma.chestRiddle.delete({ where: { id: row.id } });
    return res.json({ data: { deleted: true } });
  } catch (e) {
    return next(e);
  }
});

// ---- Chest attempts / state / relock ----

boyfriendRouter.post(
  '/spaces/:spaceId/chest-riddles/:id/attempt',
  validateBody(chestAttemptSchema),
  async (req, res, next) => {
    try {
      const callerId = requireUser(req);
      const spaceId = req.params.spaceId ?? '';
      await requireSpaceMember(callerId, spaceId);
      const riddle = await scopedRiddle(spaceId, req.params.id ?? '');
      const body = req.body as z.infer<typeof chestAttemptSchema>;
      const all = await prisma.chestRiddle.findMany({ where: { spaceId }, orderBy: { sortOrder: 'asc' } });
      const solves = await prisma.chestSolve.findMany({ where: { spaceId, playerId: callerId } });
      const solvedIds = new Set(solves.map((s) => s.riddleId));
      // Solve-in-order: every riddle sorting before this one must
      // already be solved by THIS player.
      const priorUnsolved = all.some((r) => r.sortOrder < riddle.sortOrder && !solvedIds.has(r.id));
      if (priorUnsolved) throw badRequest('Invalid request');
      const correct = normalize(body.guess) === normalize(riddle.answer);
      if (correct && !solvedIds.has(riddle.id)) {
        await prisma.chestSolve.upsert({
          where: { spaceId_playerId_riddleId: { spaceId, playerId: callerId, riddleId: riddle.id } },
          create: { spaceId, playerId: callerId, riddleId: riddle.id },
          update: {},
        });
        solvedIds.add(riddle.id);
      }
      const solvedCount = all.filter((r) => solvedIds.has(r.id)).length;
      return res.json({
        data: {
          correct,
          solvedCount,
          totalCount: all.length,
          unlocked: all.length > 0 && solvedCount === all.length,
        },
      });
    } catch (e) {
      return next(e);
    }
  },
);

boyfriendRouter.get('/spaces/:spaceId/chest-state', async (req, res, next) => {
  try {
    const callerId = requireUser(req);
    const spaceId = req.params.spaceId ?? '';
    await requireSpaceMember(callerId, spaceId);
    const all = await prisma.chestRiddle.findMany({ where: { spaceId } });
    const solves = await prisma.chestSolve.findMany({ where: { spaceId, playerId: callerId } });
    const solvedRiddleIds = solves.map((s) => s.riddleId);
    return res.json({
      data: {
        solvedRiddleIds,
        totalCount: all.length,
        unlocked: all.length > 0 && solvedRiddleIds.length >= all.length,
      },
    });
  } catch (e) {
    return next(e);
  }
});

boyfriendRouter.post('/spaces/:spaceId/chest-relock', async (req, res, next) => {
  try {
    const callerId = requireUser(req);
    const spaceId = req.params.spaceId ?? '';
    await requireSpaceMember(callerId, spaceId);
    // Only the caller's solves: riddles and the reward are untouched.
    await prisma.chestSolve.deleteMany({ where: { spaceId, playerId: callerId } });
    return res.json({ data: { relocked: true } });
  } catch (e) {
    return next(e);
  }
});

// ---- Chest reward (shared config) ----

async function rewardView(spaceId: string) {
  const row = await prisma.chestReward.findUnique({ where: { spaceId } });
  if (!row) return { message: '', memoryId: null as string | null, memoryTitle: null as string | null };
  if (!row.memoryId) return { message: row.message, memoryId: null, memoryTitle: null };
  const memory = await prisma.memory.findFirst({
    where: { id: row.memoryId, spaceId, deletedAt: null },
  });
  // A dangling or other-space memory is treated as absent — never leaked.
  if (!memory) return { message: row.message, memoryId: null, memoryTitle: null };
  return { message: row.message, memoryId: row.memoryId, memoryTitle: memory.title };
}

boyfriendRouter.get('/spaces/:spaceId/chest-reward', async (req, res, next) => {
  try {
    const callerId = requireUser(req);
    const spaceId = req.params.spaceId ?? '';
    await requireSpaceMember(callerId, spaceId);
    return res.json({ data: await rewardView(spaceId) });
  } catch (e) {
    return next(e);
  }
});

boyfriendRouter.put(
  '/spaces/:spaceId/chest-reward',
  validateBody(chestRewardSchema),
  async (req, res, next) => {
    try {
      const callerId = requireUser(req);
      const spaceId = req.params.spaceId ?? '';
      await requireSpaceMember(callerId, spaceId);
      const body = req.body as z.infer<typeof chestRewardSchema>;
      const memoryId = body.memoryId ?? null;
      if (memoryId !== null) {
        const memory = await prisma.memory.findFirst({
          where: { id: memoryId, spaceId, deletedAt: null },
        });
        if (!memory) throw badRequest('Invalid request: memoryId');
      }
      await prisma.chestReward.upsert({
        where: { spaceId },
        create: { spaceId, message: body.message, memoryId, updatedById: callerId },
        update: { message: body.message, memoryId, updatedById: callerId },
      });
      return res.json({ data: await rewardView(spaceId) });
    } catch (e) {
      return next(e);
    }
  },
);

// Original relationship board game (Phase 7) — API + persistence +
// validation. Custom terminology only: Memory Coins, Plot Twists,
// Little Surprises, Places and Moments, tokens. No third-party
// board-game name, logo, or proprietary card text appears anywhere
// here, in comments, or in tests.
//
// OWNERSHIP / CONTRACT NOTES (read before changing the engine):
// - The game rules live in the shared board engine
//   (packages/shared/src/board-engine.ts, owned by the engine
//   worker). This route imports exactly the contract it promises:
//   createGame, applyAction, BOARD_RULES_TEXT,
//   DEFAULT_BOARD_CONFIG, and the types BoardConfigData,
//   GameState, BoardAction. This route never re-implements rules.
// - The engine's exact field vocabulary beyond the task-pinned
//   rules is NOT re-declared here: the route validates the pinned
//   rules (below) and then runs a trial createGame call, which is
//   authoritative for the full config shape. Stored JSON is
//   therefore cast to BoardConfigData/GameState/BoardAction at the
//   boundary; a cast never invents data, it only hands the engine
//   back the JSON it produced or previously accepted.
// - Assumed call shape, to reconcile with the engine worker:
//   createGame(config, players) where players is an array of two
//   { name, token } setups (player index 0/1), and
//   applyAction(state, action) with server-side dice (the route
//   never passes dice; the engine's default rng rolls). If the
//   engine lands a different players shape, the trial call is the
//   first place it will surface (as a 400 on config create), and
//   only the createGame call sites need to change.
// - STATE TRANSPORT (worker A contract deviation, accommodated):
//   GameState carries an extra `config: BoardConfigData` field
//   (createGame stores the validated config on the state because
//   applyAction receives no other argument for it). This route
//   persists and returns the engine's state JSON VERBATIM — it
//   never strips, rebuilds, or rewrites fields — so `config`
//   travels with every stored row and every GET response, and a
//   state without it would throw INVALID_CONFIG inside the
//   engine. The row-level `version` (optimistic lock) is separate
//   from the engine-internal `state.version`, which applyAction
//   does not advance; the row version is the lock version.
// - EFFECT + KIND VOCABULARY (coordinator reconciliation note):
//   the route does NOT hard-code or normalize the engine's card-
//   effect or space-kind vocabulary — it defers to the trial
//   createGame call, so the engine's vocabulary IS the API's
//   vocabulary. Card effects are exactly { type: 'coins',
//   amount } | { type: 'move', steps } | { type: 'missTurn' } |
//   { type: 'toStart' }: a UI editor free-text effect type outside
//   that set fails the trial and is rejected with a clean 400 at
//   config create (never stored, never silently reinterpreted).
//   Space kinds are engine kebab-case: 'start' | 'place' |
//   'plot-twist' | 'little-surprise' | 'tax' | 'rest' |
//   'miss-turn'. The API does NOT normalize kind strings and does
//   NOT reject unknown kinds itself: a config carrying the UI
//   editor's camelCase 'plotTwist' / 'littleSurprise' kinds PASSES
//   the engine trial (the engine validates start/place strictly
//   but does not reject unknown kinds) and is stored verbatim —
//   and the engine then resolves such a space through its
//   little-surprise branch, i.e. it silently behaves as a Little
//   Surprise draw. The UI editor also lacks 'rest' and 'miss-turn'
//   in its dropdown, so those kinds cannot be authored from the
//   editor at all. Reconciliation must fix kind strings in ONE
//   place (UI sends engine kinds, or the API/engine normalizes);
//   until then, API-created configs with engine kinds are correct,
//   and UI-created configs with camelCase kinds are NOT.
// - No online multiplayer or real-time sync is claimed or built
//   here: this is a local two-player game on one device, persisted
//   per game row, with optimistic locking (version + expected
//   version) so a stale writer gets 409 STALE_VERSION instead of
//   silently overwriting a newer state.
//
// VALIDATION DECISIONS (task-pinned, enforced at CREATE/PATCH):
// - Config shape: 16–24 spaces; the space at index 0 is the start
//   space (if it declares a type/kind, that marker must be
//   start-like; an unmarked first space is accepted positionally
//   and the trial createGame call is authoritative); place spaces
//   need price > 0, rent >= 0, and a non-blank category; space ids
//   are unique; every deck-like card array (any top-level array
//   whose key mentions twist, surprise, card, or deck, plus every
//   array inside a `decks` object) holds >= 1 card; any numeric
//   coins/bonus/tax field is >= 0.
// - GET trusts stored JSON: a stored config that passed CREATE/
//   PATCH validation is never re-validated on read (the task's
//   chosen simplification — invalid configs are rejected at write
//   time, so reads stay 500-free without a second validation pass).
// - Reward links: a space carries at most one link structurally
//   (a single nullable `memoryId` field). A link is accepted only
//   if the memory exists, belongs to the SAME space, and is not
//   deleted (memories have no private variant, per hero.ts). Bogus,
//   other-space, or deleted links are 400.
// - Config access: ANY space member may GET configs; either member
//   may CREATE; only the AUTHOR may PATCH/DELETE their own config
//   (a partner gets a generic 404, following the hero router).
// - Default seeding: on first GET, if the space has no configs at
//   all, one row is created from DEFAULT_BOARD_CONFIG with
//   author = the requesting member and isDefault = true. The
//   seeded row is an ordinary row afterwards (it can be edited or
//   deleted only by its author, like any config).
// - Game access: either space member may GET a game and POST
//   actions to it (shared device, shared game). The "actor" is the
//   in-game player index 0/1, NOT the account: the route checks
//   actor is 0 or 1, the engine checks whose turn it is, and no
//   client-supplied balance, position, ownership, state, or version
//   (except expectedVersion as the optimistic-lock check) is ever
//   trusted — the strict action schema rejects those fields.
// - Snapshot isolation: a game's configSnapshot is a copy taken at
//   creation. PATCH/DELETE on the config never touches it, and
//   configId is a plain id (no FK cascade), so deleting a config
//   never deletes a running game.
// - Restart/new-game semantics: POST .../restart creates a NEW
//   game row from the OLD game's configSnapshot (not from the
//   live config row, so a deleted or edited config cannot change
//   the restart); the old row is untouched, preserving history.

import { Router } from 'express';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import {
  applyAction,
  BOARD_RULES_TEXT,
  createGame,
  DEFAULT_BOARD_CONFIG,
  type BoardAction,
  type BoardConfigData,
  type GameState,
} from '@little-place/shared';
import { prisma } from '../db.js';
import { ApiError, badRequest, conflict, notFound, unauthorized } from '../errors.js';
import { requireSpaceMember } from '../lib/membership.js';
import { validateBody } from '../middleware/validate.js';

export const boardRouter = Router();

const nonBlank = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .refine((v) => v.trim().length >= 1, { message: 'Must not be blank' });

function requireUser(req: { user?: { id: string } }): string {
  if (!req.user) throw unauthorized();
  return req.user.id;
}

// ---------------------------------------------------------------------------
// Serialisers (exactly the contract fields, no extras)
// ---------------------------------------------------------------------------

type ConfigRow = {
  id: string;
  spaceId: string;
  authorId: string;
  name: string;
  config: unknown;
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
};

function configPublic(c: ConfigRow) {
  return {
    id: c.id,
    spaceId: c.spaceId,
    authorId: c.authorId,
    name: c.name,
    config: c.config,
    isDefault: c.isDefault,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  };
}

type GameRow = {
  id: string;
  spaceId: string;
  configId: string;
  configSnapshot: unknown;
  state: unknown;
  version: number;
  status: string;
  createdById: string;
  createdAt: Date;
  updatedAt: Date;
};

function gamePublic(g: GameRow) {
  return {
    id: g.id,
    spaceId: g.spaceId,
    configId: g.configId,
    configSnapshot: g.configSnapshot,
    state: g.state,
    version: g.version,
    status: g.status,
    createdById: g.createdById,
    createdAt: g.createdAt,
    updatedAt: g.updatedAt,
  };
}

// ---------------------------------------------------------------------------
// Scoped lookups (generic 404 for wrong space, missing row, or
// non-author — never a leak that the row exists or who owns it)
// ---------------------------------------------------------------------------

async function scopedConfig(spaceId: string, id: string) {
  const row = await prisma.boardConfig.findFirst({ where: { id, spaceId } });
  if (!row) throw notFound();
  return row;
}

async function scopedGame(spaceId: string, id: string) {
  const row = await prisma.boardGame.findFirst({ where: { id, spaceId } });
  if (!row) throw notFound();
  return row;
}

function assertAuthor(authorId: string, callerId: string): void {
  if (authorId !== callerId) throw notFound();
}

// ---------------------------------------------------------------------------
// Config shape validation (task-pinned rules; the engine trial
// call underneath is authoritative for the full shape)
// ---------------------------------------------------------------------------

type JsonObject = Record<string, unknown>;

function isObject(v: unknown): v is JsonObject {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function spaceMarker(space: JsonObject): string | null {
  const marker = space.type ?? space.kind;
  return typeof marker === 'string' ? marker : null;
}

function isStartLike(marker: string): boolean {
  return marker.toLowerCase().includes('start');
}

function isPlaceLike(marker: string): boolean {
  return marker.toLowerCase().includes('place');
}

const DECK_KEY = /twist|surprise|card|deck/i;
// Engine amount fields are startCoins, passStartBonus, taxAmount;
// card-effect `amount` is deliberately NOT matched (a negative
// coins-card amount is a legitimate "pay" card, not an invalid
// negative balance — the engine trial validates effect amounts).
const COINS_BONUS_TAX_KEY = /(coins|bonus|taxamount)$/i;

// Every numeric coins/bonus/tax field anywhere in the config must
// be >= 0 (non-negative numbers rule).
function checkNonNegativeAmounts(value: unknown, path: string, errors: string[]): void {
  if (Array.isArray(value)) {
    value.forEach((v, i) => checkNonNegativeAmounts(v, `${path}[${i}]`, errors));
    return;
  }
  if (!isObject(value)) return;
  for (const [key, v] of Object.entries(value)) {
    if (typeof v === 'number' && COINS_BONUS_TAX_KEY.test(key) && !(v >= 0)) {
      errors.push(`${path}.${key} must be >= 0`);
    }
    checkNonNegativeAmounts(v, `${path}.${key}`, errors);
  }
}

function checkConfigShape(config: unknown): string[] {
  const errors: string[] = [];
  if (!isObject(config)) return ['config must be an object'];
  const spaces = (config as JsonObject).spaces;
  if (!Array.isArray(spaces)) return ['config.spaces must be an array'];
  if (spaces.length < 16 || spaces.length > 24) {
    errors.push('config.spaces must hold 16–24 spaces');
  }
  const seenIds = new Set<string>();
  spaces.forEach((raw, i) => {
    const path = `config.spaces[${i}]`;
    if (!isObject(raw)) {
      errors.push(`${path} must be an object`);
      return;
    }
    const id = raw.id;
    if (typeof id !== 'string' || id.trim().length === 0) {
      errors.push(`${path}.id must be a non-blank string`);
    } else if (seenIds.has(id)) {
      errors.push(`duplicate space id: ${id}`);
    } else {
      seenIds.add(id);
    }
    const marker = spaceMarker(raw);
    if (i === 0 && marker !== null && !isStartLike(marker)) {
      errors.push('config.spaces[0] must be the start space');
    }
    // Place rules: a place-typed space needs price > 0, rent >= 0,
    // and a non-blank category. A price/rent/category supplied on
    // any space must still satisfy the same bounds when present.
    const price = raw.price;
    const rent = raw.rent;
    const category = raw.category;
    if (marker !== null && isPlaceLike(marker)) {
      if (!(typeof price === 'number' && price > 0)) errors.push(`${path}.price must be > 0`);
      if (!(typeof rent === 'number' && rent >= 0)) errors.push(`${path}.rent must be >= 0`);
      if (!(typeof category === 'string' && category.trim().length >= 1)) {
        errors.push(`${path}.category must be present`);
      }
    } else {
      if (price !== undefined && !(typeof price === 'number' && price > 0)) {
        errors.push(`${path}.price must be > 0`);
      }
      if (rent !== undefined && !(typeof rent === 'number' && rent >= 0)) {
        errors.push(`${path}.rent must be >= 0`);
      }
      if (category !== undefined && !(typeof category === 'string' && category.trim().length >= 1)) {
        errors.push(`${path}.category must be a non-blank string`);
      }
    }
  });
  // Deck rule: every deck-like card array holds >= 1 card.
  for (const [key, v] of Object.entries(config as JsonObject)) {
    if (key === 'spaces') continue;
    if (Array.isArray(v) && DECK_KEY.test(key) && v.length < 1) {
      errors.push(`config.${key} must hold at least one card`);
    }
    if (key === 'decks' && isObject(v)) {
      for (const [deckName, deck] of Object.entries(v)) {
        if (Array.isArray(deck) && deck.length < 1) {
          errors.push(`config.decks.${deckName} must hold at least one card`);
        }
      }
    }
  }
  checkNonNegativeAmounts(config, 'config', errors);
  return errors;
}

// A space carries at most one reward link structurally (a single
// nullable memoryId field). The link must reference a real memory
// in the SAME space that is not deleted.
async function validateMemoryLinks(spaceId: string, config: unknown): Promise<void> {
  const spaces = (config as JsonObject).spaces;
  if (!Array.isArray(spaces)) return;
  for (const raw of spaces) {
    if (!isObject(raw)) continue;
    const memoryId = raw.memoryId;
    if (memoryId === undefined || memoryId === null) continue;
    if (typeof memoryId !== 'string' || memoryId.length === 0) {
      throw badRequest('Invalid request: memoryId');
    }
    const row = await prisma.memory.findFirst({
      where: { id: memoryId, spaceId, deletedAt: null },
    });
    if (!row) throw badRequest('Invalid request: memoryId');
  }
}

// Full config validation: zod-independent shape checks, memory
// links, then the trial createGame call (authoritative). Invalid
// configs are rejected here, at write time, with a 400.
async function validateBoardConfig(spaceId: string, config: unknown): Promise<void> {
  const shapeErrors = checkConfigShape(config);
  if (shapeErrors.length > 0) throw badRequest('Invalid board config');
  await validateMemoryLinks(spaceId, config);
  const dummyPlayers = [
    { name: 'Player 1', token: 'star' },
    { name: 'Player 2', token: 'moon' },
  ] as unknown as Parameters<typeof createGame>[1];
  try {
    createGame(config as unknown as BoardConfigData, dummyPlayers);
  } catch {
    throw badRequest('Invalid board config');
  }
}

// Map an engine error to a 400 carrying the engine's code/message
// (never a stack trace, SQL string, or client-supplied state).
// Engine errors are thrown as `Error("CODE: detail")`, so the code
// is extracted from the message prefix; the full message is kept
// so the code stays visible to the caller as well.
function engineErrorToApiError(e: unknown): ApiError {
  const raw = e instanceof Error && e.message ? e.message : 'Invalid action';
  const match = /^([A-Z_]+):\s/.exec(raw);
  const code =
    typeof (e as { code?: unknown } | null)?.code === 'string'
      ? ((e as { code: string }).code as string)
      : (match?.[1] ?? 'GAME_ERROR');
  return new ApiError(400, code, raw);
}

function gameStatusFromState(state: unknown): string {
  return isObject(state) && state.status === 'finished' ? 'finished' : 'playing';
}

// ---------------------------------------------------------------------------
// Request schemas (all strict: unknown fields are rejected, never
// silently ignored — so a client can never smuggle a balance,
// position, ownership, state, dice roll, or version past the route)
// ---------------------------------------------------------------------------

const configCreateSchema = z
  .object({
    name: nonBlank(200),
    config: z.unknown(),
  })
  .strict();

const configPatchSchema = z
  .object({
    name: nonBlank(200).optional(),
    config: z.unknown().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length >= 1, { message: 'At least one field is required' });

const playerSetupSchema = z.object({
  name: nonBlank(100),
  token: nonBlank(40),
});

const gameCreateSchema = z
  .object({
    configId: z.string().min(1),
    player1: playerSetupSchema,
    player2: playerSetupSchema,
  })
  .strict();

const restartSchema = z
  .object({
    player1: playerSetupSchema,
    player2: playerSetupSchema,
  })
  .strict();

// Action schema: the engine owns the discriminated-by-type action
// vocabulary beyond `type` + `actor`, so extra engine fields pass
// through — EXCEPT the forbidden set, which is rejected outright:
// a client-supplied balance, position, ownership, state, dice
// roll, or version is never trusted (version travels only as the
// top-level expectedVersion optimistic-lock check).
const FORBIDDEN_ACTION_FIELDS = new Set([
  'balance',
  'balances',
  'coins',
  'position',
  'positions',
  'owner',
  'ownership',
  'ownerid',
  'state',
  'gamestate',
  'dice',
  'diceroll',
  'die',
  'roll',
  'version',
]);

const actionSchema = z
  .object({
    type: z.string().min(1).max(100),
    actor: z.union([z.literal(0), z.literal(1)]),
  })
  .passthrough()
  .superRefine((v, ctx) => {
    for (const key of Object.keys(v)) {
      if (FORBIDDEN_ACTION_FIELDS.has(key.toLowerCase())) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Field not allowed: ${key}`, path: [key] });
      }
    }
  });

const actionBodySchema = z
  .object({
    action: actionSchema,
    expectedVersion: z.number().int(),
  })
  .strict();

// ---------------------------------------------------------------------------
// Configs
// ---------------------------------------------------------------------------

boardRouter.get('/spaces/:spaceId/board/configs', async (req, res, next) => {
  try {
    const callerId = requireUser(req);
    const spaceId = req.params.spaceId ?? '';
    await requireSpaceMember(callerId, spaceId);
    let rows = await prisma.boardConfig.findMany({
      where: { spaceId },
      orderBy: { createdAt: 'asc' },
    });
    // Default seeding (documented choice): a space with no configs
    // gets exactly one default row, authored by the requesting
    // member, so every space always has a playable board. The
    // seeded row is ordinary afterwards — it is not re-seeded
    // while any config exists, and its author alone may edit it.
    if (rows.length === 0) {
      const defaultConfig = DEFAULT_BOARD_CONFIG as unknown as JsonObject;
      const defaultName =
        typeof defaultConfig.name === 'string' && defaultConfig.name.trim().length >= 1
          ? defaultConfig.name
          : 'Our Board';
      const created = await prisma.boardConfig.create({
        data: {
          spaceId,
          authorId: callerId,
          name: defaultName,
          config: DEFAULT_BOARD_CONFIG as unknown as Prisma.InputJsonValue,
          isDefault: true,
        },
      });
      rows = [created];
    }
    return res.json({ data: rows.map(configPublic) });
  } catch (e) {
    return next(e);
  }
});

boardRouter.post(
  '/spaces/:spaceId/board/configs',
  validateBody(configCreateSchema),
  async (req, res, next) => {
    try {
      const callerId = requireUser(req);
      const spaceId = req.params.spaceId ?? '';
      await requireSpaceMember(callerId, spaceId);
      const body = req.body as z.infer<typeof configCreateSchema>;
      await validateBoardConfig(spaceId, body.config);
      const row = await prisma.boardConfig.create({
        data: {
          spaceId,
          authorId: callerId,
          name: body.name,
          config: body.config as Prisma.InputJsonValue,
          isDefault: false,
        },
      });
      return res.status(201).json({ data: configPublic(row) });
    } catch (e) {
      return next(e);
    }
  },
);

boardRouter.patch(
  '/spaces/:spaceId/board/configs/:configId',
  validateBody(configPatchSchema),
  async (req, res, next) => {
    try {
      const callerId = requireUser(req);
      const spaceId = req.params.spaceId ?? '';
      await requireSpaceMember(callerId, spaceId);
      const row = await scopedConfig(spaceId, req.params.configId ?? '');
      assertAuthor(row.authorId, callerId);
      const body = req.body as z.infer<typeof configPatchSchema>;
      // Same validation as create when a config is supplied. PATCH
      // never touches any running game's configSnapshot — games
      // hold their own copy (see the header notes).
      if (body.config !== undefined) await validateBoardConfig(spaceId, body.config);
      const updated = await prisma.boardConfig.update({
        where: { id: row.id },
        data: {
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.config !== undefined ? { config: body.config as Prisma.InputJsonValue } : {}),
        },
      });
      return res.json({ data: configPublic(updated) });
    } catch (e) {
      return next(e);
    }
  },
);

boardRouter.delete('/spaces/:spaceId/board/configs/:configId', async (req, res, next) => {
  try {
    const callerId = requireUser(req);
    const spaceId = req.params.spaceId ?? '';
    await requireSpaceMember(callerId, spaceId);
    const row = await scopedConfig(spaceId, req.params.configId ?? '');
    assertAuthor(row.authorId, callerId);
    // No cascade: configId is a plain id, so running games that
    // reference this config keep working from their snapshots.
    await prisma.boardConfig.delete({ where: { id: row.id } });
    return res.json({ data: { deleted: true } });
  } catch (e) {
    return next(e);
  }
});

// ---------------------------------------------------------------------------
// Rules (single source of truth: the engine's text)
// ---------------------------------------------------------------------------

boardRouter.get('/spaces/:spaceId/board/rules', async (req, res, next) => {
  try {
    const callerId = requireUser(req);
    const spaceId = req.params.spaceId ?? '';
    await requireSpaceMember(callerId, spaceId);
    return res.json({ data: { rules: BOARD_RULES_TEXT } });
  } catch (e) {
    return next(e);
  }
});

// ---------------------------------------------------------------------------
// Games
// ---------------------------------------------------------------------------

function playersFromBody(body: { player1: { name: string; token: string }; player2: { name: string; token: string } }) {
  return [body.player1, body.player2] as unknown as Parameters<typeof createGame>[1];
}

boardRouter.post(
  '/spaces/:spaceId/board/games',
  validateBody(gameCreateSchema),
  async (req, res, next) => {
    try {
      const callerId = requireUser(req);
      const spaceId = req.params.spaceId ?? '';
      await requireSpaceMember(callerId, spaceId);
      const body = req.body as z.infer<typeof gameCreateSchema>;
      const configRow = await prisma.boardConfig.findFirst({
        where: { id: body.configId, spaceId },
      });
      if (!configRow) throw notFound();
      // Snapshot: the game copies the stored config JSON now, so
      // later config edits cannot affect this running game.
      const snapshot = configRow.config;
      let state: GameState;
      try {
        state = createGame(snapshot as unknown as BoardConfigData, playersFromBody(body));
      } catch (e) {
        throw engineErrorToApiError(e);
      }
      const row = await prisma.boardGame.create({
        data: {
          spaceId,
          configId: configRow.id,
          configSnapshot: snapshot as Prisma.InputJsonValue,
          state: state as unknown as Prisma.InputJsonValue,
          version: 1,
          status: 'playing',
          createdById: callerId,
        },
      });
      return res.status(201).json({ data: gamePublic(row) });
    } catch (e) {
      return next(e);
    }
  },
);

boardRouter.get('/spaces/:spaceId/board/games/:gameId', async (req, res, next) => {
  try {
    const callerId = requireUser(req);
    const spaceId = req.params.spaceId ?? '';
    await requireSpaceMember(callerId, spaceId);
    const row = await scopedGame(spaceId, req.params.gameId ?? '');
    return res.json({ data: gamePublic(row) });
  } catch (e) {
    return next(e);
  }
});

boardRouter.post(
  '/spaces/:spaceId/board/games/:gameId/actions',
  validateBody(actionBodySchema),
  async (req, res, next) => {
    try {
      const callerId = requireUser(req);
      const spaceId = req.params.spaceId ?? '';
      await requireSpaceMember(callerId, spaceId);
      const body = req.body as z.infer<typeof actionBodySchema>;
      const row = await scopedGame(spaceId, req.params.gameId ?? '');
      // Optimistic locking: a stale writer gets 409, never a
      // silent overwrite. The version check runs before the
      // engine, and the final write re-checks it atomically
      // (updateMany with the expected version in the WHERE
      // clause), so two writers racing on the same version still
      // resolve to exactly one winner.
      // 409 MESSAGE CONTRACT (worker C / UI): the UI maps a
      // conflict error to its "game changed, reloaded" message by
      // matching message text, so both 409 messages below MUST
      // contain the lowercase words "stale" and "version".
      if (body.expectedVersion !== row.version) {
        throw conflict('STALE_VERSION', 'This game has a stale version — it has changed, reload and try again');
      }
      // No action is allowed on a finished game.
      if (row.status === 'finished') {
        throw new ApiError(400, 'GAME_FINISHED', 'This game is finished');
      }
      let nextState: GameState;
      try {
        // Server-side dice only: the route never passes dice and
        // the strict schema above rejects any client dice field,
        // so the engine rolls with its default rng.
        nextState = applyAction(
          row.state as unknown as GameState,
          body.action as unknown as BoardAction,
        );
      } catch (e) {
        throw engineErrorToApiError(e);
      }
      const nextStatus = gameStatusFromState(nextState);
      const updated = await prisma.boardGame.updateMany({
        where: { id: row.id, version: body.expectedVersion },
        data: {
          state: nextState as unknown as Prisma.InputJsonValue,
          version: row.version + 1,
          status: nextStatus,
        },
      });
      if (updated.count === 0) {
        throw conflict('STALE_VERSION', 'This game has a stale version — it has changed, reload and try again');
      }
      const fresh = await prisma.boardGame.findUniqueOrThrow({ where: { id: row.id } });
      return res.json({ data: gamePublic(fresh) });
    } catch (e) {
      return next(e);
    }
  },
);

boardRouter.post(
  '/spaces/:spaceId/board/games/:gameId/restart',
  validateBody(restartSchema),
  async (req, res, next) => {
    try {
      const callerId = requireUser(req);
      const spaceId = req.params.spaceId ?? '';
      await requireSpaceMember(callerId, spaceId);
      const body = req.body as z.infer<typeof restartSchema>;
      const old = await scopedGame(spaceId, req.params.gameId ?? '');
      // Restart = a NEW game row from the OLD game's snapshot, not
      // from the live config row: a config edited or deleted since
      // creation cannot change the restart, and the old row is
      // left untouched as history.
      let state: GameState;
      try {
        state = createGame(old.configSnapshot as unknown as BoardConfigData, playersFromBody(body));
      } catch (e) {
        throw engineErrorToApiError(e);
      }
      const row = await prisma.boardGame.create({
        data: {
          spaceId,
          configId: old.configId,
          configSnapshot: old.configSnapshot as Prisma.InputJsonValue,
          state: state as unknown as Prisma.InputJsonValue,
          version: 1,
          status: 'playing',
          createdById: callerId,
        },
      });
      return res.status(201).json({ data: gamePublic(row) });
    } catch (e) {
      return next(e);
    }
  },
);

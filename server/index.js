/* A Little Place Called Us — plain PostgreSQL API (Express + pg).
 *
 * This server is the ONLY thing that talks to PostgreSQL. The browser never
 * sees DATABASE_URL, never runs SQL, and never decides who may read what.
 * Privacy rules enforced here, on every request:
 *  - Every content request requires a JWT and membership in the space.
 *  - Private journals: queried with author_id = viewer, always.
 *  - Private drafts: only the author can read/update/delete them.
 *  - Scheduled letters: body is nulled for non-authors until reveal_at.
 *  - Permanent delete is refused unless the row is already soft-deleted.
 *  - Media: served only with a short-lived media token, membership checked
 *    from the first path segment (<space_id>/...).
 *
 * Env (see server/.env.example):
 *   DATABASE_URL   postgres://user:pass@host:port/db   (required)
 *   JWT_SECRET     long random string                 (required in production)
 *   PORT           default 4000
 *   CORS_ORIGIN    comma-separated origins, or unset to reflect the caller
 *   UPLOAD_DIR     default server/uploads
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');

// Tiny .env loader (server/.env) so `node index.js` works without extra deps.
(function loadEnvFile() {
  const file = path.join(__dirname, '.env');
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
})();

const PORT = Number(process.env.PORT || 4000);
const JWT_SECRET = process.env.JWT_SECRET;
const DATABASE_URL = process.env.DATABASE_URL;
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, 'uploads');
if (!DATABASE_URL) { console.error('DATABASE_URL is required. See server/.env.example'); process.exit(1); }
if (!JWT_SECRET) { console.error('JWT_SECRET is required. See server/.env.example'); process.exit(1); }

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: process.env.PG_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
});

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(cors({
  origin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',').map((s) => s.trim()) : true,
}));

// ---------- schema (idempotent; same file as postgres/schema.sql) ----------
async function ensureSchema() {
  // Local layout: postgres/ is a sibling of server/. Docker layout: it is copied next to index.js.
  const candidates = [path.join(__dirname, '..', 'postgres', 'schema.sql'), path.join(__dirname, 'postgres', 'schema.sql')];
  const found = candidates.find((f) => fs.existsSync(f));
  if (!found) throw new Error('postgres/schema.sql not found next to the server.');
  const sql = fs.readFileSync(found, 'utf8');
  await pool.query(sql);
  console.log('PostgreSQL schema is ready.');
}

// ---------- helpers ----------
function inviteCode() {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < 6; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}
function signToken(user) {
  // Phase 3: 7 days, not 30. A signed-in user stays signed in for a week;
  // an expired token is a 401 that sends the user back to sign-in (see auth()).
  // The token lives in this origin's localStorage only — see README's note on
  // why a static SPA cannot use httpOnly cookies without a server session layer.
  return jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '7d' });
}
function mediaToken(mediaPath, userId) {
  return jwt.sign({ type: 'media', path: mediaPath, id: userId }, JWT_SECRET, { expiresIn: '1h' });
}
function mediaUrl(mediaPath, userId) {
  return mediaPath ? `/api/media/${encodeURIComponent(mediaPath)}?t=${mediaToken(mediaPath, userId)}` : null;
}
function auth(req, res, next) {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ error: 'Sign in first.' });
  try { req.user = jwt.verify(token, JWT_SECRET); next(); }
  catch { return res.status(401).json({ error: 'That session has expired. Please sign in again.' }); }
}
async function isMember(userId, spaceId) {
  const r = await pool.query('SELECT 1 FROM space_members WHERE space_id=$1 AND user_id=$2', [spaceId, userId]);
  return r.rowCount > 0;
}
async function mySpace(userId) {
  const r = await pool.query(
    `SELECT s.id, s.name, s.invite_code, s.created_at
     FROM spaces s JOIN space_members m ON m.space_id = s.id
     WHERE m.user_id = $1 ORDER BY m.joined_at ASC LIMIT 1`,
    [userId]);
  if (!r.rows[0]) return null;
  const members = await pool.query(
    `SELECT u.id, u.display_name FROM users u JOIN space_members m ON m.user_id = u.id
     WHERE m.space_id = $1 ORDER BY m.joined_at ASC`, [r.rows[0].id]);
  return {
    space: { id: r.rows[0].id, name: r.rows[0].name, inviteCode: r.rows[0].invite_code, createdAt: r.rows[0].created_at },
    members: members.rows.map((m) => ({ id: m.id, displayName: m.display_name, shortName: m.id === userId ? 'You' : (m.display_name || 'Partner') })),
  };
}
function toIso(v) { return v ? new Date(v).toISOString() : null; }
// Calendar dates (happened_on, target_date) are DATE columns, not instants.
// pg returns them as midnight in the server's local timezone, so toISOString()
// (UTC) would shift them back a day in timezones east of UTC — a target of
// 2027-06-01 came back as 2027-05-31 in Asia/Calcutta. Format the local
// calendar components instead, so the stored date is the returned date.
function toDate(v) {
  if (!v) return null;
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
  const d = new Date(v);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Collection definitions: frontend camelCase -> database snake_case, whitelisted per table.
const COLLECTIONS = {
  reminders: { table: 'reminders', fields: { text: 'text', kind: 'kind' } },
  memories: { table: 'memories', fields: { title: 'title', caption: 'caption', story: 'story', happenedOn: 'happened_on', mediaPath: 'media_path', mediaType: 'media_type', tags: 'tags' } },
  letters: { table: 'letters', fields: { title: 'title', body: 'body', visibility: 'visibility', revealAt: 'reveal_at' } },
  journals: { table: 'journal_entries', fields: { title: 'title', body: 'body', mood: 'mood' } },
  appreciations: { table: 'appreciations', fields: { text: 'text', kind: 'kind', forName: 'for_name' } },
  plans: { table: 'future_plans', fields: { title: 'title', detail: 'detail', category: 'category', status: 'status', completedAt: 'completed_at', completionPhotoPath: 'completion_photo_path', targetDate: 'target_date' } },
  voiceNotes: { table: 'voice_notes', fields: { title: 'title', durationSec: 'duration_sec', mediaPath: 'media_path', room: 'room', linkedId: 'linked_id' } },
};
const COMMON = { isFavorite: 'is_favorite', deletedAt: 'deleted_at' };

function mapRow(collection, row, viewerId) {
  const def = COLLECTIONS[collection];
  const out = {
    id: row.id, spaceId: row.space_id, authorId: row.author_id, authorName: row.author_name,
    createdAt: toIso(row.created_at), updatedAt: toIso(row.updated_at),
    deletedAt: toIso(row.deleted_at), isFavorite: row.is_favorite,
  };
  for (const [camel, snake] of Object.entries(def.fields)) {
    let v = row[snake];
    if (camel === 'happenedOn' || camel === 'targetDate') v = toDate(v);
    else if (camel.endsWith('At')) v = toIso(v);
    else if (camel === 'tags') v = Array.isArray(v) ? v : [];
    out[camel] = v ?? null;
  }
  // Media URLs (short-lived tokens), derived server-side from the stored path only.
  if (collection === 'memories') out.mediaUrl = mediaUrl(row.media_path, viewerId);
  if (collection === 'plans') out.completionPhotoUrl = mediaUrl(row.completion_photo_path, viewerId);
  if (collection === 'voiceNotes') out.mediaUrl = mediaUrl(row.media_path, viewerId);
  // Sealed letters: non-authors get no body until reveal_at. The client also hides it,
  // but this is the enforcement — the words never leave the server before then.
  if (collection === 'letters' && row.visibility === 'scheduled' && row.author_id !== viewerId
    && row.reveal_at && new Date(row.reveal_at) > new Date()) {
    out.body = '';
  }
  return out;
}

function dbError(res, err) {
  if (err && err.code === '23514') return res.status(400).json({ error: 'That value is not allowed. Please check the form and try again.' });
  if (err && err.code === '23505') return res.status(400).json({ error: 'That already exists. Please try a different value.' });
  if (err && /already has two members/.test(err.message || '')) return res.status(400).json({ error: 'This space already has two members.' });
  if (err && /already belong to a space/.test(err.message || '')) return res.status(400).json({ error: 'You already belong to a space.' });
  console.error(err);
  return res.status(500).json({ error: 'Something went wrong on the server. Please try again.' });
}

// ---------- health / auth ----------
app.get('/api/health', async (_req, res) => {
  try { await pool.query('SELECT 1'); res.json({ ok: true, db: true }); }
  catch { res.status(500).json({ ok: false, db: false }); }
});

app.post('/api/auth/register', async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const displayName = String(req.body.displayName || '').trim().slice(0, 100) || 'You';
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: 'Please enter a valid email address.' });
  if (password.length < 8) return res.status(400).json({ error: 'Password needs at least 8 characters.' });
  try {
    const hash = await bcrypt.hash(password, 12);
    const r = await pool.query(
      'INSERT INTO users (email, password_hash, display_name) VALUES ($1, $2, $3) RETURNING id, email, display_name',
      [email, hash, displayName]);
    const user = r.rows[0];
    res.json({ token: signToken(user), user: { id: user.id, email: user.email, displayName: user.display_name } });
  } catch (e) { return dbError(res, e); }
});

app.post('/api/auth/login', async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  try {
    const r = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    const user = r.rows[0];
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({ error: 'Email or password does not match.' });
    }
    res.json({ token: signToken(user), user: { id: user.id, email: user.email, displayName: user.display_name } });
  } catch (e) { return dbError(res, e); }
});

app.get('/api/auth/me', auth, async (req, res) => {
  const r = await pool.query('SELECT id, email, display_name FROM users WHERE id = $1', [req.user.id]);
  if (!r.rows[0]) return res.status(401).json({ error: 'Account not found.' });
  res.json({ id: r.rows[0].id, email: r.rows[0].email, displayName: r.rows[0].display_name });
});

// Phase 3 profile: a user may rename only themself. Avatar path is stored
// on the user row for a later avatar UI; it is never set from a file path
// the client invents — uploads go through /api/upload, which namespaces
// the path by space.
app.patch('/api/auth/me', auth, async (req, res) => {
  const displayName = String(req.body.displayName || '').trim().slice(0, 100);
  if (!displayName) return res.status(400).json({ error: 'Please enter a display name.' });
  try {
    const r = await pool.query('UPDATE users SET display_name = $1 WHERE id = $2 RETURNING id, email, display_name', [displayName, req.user.id]);
    if (!r.rows[0]) return res.status(401).json({ error: 'Account not found.' });
    res.json({ id: r.rows[0].id, email: r.rows[0].email, displayName: r.rows[0].display_name });
  } catch (e) { return dbError(res, e); }
});

// ---------- spaces ----------
app.post('/api/spaces', auth, async (req, res) => {
  const name = String(req.body.name || '').trim().slice(0, 200) || 'A Little Place Called Us';
  try {
    // One space per user: the database trigger enforces this too, but the
    // explicit check gives a clean 400 instead of a trigger error.
    const existing = await pool.query('SELECT 1 FROM space_members WHERE user_id = $1', [req.user.id]);
    if (existing.rowCount) return res.status(400).json({ error: 'You already belong to a space.' });
    const s = await pool.query(
      'INSERT INTO spaces (name, invite_code, created_by) VALUES ($1, $2, $3) RETURNING *',
      [name, inviteCode(), req.user.id]);
    await pool.query('INSERT INTO space_members (space_id, user_id, role) VALUES ($1, $2, $3)', [s.rows[0].id, req.user.id, 'owner']);
    res.json({ id: s.rows[0].id, name: s.rows[0].name, inviteCode: s.rows[0].invite_code, createdAt: toIso(s.rows[0].created_at) });
  } catch (e) { return dbError(res, e); }
});

app.post('/api/spaces/join', auth, async (req, res) => {
  const code = String(req.body.inviteCode || '').trim().toUpperCase();
  if (!code) return res.status(400).json({ error: 'Please enter an invite code.' });
  try {
    // Invitation codes first: unexpired, unredeemed, single-use. The
    // redemption and the membership insert happen in one transaction, so
    // a code cannot be redeemed twice by two concurrent joins.
    const inv = await pool.query(
      'SELECT * FROM invitations WHERE code = $1 AND redeemed_by IS NULL AND expires_at > now() ORDER BY created_at DESC LIMIT 1',
      [code]);
    if (inv.rows[0]) {
      const already = await pool.query('SELECT 1 FROM space_members WHERE space_id = $1 AND user_id = $2', [inv.rows[0].space_id, req.user.id]);
      if (already.rowCount) {
        const s = await pool.query('SELECT * FROM spaces WHERE id = $1', [inv.rows[0].space_id]);
        return res.json({ id: s.rows[0].id, name: s.rows[0].name, inviteCode: s.rows[0].invite_code, createdAt: toIso(s.rows[0].created_at) });
      }
      const other = await pool.query('SELECT 1 FROM space_members WHERE user_id = $1', [req.user.id]);
      if (other.rowCount) return res.status(400).json({ error: 'You already belong to a space.' });
      const count = await pool.query('SELECT count(*)::int AS n FROM space_members WHERE space_id = $1', [inv.rows[0].space_id]);
      if (count.rows[0].n >= 2) return res.status(400).json({ error: 'This space already has two members.' });
      await pool.query('BEGIN');
      try {
        await pool.query('UPDATE invitations SET redeemed_by = $1, redeemed_at = now() WHERE id = $2 AND redeemed_by IS NULL', [req.user.id, inv.rows[0].id]);
        await pool.query('INSERT INTO space_members (space_id, user_id, role) VALUES ($1, $2, $3)', [inv.rows[0].space_id, req.user.id, 'member']);
        await pool.query('COMMIT');
      } catch (e) { await pool.query('ROLLBACK'); throw e; }
      const s = await pool.query('SELECT * FROM spaces WHERE id = $1', [inv.rows[0].space_id]);
      return res.json({ id: s.rows[0].id, name: s.rows[0].name, inviteCode: s.rows[0].invite_code, createdAt: toIso(s.rows[0].created_at) });
    }
    // Fall back to the space's permanent invite code.
    const s = await pool.query('SELECT * FROM spaces WHERE invite_code = $1', [code]);
    if (!s.rows[0]) return res.status(404).json({ error: 'No space was found with that invite code.' });
    const already = await pool.query('SELECT 1 FROM space_members WHERE space_id = $1 AND user_id = $2', [s.rows[0].id, req.user.id]);
    if (already.rowCount) {
      return res.json({ id: s.rows[0].id, name: s.rows[0].name, inviteCode: s.rows[0].invite_code, createdAt: toIso(s.rows[0].created_at) });
    }
    const other = await pool.query('SELECT 1 FROM space_members WHERE user_id = $1', [req.user.id]);
    if (other.rowCount) return res.status(400).json({ error: 'You already belong to a space.' });
    await pool.query('INSERT INTO space_members (space_id, user_id, role) VALUES ($1, $2, $3)', [s.rows[0].id, req.user.id, 'member']);
    res.json({ id: s.rows[0].id, name: s.rows[0].name, inviteCode: s.rows[0].invite_code, createdAt: toIso(s.rows[0].created_at) });
  } catch (e) { return dbError(res, e); }
});

// Phase 3 invitation: a member creates a 7-day, single-use code for their
// space. Creating one for a full space is refused — it could never be used.
app.post('/api/invitations', auth, async (req, res) => {
  try {
    const mine = await mySpace(req.user.id);
    if (!mine) return res.status(400).json({ error: 'Join or create a space first.' });
    if (mine.members.length >= 2) return res.status(400).json({ error: 'This space already has two members.' });
    let code = '';
    for (let attempt = 0; attempt < 20 && !code; attempt++) {
      const candidate = inviteCode();
      const clash = await pool.query('SELECT 1 FROM invitations WHERE code = $1 UNION SELECT 1 FROM spaces WHERE invite_code = $1', [candidate]);
      if (!clash.rowCount) code = candidate;
    }
    if (!code) return res.status(500).json({ error: 'Could not create an invite code. Please try again.' });
    const r = await pool.query(
      'INSERT INTO invitations (space_id, code, created_by) VALUES ($1, $2, $3) RETURNING code, expires_at',
      [mine.space.id, code, req.user.id]);
    res.status(201).json({ code: r.rows[0].code, expiresAt: toIso(r.rows[0].expires_at), spaceId: mine.space.id });
  } catch (e) { return dbError(res, e); }
});

// ---------- whole-space read (what the frontend loads on open) ----------
app.get('/api/data', auth, async (req, res) => {
  try {
    const mine = await mySpace(req.user.id);
    if (!mine) return res.json({ space: null, members: [], viewer: req.user, reminders: [], memories: [], letters: [], journals: [], appreciations: [], plans: [], voiceNotes: [] });
    const { space } = mine;
    const out = { space, members: mine.members, viewer: req.user };
    for (const [collection, def] of Object.entries(COLLECTIONS)) {
      let sql = `SELECT * FROM ${def.table} WHERE space_id = $1`;
      const params = [space.id];
      if (collection === 'journals') { sql += ' AND author_id = $2'; params.push(req.user.id); }
      if (collection === 'letters') { sql += ` AND (visibility <> 'private_draft' OR author_id = $2)`; params.push(req.user.id); }
      sql += ' ORDER BY created_at DESC';
      const r = await pool.query(sql, params);
      out[collection] = r.rows.map((row) => mapRow(collection, row, req.user.id));
    }
    res.json(out);
  } catch (e) { return dbError(res, e); }
});

// ---------- generic item CRUD (membership + ownership checked per row) ----------
async function loadOwned(req, res, collection) {
  const def = COLLECTIONS[collection];
  if (!def) { res.status(404).json({ error: 'Unknown collection.' }); return null; }
  const mine = await mySpace(req.user.id);
  if (!mine) { res.status(400).json({ error: 'Join or create a space first.' }); return null; }
  const r = await pool.query(`SELECT * FROM ${def.table} WHERE id = $1 AND space_id = $2`, [req.params.id, mine.space.id]);
  if (!r.rows[0]) { res.status(404).json({ error: 'That item could not be found.' }); return null; }
  const row = r.rows[0];
  // Personal-voice items are author-only for changes, matching the UI
  // (which only shows Edit to the author). Shared artefacts — reminders,
  // memories, plans, voice notes — stay editable by either member.
  // Phase 8 audit fix: before this, any member could PATCH or delete a
  // partner's shared letter or appreciation through the API, even though
  // the UI hid the Edit button. Journals and private drafts were already
  // author-only here.
  if ((collection === 'journals' || collection === 'letters' || collection === 'appreciations') && row.author_id !== req.user.id) {
    res.status(403).json({ error: 'You can only change your own letters, appreciations and private entries.' });
    return null;
  }
  return { mine, row };
}

function sanitiseTags(body) {
  // Tags are a TEXT[] column: only a short, trimmed string array is accepted.
  if (body.tags === undefined) return;
  body.tags = Array.isArray(body.tags)
    ? body.tags.filter((t) => typeof t === 'string').map((t) => t.trim().slice(0, 50)).filter(Boolean).slice(0, 10)
    : [];
}

app.post('/api/items/:collection', auth, async (req, res) => {
  const def = COLLECTIONS[req.params.collection];
  if (!def) return res.status(404).json({ error: 'Unknown collection.' });
  sanitiseTags(req.body);
  try {
    const mine = await mySpace(req.user.id);
    if (!mine) return res.status(400).json({ error: 'Join or create a space first.' });
    const me = await pool.query('SELECT display_name FROM users WHERE id = $1', [req.user.id]);
    const cols = ['space_id', 'author_id', 'author_name'];
    const vals = [mine.space.id, req.user.id, me.rows[0].display_name];
    for (const [camel, snake] of Object.entries(def.fields)) {
      if (req.body[camel] !== undefined && req.body[camel] !== null) { cols.push(snake); vals.push(req.body[camel]); }
    }
    if (req.body.isFavorite !== undefined) { cols.push('is_favorite'); vals.push(Boolean(req.body.isFavorite)); }
    const placeholders = vals.map((_, i) => `$${i + 1}`).join(', ');
    const r = await pool.query(`INSERT INTO ${def.table} (${cols.join(', ')}) VALUES (${placeholders}) RETURNING *`, vals);
    res.status(201).json(mapRow(req.params.collection, r.rows[0], req.user.id));
  } catch (e) { return dbError(res, e); }
});

app.patch('/api/items/:collection/:id', auth, async (req, res) => {
  const def = COLLECTIONS[req.params.collection];
  if (!def) return res.status(404).json({ error: 'Unknown collection.' });
  sanitiseTags(req.body);
  try {
    const owned = await loadOwned(req, res, req.params.collection);
    if (!owned) return;
    const sets = [];
    const vals = [];
    const allowed = { ...def.fields, ...COMMON };
    for (const [camel, snake] of Object.entries(allowed)) {
      if (req.body[camel] !== undefined) { vals.push(req.body[camel]); sets.push(`${snake} = $${vals.length}`); }
    }
    if (!sets.length) return res.status(400).json({ error: 'Nothing to change.' });
    vals.push(req.params.id);
    const r = await pool.query(
      `UPDATE ${def.table} SET ${sets.join(', ')}, updated_at = now() WHERE id = $${vals.length} RETURNING *`, vals);
    res.json(mapRow(req.params.collection, r.rows[0], req.user.id));
  } catch (e) { return dbError(res, e); }
});

app.post('/api/items/:collection/:id/restore', auth, async (req, res) => {
  const def = COLLECTIONS[req.params.collection];
  if (!def) return res.status(404).json({ error: 'Unknown collection.' });
  try {
    const owned = await loadOwned(req, res, req.params.collection);
    if (!owned) return;
    const r = await pool.query(`UPDATE ${def.table} SET deleted_at = NULL, updated_at = now() WHERE id = $1 RETURNING *`, [req.params.id]);
    res.json(mapRow(req.params.collection, r.rows[0], req.user.id));
  } catch (e) { return dbError(res, e); }
});

app.delete('/api/items/:collection/:id', auth, async (req, res) => {
  const def = COLLECTIONS[req.params.collection];
  if (!def) return res.status(404).json({ error: 'Unknown collection.' });
  try {
    const owned = await loadOwned(req, res, req.params.collection);
    if (!owned) return;
    if (!owned.row.deleted_at) {
      return res.status(400).json({ error: 'Move it to Deleted first. Permanent deletion is only for already-deleted items.' });
    }
    await pool.query(`DELETE FROM ${def.table} WHERE id = $1`, [req.params.id]);
    res.json({ ok: true });
  } catch (e) { return dbError(res, e); }
});

// ---------- Phase 5 arcade ----------
// Configs are shared: either member may edit them. Progress is validated
// here, not trusted from the client: scores/moves/time must be non-negative
// integers, a quiz score cannot exceed the number of questions in the
// stored quiz config, and a Memory Match completion needs at least as many
// moves as there are pairs (one flip per card, at minimum).
function normaliseAnswer(s) {
  return String(s || '').trim().toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ');
}

app.get('/api/games/data', auth, async (req, res) => {
  try {
    const mine = await mySpace(req.user.id);
    if (!mine) return res.json({ configs: {}, progress: [], rounds: [] });
    const configs = {};
    const cfg = await pool.query('SELECT game_key, config FROM game_configs WHERE space_id = $1', [mine.space.id]);
    for (const row of cfg.rows) configs[row.game_key] = row.config;
    const prog = await pool.query(
      `SELECT p.*, u.display_name FROM game_progress p JOIN users u ON u.id = p.user_id
       WHERE p.space_id = $1 ORDER BY p.updated_at DESC`, [mine.space.id]);
    const progress = prog.rows.map((r) => ({
      id: r.id, gameKey: r.game_key, userId: r.user_id, userName: r.display_name,
      score: r.score, moves: r.moves ?? null, timeMs: r.time_ms ?? null, completed: true,
      details: r.progress || {}, updatedAt: toIso(r.updated_at),
    }));
    const rounds = await pool.query('SELECT * FROM game_rounds WHERE space_id = $1 ORDER BY created_at DESC', [mine.space.id]);
    res.json({
      configs,
      progress,
      rounds: rounds.rows.map((r) => ({
        id: r.id, spaceId: r.space_id, creatorId: r.creator_id, creatorName: '',
        question: r.question,
        // Answer masking: only the creator, or anyone after reveal, sees it.
        answer: (r.revealed || r.creator_id === req.user.id) ? r.answer : null,
        guess: r.guess, guessedBy: r.guessed_by, correct: r.correct, revealed: r.revealed,
        createdAt: toIso(r.created_at),
      })),
    });
  } catch (e) { return dbError(res, e); }
});

app.put('/api/games/config/:key', auth, async (req, res) => {
  const key = String(req.params.key || '').slice(0, 100);
  if (!key || typeof req.body.config !== 'object' || req.body.config === null) {
    return res.status(400).json({ error: 'A game config is needed.' });
  }
  try {
    const mine = await mySpace(req.user.id);
    if (!mine) return res.status(400).json({ error: 'Join or create a space first.' });
    await pool.query(
      `INSERT INTO game_configs (space_id, game_key, config, updated_by) VALUES ($1, $2, $3, $4)
       ON CONFLICT (space_id, game_key) DO UPDATE SET config = EXCLUDED.config, updated_by = EXCLUDED.updated_by, updated_at = now()`,
      [mine.space.id, key, JSON.stringify(req.body.config), req.user.id]);
    res.json({ ok: true });
  } catch (e) { return dbError(res, e); }
});

app.post('/api/games/progress', auth, async (req, res) => {
  const gameKey = String(req.body.gameKey || '').slice(0, 100);
  const score = Number(req.body.score);
  const moves = req.body.moves === undefined || req.body.moves === null ? null : Number(req.body.moves);
  const timeMs = req.body.timeMs === undefined || req.body.timeMs === null ? null : Number(req.body.timeMs);
  if (!gameKey || !Number.isInteger(score) || score < 0
    || (moves !== null && (!Number.isInteger(moves) || moves < 0))
    || (timeMs !== null && (!Number.isInteger(timeMs) || timeMs < 0))) {
    return res.status(400).json({ error: 'That score is not valid.' });
  }
  try {
    const mine = await mySpace(req.user.id);
    if (!mine) return res.status(400).json({ error: 'Join or create a space first.' });
    // Quiz scores cannot exceed the stored question count.
    if (gameKey === 'quiz') {
      const cfg = await pool.query('SELECT config FROM game_configs WHERE space_id = $1 AND game_key = $2', [mine.space.id, 'quiz']);
      const total = Array.isArray(cfg.rows[0]?.config?.questions) ? cfg.rows[0].config.questions.length : null;
      if (total !== null && score > total) return res.status(400).json({ error: 'That score is not valid.' });
    }
    if (gameKey === 'memory') {
      const cfg = await pool.query('SELECT config FROM game_configs WHERE space_id = $1 AND game_key = $2', [mine.space.id, 'memory']);
      const pairs = Number(cfg.rows[0]?.config?.pairs) || 6;
      if (moves !== null && moves < pairs) return res.status(400).json({ error: 'That score is not valid.' });
    }
    const details = (req.body.details && typeof req.body.details === 'object') ? req.body.details : {};
    await pool.query(
      `INSERT INTO game_progress (space_id, user_id, game_key, score, moves, time_ms, progress, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, now())
       ON CONFLICT (space_id, user_id, game_key) DO UPDATE SET score = EXCLUDED.score, moves = EXCLUDED.moves, time_ms = EXCLUDED.time_ms, progress = EXCLUDED.progress, updated_at = now()`,
      [mine.space.id, req.user.id, gameKey, score, moves, timeMs, JSON.stringify(details)]);
    await pool.query(
      'INSERT INTO game_sessions (space_id, game_key, status, started_by, ended_at) VALUES ($1, $2, $3, $4, now())',
      [mine.space.id, gameKey, 'finished', req.user.id]);
    res.json({ ok: true });
  } catch (e) { return dbError(res, e); }
});

app.post('/api/games/rounds', auth, async (req, res) => {
  const question = String(req.body.question || '').trim().slice(0, 1000);
  const answer = String(req.body.answer || '').trim().slice(0, 1000);
  if (!question || !answer) return res.status(400).json({ error: 'A question and a private answer are needed.' });
  try {
    const mine = await mySpace(req.user.id);
    if (!mine) return res.status(400).json({ error: 'Join or create a space first.' });
    const r = await pool.query(
      'INSERT INTO game_rounds (space_id, creator_id, question, answer) VALUES ($1, $2, $3, $4) RETURNING *',
      [mine.space.id, req.user.id, question, answer]);
    res.status(201).json({ id: r.rows[0].id, question: r.rows[0].question, answer: r.rows[0].answer, revealed: false });
  } catch (e) { return dbError(res, e); }
});

app.post('/api/games/rounds/:id/guess', auth, async (req, res) => {
  const guess = String(req.body.guess || '').trim();
  if (!guess) return res.status(400).json({ error: 'Please enter a guess.' });
  try {
    const mine = await mySpace(req.user.id);
    if (!mine) return res.status(400).json({ error: 'Join or create a space first.' });
    const r = await pool.query('SELECT * FROM game_rounds WHERE id = $1 AND space_id = $2', [req.params.id, mine.space.id]);
    if (!r.rows[0]) return res.status(404).json({ error: 'That round could not be found.' });
    const round = r.rows[0];
    if (round.creator_id === req.user.id) return res.status(400).json({ error: 'You cannot guess your own question.' });
    if (round.revealed) return res.status(400).json({ error: 'That round has already been guessed.' });
    const correct = normaliseAnswer(guess) === normaliseAnswer(round.answer);
    await pool.query(
      'UPDATE game_rounds SET guess = $1, guessed_by = $2, correct = $3, revealed = true, updated_at = now() WHERE id = $4',
      [guess, req.user.id, correct, round.id]);
    res.json({ correct, answer: round.answer });
  } catch (e) { return dbError(res, e); }
});

// ---------- Phase 7 board game ----------
// The client sends only an ACTION, never a full state. The server loads
// the stored game, re-runs the engine from that state (the same engine
// file the frontend uses, imported with Node's type stripping — there is
// no second copy to drift), and writes the new state only if the version
// still matches. A stale version is a 409: the client reloads and retries.
// Balances and ownership are therefore never accepted from a device.
let boardEnginePromise = null;
async function loadBoardEngine() {
  if (!boardEnginePromise) {
    boardEnginePromise = import('../src/lib/boardGame.ts').catch((e) => {
      boardEnginePromise = null;
      throw e;
    });
  }
  return boardEnginePromise;
}

function boardGameRow(r) {
  return { id: r.id, config: r.config, state: r.state, version: r.version, status: r.status };
}

app.get('/api/board/games', auth, async (req, res) => {
  try {
    const mine = await mySpace(req.user.id);
    if (!mine) return res.json({ game: null });
    const r = await pool.query('SELECT * FROM board_games WHERE space_id = $1 ORDER BY created_at DESC LIMIT 1', [mine.space.id]);
    if (!r.rows[0]) return res.json({ game: null });
    res.json({ game: boardGameRow(r.rows[0]) });
  } catch (e) { return dbError(res, e); }
});

app.post('/api/board/games', auth, async (req, res) => {
  try {
    const engine = await loadBoardEngine();
    const mine = await mySpace(req.user.id);
    if (!mine) return res.status(400).json({ error: 'Join or create a space first.' });
    const players = Array.isArray(req.body.players) ? req.body.players.slice(0, 2) : [];
    const created = engine.createBoardGame(req.body.config, players);
    if (!created.ok) return res.status(400).json({ error: created.error });
    const r = await pool.query(
      'INSERT INTO board_games (space_id, config, state, version, status, current_turn_user_id) VALUES ($1, $2, $3, 0, $4, $5) RETURNING *',
      [mine.space.id, JSON.stringify(req.body.config), JSON.stringify(created.state), 'active', req.user.id]);
    res.status(201).json({ game: boardGameRow(r.rows[0]) });
  } catch (e) { return dbError(res, e); }
});

app.post('/api/board/games/:id/action', auth, async (req, res) => {
  try {
    const engine = await loadBoardEngine();
    const mine = await mySpace(req.user.id);
    if (!mine) return res.status(400).json({ error: 'Join or create a space first.' });
    const r = await pool.query('SELECT * FROM board_games WHERE id = $1 AND space_id = $2', [req.params.id, mine.space.id]);
    if (!r.rows[0]) return res.status(404).json({ error: 'That board game could not be found.' });
    const game = r.rows[0];
    if (game.status !== 'active') return res.status(400).json({ error: 'That board game is already finished.' });
    if (Number(req.body.version) !== game.version) {
      return res.status(409).json({ error: 'That game changed since you last saw it. Reload it and try again.' });
    }
    const state = game.state;
    const config = game.config;
    let result;
    switch (req.body.action) {
      case 'roll': result = engine.roll(state, config, Number(req.body.d1), Number(req.body.d2)); break;
      case 'buy': result = engine.buy(state, config); break;
      case 'pass': result = engine.declineBuy(state); break;
      case 'trade': result = engine.proposeTrade(state, String(req.body.propertyId || ''), Number(req.body.price)); break;
      case 'tradeRespond': result = engine.respondTrade(state, req.body.accept === true); break;
      case 'endEarly': result = engine.endEarly(state); break;
      default: return res.status(400).json({ error: 'That board action is not known.' });
    }
    if (!result.ok) return res.status(400).json({ error: result.error });
    const newState = result.state;
    const newStatus = newState.phase === 'gameover' ? 'finished' : 'active';
    const updated = await pool.query(
      'UPDATE board_games SET state = $1, version = version + 1, status = $2, current_turn_user_id = $3, updated_at = now() WHERE id = $4 AND version = $5 RETURNING *',
      [JSON.stringify(newState), newStatus, req.user.id, game.id, game.version]);
    if (!updated.rows[0]) {
      return res.status(409).json({ error: 'That game changed since you last saw it. Reload it and try again.' });
    }
    await pool.query('INSERT INTO board_game_moves (board_game_id, user_id, move) VALUES ($1, $2, $3)',
      [game.id, req.user.id, JSON.stringify({ action: req.body.action, version: game.version + 1 })]);
    res.json({ game: boardGameRow(updated.rows[0]) });
  } catch (e) { return dbError(res, e); }
});

// ---------- uploads (private: disk under <space_id>/, served only via media token) ----------
const storage = multer({
  storage: multer.diskStorage({
    destination: async (req, file, cb) => {
      try {
        const mine = await mySpace(req.user.id);
        if (!mine) return cb(new Error('Join or create a space first.'));
        const dir = path.join(UPLOAD_DIR, mine.space.id, req.body.kind === 'voice' ? 'voice' : 'photo');
        fs.mkdirSync(dir, { recursive: true });
        req.spaceId = mine.space.id;
        cb(null, dir);
      } catch (e) { cb(e); }
    },
    filename: (_req, file, cb) => {
      const ext = (path.extname(file.originalname || '').toLowerCase() || '.bin').slice(0, 10);
      cb(null, `${crypto.randomUUID()}${ext}`);
    },
  }),
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    // Phase 8 audit fix: the mimetype alone is client-controlled, so a
    // .html file sent as image/png used to pass and could then be served
    // with an HTML content type. The extension must also be an allowed
    // image/audio extension, regardless of the claimed mimetype.
    const ext = (path.extname(file.originalname || '').toLowerCase() || '');
    const allowedExt = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.avif', '.mp3', '.wav', '.ogg', '.m4a', '.webm'];
    if (/^(image|audio)\//.test(file.mimetype) && allowedExt.includes(ext)) cb(null, true);
    else cb(new Error('Only images and audio files can be uploaded.'));
  },
});

// Phase 10: trusted file-signature check. Multer's fileFilter sees only the
// client-claimed mimetype and filename extension, so a file named photo.png
// containing HTML would pass it and then be served as image/png (low risk
// on its own, since browsers do not execute image/png as HTML, but still
// wrong). The saved file's first bytes are the ground truth: they must
// match the extension's real format, or the file is deleted and rejected.
// This is the check Supabase mode cannot enforce without a trusted server
// (its Storage policies check extension only — see migration 0009).
function signatureOk(buf, ext) {
  if (!buf || buf.length < 4) return false;
  const ascii = (at, len) => buf.slice(at, at + len).toString('latin1');
  switch (ext) {
    case '.png': return buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
    case '.jpg': case '.jpeg': return buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
    case '.gif': return ascii(0, 4) === 'GIF8';
    case '.webp': return ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP';
    case '.avif': return ascii(4, 4) === 'ftyp' && ['avif', 'avis', 'av01'].includes(ascii(8, 4));
    case '.mp3': return ascii(0, 3) === 'ID3' || (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0);
    case '.wav': return ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WAVE';
    case '.ogg': return ascii(0, 4) === 'OggS';
    case '.m4a': return ascii(4, 4) === 'ftyp';
    case '.webm': return buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3;
    default: return false;
  }
}

app.post('/api/upload', auth, (req, res) => {
  storage.single('file')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'No file was uploaded.' });
    try {
      const fd = fs.openSync(req.file.path, 'r');
      const head = Buffer.alloc(12);
      fs.readSync(fd, head, 0, 12, 0);
      fs.closeSync(fd);
      const ext = path.extname(req.file.filename || '').toLowerCase();
      if (!signatureOk(head, ext)) {
        fs.unlinkSync(req.file.path);
        return res.status(400).json({ error: 'That file does not match its extension. Please choose a real photo or audio file.' });
      }
    } catch (e) {
      try { fs.unlinkSync(req.file.path); } catch { /* already gone */ }
      return res.status(400).json({ error: 'That file could not be verified. Please try again.' });
    }
    const kind = req.body.kind === 'voice' ? 'voice' : 'photo';
    const mediaPath = `${req.spaceId}/${kind}/${req.file.filename}`;
    res.json({ path: mediaPath, url: mediaUrl(mediaPath, req.user.id) });
  });
});

app.get('/api/media/:encoded', async (req, res) => {
  try {
    const token = String(req.query.t || '');
    const payload = jwt.verify(token, JWT_SECRET);
    if (payload.type !== 'media' || !payload.path) return res.status(403).json({ error: 'Invalid media link.' });
    const spaceId = String(payload.path).split('/')[0];
    // The token carries the viewer it was issued to; re-check that viewer is still a
    // member of the space in the path, so a token for one space cannot open another's files.
    const member = await pool.query('SELECT 1 FROM space_members WHERE space_id = $1 AND user_id = $2', [spaceId, payload.id]);
    if (!member.rowCount) return res.status(403).json({ error: 'Invalid media link.' });
    const filePath = path.join(UPLOAD_DIR, payload.path);
    const resolved = path.resolve(filePath);
    if (!resolved.startsWith(path.resolve(UPLOAD_DIR))) return res.status(403).json({ error: 'Invalid media link.' });
    if (!fs.existsSync(resolved)) return res.status(404).json({ error: 'That file is no longer available.' });
    // nosniff: a file served as image/audio must never be sniffed as HTML by the browser.
    res.set('X-Content-Type-Options', 'nosniff');
    res.sendFile(resolved);
  } catch {
    return res.status(403).json({ error: 'That media link has expired. Please reopen the app.' });
  }
});

// ---------- boot ----------
ensureSchema()
  .then(() => app.listen(PORT, () => console.log(`A Little Place Called Us API listening on http://localhost:${PORT}`)))
  .catch((e) => { console.error('Could not start: failed to apply the PostgreSQL schema.', e.message); process.exit(1); });

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
  return jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '30d' });
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
function toDate(v) { return v ? new Date(v).toISOString().slice(0, 10) : null; }

// Collection definitions: frontend camelCase -> database snake_case, whitelisted per table.
const COLLECTIONS = {
  reminders: { table: 'reminders', fields: { text: 'text', kind: 'kind' } },
  memories: { table: 'memories', fields: { title: 'title', caption: 'caption', story: 'story', happenedOn: 'happened_on', mediaPath: 'media_path', mediaType: 'media_type' } },
  letters: { table: 'letters', fields: { title: 'title', body: 'body', visibility: 'visibility', revealAt: 'reveal_at' } },
  journals: { table: 'journal_entries', fields: { title: 'title', body: 'body', mood: 'mood' } },
  appreciations: { table: 'appreciations', fields: { text: 'text', kind: 'kind', forName: 'for_name' } },
  plans: { table: 'future_plans', fields: { title: 'title', detail: 'detail', category: 'category', status: 'status', completedAt: 'completed_at', completionPhotoPath: 'completion_photo_path' } },
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
    if (camel === 'happenedOn') v = toDate(v);
    else if (camel.endsWith('At')) v = toIso(v);
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

// ---------- spaces ----------
app.post('/api/spaces', auth, async (req, res) => {
  const name = String(req.body.name || '').trim().slice(0, 200) || 'A Little Place Called Us';
  try {
    const s = await pool.query(
      'INSERT INTO spaces (name, invite_code, created_by) VALUES ($1, $2, $3) RETURNING *',
      [name, inviteCode(), req.user.id]);
    await pool.query('INSERT INTO space_members (space_id, user_id, role) VALUES ($1, $2, $3)', [s.rows[0].id, req.user.id, 'owner']);
    res.json({ id: s.rows[0].id, name: s.rows[0].name, inviteCode: s.rows[0].invite_code, createdAt: toIso(s.rows[0].created_at) });
  } catch (e) { return dbError(res, e); }
});

app.post('/api/spaces/join', auth, async (req, res) => {
  const code = String(req.body.inviteCode || '').trim().toUpperCase();
  try {
    const s = await pool.query('SELECT * FROM spaces WHERE invite_code = $1', [code]);
    if (!s.rows[0]) return res.status(404).json({ error: 'No space was found with that invite code.' });
    await pool.query('INSERT INTO space_members (space_id, user_id, role) VALUES ($1, $2, $3)', [s.rows[0].id, req.user.id, 'member']);
    res.json({ id: s.rows[0].id, name: s.rows[0].name, inviteCode: s.rows[0].invite_code, createdAt: toIso(s.rows[0].created_at) });
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
  if ((collection === 'journals' || (collection === 'letters' && row.visibility === 'private_draft')) && row.author_id !== req.user.id) {
    res.status(403).json({ error: 'You can only change your own private entries.' });
    return null;
  }
  return { mine, row };
}

app.post('/api/items/:collection', auth, async (req, res) => {
  const def = COLLECTIONS[req.params.collection];
  if (!def) return res.status(404).json({ error: 'Unknown collection.' });
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
    if (/^(image|audio)\//.test(file.mimetype)) cb(null, true);
    else cb(new Error('Only images and audio files can be uploaded.'));
  },
});

app.post('/api/upload', auth, (req, res) => {
  storage.single('file')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'No file was uploaded.' });
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
    res.sendFile(resolved);
  } catch {
    return res.status(403).json({ error: 'That media link has expired. Please reopen the app.' });
  }
});

// ---------- boot ----------
ensureSchema()
  .then(() => app.listen(PORT, () => console.log(`A Little Place Called Us API listening on http://localhost:${PORT}`)))
  .catch((e) => { console.error('Could not start: failed to apply the PostgreSQL schema.', e.message); process.exit(1); });

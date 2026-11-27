/* Екрани — видеа, снимки и промоции на телевизорите в магазина.
   Админ страница (с парола) за качване и подреждане, и страница-плейър за всеки телевизор (/tv/1, /tv/2 ...).
   Файловете и списъците се пазят на диска (Railway Volume, монтиран на /data).
   Видеата се преобразуват с ffmpeg до MP4 (H.264), за да тръгват на всеки телевизор.
   Всичко в един файл нарочно — по-лесно за поддръжка. */

const express = require('express');
const multer = require('multer');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const { spawn, execFileSync } = require('child_process');

/* ---------------- НАСТРОЙКИ (Railway Variables) ---------------- */
const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const APP_PASSWORD = process.env.APP_PASSWORD || '';
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(24).toString('hex');
const SCREENS_DEFAULT = parseInt(process.env.SCREENS || '3', 10);
const MAX_UPLOAD_MB = parseInt(process.env.MAX_UPLOAD_MB || '2048', 10);
const VIDEO_MAX_W = parseInt(process.env.VIDEO_MAX_WIDTH || '1920', 10);

const MEDIA_DIR = path.join(DATA_DIR, 'media');
const TMP_DIR = path.join(DATA_DIR, 'tmp');
const DB_FILE = path.join(DATA_DIR, 'db.json');
for (const d of [DATA_DIR, MEDIA_DIR, TMP_DIR]) fs.mkdirSync(d, { recursive: true });

let HAS_FFMPEG = true;
try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); } catch { HAS_FFMPEG = false; console.warn('Няма ffmpeg — видеата се пазят както са качени.'); }

/* ---------------- БАЗА (JSON файл) ---------------- */
const newId = () => crypto.randomBytes(6).toString('hex');
const TRANSITIONS = ['fade', 'slide', 'up', 'zoom', 'blur', 'wipe', 'black', 'flip', 'cut', 'random'];
const newScreen = id => ({ id, name: 'Екран ' + id, fit: 'contain', sound: false, transition: 'fade', tdur: 1, kenburns: true, logo: false, clock: true, clockPos: 'bl' });
function freshDb() {
  const db = { version: 1, screens: [], media: [], playlists: {} };
  for (let i = 1; i <= SCREENS_DEFAULT; i++) {
    db.screens.push(newScreen(String(i)));
    db.playlists[String(i)] = [];
  }
  return db;
}
let db;
try { db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); } catch { db = freshDb(); }
// по-стари записи без новите полета
for (const s of db.screens) for (const [k, v] of Object.entries(newScreen(s.id))) if (s[k] === undefined) s[k] = v;
const live = {}; // screenId -> { lastSeen, current } — само в паметта

let saveTimer = null;
function save(bump = true) {
  if (bump) db.version++;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const tmp = DB_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(db, null, 1));
    fs.renameSync(tmp, DB_FILE);
  }, 150);
}

/* ---------------- ОБРАБОТКА НА ФАЙЛОВЕ ---------------- */
function run(cmd, args) {
  return new Promise((res, rej) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    p.stdout.on('data', d => out += d);
    p.stderr.on('data', d => { err += d; if (err.length > 20000) err = err.slice(-10000); });
    p.on('close', code => code === 0 ? res(out) : rej(new Error(err.split('\n').filter(Boolean).slice(-3).join(' ') || 'код ' + code)));
    p.on('error', rej);
  });
}
async function probe(file) {
  const out = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type,codec_name,width,height', '-of', 'json', file]);
  const j = JSON.parse(out);
  const v = (j.streams || []).find(s => s.codec_type === 'video');
  return { duration: parseFloat(j.format && j.format.duration) || 0, vcodec: v && v.codec_name, width: v && v.width, height: v && v.height };
}

const queue = [];
let busy = false;
function enqueue(mediaId, srcPath) { queue.push({ mediaId, srcPath }); pump(); }
async function pump() {
  if (busy || !queue.length) return;
  busy = true;
  const { mediaId, srcPath } = queue.shift();
  const m = db.media.find(x => x.id === mediaId);
  try { if (m) await processMedia(m, srcPath); }
  catch (e) { if (m) { m.status = 'error'; m.error = String(e.message || e).slice(0, 300); save(); } console.error('Обработка', mediaId, e.message); }
  finally { fs.rm(srcPath, { force: true }, () => {}); busy = false; pump(); }
}

async function processMedia(m, src) {
  const base = m.id;
  if (m.type === 'image') {
    const out = base + '.jpg';
    if (HAS_FFMPEG) {
      // до 1920 по ширина, завъртане според EXIF го прави самият ffmpeg
      await run('ffmpeg', ['-y', '-i', src, '-vf', "scale='min(1920,iw)':-2", '-q:v', '3', '-frames:v', '1', path.join(MEDIA_DIR, out)]);
      m.file = out;
    } else {
      m.file = base + path.extname(m.original || '.jpg').toLowerCase();
      fs.copyFileSync(src, path.join(MEDIA_DIR, m.file));
    }
    m.thumb = m.file;
  } else {
    if (!HAS_FFMPEG) {
      m.file = base + path.extname(m.original || '.mp4').toLowerCase();
      fs.copyFileSync(src, path.join(MEDIA_DIR, m.file));
    } else {
      const info = await probe(src);
      if (!info.vcodec) throw new Error('Файлът няма видео');
      m.duration = Math.round(info.duration * 10) / 10;
      const out = base + '.mp4';
      await run('ffmpeg', ['-y', '-i', src,
        '-vf', `scale='min(${VIDEO_MAX_W},iw)':-2,format=yuv420p`,
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22', '-profile:v', 'high', '-level', '4.1',
        '-c:a', 'aac', '-b:a', '128k', '-ac', '2',
        '-movflags', '+faststart', path.join(MEDIA_DIR, out)]);
      m.file = out;
      const th = base + '_t.jpg';
      await run('ffmpeg', ['-y', '-ss', String(Math.min(1, info.duration / 2)), '-i', path.join(MEDIA_DIR, out),
        '-frames:v', '1', '-vf', 'scale=480:-2', path.join(MEDIA_DIR, th)]).catch(() => {});
      if (fs.existsSync(path.join(MEDIA_DIR, th))) m.thumb = th;
    }
  }
  try { m.size = fs.statSync(path.join(MEDIA_DIR, m.file)).size; } catch {}
  m.status = 'ready';
  delete m.error;
  save();
}

// след рестарт: всичко недовършено е изгубено
for (const m of db.media) if (m.status === 'processing') { m.status = 'error'; m.error = 'Прекъсната обработка — качи го пак'; }

/* ---------------- ВХОД ---------------- */
const sessionToken = () => crypto.createHmac('sha256', SESSION_SECRET).update('ekrani:' + APP_PASSWORD).digest('hex');
function cookie(req, name) {
  const c = (req.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith(name + '='));
  return c ? decodeURIComponent(c.slice(name.length + 1)) : '';
}
const authed = req => !APP_PASSWORD || cookie(req, 'ekrani') === sessionToken();
const auth = (req, res, next) => authed(req) ? next() : res.status(401).json({ error: 'Влез с паролата' });

/* ---------------- ПРИЛОЖЕНИЕ ---------------- */
const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));

app.post('/api/login', (req, res) => {
  const p = String((req.body && req.body.password) || '');
  const ok = APP_PASSWORD && p.length === APP_PASSWORD.length && crypto.timingSafeEqual(Buffer.from(p), Buffer.from(APP_PASSWORD));
  if (!ok) return res.status(401).json({ error: 'Грешна парола' });
  res.setHeader('Set-Cookie', `ekrani=${sessionToken()}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 24 * 180}${req.secure || req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : ''}`);
  res.json({ ok: true });
});
app.post('/api/logout', (req, res) => { res.setHeader('Set-Cookie', 'ekrani=; Path=/; Max-Age=0'); res.json({ ok: true }); });

function diskUsage() {
  let used = 0;
  for (const f of fs.readdirSync(MEDIA_DIR)) { try { used += fs.statSync(path.join(MEDIA_DIR, f)).size; } catch {} }
  let free = null;
  try { const s = fs.statfsSync(DATA_DIR); free = s.bavail * s.bsize; } catch {}
  return { used, free };
}

app.get('/api/state', auth, (req, res) => {
  const now = Date.now();
  res.json({
    ...db,
    screens: db.screens.map(s => ({ ...s, online: !!(live[s.id] && now - live[s.id].lastSeen < 90000), lastSeen: live[s.id] && live[s.id].lastSeen, current: live[s.id] && live[s.id].current })),
    disk: diskUsage(), ffmpeg: HAS_FFMPEG, queue: queue.length + (busy ? 1 : 0)
  });
});

/* качване */
const upload = multer({ dest: TMP_DIR, limits: { fileSize: MAX_UPLOAD_MB * 1024 * 1024, files: 30 } });
app.post('/api/upload', auth, upload.array('files', 30), (req, res) => {
  let screens = [];
  try { screens = JSON.parse(req.body.screens || '[]'); } catch {}
  screens = screens.filter(id => db.playlists[id]);
  const added = [];
  for (const f of req.files || []) {
    const mt = f.mimetype || '';
    const ext = path.extname(f.originalname).toLowerCase();
    const type = mt.startsWith('video/') || ['.mp4', '.mov', '.m4v', '.webm', '.avi', '.mkv'].includes(ext) ? 'video'
      : mt.startsWith('image/') || ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.heic'].includes(ext) ? 'image' : null;
    if (!type) { fs.rm(f.path, { force: true }, () => {}); continue; }
    const name = Buffer.from(f.originalname, 'latin1').toString('utf8').replace(/\.[^.]+$/, '');
    const m = { id: newId(), name, type, original: f.originalname, status: 'processing', createdAt: new Date().toISOString() };
    db.media.push(m);
    for (const sid of screens) db.playlists[sid].push({ id: newId(), mediaId: m.id, seconds: 10, from: '', to: '', on: true, transition: '' });
    added.push(m.id);
    enqueue(m.id, f.path);
  }
  save();
  res.json({ ok: true, added });
});
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? `Файлът е над ${MAX_UPLOAD_MB} MB` : err.message });
  next(err);
});

/* екрани */
app.post('/api/screens', auth, (req, res) => {
  const id = String(Math.max(0, ...db.screens.map(s => +s.id || 0)) + 1);
  db.screens.push(newScreen(id));
  db.playlists[id] = [];
  save(); res.json({ ok: true, id });
});
app.patch('/api/screens/:id', auth, (req, res) => {
  const s = db.screens.find(x => x.id === req.params.id);
  if (!s) return res.status(404).json({ error: 'Няма такъв екран' });
  const b = req.body || {};
  if (typeof b.name === 'string' && b.name.trim()) s.name = b.name.trim().slice(0, 60);
  if (['contain', 'cover'].includes(b.fit)) s.fit = b.fit;
  if (typeof b.sound === 'boolean') s.sound = b.sound;
  if (TRANSITIONS.includes(b.transition)) s.transition = b.transition;
  if (b.tdur !== undefined) s.tdur = Math.min(3, Math.max(0.2, Number(b.tdur) || 1));
  if (typeof b.kenburns === 'boolean') s.kenburns = b.kenburns;
  if (typeof b.logo === 'boolean') s.logo = b.logo;
  if (typeof b.clock === 'boolean') s.clock = b.clock;
  if (['tl', 'bl', 'br'].includes(b.clockPos)) s.clockPos = b.clockPos;
  save(); res.json({ ok: true });
});
app.delete('/api/screens/:id', auth, (req, res) => {
  db.screens = db.screens.filter(x => x.id !== req.params.id);
  delete db.playlists[req.params.id];
  save(); res.json({ ok: true });
});

/* списък за екран — пращаме целия списък (подреждане, време, дати, вкл/изкл) */
app.put('/api/playlists/:id', auth, (req, res) => {
  if (!db.playlists[req.params.id]) return res.status(404).json({ error: 'Няма такъв екран' });
  const items = Array.isArray(req.body) ? req.body : [];
  const okDate = v => typeof v === 'string' && /^(\d{4}-\d{2}-\d{2})?$/.test(v) ? v : '';
  db.playlists[req.params.id] = items
    .filter(i => i && db.media.some(m => m.id === i.mediaId))
    .map(i => ({ id: typeof i.id === 'string' && i.id ? i.id.slice(0, 20) : newId(), mediaId: i.mediaId,
      seconds: Math.min(600, Math.max(3, parseInt(i.seconds, 10) || 10)), from: okDate(i.from), to: okDate(i.to), on: i.on !== false,
      transition: TRANSITIONS.includes(i.transition) ? i.transition : '' }));
  save(); res.json({ ok: true });
});

/* библиотека */
app.patch('/api/media/:id', auth, (req, res) => {
  const m = db.media.find(x => x.id === req.params.id);
  if (!m) return res.status(404).json({ error: 'Няма такъв файл' });
  if (typeof req.body.name === 'string' && req.body.name.trim()) m.name = req.body.name.trim().slice(0, 120);
  save(); res.json({ ok: true });
});
app.delete('/api/media/:id', auth, (req, res) => {
  const m = db.media.find(x => x.id === req.params.id);
  if (!m) return res.status(404).json({ error: 'Няма такъв файл' });
  db.media = db.media.filter(x => x.id !== m.id);
  for (const k of Object.keys(db.playlists)) db.playlists[k] = db.playlists[k].filter(i => i.mediaId !== m.id);
  for (const f of [m.file, m.thumb]) if (f) fs.rm(path.join(MEDIA_DIR, f), { force: true }, () => {});
  save(); res.json({ ok: true });
});

/* ---------------- ЗА ТЕЛЕВИЗОРА (без парола — само чете) ---------------- */
function today() { // дата по българско време
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Sofia', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
app.get('/api/play/:id', (req, res) => {
  const s = db.screens.find(x => x.id === req.params.id);
  if (!s) return res.status(404).json({ error: 'Няма такъв екран' });
  const d = today();
  const items = (db.playlists[s.id] || [])
    .filter(i => i.on && (!i.from || i.from <= d) && (!i.to || i.to >= d))
    .map(i => ({ i, m: db.media.find(m => m.id === i.mediaId) }))
    .filter(x => x.m && x.m.status === 'ready' && x.m.file)
    .map(({ i, m }) => ({ id: i.id, type: m.type, url: '/media/' + m.file, seconds: i.seconds, name: m.name, transition: i.transition || '' }));
  res.set('Cache-Control', 'no-store');
  res.json({ key: crypto.createHash('md5').update(JSON.stringify([s, items])).digest('hex'), name: s.name, fit: s.fit, sound: s.sound,
    transition: s.transition, tdur: s.tdur, kenburns: s.kenburns, logo: s.logo, clock: s.clock, clockPos: s.clockPos, items });
});
app.post('/api/play/:id/ping', (req, res) => {
  if (req.query.preview) return res.json({ ok: true }); // прегледът в админа не се брои за телевизор
  live[req.params.id] = { lastSeen: Date.now(), current: String((req.body && req.body.current) || '').slice(0, 120) };
  res.json({ ok: true });
});

app.use('/media', express.static(MEDIA_DIR, { immutable: true, maxAge: '365d' }));
app.use('/static', express.static(path.join(__dirname, 'public'), { maxAge: '7d', index: false }));
app.get('/tv/:id', (req, res) => res.sendFile(path.join(__dirname, 'public', 'tv.html')));
app.get('/tv', (req, res) => res.redirect('/tv/1'));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
// приложението за телевизора (Android TV) — сглобява се в GitHub Actions
const APK_URL = process.env.APK_URL || 'https://github.com/dimoandonov-dotcom/Bonove/releases/latest/download/ekrani-tv.apk';
app.get(['/app.apk', '/apk', '/app'], (req, res) => res.redirect(302, APK_URL));
app.get('/health', (req, res) => res.json({ ok: true }));

app.listen(PORT, () => console.log(`Екрани слуша на ${PORT}. Данни: ${DATA_DIR}${APP_PASSWORD ? '' : ' — ВНИМАНИЕ: няма APP_PASSWORD, админът е отворен'}`));

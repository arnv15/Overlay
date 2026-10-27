#!/usr/bin/env node
/* Renders every <section class="scene"> in <Video>/index.html to its own clip.

     npm run render -- Jev                     all scenes as phone-transparent clips (the default)
     npm run render -- Jev --scenes 3,5        only those scenes
     npm run render -- Jev --formats alpha     other formats on request: alpha | phone | green | boxed | preview
     npm run render -- Jev --dur 4=7.5,6=5     re-time clips to how long each line really takes (s)
     npm run render -- Jev --fps 60

   Outputs (in <Video>/renders/), each clip cropped to its card:
     alpha/NN-name.mov              ProRes 4444 + transparency — Premiere, Final Cut, DaVinci, CapCut desktop
     phone-transparent/NN-name.mov  HEVC + transparency (Apple's iPhone format) — small enough for a phone
                                    (both written by Apple's encoder via tools/apple-encode.swift)
     greenscreen/NN-name.mp4        H.264 on #00FF00 — for apps with a chroma key (CapCut, iMovie)
     phone-boxed/NN-name.mp4        just the card, square corners — works as a plain overlay in any app
     <video>-preview.mp4            all clips back to back, full frame, over a stand-in background

   Frames are captured by pausing every CSS animation and seeking it to the
   frame's timestamp, so output is frame-exact no matter how slow capture is. */

import { chromium } from 'playwright-core';
import ffmpegPath from 'ffmpeg-static';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const W = 1080, H = 1920;
// Strip crops keep the full width (so every clip lands at the same scale when an
// editor fits it to the frame) plus room for the card's shadow, which reaches
// ~150px below the card and isn't part of any element's box.
const STRIP_MARGIN = { top: 50, bottom: 160 };

// RGB → BT.709 limited range, tagged, so colours (and the key green) survive
// every editor's colour management unchanged.
const BT709 = ['-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709'];
const H264 = ['-vf', 'scale=out_color_matrix=bt709:out_range=tv,format=yuv420p',
  '-c:v', 'libx264', '-profile:v', 'high', ...BT709, '-color_range', 'tv', '-movflags', '+faststart'];
const FORMATS = {
  // alpha + phone come out of one capture pass through Apple's encoder
  alpha: { bg: 'transparent', crop: 'strip', dir: 'alpha', ext: 'mov' },
  phone: { bg: 'transparent', crop: 'strip', dir: 'phone-transparent', ext: 'mov' },
  green: { bg: 'green', crop: 'strip', dir: 'greenscreen', ext: 'mp4', args: [...H264, '-preset', 'slow', '-crf', '12'] },
  boxed: { bg: 'box', crop: 'card', dir: 'phone-boxed', ext: 'mp4', args: [...H264, '-preset', 'slow', '-crf', '14'] },
  preview: { bg: 'mock', args: [...H264, '-preset', 'medium', '-crf', '20'] },
};

const opts = parseArgs(process.argv.slice(2));
const videoDir = join(ROOT, opts.video);
if (!existsSync(join(videoDir, 'index.html'))) fail(`No ${opts.video}/index.html in ${ROOT}`);
const APPLE_ENCODE = join(ROOT, 'tools/.bin/apple-encode');
if (opts.formats.some(f => f === 'alpha' || f === 'phone')) await buildAppleEncoder();

const server = await serve(ROOT);
const base = `http://127.0.0.1:${server.address().port}/${encodeURIComponent(opts.video)}/index.html`;
const browser = await launch();

const names = new Map(); // scene number → data-name   } both filled by
const crops = new Map(); // scene number → { strip, card } } the audit pass

try {
  const sceneCount = await countScenes();
  const scenes = opts.scenes ?? Array.from({ length: sceneCount }, (_, i) => i + 1);
  for (const n of scenes) if (n < 1 || n > sceneCount) fail(`Scene ${n} doesn't exist (1-${sceneCount})`);

  // Audit and measure once per scene before spending time on frames
  let problems = 0;
  for (const n of scenes) {
    const { info, issues, page } = await openScene(n, 'transparent');
    if (info.failed.length) fail(`Fonts failed to load: ${info.failed.join(', ')}`);
    for (const issue of issues) { console.warn(`  ⚠ scene ${n}: ${issue}`); problems++; }
    const b = await page.evaluate(fps => window.overlay.bounds(fps), opts.fps);
    const c = await page.evaluate(() => window.overlay.cardRect());
    await page.close();
    names.set(n, info.name);
    crops.set(n, {
      strip: evenBox(0, b.top - STRIP_MARGIN.top, W, b.bottom + STRIP_MARGIN.bottom),
      card: evenBox(c.left, c.top, c.left + c.width, c.top + c.height),
    });
  }
  if (problems && !opts.force) fail(`${problems} layout problem(s) — fix them or pass --force`);

  const jobs = [];
  if (opts.formats.some(f => f === 'alpha' || f === 'phone')) for (const n of scenes) jobs.push(() => renderTransparent(n));
  for (const f of ['green', 'boxed']) {
    if (opts.formats.includes(f)) for (const n of scenes) jobs.push(() => renderClip(n, f));
  }
  if (opts.formats.includes('preview')) jobs.push(() => renderPreview(scenes));
  await pool(jobs, opts.parallel);
} finally {
  await browser.close();
  server.close();
}

/* ---- Rendering ------------------------------------------------------------ */

async function openScene(n, bg) {
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  page.on('pageerror', err => fail(`Scene ${n}: ${err.message}`));
  const params = new URLSearchParams({ render: '1', scene: n, bg });
  if (opts.durs.has(n)) params.set('dur', opts.durs.get(n));
  await page.goto(`${base}?${params}`);
  const info = await page.evaluate(() => window.overlay.ready);
  const issues = await page.evaluate(() => window.overlay.audit());
  return { page, info, issues };
}

async function captureScene(n, bg, sink, clip) {
  const { page, info } = await openScene(n, bg);
  const frames = Math.round(info.duration * opts.fps);
  for (let f = 0; f < frames; f++) {
    await page.evaluate(ms => window.overlay.seek(ms), (f * 1000) / opts.fps);
    await sink.write(await page.screenshot({ type: 'png', omitBackground: bg === 'transparent', clip }));
  }
  await page.close();
  return { ...info, frames };
}

function clipPath(n, format) {
  return join(videoDir, 'renders', FORMATS[format].dir, `${String(n).padStart(2, '0')}-${names.get(n)}.${FORMATS[format].ext}`);
}

async function renderClip(n, format) {
  const fmt = FORMATS[format];
  const clip = crops.get(n)[fmt.crop];
  const outPath = clipPath(n, format);
  mkdirSync(dirname(outPath), { recursive: true });
  const started = Date.now();
  const enc = encoder(fmt.args, outPath);
  const { frames } = await captureScene(n, fmt.bg, enc, clip);
  await enc.end();
  report(outPath, clip, frames, started);
}

// One capture → ProRes 4444 and/or HEVC-with-alpha, both via Apple's encoder
async function renderTransparent(n) {
  const clip = crops.get(n).strip;
  const paths = ['alpha', 'phone'].map(f => (opts.formats.includes(f) ? clipPath(n, f) : null));
  for (const p of paths) if (p) mkdirSync(dirname(p), { recursive: true });
  const started = Date.now();
  const enc = appleEncoder(clip, ...paths);
  const { frames } = await captureScene(n, 'transparent', enc, clip);
  await enc.end();
  for (const p of paths) if (p) report(p, clip, frames, started);
}

async function renderPreview(scenes) {
  const outPath = join(videoDir, 'renders', `${opts.video.toLowerCase()}-preview.mp4`);
  mkdirSync(dirname(outPath), { recursive: true });
  const started = Date.now();
  const enc = encoder(FORMATS.preview.args, outPath);
  let frames = 0;
  for (const n of scenes) frames += (await captureScene(n, 'mock', enc)).frames;
  await enc.end();
  report(outPath, { width: W, height: H }, frames, started);
}

function encoder(args, outPath) {
  const proc = spawn(ffmpegPath, [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'image2pipe', '-framerate', String(opts.fps), '-c:v', 'png', '-i', '-',
    '-r', String(opts.fps), ...args, outPath,
  ], { stdio: ['pipe', 'inherit', 'inherit'] });
  const done = exited(proc, `ffmpeg (${rel(outPath)})`);
  return {
    write: png => writeTo(proc.stdin, png),
    end: () => { proc.stdin.end(); return done; },
  };
}

// PNG frames → ffmpeg (decode to raw straight-alpha BGRA) → apple-encode
function appleEncoder(clip, proresPath, hevcPath) {
  const enc = spawn(APPLE_ENCODE, [clip.width, clip.height, opts.fps, proresPath ?? '-', hevcPath ?? '-'].map(String),
    { stdio: ['pipe', 'inherit', 'inherit'] });
  const dec = spawn(ffmpegPath, [
    '-hide_banner', '-loglevel', 'error',
    '-f', 'image2pipe', '-framerate', String(opts.fps), '-c:v', 'png', '-i', '-',
    '-f', 'rawvideo', '-pix_fmt', 'bgra', '-',
  ], { stdio: ['pipe', 'pipe', 'inherit'] });
  dec.stdout.pipe(enc.stdin);
  const done = Promise.all([exited(dec, 'ffmpeg'), exited(enc, 'apple-encode')]);
  return {
    write: png => writeTo(dec.stdin, png),
    end: () => { dec.stdin.end(); return done; },
  };
}

function writeTo(stream, buf) {
  return new Promise((ok, bad) => stream.write(buf, err => (err ? bad(err) : ok())));
}

function exited(proc, label) {
  return new Promise((ok, bad) => {
    proc.on('error', bad);
    proc.on('close', code => (code === 0 ? ok() : bad(new Error(`${label} exited with ${code}`))));
  });
}

// Compiles tools/apple-encode.swift once (and again whenever it changes)
async function buildAppleEncoder() {
  const src = join(ROOT, 'tools/apple-encode.swift');
  if (existsSync(APPLE_ENCODE) && statSync(APPLE_ENCODE).mtimeMs > statSync(src).mtimeMs) return;
  mkdirSync(dirname(APPLE_ENCODE), { recursive: true });
  console.log('  compiling tools/apple-encode.swift…');
  await run('swiftc', ['-O', '-o', APPLE_ENCODE, src])
    .catch(err => fail(`Couldn't compile the Apple encoder (needs Xcode / xcode-select --install):\n${err.message}`));
}

/* ---- Plumbing ------------------------------------------------------------- */

// Integer box with even width/height (H.264 4:2:0 needs both), clamped to the frame
function evenBox(x0, y0, x1, y1) {
  const x = Math.max(0, Math.floor(x0 / 2) * 2), y = Math.max(0, Math.floor(y0 / 2) * 2);
  const right = Math.min(W, Math.ceil(x1 / 2) * 2), bottom = Math.min(H, Math.ceil(y1 / 2) * 2);
  return { x, y, width: right - x, height: bottom - y };
}

function report(outPath, clip, frames, started) {
  const secs = ((Date.now() - started) / 1000).toFixed(0);
  console.log(`  ✓ ${rel(outPath)}  ${clip.width}×${clip.height}, ${(frames / opts.fps).toFixed(2)}s  (${secs}s)`);
}

// Runs a command quietly; its output only surfaces if it fails
function run(cmd, args) {
  return new Promise((ok, bad) => {
    const proc = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let log = '';
    proc.stdout.on('data', d => { log += d; });
    proc.stderr.on('data', d => { log += d; });
    proc.on('error', bad);
    proc.on('close', code => (code === 0 ? ok() : bad(new Error(`${basename(cmd)} exited with ${code}\n${log}`))));
  });
}

async function countScenes() {
  const page = await browser.newPage();
  await page.goto(`${base}?render=1&scene=1`);
  const count = await page.evaluate(() => document.querySelectorAll('.scene').length);
  await page.close();
  return count;
}

// Prefer Playwright's own Chromium; fall back to any cached build, then to Chrome
async function launch() {
  const args = ['--force-color-profile=srgb', '--hide-scrollbars', '--font-render-hinting=none'];
  const candidates = [chromium.executablePath()];
  const cache = join(homedir(), 'Library/Caches/ms-playwright');
  if (existsSync(cache)) {
    for (const d of readdirSync(cache).filter(d => /^chromium-\d+$/.test(d)).sort((a, b) => b.split('-')[1] - a.split('-')[1])) {
      candidates.push(join(cache, d, 'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'));
      candidates.push(join(cache, d, 'chrome-mac/Chromium.app/Contents/MacOS/Chromium'));
    }
  }
  const executablePath = candidates.find(p => p && existsSync(p));
  return executablePath ? chromium.launch({ executablePath, args }) : chromium.launch({ channel: 'chrome', args });
}

// A tiny static server: pages load fonts/CSS over http rather than file://
function serve(root) {
  const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg' };
  const server = createServer(async (req, res) => {
    const path = join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (path !== root && !path.startsWith(root + sep)) return res.writeHead(403).end();
    let body;
    try { body = await readFile(path); } catch { return res.writeHead(404).end(); }
    res.writeHead(200, { 'content-type': types[extname(path)] ?? 'application/octet-stream' }).end(body);
  });
  return new Promise(ok => server.listen(0, '127.0.0.1', () => ok(server)));
}

async function pool(jobs, size) {
  const queue = [...jobs];
  await Promise.all(Array.from({ length: Math.min(size, queue.length) }, async () => {
    while (queue.length) await queue.shift()();
  }));
}

function parseArgs(argv) {
  const o = { video: null, scenes: null, formats: ['phone'], fps: 30, durs: new Map(), parallel: 3, force: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i], next = () => argv[++i];
    if (a === '--scenes') o.scenes = next().split(',').map(Number);
    else if (a === '--formats') o.formats = next().split(',');
    else if (a === '--fps') o.fps = Number(next());
    else if (a === '--dur') for (const pair of next().split(',')) {
      const [n, sec] = pair.split('=').map(Number);
      if (!(n >= 1) || !(sec >= 1)) fail(`--dur wants scene=seconds pairs like 4=7.5 (min 1s), got "${pair}"`);
      o.durs.set(n, sec);
    }
    else if (a === '--parallel') o.parallel = Number(next());
    else if (a === '--force') o.force = true;
    else if (!a.startsWith('--') && !o.video) o.video = a;
    else fail(`Unknown argument: ${a}`);
  }
  if (!o.video) fail('Usage: npm run render -- <VideoFolder> [--scenes 1,2] [--formats alpha,phone,green,boxed,preview] [--dur 4=7.5] [--fps 30]');
  for (const f of o.formats) if (!FORMATS[f]) fail(`Unknown format "${f}" (${Object.keys(FORMATS).join(', ')})`);
  if (!(o.fps > 0)) fail('--fps must be a positive number');
  return o;
}

function rel(p) { return p.slice(ROOT.length + 1); }
function fail(msg) { console.error(`✗ ${msg}`); process.exit(1); }

/* Shared runtime for overlay pages.

   Preview: open a video's index.html in a browser to play, scrub, and check
   clips over different backgrounds.

   Render: ?render=1&scene=N&bg=transparent|green|box|mock shows one scene at 1:1
   and exposes window.overlay for tools/render.mjs:
     overlay.ready        resolves once fonts load → { duration, name, failed }
     overlay.seek(ms)     puts every animation in the scene at time `ms`
     overlay.audit()      layout problems at the scene's hold point (overflow etc.)
     overlay.bounds(fps)  vertical extent of everything visible across the clip
     overlay.cardRect()   the card's box at the hold point
*/
(() => {
  const params = new URLSearchParams(location.search);
  const root = document.documentElement;
  const stage = document.querySelector('.stage');
  const scenes = [...stage.querySelectorAll('.scene')];

  const FACES = [
    '400 40px "Space Grotesk"', '500 40px "Space Grotesk"', '600 40px "Space Grotesk"', '700 40px "Space Grotesk"',
    '400 40px "JetBrains Mono"', '500 40px "JetBrains Mono"', '700 40px "JetBrains Mono"',
  ];
  // Unicode coverage of the bundled latin font subset
  const COVERED = /\s|[ -~ -ÿ -⁯€™↑↓−]/g;

  for (const s of scenes) s.style.setProperty('--dur', `${s.dataset.dur}s`);
  for (const el of stage.querySelectorAll('.type')) el.parentElement.style.setProperty('--n', el.textContent.length);

  // Every CSS animation in a scene is created the moment the scene is shown,
  // so pausing them all and giving them one shared currentTime puts the whole
  // scene at time `ms` — independent of how long a frame takes to capture.
  const seek = ms => {
    for (const a of document.getAnimations()) { a.pause(); a.currentTime = ms; }
  };
  const durationMs = scene => Number(scene.dataset.dur) * 1000;

  if (params.has('render')) setupRender();
  else setupPreview();

  /* ---- Render ------------------------------------------------------------ */

  function setupRender() {
    const scene = scenes[Number(params.get('scene')) - 1];
    if (!scene) throw new Error(`No scene ${params.get('scene')} (have ${scenes.length})`);
    const bg = params.get('bg') ?? 'transparent';

    root.classList.add('is-render');
    if (bg === 'green') root.classList.add('is-keyable');
    if (bg === 'box') root.classList.add('is-boxed');
    if (bg === 'mock') stage.classList.add('bg-mock');
    scene.classList.add('is-active');
    if (params.has('dur')) fitScene(scene, Number(params.get('dur')) * 1000);

    window.overlay = {
      seek,
      audit: () => audit(scene),
      bounds: fps => bounds(scene, fps),
      cardRect: () => {
        seek(durationMs(scene) - 450);
        const { left, top, width, height } = scene.querySelector('.card').getBoundingClientRect();
        seek(0);
        return { left, top, width, height };
      },
      ready: (async () => {
        await Promise.all(FACES.map(f => document.fonts.load(f)));
        await document.fonts.ready;
        const failed = [...document.fonts].filter(f => f.status !== 'loaded').map(f => `${f.family} ${f.weight}`);
        seek(0);
        return { duration: Number(scene.dataset.dur), name: scene.dataset.name, failed };
      })(),
    };
  }

  // Re-times a scene to `newMs` — e.g. how long you actually took to say the
  // line. The exit animation follows --dur by itself; every other animation's
  // start time goes through retime().
  function fitScene(scene, newMs) {
    const oldMs = durationMs(scene);
    scene.dataset.dur = newMs / 1000;
    scene.style.setProperty('--dur', `${newMs / 1000}s`);
    for (const a of document.getAnimations()) {
      if (a.animationName === 'card-out') continue;
      a.effect.updateTiming({ delay: retime(a.effect.getTiming().delay, oldMs, newMs) });
    }
  }

  // TODO(human): decide how a scene's beats move when its length changes.
  //   delayMs  when this animation starts in the original timing (ms)
  //   oldMs    the scene's original length; newMs = the length you asked for
  // Return the new start time in ms. Returning delayMs unchanged keeps every
  // beat where it was and only stretches (or cuts into) the hold before the exit.
  function retime(delayMs, oldMs, newMs) {
    return delayMs;
  }

  // Top and bottom of everything that's actually visible at any frame, so the
  // renderer can crop each clip to a strip around its card. Shadows aren't in
  // element boxes; the renderer adds margin for them.
  function bounds(scene, fps) {
    const els = [...scene.querySelectorAll('.card, .card *')];
    const opacity = el => {
      let o = 1;
      for (let e = el; e && e !== stage; e = e.parentElement) o *= Number(getComputedStyle(e).opacity);
      return o;
    };
    let top = Infinity, bottom = -Infinity;
    for (let f = 0; f < Math.round(durationMs(scene) / 1000 * fps); f++) {
      seek(f * 1000 / fps);
      for (const el of els) {
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height || opacity(el) < 0.01) continue;
        top = Math.min(top, r.top);
        bottom = Math.max(bottom, r.bottom);
      }
    }
    seek(0);
    return { top, bottom };
  }

  function audit(scene) {
    seek(durationMs(scene) - 450); // the hold: everything is in, the exit hasn't started
    const issues = [];
    const frame = stage.getBoundingClientRect();
    const describe = el => {
      const cls = (el.getAttribute('class') ?? '').trim().replace(/\s+/g, '.');
      return `<${el.tagName.toLowerCase()}${cls ? '.' + cls : ''}> "${el.textContent.trim().slice(0, 28)}"`;
    };

    for (const card of scene.querySelectorAll('.card')) {
      const c = card.getBoundingClientRect();
      if (c.top < frame.top || c.bottom > frame.bottom || c.left < frame.left || c.right > frame.right) {
        issues.push(`card runs outside the 1080x1920 frame (top ${Math.round(c.top)}, bottom ${Math.round(c.bottom)})`);
      }
      for (const el of card.querySelectorAll('*')) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) continue;
        if (r.left < c.left - 1 || r.right > c.right + 1 || r.top < c.top - 1 || r.bottom > c.bottom + 1) {
          issues.push(`${describe(el)} spills outside its card`);
        }
        if (el.matches('.type') || el instanceof SVGElement) continue;
        if (getComputedStyle(el).overflowX !== 'visible' && el.scrollWidth > el.clientWidth + 1) {
          issues.push(`${describe(el)} clips its content (${el.scrollWidth}px into ${el.clientWidth}px)`);
        }
      }
    }

    const stray = [...new Set(scene.textContent.replace(COVERED, ''))];
    if (stray.length) issues.push(`characters missing from the bundled fonts: ${stray.join(' ')}`);

    seek(0);
    return issues;
  }

  /* ---- Preview ----------------------------------------------------------- */

  function setupPreview() {
    root.classList.add('is-preview');
    const viewport = stage.parentElement;

    const h = (tag, attrs = {}, ...kids) => {
      const el = document.createElement(tag);
      for (const [k, v] of Object.entries(attrs)) {
        if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
        else el.setAttribute(k, v);
      }
      el.append(...kids);
      return el;
    };
    const fmt = ms => (ms / 1000).toFixed(2) + 's';
    const total = scenes.reduce((sum, s) => sum + Number(s.dataset.dur), 0);

    let current = 0, t = 0, playing = false, last = 0;
    let playAll = true, loop = true;

    const sceneButtons = scenes.map((s, i) => h('button', { class: 'ui-scene', onclick: () => { show(i); setPlaying(true); } },
      h('b', {}, String(i + 1).padStart(2, '0')),
      h('span', {}, s.dataset.line ?? s.dataset.name),
      h('em', {}, `${s.dataset.dur}s`),
    ));
    const playBtn = h('button', { class: 'ui-btn is-primary', onclick: () => setPlaying(!playing) }, 'Play');
    const allBox = h('input', { type: 'checkbox', checked: '', onchange: e => { playAll = e.target.checked; } });
    const loopBox = h('input', { type: 'checkbox', checked: '', onchange: e => { loop = e.target.checked; } });
    const scrub = h('input', { type: 'range', class: 'ui-scrub', min: 0, step: 1, oninput: e => { setPlaying(false); t = Number(e.target.value); seek(t); sync(); } });
    const clock = h('output', { class: 'ui-clock' });
    const bgs = { mock: 'Talking head', dark: 'Dark', light: 'Light', check: 'Transparent', green: 'Green' };
    const bgButtons = Object.entries(bgs).map(([key, label]) => h('button', { class: 'ui-chip', 'data-bg': key, onclick: () => setBg(key) }, label));
    const safeBox = h('input', { type: 'checkbox', onchange: e => stage.classList.toggle('show-safe', e.target.checked) });

    stage.append(h('div', { class: 'safe', 'aria-hidden': 'true' },
      h('i', { class: 'safe-top' }, 'IG header'), h('i', { class: 'safe-bottom' }, 'Caption + audio'), h('i', { class: 'safe-right' }, 'Buttons')));

    document.body.append(h('aside', { class: 'ui' },
      h('header', {}, h('h1', {}, document.title), h('p', {}, `${scenes.length} clips · 1080×1920 · ${total.toFixed(1)}s total`)),
      h('ol', { class: 'ui-scenes' }, ...sceneButtons.map(b => h('li', {}, b))),
      h('div', { class: 'ui-row' }, playBtn, scrub, clock),
      h('div', { class: 'ui-row' }, h('label', {}, allBox, 'Play all'), h('label', {}, loopBox, 'Loop'), h('label', {}, safeBox, 'IG safe zones')),
      h('div', { class: 'ui-row ui-bgs' }, h('span', { class: 'ui-k' }, 'Background'), ...bgButtons),
      h('p', { class: 'ui-hint' }, 'Space play/pause · ← → clip · R restart'),
    ));

    function show(i) {
      current = (i + scenes.length) % scenes.length;
      scenes.forEach((s, j) => s.classList.toggle('is-active', j === current));
      sceneButtons.forEach((b, j) => b.classList.toggle('is-on', j === current));
      scrub.max = durationMs(scenes[current]);
      t = 0; seek(0); sync();
    }
    function setPlaying(on) {
      if (on && t >= durationMs(scenes[current])) t = 0;
      playing = on;
      playBtn.textContent = on ? 'Pause' : 'Play';
      if (on) { last = performance.now(); requestAnimationFrame(tick); }
    }
    function tick(now) {
      if (!playing) return;
      t += now - last; last = now;
      if (t >= durationMs(scenes[current])) {
        const atEnd = current === scenes.length - 1;
        if (playAll && (!atEnd || loop)) show(current + 1);
        else if (!playAll && loop) t = 0;
        else { t = durationMs(scenes[current]); seek(t); sync(); setPlaying(false); return; }
      }
      seek(t); sync();
      requestAnimationFrame(tick);
    }
    function sync() {
      scrub.value = t;
      clock.textContent = `${fmt(t)} / ${fmt(durationMs(scenes[current]))}`;
    }
    function setBg(key) {
      for (const k of Object.keys(bgs)) stage.classList.toggle(`bg-${k}`, k === key);
      bgButtons.forEach(b => b.classList.toggle('is-on', b.dataset.bg === key));
    }
    function fit() {
      const narrow = innerWidth < 900;
      const k = narrow ? (innerWidth - 32) / 1080 : Math.min((innerHeight - 48) / 1920, (innerWidth - 460) / 1080);
      viewport.style.setProperty('--k', Math.max(k, 0.1));
    }

    addEventListener('resize', fit);
    addEventListener('keydown', e => {
      if (e.target instanceof HTMLInputElement && e.target.type === 'range') return;
      if (e.code === 'Space') { e.preventDefault(); setPlaying(!playing); }
      if (e.key === 'ArrowRight') { show(current + 1); setPlaying(true); }
      if (e.key === 'ArrowLeft') { show(current - 1); setPlaying(true); }
      if (e.key === 'r' || e.key === 'R') { t = 0; setPlaying(true); }
    });

    fit();
    setBg('mock');
    show(0);
    document.fonts.ready.then(() => setPlaying(true));
  }
})();

# Overlays — @arnsv.mp4

HTML/CSS overlay animations for Instagram Reels, rendered to transparent video clips you lay over the talking-head footage.

```
shared/          overlay.css (look + animation helpers), overlay.js (preview player + render hooks), fonts/
tools/render.mjs captures each scene frame-by-frame → one transparent iPhone .mov per clip
                 (renders/phone-transparent/), cropped to its card, for Instagram Edits.
                 Other formats only on request: --formats boxed,green,alpha,preview
tools/apple-encode.swift  writes the transparent .movs with Apple's encoder (compiled automatically)
<Video>/         one folder per video: index.html (the scenes), README.md (clip ↔ line map), renders/
```

## Making a new video

1. Copy a video folder's `index.html` into a new folder (e.g. `Sentinel/`) and replace the `<section class="scene">` blocks, one per script beat.
2. In each scene, `data-dur` is the clip length in seconds, and `--at` on an element is when it animates, in seconds into the scene.
3. Open `<Video>/index.html` in Chrome to preview, then run:

```bash
npm run render -- Sentinel
```

The renderer audits every scene first and refuses to render if text overflows a card, a font fails to load, or a character isn't in the bundled fonts. Pass `--force` to override.

Setup on a new machine: `npm install`. Rendering uses Playwright's cached Chromium (or Google Chrome) and a bundled ffmpeg. The transparent formats also need Xcode's `swiftc`.

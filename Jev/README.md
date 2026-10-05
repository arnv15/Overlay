# Jev — overlay clips

Seven clips, one per beat of the script, each cropped to its card so you can drag and pinch it wherever you want. Drop each clip on the timeline **at the moment you start saying its line**.

| # | Clip | Starts when you say… | Length |
|---|------|----------------------|--------|
| 01 | `as-good-as-astra-and-fable` | "Yet another model was recently unveiled…" | 9.0s |
| 02 | `released-by-typesafe-ai` | "Jev was released just 2 weeks ago…" | 6.0s |
| 03 | `next-big-model-it-isnt` | "Although Jev seems like the next big model…" | 3.8s |
| 04 | `different-architectures` | "Jev and frontier LLMs have completely different…" | 6.0s |
| 05 | `jev-single-forward-pass` | "Jev scans and gives a probability…" | 6.0s |
| 06 | `llm-token-by-token` | "LLMs generate text token by token…" | 6.0s |
| 07 | `open-source-for-over-a-year` | "The crazy bit is that there has secretly been…" | 6.0s |

Every clip ends with a 0.3s exit animation. If your line is shorter than the clip, trim the clip's **start** or re-time it (see below). Don't cut its tail, or the card will vanish abruptly instead of animating out.

## Which file to use

| Where you edit | Use | How |
|----------------|-----|-----|
| **Instagram Edits** (iPhone) | `renders/phone-transparent/*.mov` | Save to Photos → in Edits tap **Overlay** → pick the clip → pinch/drag into place. It's transparent: rounded corners, shadow, your video shows around it. |
| Instagram Edits, fallback | `renders/phone-boxed/*.mp4` | Only if a transparent clip shows a black box around the card. These are just the card (square corners), so they work as a plain overlay anywhere. |
| CapCut mobile, iMovie | `renders/greenscreen/*.mp4` | Overlay → **Chroma key** (CapCut) / **Green/Blue Screen** (iMovie) → raise intensity/softness until the thin green edge disappears. Nothing in the cards is green. |
| Premiere, Final Cut, DaVinci, CapCut desktop | `renders/alpha/*.mov` | ProRes 4444 with transparency. Put it on a track above your video. |
| Just checking it | `renders/jev-preview.mp4` | All clips back to back, full frame, over a stand-in background |

The transparent `.mov`s are written by Apple's own encoder (`tools/apple-encode.swift`). Apple's frameworks, which Edits, Final Cut and iMovie all use, read the alpha in ffmpeg-written ProRes as fully opaque.

Why not a GIF? GIF transparency is on/off only, so anti-aliased text gets jagged edges. GIFs are also limited to 256 colours, and most editors treat them poorly as overlays.

## Preview / tweak

Open `index.html` in Chrome to play, scrub, swap backgrounds, and toggle Instagram's UI safe zones. To change wording, edit the text in `index.html` and re-render:

```bash
npm run render -- Jev                          # everything
npm run render -- Jev --scenes 1               # just clip 01
npm run render -- Jev --formats phone          # just the iPhone transparent clips
npm run render -- Jev --scenes 4 --dur 4=7.5   # clip 04 re-timed to 7.5s to match your take
```

## Fact check (Oct 4, 2026)

| Script claim | Status |
|---|---|
| As good as Astra and Fable | ✅ TypeSafe's launch post compares Jev against Astra and Fable and claims "similar levels of intelligence on System One tasks" |
| Cheaper | ✅ $0.042 per 1M input tokens, output tokens free (shown on clip 01) |
| Released 2 weeks ago by TypeSafe AI | ✅ Sept 15, 2026 (limited early access). That's ~3 weeks before posting on Oct 4+ |
| Founded by an ex-OpenAI researcher | ✅ Co-founder Diogo Almeida spent ~4 years at OpenAI |
| Single forward pass vs. token-by-token | ✅ TypeSafe: "parallel" generation vs LLMs producing "one token at a time" |
| **400 million parameters** | ⚠️ Not in TypeSafe's post or Wikipedia. TypeSafe hasn't published the architecture. |
| **Open-source version for over a year** | ⚠️ Not mentioned in either source |

Sources: [TypeSafe launch post](https://typesafe.ai/blog/introducing-system-one-models-and-jev) · [Wikipedia: Jev (AI model)](https://en.wikipedia.org/wiki/Jev_(AI_model))

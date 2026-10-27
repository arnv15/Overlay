# Cadence — overlay clips

Sixteen clips for the Congressional App Challenge 2026 video, one per beat of `docs/VIDEO_SCRIPT.md` in the Cadence repository, each cropped to its card so you can drag and pinch it wherever you want. Drop each clip on the timeline **at the moment you start saying its line**. Every card ends above y ≈ 1040, so it stays clear of the talking head in the lower half.

| # | Clip | Starts when you say… | Length | Priority |
|---|------|----------------------|--------|----------|
| 01 | `what-is-cadence` | "This is Cadence…" | 13.5s | Must |
| 02 | `speech-clues` | "…changes in everyday speech…" | 7.0s | Nice |
| 03 | `built-for-50-to-85` | "Cadence is for adults 50 to 85…" | 10.4s | Nice |
| 04 | `shortened-for-video` | (the recorder appears on screen) | 4.0s | Must |
| 05 | `on-device-pipeline` | "Whisper, an open-source speech model…" | 8.4s | Must |
| 06 | `nine-features` | "Cadence computes nine speech features…" | 2.6s | Must |
| 07 | `three-tiers` | "…and picks one of three tiers…" | 7.4s | Must |
| 08 | `demo-model-lock` | "I don't have clinical data yet…" | 12.8s | Must |
| 09 | `personal-baseline` | "Your first five days…" | 7.0s | Must |
| 10 | `timestamps-miss-silence` | "The hardest part was measuring pauses." | 7.4s | Must |
| 11 | `cutoff-too-high` | "On my first real test…" | 11.2s | Must |
| 12 | `cutoff-adapts` | "Now the cutoff adapts…" | 5.4s | Must |
| 13 | `same-numbers-two-languages` | "The same features run in TypeScript and Python…" | 7.0s | Must |
| 14 | `tools-and-ai` | "Cadence is written in TypeScript…" | 14.0s | Must |
| 15 | `whats-next` | "Next: real clinical data…" | 4.0s | Nice |
| 16 | `end-card` | (right after "Thanks for watching!") | 3.0s | Must |

Clips 10, 11 and 12 use the same card size and the same row of loudness bars (built once from one array in `index.html`), so placed back to back they play as one story: each starts where the last left off.

Every clip ends with a 0.3s exit animation. If your line is shorter than the clip, trim the clip's **start** or re-time it (see below). Don't cut its tail, or the card will vanish abruptly instead of animating out.

Timings assume about 150 words a minute from the first word of each line. `--dur` only changes the hold before the exit (`retime()` in `shared/overlay.js` still returns the original delay), so if a take is much faster or slower, edit the `--at` values in `index.html`.

## Which file to use

Default output is `renders/phone-transparent/` only.

| Where you edit | Use | How |
|----------------|-----|-----|
| **Instagram Edits** (iPhone) | `renders/phone-transparent/*.mov` | Save to Photos → in Edits tap **Overlay** → pick the clip → pinch/drag into place. It's transparent: rounded corners, shadow, your video shows around it. |
| Instagram Edits, fallback | `renders/phone-boxed/*.mp4` | Only if a transparent clip shows a black box. Make with `--formats boxed`. |
| CapCut mobile, iMovie | `renders/greenscreen/*.mp4` | Make with `--formats green`. Check that the keyer doesn't eat the light-green "Typical" row in clip 07. |
| Premiere, Final Cut, DaVinci | `renders/alpha/*.mov` | ProRes 4444 with transparency. Make with `--formats alpha`. |

## Preview / tweak

Open `index.html` in Chrome to play, scrub, swap backgrounds, and toggle Instagram's UI safe zones. To change wording, edit the text in `index.html` and re-render:

```bash
npm run render -- Cadence                           # everything
npm run render -- Cadence --scenes 11               # just clip 11
npm run render -- Cadence --scenes 10,11,12         # the pause story
npm run render -- Cadence --scenes 8 --dur 8=14     # clip 08 with a longer hold
```

## Rules the cards follow

- Tiers always show their name and icon, never colour alone.
- Icons are inline SVG; the renderer's audit refuses glyphs missing from the bundled fonts.
- No accuracy figures, and none of the words "diagnose", "detect", "predict" or "Alzheimer's".
- Code has ligatures turned off, so `===` and `&&` read exactly as written in `scorer.ts`.

## Fact check (Oct 25, 2026)

Every claim on a card and its source in the Cadence repository (`/Users/gupta/Documents/GitHub/Cadence`). All were re-checked against the files at commit `2e6b6e4`.

| Card claim | Source |
|---|---|
| 60-second check; recorder minimum 20 s | `app/src/shared/feature_spec.json` → `recording` |
| Runs entirely on the phone; nothing uploaded | `docs/SUBMISSION.md` → "Privacy claims": the only network request is the one-time speech-model download |
| Whisper tiny.en | `feature_spec.json` → `whisper.model` |
| Nine feature labels | `app/src/explain.ts` → feature labels |
| "You paused more often than this model expects." | `app/src/explain.ts` |
| Ages 50–85; text at least 17 pt; buttons at least 56 pt | `AGENTS.md` → Non-negotiables 6 |
| "Trained on synthetic data (not clinical)"; `"trained": false` | `app/assets/model.json` → `trained_on`, `trained` |
| `if (tier === 'doctor' && !modelTrained) tier = 'watch';` | `app/src/scorer.ts`, `decideTier` |
| Baseline = first five distinct days | `feature_spec.json` → `baseline.baseline_days`; `docs/ARCHITECTURE.md` → `computeDrift` |
| One off day can never send you to a doctor | `decideTier`: "Talk to a doctor" needs sustained drift, a probability above threshold, and a trained model |
| Loudness every 20 ms | `feature_spec.json` → `audio_activity.frame_ms` |
| Whisper's timings found 0 of 5 pauses in the test recording | `HANDOFF.md` → "P0: pause measurement repaired" |
| Cutoff 0.010; 90% of the recording quieter than 0.0087; heard as speech 7% → 43% | `HANDOFF.md` → "2026-10-23: feature spec v4" (loud decile 0.0087; active fraction 6.7% → 43%) |
| cutoff = max(noise floor × 3, loud × 0.1, 0.004) | `HANDOFF.md` → feature spec v4; `feature_spec.json` → `audio_activity` |
| 119.69 wpm, 12.73 /min, 1.856 s, 0.757; difference 0.000000 | `app/src/shared/parity/sample_pauses_python.json`; `docs/SUBMISSION.md` → feature parity three-way bit-identical |
| 400+ automated tests | `docs/SUBMISSION.md` → 379 Jest + 29 pytest |
| React Native 0.86, Expo SDK 57, Python 3.14 | `AGENTS.md` → Layout |
| DementiaBank access not yet granted | `README.md` → "Status of the model" |
| Papers in clip 02 | `app/src/content/citations.ts` |

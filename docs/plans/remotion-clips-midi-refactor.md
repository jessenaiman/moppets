# Studio 404 — Remotion + Individual Clips + MIDI Refactoring Plan

> **Goal:** Replace static sprite-sheet playback and browser-only `blob:` audio hacks with a real Remotion multi-track clip architecture where live Web MIDI, Launchkey knobs, `.mid` round-trips, and editable lyrics drive individual transparent alpha character loops (`@remotion/media` `<Video>` inside `<Sequence>` tracks) and deterministic MP4/WebM export.

---

## 1. Why the Current App Needed Refactoring

1. **Sprite-sheet bottleneck:** `VideoStudio.tsx` mounts `MoppetComposition.tsx`, which renders `ShotcraftStage.tsx` using CSS `background-image` offsets over `4×2` WebP sheets (`public/rehearsal/rigs/<artKey>/{closed,open}.webp`). Individual character clips (`idle`, `sing`, `belt`, `chuckle`) and ArtCraft rigs were not loaded as native Remotion media tracks.
2. **Broken headless audio & asset paths:** Clicking **Attach CHIMERA Audio** in `VideoStudio.tsx` created a browser-only `blob:` URL (`URL.createObjectURL`), while `ShotcraftStage.tsx` emitted raw `/rehearsal/...` paths without Remotion `staticFile()`, `delayRender()` preloading, or `--public-dir=public` in `tools/video-bridge.ts`. Editing notes via MIDI left cached WAVs stale or un-renderable headlessly.

---

## 2. Target Architecture (Non-Hacky)

```
  Launchkey MIDI / Staff Step-Edit / .mid Import / Words Editor
                          │
                          ▼
             useMoppet (Piece + MoppetVoice[])   ← single source of truth
                          │
        ┌─────────────────┼─────────────────────────────┐
        ▼                 ▼                             ▼
  CHIMERA Audio     Clip Timeline Compiler       Remotion <Player> & Render
 (exportWav ->      (src/choir/clipTimeline.ts)  (MoppetComposition + @remotion/media)
  /__video/audio)         │                             │
        │                 ▼                             ▼
        │       Per-character <Sequence>       Individual Transparent Alpha Clips
        │       segments (idle/sing/belt/      public/clips/<artKey>/
        │       chuckle) locked to beat/MIDI     ├─ manifest.json
        │                                        ├─ idle.webm    (VP9 yuva420p)
        └───────────────────────────────────────▶├─ sing.webm    (VP9 yuva420p)
                                                 ├─ belt.webm    (VP9 yuva420p)
                                                 └─ chuckle.webm (VP9 yuva420p)
```

### Core Modules & Contracts

1. **Individual Clip Registry (`public/clips/<artKey>/manifest.json`):**
   - Each character upgraded through **Google Flow `Asset Breakout` + ArtCraft (`photocraft-cli`, `vectorcraft`, `effectcraft-cli`)** exports 4 seamless integer-period transparent VP9 alpha `.webm` loops (`384×512`, `24 fps`, `2.0 s`, `yuva420p`): `idle.webm`, `sing.webm`, `belt.webm`, `chuckle.webm`.
   - `public/clips/<artKey>/manifest.json` records dimensions, fps, loop duration, and clip URLs. Characters not yet upgraded gracefully fall back to `staticFile("rehearsal/rigs/<artKey>/{closed,open}.webp")`.

2. **Pure Clip Timeline Compiler (`src/choir/clipTimeline.ts`, engine-free):**
   - `buildCharacterClipSegments(piece, voiceId, fps, stageDurationSec)` reads any `Piece` (including freshly imported `.mid` pitches/durations and edited lyrics) and emits coalesced `{ clip: "idle" | "sing" | "belt" | "chuckle", startFrame, durationInFrames, playbackRate }` segments.
   - Musical mapping rules:
     - Active vocal notes -> `"sing"`, automatically escalating to `"belt"` on high/sustained notes (top quartile of the voice's note range in the piece or sustained `beats >= 2`).
     - Phrase tails / skit laughs -> `"chuckle"`.
     - Rest gaps -> `"idle"`.
   - `playbackRate` scales cleanly with `piece.bpm / 112` so loop choreography tracks tempo changes (`0.5×` / `0.75×` / `1×` or custom BPM).

3. **Native Remotion Character Layer (`src/remotion/CharacterClip.tsx`):**
   - Renders `@remotion/media` `<Video src={resolveAsset(url)} loop muted playbackRate={seg.playbackRate} />` inside explicit `<Sequence from={seg.startFrame} durationInFrames={seg.durationInFrames}>` tracks.
   - `ShotcraftStage.tsx` accepts optional `resolveAsset` and `renderCharacterOverride` props so live booth and Remotion share stage camera/bubbles/lights while Remotion swaps in true video clip `<Sequence>` tracks for upgraded cast (`Neon` first).

4. **MIDI + CHIMERA Audio Bridge (`src/ui/VideoStudio.tsx` & `tools/video-bridge.ts`):**
   - `VideoStudio.tsx` exposes `Connect MIDI`, `↑ Import .mid`, and `↓ Export .mid` right in the Remotion toolbar alongside Song/Skit selection and lyric bubble editing.
   - `pieceSignature` tracks any MIDI note edit, `.mid` import, Launchkey knob change, or lyric rewrite; `triggerRender()` auto-synthesizes fresh 48 kHz CHIMERA vocals and persists them via `POST /__video/audio?slug=<slug>` -> `out/video/<slug>/mix.wav` before invoking `remotion render --public-dir=public`.

---

## 3. Phased Rollout

- **Phase 1 (Implemented Now — Vertical Slice):** Refactor docs, `src/choir/clipTimeline.ts`, `src/remotion/CharacterClip.tsx`, `ShotcraftStage.tsx` overrides + `staticFile` / `delayRender` preload, `/__video/audio` + MIDI controls in `VideoStudio.tsx`, and **Neon (#1)** 4 transparent VP9 alpha clips (`public/clips/neon/`) rendered from standalone `out/neon.ecproj` + proved with real H.264/AAC MP4 export.
- **Phase 2 (One Character at a Time):** Use upgraded Google Flow `Asset Breakout` + ArtCraft to cut, rig, and render individual `public/clips/<artKey>/` packs for `Tabby`, `Watt`, `Gruff` (Copper/Romex redesign), `Click`, `Cue`, `Clank`, `Chip`, `Thrum`, `Clacker`, and floor `Tracking & Hertz`, registering each in `AVAILABLE_CLIP_MANIFESTS`.
- **Phase 3 (Native Remotion Studio Interactivity):** Wrap world background plates and foreground props in `<Interactive.Div>` / `<Interactive.Path>` components so artists can tweak framing in `npx remotion studio` without losing MIDI sync.

# DESIGN.md — CHIMERA Moppets Studio (Studio 404)

## Direction
Warm dark backstage puppet theater paired with crisp, physically modeled CHIMERA vocal instrumentation.

- **Mode:** Operate + Stage Showcase (desktop-first, responsive fallback)
- **Surfaces:**
  - Canvas / Stage Backdrop: `#111014`
  - Console Panel: `#18161d`
  - Control Well / Track Surface: `#211e28`
  - Hairline Border: `#2e2938`
- **Palette & Meaning:**
  - Primary Interactive / Tabby Soprano Accent: `#2fbfa0`
  - Warm Tungsten Stage Cue / Active Phrase: `#e6a24c`
  - Vocal Tract Air Pressure / Formant Peak: `#5ea8ff`
  - Primary Ink: `#f2efe9`
  - Muted Secondary Ink: `#a7a0b5`
- **Typography:**
  - UI & Headings: `Space Grotesk` / system geometric sans
  - Data, Timecode, BPM, Hz & Formants: `JetBrains Mono` / `monospace` with `font-variant-numeric: tabular-nums`
- **Geometry:**
  - Console panels: `12px` radius, `1px solid #2e2938`
  - Action & camera controls: `8px` radius (pills `9999px` only for small status tags)
  - Stage viewport: strict `16:9` aspect (`1280x720` native render & export target)

## Stitch Screen Sections
1. `studio-topbar` — Brand mark, active song badge, Play/Pause, timeline scrubber, timecode, Master Volume, **Export Video** CTA, links to `Airway Lab` (`/?view=chimera`) & `3D Rig` (`/rig.html`).
2. `stage-viewport` — Full-width 16:9 Three.js Stage canvas (`MoppetStage3D`), floating camera pills (`Auto`, `Wide`, `Close-Up`, `Low Angle`), live action pads (`Idle`, `Sing`, `Belt`, `Chuckle`, `Walk`, `Bow`), and active sung lyric subtitle.
3. `studio-console` — 3-column dock:
   - **Cast Roster:** Tabby card + locked Mop #2 migration slot (`Neon` next).
   - **Lead Sheet & Live Keys:** Click-to-seek `Bible · Tabby` phrases + playable 2-octave keyboard (`Z–M` / `Q–U` / Web MIDI).
   - **CHIMERA Voice & Airway:** Pressure / Tension / Brightness / Vibrato controls + live CHIMERA 2D `<AnatomyView />`.

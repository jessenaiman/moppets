# The Moppets

Found-object characters with physically modelled voices, on CHIMERA (pinned in `chimera/`). See
the README.

## Working here

- Do what was asked, the simplest way. Side work nobody asked for (experiments, tooling, paid
  runs) is a proposal with its cost. If the work grows well past the estimate, stop and say so.
- Before repeating or reversing earlier work, read its history (`git log -- <path>`, `git log -S`).
- Commit small. The subject names what changed and the trap, in searchable words; the body gives
  the why, what you ruled out, and what you verified in the browser.
- Code outranks this file: fix the file when they disagree.

## Map

- `chimera/`: CHIMERA, a pinned git submodule. `bun run dev` and `bun run build`
  check out the recorded revision (`bun run chimera:update`). **Never edit it**; its own AGENTS.md governs it, not
  this repo.
- `crates/moppet-wasm/`: the app's wasm: CHIMERA's C ABI plus the sized Moppet voices (`moppet_*`).
- `src/choir/`: the Moppets (cast, scores, songs, skits, band, gestures, the ensemble of singer
  workers). `src/audio/`: the AudioContext and the dictionary. `src/ui/`: the app (React, Tailwind CSS v4, the stage).
  `src/worklet/`: the choir mixer and live CHIMERA voice worklet.
- `songs/`: every song, skit and round's words as a lead sheet (`src/choir/songFile.ts`,
  `docs/writing-songs.md`); a new one is listed in `src/choir/songs.ts`.
- `tools/`: the real-browser Playwright check (`tools/playwright-check.ts`), Craft FMV slicer, and dev bridges.

## Rules

- **CHIMERA's TypeScript is imported as `@chimera/…`**, never copied. When the Moppets need what
  CHIMERA doesn't do, it goes in `crates/moppet-wasm` or `src/`, on CHIMERA's public API.
- **`src/audio/moppet.wasm` is a gitignored build product.** After a Rust change (or a newer
  CHIMERA), run `bun run wasm` before checking the affected behavior.
- **The wasm loads before the UI.** CHIMERA's `engine.ts` calls the engine as it loads, so it
  must not be reachable from `src/main.tsx`'s static imports.
- **Worker and worklet modules stay engine-free** (`music.ts`, `band.ts`, `bandSynth.ts`,
  `mix.ts`, `midi.ts`, `timeline.ts`, `captions.ts`, the singer worker, the mixer worklet): they load
  where the engine isn't. Engine-calling helpers go in their own module (`roundCheck.ts`, `plan.ts`).
- **Keep audio direct.** Route CHIMERA voices straight through the single master volume (`src/audio/audio.ts`) and clean browser WASM worklets without stacked volume wrappers, lockouts, or external plugin-host bypasses.
- **Use Tailwind CSS v4** (`src/ui/tailwind.css`) for responsive layout instead of ad-hoc CSS hacks.
- **Use the Craft apps (`photocraft`, `anicraft`, `effectcraft`, `filmcraft`, `vectorcraft`)** via
  their MCP `--bridge` / `--automation-read-root` or `<app>-cli` for keying, matting, animation,
  and compositing instead of hand-rolling image/video processing in Python or JS. Read
  `<app>-cli --help` (`mcp --help`) and `commands` before writing any tool.
- **Nothing copyrighted goes in git.**

## Checks

Verify real user-facing functionality in a real Chromium browser when finishing or committing changes (`bun run check` + `bun run typecheck`). Do not add or maintain internal unit/policy/fixture test suites that assert third-party internals or lock in wrappers.

# The Moppets

Found-object characters with physically modelled voices, on CHIMERA (its `main`, in `chimera/`). See
the README.

## Working here

- Do what was asked, the simplest way. Side work nobody asked for (experiments, tooling, paid
  runs) is a proposal with its cost. If the work grows well past the estimate, stop and say so.
- Before repeating or reversing earlier work, read its history (`git log -- <path>`, `git log -S`).
- Commit small. The subject names what changed and the trap, in searchable words; the body gives
  the why, what you ruled out, what you ran (with numbers) and what you didn't test.
- Keep each fixed bug's reproduction as a test.
- Code outranks this file: fix the file when they disagree. When something breaks unnoticed, add
  a rule here, with a check.

## Map

- `chimera/`: CHIMERA, a git submodule following its `main`; `bun run dev` and `bun run build`
  take the newest (`bun run chimera:update`). **Never edit it**; its own AGENTS.md governs it, not
  this repo.
- `crates/moppet-wasm/`: the app's wasm: CHIMERA's C ABI plus the sized Moppet voices (`moppet_*`).
- `src/choir/`: the Moppets (cast, scores, songs, skits, band, gestures, the ensemble of singer
  workers). `src/audio/`: the AudioContext and the dictionary. `src/ui/`: the app (React, the stage).
  `src/worklet/`: the choir mixer.
- `songs/`: every song, skit and round's words as a lead sheet (`src/choir/songFile.ts`,
  `docs/writing-songs.md`); a new one is listed in `src/choir/songs.ts`.
- `tests/`: bun tests on the wasm build. `tools/`: the choir e2e, layout lint, videos, gestures,
  the Claude, SoundCraft and song bridges for the dev server.

## Rules

- **CHIMERA's TypeScript is imported as `@chimera/…`**, never copied. When the Moppets need what
  CHIMERA doesn't do, it goes in `crates/moppet-wasm` or `src/`, on CHIMERA's public API.
- **`src/audio/moppet.wasm` is a gitignored build product.** After a Rust change (or a newer
  CHIMERA), `bun test ./tests` alone tests the old engine: use `bun run test`.
- **`bun test ./tests`, not `bun test tests`:** the bare word is a filter that also runs
  CHIMERA's own tests in `chimera/`, against a wasm they weren't built for.
- **The wasm loads before the UI.** CHIMERA's `engine.ts` calls the engine as it loads, so it
  must not be reachable from `src/main.tsx`'s static imports. Check: `bun tools/choir-e2e.ts`
  against `bun run preview`.
- **Worker, worklet and tool modules stay engine-free** (`music.ts`, `band.ts`, `bandSynth.ts`,
  `mix.ts`, `midi.ts`, `timeline.ts`, `captions.ts`, the singer worker, the mixer worklet): they load
  where the engine isn't. Engine-calling helpers go in their own module (`roundCheck.ts`, `plan.ts`).
  Check: `tests/engine-free.test.ts`.
- **DOM content flows in `.screen-body`, never absolutely positioned.** Check: `bun run lint:layout`.
- **Nothing copyrighted goes in git.**

## Checks

| When you touch | Run |
|---|---|
| anything | `bun run test` and `bun run typecheck` |
| `crates/moppet-wasm/`, a newer `chimera/`, `src/audio/`, `src/worklet/`, `src/main.tsx` | `bun run build && bun run preview`, then `bun tools/choir-e2e.ts http://127.0.0.1:5418/` |
| `src/ui/`, CSS | `bun run lint:layout` |

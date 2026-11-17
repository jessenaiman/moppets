# The Moppets

Found objects that sing: a tape-deck fox, a typewriter rabbit, a robot tenor, a felted frog, a
gravelly monster, a patchwork soprano and a floppy-disk bird, each with a real, physically modelled
voice. An animated stage, songs written as lead sheets, a round, talking skits, a MIDI band, and
a Launchkey Mini to play with.

Every voice is [CHIMERA](https://github.com/jamesondh/chimera-vocal-synth): a simulated airway
(lungs, vocal folds, throat, mouth and nose), not samples. CHIMERA is a dependency here, pinned
in `chimera/` (a git submodule, never edited); what the Moppets add is in this repo.

## What's here

- **The stage:** each Moppet is its own CHIMERA voice (body, airway size, posture and folds)
  singing one score, animated from the engine's own telemetry: mouths open with the lips, gesture
  clips (laugh, shrug, gasp, nod, tilt, bow) play on cue.
- **Songs** are lead sheets in `songs/`, one text file each, with words you can edit in the app
  (a live syllable and stress check, holds and note splits as fixes): see
  [docs/writing-songs.md](docs/writing-songs.md). Claude can write a new round or skit (dev server).
- **The band:** bass, keys and drums arranged from each song's chords; MIDI out and back through
  SoundCraft.
- **Videos:** `bun tools/moppet-video.ts autocomplete toaster` (against `bun run preview`) renders
  each performance frame-exact to `out/video/<title>/`; `bun tools/moppet-edit.ts` builds FilmCraft
  and EffectCraft projects from them.
- **A Launchkey Mini** (any MIDI controller): knobs shape the selected Moppet's voice, pads pick a
  Moppet and sing its introduction.

## Run it

Needs Rust with the `wasm32-unknown-unknown` target, and Bun.

```sh
git clone --recurse-submodules …      # or, in a clone: git submodule update --init
bun install
bun run dev        # builds the wasm, then Vite on 127.0.0.1:5417
bun run test       # wasm build, cargo test, bun test ./tests
```

## How it uses CHIMERA

- **`chimera/`** is CHIMERA at an exact commit. To take the newest CHIMERA, `bun run
  chimera:update` (fetches it, moves the pin to its `main`, rebuilds the engine), try the app, then
  commit the new pin (`git add chimera`). Nothing is merged. Hosting the app (Vercel and the like)
  needs the submodule fetched in its build, issue #13; that's separate from updating.
- **`crates/moppet-wasm/`** builds the one wasm the app loads: CHIMERA's whole C ABI, unchanged,
  plus the Moppet voices (`moppet_*`): CHIMERA's engine with the airway at any size, which CHIMERA
  itself doesn't offer (Gruff and Clank are giants).
- **TypeScript** imports CHIMERA's engine wrapper, types and look as `@chimera/…`
  (`chimera/src/…`). The dictionary and fonts are served from `chimera/public`.

## License

[MIT](LICENSE), as CHIMERA. Bundled third-party files keep their own licenses: the CMU
Pronouncing Dictionary and the fonts (in `chimera/public/`).

# The Moppets

Found objects that sing: a tape-deck fox, a typewriter rabbit, a robot tenor, a felted frog, a
gravelly monster, a patchwork soprano and a floppy-disk bird, each with a real, physically modelled
voice. An animated stage, songs written as lead sheets, a round, talking skits, a MIDI band, and
a Launchkey Mini to play with.

The stage sings the score through the CHIMERA singer workers. Found Things uses its recorded vocal and beatbox stems against the same score. SoundCraft hosts the upstream CHIMERA CLAP instrument for plug-in recording. For the upstream documentation, build instructions, MIDI routing, and an inspectable host session, see [CHIMERA plug-in vocals](docs/chimera-plugin-vocals.md).

## What's here

- **The stage** plays the cast’s individual vocals and score-directed puppet animation. Mouth opening follows the singer’s measured vocal level.
- **Songs** are lead sheets in `songs/`, one text file each, with words you can edit in the app
  (a live syllable and stress check, holds and note splits as fixes): see
  [docs/writing-songs.md](docs/writing-songs.md). Claude can write a new round or skit (dev server).
- **The band:** bass, keys and drums arranged from each song's chords; MIDI out and back through
  SoundCraft.
- **Videos:** Run `bun run dev`, select a song or skit, then choose **Export MP4** in the rehearsal
  toolbar. The app prepares a WAV from the score and current singer levels and passes its vocal
  timing to Remotion. The MP4 is written under `out/video/<title>/`.
- **Audio sync:** Rehearsal picture follows the audio sample clock. Playback starts once the mixer has
  enough samples to begin. If the browser suspends audio, press **Play** to continue at that position.
- **A Launchkey Mini** (any MIDI controller): the eight encoders control the eight cast volumes. The top pads select performers and the bottom pads trigger gestures.

## Run it

Needs Rust with the `wasm32-unknown-unknown` target, and Bun.

```sh
git clone --recurse-submodules …      # or, in a clone: git submodule update --init
bun install
bun run dev        # takes CHIMERA's newest main, builds the wasm, then Vite on 127.0.0.1:5417
bun run test       # wasm build, cargo test, bun test ./tests
```

## Public Moppets app

Vercel serves the same Vite app as the local rehearsal. The song picker opens on
Found Things. Press Play to hear the CHIMERA mixer and watch the stage follow the
audio clock. Found Things uses recorded stems. The rest of the repertoire uses
the browser's CHIMERA workers through the app's 48 kHz AudioWorklet mixer.
The Vercel build uses the CHIMERA commit recorded by the repository, builds
`moppet.wasm`, and serves the Vite output over HTTPS.

## How it uses CHIMERA

- **`chimera/`** follows CHIMERA's `main` (`branch = main` in `.gitmodules`). `bun run dev` and
  `bun run build` take its newest commit first (`bun run chimera:update`, which also rebuilds the
  engine; offline, they build the checkout as it is). Git still records which commit a Moppets
  commit was made against. The production build uses that recorded commit.
- **`crates/moppet-wasm/`** builds the one wasm the app loads: CHIMERA's whole C ABI, unchanged,
  plus the Moppet voices (`moppet_*`): CHIMERA's engine with the airway at any size, which CHIMERA
  itself doesn't offer (Gruff and Clank are giants).
- **TypeScript** imports CHIMERA's engine wrapper, types and look as `@chimera/…`
  (`chimera/src/…`). The dictionary and fonts are served from `chimera/public`.

## License

[MIT](LICENSE), as CHIMERA. Bundled third-party files keep their own licenses: the CMU
Pronouncing Dictionary and the fonts (in `chimera/public/`).

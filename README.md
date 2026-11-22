# The Moppets

Found objects that sing: a tape-deck fox, a typewriter rabbit, a robot tenor, a felted frog, a
gravelly monster, a patchwork soprano and a floppy-disk bird, each with a real, physically modelled
voice. An animated stage, songs written as lead sheets, a round, talking skits, a MIDI band, and
a Launchkey Mini to play with.

The stage sings the score through the CHIMERA singer workers, including the vocals and beatbox in Found Things. SoundCraft hosts the upstream CHIMERA CLAP instrument for local authoring and plug-in recording. For the upstream documentation, build instructions, MIDI routing, and an inspectable host session, see [CHIMERA plug-in vocals](docs/chimera-plugin-vocals.md).

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

The app needs Bun, Git LFS, and Rust with the `wasm32-unknown-unknown` target.

```sh
git lfs install
git clone --recurse-submodules https://github.com/jessenaiman/moppets.git
cd moppets
git lfs pull
bun install --frozen-lockfile
bun run dev
```

Open [the public stage](http://127.0.0.1:5417/) to pick a song and place, follow the full-band score or view MIDI notes.
The development server also provides [the local creation desk](http://127.0.0.1:5417/admin) with the live instrument, hardware MIDI, score editor and a separate Remotion video preview.
Production builds only include the audience view. To serve one locally, use `bun run build` and `bun run preview`.

## Screening and recordings

The public stage prepares the selected written score with CHIMERA. The audio element supplies the clock for the cast, score and note display. The Clips tab plays finished videos.
The standalone screening page in
[`watch/index.html`](watch/index.html) also plays exported videos and full-length songs. To view it locally,
run `python3 -m http.server 8000 --directory watch` and open [the screening page](http://localhost:8000/).

Git LFS stores finished MP3 recordings in `watch/rehearsal/audio/` and `public/rehearsal/audio/`,
and Ogg stems in `public/plugin-vocals/` and `public/scored-vocals/`. The app serves the catalog at
`/recordings/` through the `public/recordings` symlink. After a re-render, stage and commit the audio
at its existing path. Git records a pointer, and the LFS pre-push hook uploads the audio. Run
`git lfs pull` in an existing checkout to download it. The Vercel build hydrates recordings
before building the app against its pinned engine.

## How it uses CHIMERA

- **`chimera/`** is pinned to the commit recorded in this repository. Both local builds and
  Vercel use `bun run chimera:update` to initialize that checkout before rebuilding the engine.
  To upgrade CHIMERA deliberately, run `git submodule update --remote -- chimera`, stage the
  new pin with `git add chimera`, then test and commit the change.
- **`bun run wasm`** uses the pinned submodule's build script. Browser workers and live
  worklets use its native voice engine, with each character's body, articulation and source preset.
- **TypeScript** imports CHIMERA's engine wrapper, types and look as `@chimera/…`
  (`chimera/src/…`). The dictionary and fonts are served from `chimera/public`.

## License

[MIT](LICENSE), as CHIMERA. Bundled third-party files keep their own licenses: the CMU
Pronouncing Dictionary and the fonts (in `chimera/public/`).

EffectCraft project masters live under `/run/media/jesse/Speedy/magic-studio/assets/moppet-choir/`, following their former repository paths. The web build uses the exported media.

The same Speedy library holds character artwork, storyboards, Craft and Blender masters, and copies of published media. Git retains the exported files used by the web app, watch page, and documentation.

Storyboards and their exports live in `/run/media/jesse/Speedy/magic-studio-assets/storyboards/moppet-choir`. The Colab bootstrap script lives in `tools/storyboards/bootstrap-found-things.py`.

# CHIMERA vocal signal path

The browser engine and the desktop instrument are published on different branches. The application's CHIMERA submodule follows upstream main. The Linux instrument used here is the upstream plug-in branch at commit `5f1365c7391b0dc39048e980358c97df09682f06`. Its CLAP identifier is `com.github.jamesondh.chimera`.

1. Read the [upstream overview](https://github.com/jamesondh/chimera-vocal-synth/blob/0dc13f8704bd998e8d70377f3bc4de53b16863f8/README.md), then the [plug-in manual](https://github.com/jamesondh/chimera-vocal-synth/blob/5f1365c7391b0dc39048e980358c97df09682f06/docs/plugin.md). Its “MIDI”, “Lyrics and the transport”, and “State” sections define the host contract.
2. Build in a separate checkout with the [upstream Linux build script](https://github.com/jamesondh/chimera-vocal-synth/blob/5f1365c7391b0dc39048e980358c97df09682f06/crates/chimera-plugin/linux/build.sh). Put the resulting `target/bundled/CHIMERA.clap` and its license notices in this project's ignored `out/chimera-plugin/` folder. SoundCraft can discover it with `CLAP_PATH="$PWD/out/chimera-plugin" soundcraft-cli run --cmd engine.clap_plugins`.
3. In `src/choir/pluginScore.ts`, each scored event supplies its MIDI note, beat and duration. Lyrics advance in their written order. In `tools/plugin-host.ts`, SoundCraft creates a CHIMERA instrument track, loads its lyrics and native parameters, inserts MIDI notes and bounces the track. The host state uses the same length-prefixed JSON contract as the [upstream host test](https://github.com/jamesondh/chimera-vocal-synth/blob/5f1365c7391b0dc39048e980358c97df09682f06/crates/chimera-plugin/host-test/host_test.lua). The template in `tools/chimera-plugin-default.json` was read from a new upstream instrument instance.
4. Run `bun tools/render-plugin-cast.ts` to produce the stock vocal recordings and editable SoundCraft sessions. Open a session from `out/chimera-plugin/sessions/` to inspect the instrument slot, MIDI notes and state. The renderer emits note-on/off events and sets the instrument's native vibrato, glide and fry controls to zero. CHIMERA owns the oscillation and articulation. Its physical output can still have small cycle-to-cycle variation.

## What runs where

SoundCraft runs the Linux CLAP instrument for local authoring and offline bounces.
The public Vite app loads the CHIMERA WebAssembly build over HTTPS. One worker per
voice sends sample-aligned audio to the 48 kHz AudioWorklet mixer. The rehearsal
picture follows that mixer's audible position. Found Things uses its authored
vocal and beatbox stems. The other songs and skits synthesize from their scores in
the browser, independent of the desktop plug-in cache.

To inspect the native instrument in a fresh SoundCraft process from this folder, run `CLAP_PATH="$PWD/out/chimera-plugin" soundcraft out/right-on-cue/neon-chimera.scraft`. Inspect the instrument slot and the MIDI region. The stage never requests a pitch-bend event from that host.

In the local app, select a solo, open **Stage tools**, then **Open vocal instrument**. This opens that singer's editable SoundCraft session with the project-local CLAP search path. **Open in SoundCraft** continues to open the complete MIDI arrangement for note editing. These are separate commands.

The app's former chord-fitting rule altered 1,041 of 3,005 authored note events in this scorebook. The score compiler now preserves the written scale degrees. Whole-part octave placement still assigns the cast's score registers. Incoming keyboard notes use their original MIDI numbers. The regression check is in `tests/songs.test.ts`.

Found Things uses the scored CHIMERA singer for phrase-level consonant timing and the complete cast voice recipes, including tract size. Run `bun tools/render-found-vocals.ts` to build its stock vocal and beatbox stems, then `ONLY=14-found bun tools/choir-render.ts out/listen` for the mix. Edited parts use the scored singer workers when their pre-rendered stem is absent.

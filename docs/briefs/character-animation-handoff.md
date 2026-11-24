# Character bibles and singing-animation handoff

Checked November 24, 2026. This inventory covers the Studio 404 stage, its guest performers, and Sam’s winter act. I read the saved DesignCraft stories in the production library and in the app’s 16 downloadable bibles, then checked the published animation manifests. A file that decodes in the browser still needs an identity check against the current character art.

## Books to add or connect

| Character | What exists | What to add |
| --- | --- | --- |
| Latch | The app has a two-page acting bible and a vector performance for *After You*. It specifies a fixed rear hinge and a toe that releases on the click. | A production master under the general cast. Include the base and tread layers, the measured hinge pivot, and closed, speaking and listening poses. [Existing bible](../design/bibles/latch.designcraft) |
| Deck, Ozzi, Tally | Each has a current production master. All three already appear in the app’s Cast gallery. | Publish current copies for the three gallery downloads. [Deck](/run/media/jesse/Speedy/magic-studio-assets/bibles/general/Deck/Deck.designcraft) · [Ozzi](/run/media/jesse/Speedy/magic-studio-assets/bibles/general/Ozzi/Ozzi.designcraft) · [Tally](/run/media/jesse/Speedy/magic-studio-assets/bibles/general/Tally/Tally.designcraft) |
| LeadSinger, Sam | Both have masters. Neither has a dedicated card in the current gallery. Sam has a playable voice and winter act. LeadSinger has performance art and is listed in the Studio 404 cast map. | Gallery entries if these books should be available there. [LeadSinger](/run/media/jesse/Speedy/magic-studio-assets/bibles/general/LeadSinger/LeadSinger.designcraft) · [Sam](/run/media/jesse/Speedy/magic-studio-assets/bibles/children/Sam/Sam.designcraft) |
| Vee, Scribe, Pip | The original workshop voices have distinct art for the tape-deck fox, typewriter rabbit, and felt frog. Studio 404 maps their voice IDs to Neon, Cue, and Watt. The Farm School Pip book depicts a sparrow. | Separate books only if the original workshop designs are still in production. [Voice definitions](../../src/choir/cast) · [Studio 404 mapping](../../src/choir/studio404.ts) |

The general library contains 20 current character files for 19 distinct characters. Tracker and Tracking are byte-identical copies. Fuzz is the gallery’s Amplifier. Moonbell’s book explicitly names Moonbeam as her rehearsal identity. All 16 Farm School characters have a named master. Sam is the one used by the current winter song. [General masters](/run/media/jesse/Speedy/magic-studio-assets/bibles/general) · [Farm School masters](/run/media/jesse/Speedy/magic-studio-assets/bibles/children)

## What the animation team can add

| Character | Evidence and next usable delivery |
| --- | --- |
| Deck | The book specifies the cassette-door hinge through 0–55°, the VU eyes and transport keys. It lists the mechanical cutout sheet and native idle rig as pending. The stage already plays Deck’s idle and singing atlases. Supply the separated recorder parts and an idle-to-sung-to-rest take with the chassis held rigid. [Master, Rig and Motion spreads](/run/media/jesse/Speedy/magic-studio-assets/bibles/general/Deck/Deck.designcraft) |
| Ozzi | The mechanical cutouts and four acting poses exist. The book queues an EffectCraft rig for the scope waveform and spring aerial. Supply the driven singing take and its neutral return. Scope art belongs to Ozzi. [Master](/run/media/jesse/Speedy/magic-studio-assets/bibles/general/Ozzi/Ozzi.designcraft) |
| Tally | The book contains separated parts and requests the idle and ticker-critique projects. Use the brass iris, ON-AIR dome and paper ticker for phrasing. Deliver the quiet hold, spoken/sung response and settle with the tripod planted. [Master](/run/media/jesse/Speedy/magic-studio-assets/bibles/general/Tally/Tally.designcraft) |
| Tracker and Hertz | Their redesigned mechanical cutout sheets exist. The stage has WebMs for both. Verify the source rig and return pose for the wide VHS drawer and the wood-grain CRT pixel face before promoting another pair. The books assign the old counter-deck to Deck and the oscilloscope to Ozzi. [Tracker](/run/media/jesse/Speedy/magic-studio-assets/bibles/general/Tracker/Tracker.designcraft) · [Hertz](/run/media/jesse/Speedy/magic-studio-assets/bibles/general/Hertz/Hertz.designcraft) |
| Gruff | The book flags old rope-era takes for re-export. A newer eight-angle wired turnaround already exists in the harvest. Match the source project and singing take to the coiled cable body, grounded feet and coil-gap mouth. [Master](/run/media/jesse/Speedy/magic-studio-assets/bibles/general/Gruff/Gruff.designcraft) · [Eight-angle turnaround](/run/media/jesse/Speedy/magic-studio-assets/moppets/flow-3102c6e1-harvest/Gruff_Wired_8Angle_Turnaround_CANON.jpg) |
| Fuzz | The D-18 three-prong idle, walk-right, shred/reaction, layered rig, and puppet rig already exist. The rig metadata maps `404` to rest, `PLAY` to singing/groove, and `NO_NET` to an overdrive accent. The remaining handoff is the released performance comp and action ranges. [Display state map](/run/media/jesse/Speedy/magic-studio-assets/animations/effectcraft/fuzz/rig/fuzz_d18_rig_metadata.json). [Rig projects](/run/media/jesse/Speedy/magic-studio-assets/animations/effectcraft/fuzz) · [Master](/run/media/jesse/Speedy/magic-studio-assets/bibles/general/Fuzz/Fuzz.designcraft) |
| LeadSinger | The eight-state visor/viseme sheet and a singing project exist. The book still requests a clean Side-B cassette flip sheet and the idle, crooner and flip takes for this design. [Master](/run/media/jesse/Speedy/magic-studio-assets/bibles/general/LeadSinger/LeadSinger.designcraft) |
| Sam | Base and winter viseme sheets exist. The published standard atlas pack has idle, dig, cheer and other gestures, but no named sing action. The book requests a socket file. Map the existing winter mouth poses to the live voice ID `sam` and export a registered singing take. [Master](/run/media/jesse/Speedy/magic-studio-assets/bibles/children/Sam/Sam.designcraft) |
| Zap, Moonbell | Zap has a working keypad act and existing walk/idle loops. Add the isolated backlit LCD singing states for a reusable take. Moonbell has expression and locomotion clips. Her book asks for a separate bell-glow matte and choir socket mapping. [Zap](/run/media/jesse/Speedy/magic-studio-assets/bibles/general/Zap/Zap.designcraft) · [Moonbell](/run/media/jesse/Speedy/magic-studio-assets/bibles/general/Moonbell/Moonbell.designcraft) |
| Clacker, Click, Thrum | Their books identify native performance projects. Clacker requests chest-key, LED and eye mattes. Click requests brow, BPM LED and battery-hatch mattes. Thrum requests VU, mouth-bar and reel mattes and a rig map. Their instrument loops can be used independently of these overlays. [Clacker](/run/media/jesse/Speedy/magic-studio-assets/bibles/general/Clacker/Clacker.designcraft) · [Click](/run/media/jesse/Speedy/magic-studio-assets/bibles/general/Click/Click.designcraft) · [Thrum](/run/media/jesse/Speedy/magic-studio-assets/bibles/general/Thrum/Thrum.designcraft) |
| Cue, Tabby, Neon, Chip, Clank, Watt | All six already have named idle, sing, belt and chuckle WebMs. Cue also has an RGBA eight-pose singing/viseme sheet. These can be used for playback now. Neon’s secondary glow/mouth matte and Chip’s left/right walk and jump sheets are useful follow-ups. [Stage clip library](../../public/clips) · [Production masters](/run/media/jesse/Speedy/magic-studio-assets/bibles/general) |

Gruff is the Herdr orchestrator for missing creative assets. The production Spill board has Q-28 for the hardware quartet and Tally, Q-29 for Fuzz and Gruff, Q-30 for Sam, and Q-31 for Latch. Reply there with the current project, comp, action range and export. [Shared Spill board](http://localhost:4748)

## Export handoff

For this cast, one silent transparent VP9 WebM per action fits the existing player. Keep the matching still sheet for frame picking, scrubbing, and Three.js. Give the sheet its actual row and column count, occupied frame count, frame rate and foot anchor. Name the rig revision and neutral frame. Include the closed-to-sung-to-closed transition or the mouth, display or light layer that performs it. The CHIMERA score supplies the voice.

The Cast gallery offers each published WebM and its manifest under **Animation files**. To register another pack, put its clips and a `manifest.json` in `public/clips/<artKey>/`. The `artKey` matches the stage character. The required clip names are `idle` and `sing`. Add `belt`, `chuckle` or other named downloads as they become available. Use local filenames or existing public-root URLs. Vite and Remotion discover the pack when bundling. A minimal example follows.

```json
{"artKey":"deck","clips":{"idle":"idle.webm","sing":"sing.webm"}}
```

To encode an existing registered WebP sheet, run `bun run character:webm deck`. The exporter writes an installable clip folder under `out/character-clips/`, using each action’s source frame rate and dropping empty grid cells. It includes idle and sing. List additional actions after the character name to include them. The source WebP sheets remain available for the stage’s frame-based views.

EffectCraft can render the active rig directly. This example exports Fuzz’s D-18 layered composition at half resolution. Run it from the choir repository with an existing output directory.

```sh
effectcraft-cli --project /run/media/jesse/Speedy/magic-studio-assets/animations/effectcraft/fuzz/fuzz-d18-layered-rig.ecproj \
  render --comp 1 --work-area --resolution half --format webm --webm-codec vp9 \
  --channels rgba --audio off --out out/fuzz-d18-layered-rig.webm
```

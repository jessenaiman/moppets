# Studio 404 Backing Band: Canon & Art Brief

Three found-object studio Moppets who live upstage in Studio 404 and play the backing arrangement (`src/choir/band.ts`: bass on ch 11, keys on ch 12, drums on ch 10). They follow `docs/briefs/moppet-world.md`: the vintage device **is** the head or body, every Moppet carries a part borrowed from another, warm and kind, completely original.

## The Band Roster

| Band Member | Part | Device & Borrowed Part | Quirk & Why They're Here | Visible Stage Motion |
|---|---|---|---|---|
| **Thrum** | Bass (GM 33, ch 11) | Vintage brushed-steel broadcast **audio patch-bay & reel-to-reel chassis** upright as his body: two warm analog VU-meter eyes, a glowing amber level-bar mouth, and a thick braided orange studio XLR bass cable looped over his shoulder like an upright bass string that he plucks with felt fingers. Carries a borrowed brass glass-fuse clip from Neon. *(Rebuilt from the old power-strip concept so there is zero overlap with Watt.)* | Feels every note in his chassis before he hears it; hums low through his VU meters and sways in slow half-time. | Plucks his braided cable on every bass note-on (amplitude scaled by `vel`); deep squash-and-sway groove; rests calmly when bass is silent. |
| **Clacker** | Keys (Electric Piano GM 4, ch 12) | A vintage beige **1980s mechanical keyboard & studio synth module** standing upright: two big round keycap eyes with warm LED pupils, a wide grinning row of ivory piano-style keys across his chest, felt arms in mossy corduroy with four-fingered felt hands hovering over his own keys. Carries a borrowed rainbow ribbon-cable scarf from Tabby. | Can't stop fidgeting melodies on his own ribs; proud whenever a chord resolves cleanly. | Bounces and leans into chord hits, hands striking his own keys on note-ons, with harmonic glow pulses. |
| **Rattle** | Drums (GM Kit, ch 10) | A dented red vintage **studio craft-coffee tin** as his body and bass drum: two mismatched button eyes under stitched felt brows, a wide stitched smile, two yellow wooden pencils as drumsticks, two brass jar lids on bent wire stands flanking him like cymbals, perched on an upturned bottle-cap stool. Carries a borrowed strip of gaffer tape and a frayed cable shoelace from Gruff. | Loves counting off loudly and tapping on anything nearby; never minds sitting out for CHIMERA's beatbox — he nods and grooves right along with it. | Tin bounces on kick (36), pencil stick whips on snare (38), left/right lid cymbals rock and glint on hats (42/46) and crash (49); switches to a happy head-bobbing groove when drums sit out for beatbox. |

## Art Style (Matches `studio-404-cast-art.md`)

- Handmade felt puppet photographed like a stop-motion film set: soft studio light, visible stitching, wool felt and worn fabric texture, real vintage studio electronics with scuffs, patina, and small glowing lights.
- Warm, kind, expressive; never angry or sneering.
- Full body, three-quarter front view, centred, feet near the bottom of the frame.
- Flat solid chroma-blue background (`#0047BB`), even lighting, no shadow on the background. Square image. No text, no logos.
- Two matching images per member (`rest` and `play`), cut out via **EffectCraft SAM 2.1 Tiny (`--control` / `--bridge`) + PhotoCraft Refine Edge**, and animated with **AniCraft** (`tools/moppets/band.anicraft` -> `src/choir/band-anim.generated.json`).

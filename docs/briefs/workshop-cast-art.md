# Brief: art for the Workshop cast (four new singers and the AV cart pair)

You're making image assets for the Moppets (this repo; read `AGENTS.md` first). Use your image
generation. Make only the images below; don't change code.

## What a Moppet is

A Moppet is a puppet that a device became. The device **is** its head or body, never something it
holds or wears. Its working parts do the acting (a screen is the face, a hinge is the jaw, reels
are the ears). Felt does the rest: arms, legs, hands, stitching, patches. If you took the device
away there would be no character left. The three existing true Moppets show the idea: Clank (an
old computer monitor for a head, a rusty PC tower body), Tabby (a cracked tablet for a face) and
Chip (a floppy disk for a torso).

Everything must be original: no characters, names or looks from existing puppet shows.

## Style, at the start of every prompt

> A handmade felt puppet character photographed like a stop-motion film set: soft studio light,
> visible stitching, wool felt and worn fabric texture, real vintage hardware with scuffs and
> patina. The device is the character's head or body, not something it holds. Felt arms and legs,
> hands with four felt fingers. Friendly, expressive, original design, not resembling any existing
> puppet franchise. Full body, front view, on a flat solid chroma-blue background (#0047BB), even
> lighting, no shadows on the background. No text, no logos.

Chroma blue, not magenta: magenta keys out pink and purple felt. None of these characters is blue.

## The singers: two sprite sheets each

For each singer make **two sheets**, one with the mouth closed and one with it open as if singing.
Each sheet is **1536 × 1024**: 8 cells of 384 × 512 in a 4 × 2 grid, the same character in 8 dance
poses (bounce, step left, arms up, step right, crouch, lean, both arms high, rest), identical size
and proportions, feet on the same baseline (about 96 % of the way down each cell), nothing crossing
into a neighbouring cell. The two sheets must match pose for pose; only the mouth differs.

**Boom** (lead voice: carries the words)
> A small round creature whose head is a shaggy grey microphone windshield, long soft fur like a
> fluffy wind cover, with two bright button eyes peeking out of the fur and a wide felt mouth that
> can open. Its neck is a slim black boom pole bending gently forward like a curious long neck. A
> felt body in muted olive with a coiled black cable tail ending in an old connector plug. It
> always leans in to listen.

**Clapper** (comic baritone: claps the rhythm)
> A sturdy character whose head is a classic black-and-white film clapperboard: the striped hinged
> clapper on top is its upper jaw and opens like a puppet mouth, the slate below is its face, with
> two round chalk-drawn eyes and chalk smudges for cheeks. Thick stubby felt arms in charcoal, short
> legs with big felt boots. Proud, a little bossy.

**Reel** (alto: tells the stories)
> A gentle character built from a small vintage film projector: the body is the projector's
> rounded metal housing in cream and brass, two film reels on top are its ears (one a little bent),
> the lens on the front is its single large glassy eye with a warm amber glow inside, a tiny brass
> crank on its side. Felt arms in warm rust colour, little felt feet. Wistful and kind. A small felt
> mouth under the lens that can open.

**Spot** (tenor: the show-off)
> A theatrical character built from a vintage stage spotlight: the round glass lens is one huge
> expressive eye with a bright iris, four black metal flaps around it act as eyelids and eyebrows,
> the black cylindrical lamp body is its torso on short felt legs, a coiled power cable for a tail.
> Felt arms in deep red velvet. Dramatic and vain, always posing. A felt mouth below the lens that
> can open.

## The AV cart pair: one sheet each

They stand side by side on a rolling early-90s school AV cart and coach every number (canon:
`moppet-world.md`, "The AV cart and study hall"; they are not hecklers and never sit in a box). For each make one
**1536 × 1024** sheet, 8 cells of 384 × 512 in a 4 × 2 grid: top row mouth closed, bottom row the
same four poses with the mouth open. Poses: arms folded, leaning towards the other one, pointing
at the stage, laughing. Draw the AV cart's top shelf edge in every cell at the same height.

**Tracking** (the VCR)
> An elderly-looking character built from a silver 1980s VCR: the cassette slot is its mouth with a
> sliding flap that opens, two round play/stop buttons are its eyes under bushy grey felt eyebrows,
> a small display on the front blinks 12:00. It sits on the top shelf of a rolling metal school AV cart,
> felt arms folded, a tiny tweed scarf. Fussy, devoted, always taking notes.

**Degauss** (the CRT television)
> An elderly character built from a wood-panelled 1970s CRT television: the curved glass screen is
> its face, showing two big pixel eyes and a broad smiling mouth glowing pale green on a dark screen, a
> rabbit-ear aerial for hair, two dials for ears. Felt arms in brown corduroy, sitting on the top shelf of a
> rolling metal school AV cart. Grand, warm, sure the show is nearly ready.

## Where the files go

Save every image under `out/moppet-art/sheets-v2/` (create it), named:

- `boom-closed.png`, `boom-open.png`, `clapper-closed.png`, `clapper-open.png`,
  `reel-closed.png`, `reel-open.png`, `spot-closed.png`, `spot-open.png`
- `tracking.png`, `degauss.png`

Also save one single full-body front view of each of the six as `<name>-ref.png` (1024 × 1024),
made first, and use it as the reference so every sheet keeps the same design.

Check each sheet before saving: 1536 × 1024, 8 whole cells, same character in every cell, flat
chroma-blue background. Redo any that fail. Finish with a short list of what you made and anything
you couldn't get right. `out/` is gitignored: commit nothing.

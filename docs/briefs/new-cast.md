# A better Moppet cast: brainstorm, text and image prompts

## What's wrong with the cast now

- **Too much old tech.** Scribe's typewriter (1900s), Vee's cassette, Clank's CRT and Chip's floppy
  are all museum pieces. Moppets are things found in a drawer *today*: tangled cables, old keys,
  cracked phones, lost earbuds.
- **The words don't fit the characters.** Pip's introduction sings "I am Flash I catch the bright
  glow" and Gruff's "I am Babel I speak all tongues / My radio warms up my lungs": leftovers from
  older characters. The round sings "I Found a Key", and no Moppet is a key.
- **The songs need roles, not just faces.** "Autocomplete" is about predictive text (a phone, not a
  typewriter). The round needs three pairs. Every song needs a bass (Clank today), a soprano (Tabby)
  and a lead who carries words clearly.
- **Clarity (issue #1):** Scribe, Pip, Chip and Gruff are the hardest for Whisper to understand
  (96, 85, 80 and 78 % of words missed): high-pitched, nasal or very rough voices. A new cast can
  keep the character in the *look* and keep the lead voices clear.

## The proposed cast

Keep **Tabby** and **Pip**. Rebuild **Gruff** as tangled wires, add a **Keys** Moppet, and replace
**Scribe** with a phone. Vee, Clank and Chip are options, below.

| Moppet | What it's made of | Part | Voice direction | Its object shows its voice |
|---|---|---|---|---|
| **Tabby** (keep) | a cracked tablet for a face, patchwork cat body, rainbow cables | soprano | bright, warm vibrato | her screen traces her vocal folds (as now) |
| **Pip** (keep) | a felted frog with a red scarf | comic tenor | less nasal than now (velum down), keep the croak | his throat sac swells (as now) |
| **Tangle** (was Gruff) | a monster of old tangled cables: chargers, earphone wires, a power brick belly, two plugs for horns | bass | deep and gravelly, but rough rather than breathy, so words survive | the cable ends spark and the brick's LED glows warmer the longer he sings |
| **Jangle** (new) | a keyring creature: old keys for a crest and tail, a padlock body, a keyhole mouth | alto, the round's lead ("I Found a Key") | clear and bright, a little metallic | the keys swing and chime with the breath |
| **Swipe** (was Scribe) | a cracked smartphone rabbit, screen for a face, earbuds for ears | lead, the "Autocomplete" song | clear mid voice, not nasal: carries the words | the predicted next word pops up on its screen as it sings |
| **Vee** (option) | keep the fox, swap the cassette for a broken Bluetooth speaker in her paws | alto | as now (she's the clearest Moppet already, 54 %) | the speaker cone pulses with her airflow |
| **Clank** (option) | keep the robot, swap the CRT head for an old Wi-Fi router with antennas | low tenor / bass | as now | router lights chase with his breath |
| **Chip** (option) | Claude's own character: swap the floppy for an SD card or a USB stick | soloist, song 03 | lower the larynx a little (clarity) | the activity light blinks per syllable |

## The style, for every image prompt

> A handmade felt puppet character built from found objects, photographed like a stop-motion
> film set: soft studio light, visible stitching and fabric texture, warm and a little worn, full
> body, front view, standing, on a plain transparent background. Friendly, expressive face. No
> text, no logos.

For the stage the app needs a **sprite sheet**: 8 dance poses in a 4 × 2 grid, each cell 384 × 512,
the character's feet at the same height in every cell, once with the mouth closed and once open
(see `public/moppets/<id>/closed.webp` and `open.webp`, and the art brief in
`docs/briefs/band-members-and-animation.md`). Add to the prompt:

> Character sheet: the same character in 8 dance poses in a 4 by 2 grid (bounce, step left, arms
> up, step right, crouch, lean, both arms high, rest), consistent size and proportions, feet on
> the same baseline in every pose.

## Image prompts

**Tangle (was Gruff).**
> A big, shaggy bass-singer monster made entirely of old tangled cables: phone chargers, earphone
> wires, a coiled extension cord, knotted into fur. Two old plugs stick up like horns, a chunky
> black power brick is its round belly with a small amber LED like a belly button, a frayed USB
> cable is its tail. Kind sleepy eyes peeking out from the tangle, a wide gentle mouth.

**Jangle (new, the keys).**
> A small proud bird-like creature made from a ring of old keys: brass and silver house keys fan
> out as its crest and tail feathers, an old padlock is its body, a keyhole shape is its mouth,
> two mismatched buttons for eyes, a little keyring loop on its head. Shiny metal against felt
> legs and wings.

**Swipe (was Scribe).**
> A rabbit made from a cracked old smartphone: the phone is its body with a cracked screen that
> glows softly as its face (two pixel eyes and a smile on the screen), long ears made from a pair of
> tangled white earbuds, felt arms and feet, a charging cable for a tail.

**Tabby (keep, refresh).**
> A patchwork cat whose face is a cracked tablet screen showing two big glowing green pixel eyes,
> felt cat ears, a body stitched from colourful fabric scraps with rainbow ribbon cables
> wrapped around it like a scarf, a curling cable tail.

**Pip (keep, refresh).**
> A felted green frog with big round goggle eyes, a wide happy mouth, a knitted red scarf with
> a button, a little patch pocket, long floppy ears like a hound, a striped tail.

**Vee (option).**
> An orange felt fox in a patchwork vest holding a small battered Bluetooth speaker against her
> chest like a drum, its round speaker cone facing out, a fluffy orange tail.

**Clank (option).**
> A friendly robot made from an old Wi-Fi router for a head (three antennas, a row of little status
> lights for eyes and a smile), a dented metal box body wrapped in tape, padded felt arms and legs.

**Chip (option).**
> A small bright parrot-like bird whose body is a big SD card with a gold-contact belly, feathers
> made from colourful old circuit boards, felt wings, orange felt feet.

## Text prompts: who they are and what they sing

Each Moppet introduces itself in two lines of about 8 syllables, on the introduction's tune
(`src/choir/cast/<id>.ts`, `lyrics`). Drafts:

- **Tangle:** "I am Tangle, knot by knot I grew / Plug me in and I will hum for you"
- **Jangle:** "I am Jangle, keys of every door / I found a lock I'd never seen before"
- **Swipe:** "I am Swipe, I guess what you will say / Then I finish it a funny way"
- **Pip** (fix): "I am Pip, I croak the morning in / Then I lose my scarf and croak again"
- **Tabby** (as now): "I am Tabby stitched from old cloth / My screen purrs soft and keeps you warm"

Character notes for writing skits and songs (Claude's skit writer can take these):

- **Tangle**: slow, sleepy, kind; always knotted into something; says "hmm" before every answer.
- **Jangle**: proud, a collector; thinks every key opens something important; jingles when nervous.
- **Swipe**: finishes everyone's sentences, usually wrong; speaks in suggestions ("Did you mean…").
- **Tabby**: the warm one; turns everything into a lullaby.
- **Pip**: the clown; repeats the last word anyone said.

## Voice direction (CHIMERA recipes)

From the clarity baseline: keep leads (Swipe, Jangle) clear: velum near closed (≤ 0.1), larynx
near 0, low roughness, speaking in a comfortable register. Put character in the bass and comic
parts: Tangle's roughness and false folds, Pip's croak. A recipe lives in `src/choir/cast/<id>.ts`;
`bun tools/moppet-voices.ts` checks the cast stays distinct and `bun tools/moppet-clarity.ts` that
it can be understood.

## Adding one

Copy a file in `src/choir/cast/`, give it art in `public/moppets/<id>/` (the sprite sheets above),
run `python3 tools/gen-prop-anchors.py` with an anchor on its object, and add it to
`src/choir/cast/index.ts`. Songs name Moppets by id, so a renamed one (Gruff → Tangle) means
updating `songs/*.song` and the round's groups.

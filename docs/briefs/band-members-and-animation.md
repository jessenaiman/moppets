# Brief: design the Moppet band, and tighten the stage animation

You're working in the CHIMERA / Moppet Choir repo. Read `AGENTS.md` first; its rules and checks
apply, and commit messages follow its style (what changed and the trap in the subject; why, what you
ruled out, what you ran with numbers, and what you didn't test in the body).

## The world

The Moppets are puppets that assembled themselves from discarded mechanical and electrical devices
left over from old TV puppetry. Everything they know comes from reruns that Vee (a VCR, the
"tape-deck fox") and Tabby (an old TV set, the "patchwork soprano") show and lecture them on. Their
songs and skits use found objects as warm, funny metaphors for a helpful AI. The cast:

- Vee, the tape-deck fox
- Scribe, the typewriter rabbit
- Clank, the robot tenor
- Pip, the felted frog
- Gruff, the gravelly monster
- Tabby, the patchwork soprano
- Chip, the floppy-disk bird

Everything must be original. No characters, names or looks from existing shows (no Muppets, no
Henson designs), and nothing copyrighted goes in git.

## Part 1: band members

A backing band now plays under every song (`src/choir/band.ts`). The parts are:

- **bass:** General MIDI program 33, MIDI channel 11
- **keys:** electric piano, General MIDI program 4, MIDI channel 12
- **drums:** a kit on MIDI channel 10. It sits out when a song has CHIMERA's beatbox.

The band is audio only today. Nobody plays it on stage.

Design three band members, one per part, who belong in this world: devices that became puppets. For
example a drummer built from a washing machine and pot lids, a bassist from a phone cord and a
cigar-box radio, or a keyboardist from an adding machine. Those are prompts, not requirements: bring
your own ideas, then pick the best ones. For each member, write:

- a name and a one-line role, as in `src/choir/voices.ts`;
- the device it was made from and a personality quirk that suits it;
- what it does visibly when its part plays.

Then make them real on the stage:

- **Art.** Use the cast's sprite format. A sheet is 8 frames in a 4×2 grid of 384×512 cells on flat
  magenta, in open and closed variants. `tools/moppets/sheets.py` keys them and writes
  `public/moppets/<id>/{open,closed}.webp`. Feet sit 96% of the way down each cel; the stage pivots
  there. Look at an existing Moppet's sheet before drawing.
- **Placement.** Band members stand at the back or the side of the stage (`Stage` in
  `src/ui/components/MoppetPanel.tsx`). They must never crowd the singers' downstage spots;
  `src/choir/choreo.ts` decides those.
- **Animation driven by the band's notes.** `bandFor(piece)` in `src/choir/band.ts` returns the
  parts, each with notes `{beat, beats, midi, vel}`. Turn the stage's current beat (`beatNow` in
  `MoppetPanel.tsx`) into hits: a drummer strikes on each kick, snare and hat note (General MIDI drum
  notes 36, 38, 42, 46 and 49); the bassist and keyboardist move on their note-ons, scaled by `vel`.
  `bandEnabled()` and an empty part both mean that member rests. When the drums sit out for the
  beatbox, the drummer should visibly enjoy the beatbox instead of playing.
- **Gestures.** The AniCraft gesture clips (below) work on any puppet. Use them for band reactions:
  a nod at the end of a song, a laugh at a punchline in a skit.

Don't change the band's audio or arrangement (`band.ts`'s `arrange`, `bandSynth.ts`, `mix.ts`).
Treat them as the contract you animate from. If you need something more from them, write it down
as a request instead of editing them.

## Part 2: tighten the animation

This is how the stage works now:

- Each Moppet is one cutout: an 8-cel sprite sheet for dancing and walking, with an open-mouth
  overlay. Vee alone has a separate head with mouth shapes, riding a dancing body.
- `src/choir/choreo.ts` moves the puppets on a critically damped spring and decides who stands
  downstage.
- Gestures (laugh, shrug, gasp, nod, tilt, bow) are motion-only clips, animated in AniCraft in
  `tools/moppets/gestures.anicraft`. `bun tools/gen-gestures.ts` samples them into
  `src/choir/gestures.generated.json`; that file is generated, never edited by hand. The GIFs it
  writes to `out/gestures/` are for looking at.
- Cues come from `src/choir/cues.ts` (every song), a songbook phrase's `do` and `react`
  (`src/choir/songbook.ts`), and a skit line's `do` and `react` (`src/choir/skits.ts`).

Already fixed, so don't redo them:
- puppets clipped at the top of the stage (the scale cap counts a lean's rotated corner, and
  `HEADROOM` in `MoppetPanel.tsx` keeps 40 px above a front-row puppet for gestures; keep any new
  or retimed clip inside it);
- the vowel map's label overlap;
- Moppet mouths stuck open (loud voices) or shut (quiet ones);
- the paused playhead drifting.
Every check passes as of this brief; keep it that way.

These are observed problems. Fix the ones that matter most, and measure before and after where
you can:

1. **Every gesture moves the whole body.** "Tilt" (a sung or spoken question) and "nod" rotate the
   whole puppet from its feet, so they read as leaning, not as a head moving. Vee has a separate head
   that could carry them. Decide per Moppet whether splitting off a head (as `tools/moppets/solo.py`
   did for Vee) is worth it, or retime the clips so a whole-body move reads right.
2. **Too many nods.** Mainframe Blues cues 28 nods, because the backing "doo wah"s re-enter after
   every rest (the entrance rule in `cues.ts`, `REST = 6`). Throttle it, for example one nod per
   Moppet per section, or no nods on short answer phrases.
3. **Clicking a puppet still runs its own code.** The poke (`Choreographer.step`) has a hand-coded
   spin and hop. Use the gesture clips instead, picked per Moppet's personality.
4. **The downstage spot gets crowded.** Autocomplete can bring four Moppets downstage at once. The
   featured window (`LOOKAHEAD`/`LINGER` in `choreo.ts`) overlaps call-and-response lines. Keep the
   formation readable.
5. **Speech bubbles.** They wrap to as many as three rows at 190 px. Narrow widths, and bubbles over
   upstage Moppets, haven't been checked. Bubbles must not cover another speaker's face or leave the
   stage.
6. **Vee under a bow.** Vee's head is placed per dance frame from `vee-solo.json`. Check that the
   gesture transform on the sprite keeps the head attached through a 24° bow.
7. **Skit staging.** A scene's whole cast walks downstage together and talks facing each other;
   listeners only react through cued gestures. Give listeners small, idle-looking reactions (a
   glance at the speaker, a blink), and make the speaker's mouth follow speech as well as it follows
   song.

## Done means

- Three band members exist, with art in the cast's format, standing on the stage. Each is animated
  from `bandFor(piece)` notes, rests when the band is off, and reacts to the beatbox when the drums
  sit out.
- The layout lint stays at 0 errors, and band members fit inside the stage like the cast.
- The observations you fixed are each in their own small commit, with numbers (lint errors before
  and after, nod counts, screenshots or measured positions). The ones you didn't fix are listed with
  the reason.
- `bun run test`, `bun run typecheck` and `bun run lint:layout` pass. After touching anything the
  worker or build loads, run `bun run build`, `bun run preview`, `bun tools/e2e.ts` and
  `bun tools/choir-e2e.ts http://127.0.0.1:5318/`. `tests/engine-free.test.ts` guards the modules
  that load without the engine.

Keep it simple. This is a prototype: no new frameworks, and ask before adding extensive tests.

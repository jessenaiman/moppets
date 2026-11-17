# Voice tuning log

## Leads

1. **Skits rush their lines.** `planSpeech` (src/choir/plan.ts) speeds a line up to 1.6× when
   the planner's natural pace overruns the slot `lineSeconds` (src/choir/skits.ts) estimated.
   Even `plain` (no recipe) scores 51.7 %, against about 36 to 40 % for CHIMERA's own speech
   judge on the same sentences (`chimera render text`, chimera/docs/hill-climb/log.md). Try:
   longer slots, or no speed-up past ~1.15×. Affects every Moppet.
2. **Scribe (96 %)** speaks at MIDI 66 (370 Hz: `speakingMidi` = register low + 4) with a child
   body, a raised larynx (0.5) and a half-open velum (0.5): high and nasal. Whisper hears
   "Moo! Moo! Moo!". Try the velum first (nasality), then the speaking pitch.
3. **Pip (85 %)**: velum 0.6, larynx −0.6, tongue root −0.5: very nasal and dark. Velum first.
4. **Chip (80 %)**: larynx 1.3 (very high) and breathiness 0.3.
5. **Gruff (78 %, 124 % held out: Whisper invents words)**: roughness 0.72 and false folds 0.75.
6. **Singing isn't judged yet**; only speech (skits). Songs are a later judge.

## Experiments

### 0. Baseline (2026-11-17)

Every Moppet speaking CHIMERA's judge sentences through the skit path, scored by Whisper
(small.en). Word error rate, training / held out:

| | plain | vee | scribe | clank | pip | gruff | tabby | chip |
|---|---|---|---|---|---|---|---|---|
| training | 51.7 | 53.6 | 96.0 | 62.9 | 85.4 | 78.2 | 70.2 | 80.1 |
| held out | 59.3 | 69.3 | 107.3 | 67.3 | 89.3 | 124.0 | 69.3 | 93.3 |

Stored as `out/clarity/best/` (gitignored: re-measure on a new machine).

### 1. Skit pace, then where the plain voice loses its words (diagnosis, nothing changed)

- Hypothesis: skits rush lines (the speed-up to 1.6×), costing every Moppet clarity.
- Measured: only 8 of the 20 training sentences are sped up at all, by at most 1.04×; the
  Toaster skit's lines 1 of 8, at 1.03×. Not the cause: no pacing change made.
- CHIMERA's own judge on this machine (`speech_wer.py`): male 31.3 % (Harvard) and 43.7 %
  (nonsense), about 37 % together; ours for `plain` 51.7 %.
- Diagnostic (out/diag.ts, plain voice, same plan, same 112 Hz): CHIMERA's stock engine
  **35.1 %**, the Moppets' singer engine (SingerCore: moppet_* handle, the held character
  posture gesture at strength 5, vowel shaping) **53.6 %**. The loss is in our singer path.
- Next: find which part of SingerCore costs it, one at a time: the character posture gesture
  (holds larynx, epilarynx and false folds against every phoneme), the vowel shaping (velum and
  tongue root on every vowel), the source settings it sends at the start. Fixing it should help
  every Moppet at once.

### 2. Which part of the singer engine costs the plain voice its words (diagnosis)

- Diagnostic: `out/diag2.ts` with `out/core.ts`, a copy of SingerCore with one part switchable
  off at a time (gitignored scratch). Plain voice, CHIMERA's plan at 112 Hz, all 40 sentences,
  training word errors: stock engine **33.1 %**; singer engine **53.0 %**; without the held
  character posture 48.3 %; without vowel shaping **45.0 %**; without the start-up artic and
  source settings 53.0 % (no effect); scheduled all at once, no rest skipping 54.3 % (no effect).
- Why the shaping costs anything for a voice with no recipe: `shapeGesture`'s vowel test
  `VOWEL.test(label)` was unanchored, so it matched every label with a vowel letter in it, among
  them the planner's `"velum"` gesture. With `nasal` on (every skit line), the recipe's velum
  (−0.15 for plain) replaced the planner's nasal opening (0.45) on every /m n ŋ/: nasals spoken
  oral, "m" as "b". The planner gives vowels no velum target at all, so the `nasal` branch never
  coloured a vowel; a Moppet's nasality comes from its resting posture (`moppet_set_artic`).
- Why the held posture costs: the planner moves the larynx on every vowel (−0.92 for /ɝ/ to
  +0.36 for /ɪ/); the character gesture, strength 5, pins it at the recipe value.

### 3. Anchor the vowel test, so nasal consonants keep their velum opening (kept)

- Hypothesis: from experiment 2, every Moppet's /m n ŋ/ is spoken oral because `shapeGesture`
  treated the `"velum"` gesture as a vowel. Anatomy: a nasal needs the velum open.
- Change: `VOWEL` in `src/choir/character.ts` must match the whole label (vowel symbols and the
  length mark), not any vowel letter in it.
- Measured (`out/clarity/e2`), training word errors: plain 51.7 → **37.8** BETTER, Vee 53.6 →
  **41.1** BETTER, Tabby 70.2 → **64.9** BETTER, Chip 80.1 → **75.5** BETTER; Scribe 96.0 → 94.7,
  Clank 62.9 → 62.9, Gruff 78.2 → 78.2, Pip 85.4 → 88.1 (all no clear change). Held out: Pip
  89 → 181 (Whisper inventing words on a few sentences; held out never decides, watch it).
  `bun tools/moppet-voices.ts`: every Moppet still its own voice.
- Pip's resting velum (0.6) is above the planner's nasal opening (0.45), so its nasals now
  narrow the port a little: its nasality is the next lead.
- Listen, before → after: Vee `out/clarity/baseline/vee/00.wav` → `out/clarity/e2/vee/00.wav`
  ("The birch canoe…"), Chip `out/clarity/baseline/chip/06.wav` → `out/clarity/e2/chip/06.wav`
  ("The box was thrown…"), Tabby `out/clarity/baseline/tabby/10.wav` →
  `out/clarity/e2/tabby/10.wav`, plain `out/clarity/baseline/plain/20.wav` →
  `out/clarity/e2/plain/20.wav` ("…when the sun rose", 5 → 0 errors).
- `out/clarity/best` is now `e2`.

### 4. Let the larynx move: recipe larynx as an offset on the planner's vowel larynx (reverted)

- Hypothesis: from experiment 2, the held posture pins the larynx (strength 5) against the
  planner's per-vowel larynx moves.
- Change: the character gesture held only epilarynx and false folds; `shapeGesture` added the
  recipe larynx to each vowel's larynx target (clamped to ±1.6), as it does the tongue root.
- Measured (`out/clarity/e4`): plain 37.8 → 39.1, Vee 41.1 → 42.4, Clank 62.9 → 62.9 (no clear
  change); Gruff 78.2 → 75.5 BETTER; Scribe 94.7 → **144.4**, Pip 88.1 → **227.8**, Tabby
  64.9 → 68.2, Chip 75.5 → 79.5 WORSE. Cast still distinct.
- Reverted. With the nasals fixed, the held larynx no longer costs the plain voice anything
  (the 48 % in experiment 2 was measured with the velum bug in). Moppets with a strongly raised
  or lowered larynx get pushed to the end of its range on some vowels (Pip −0.6 + /ɝ/'s −0.92),
  and Whisper starts inventing words. Don't retry as an offset; a gentler hold is untested.

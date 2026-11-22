# Voice tuning log

## Leads

1. **Scribe (~95 % on capped errors)** sits at the floor whatever its velum or pitch. Untested
   suspects, one at a time: its overall airway scale (child 0.9 × size 0.95 ≈ 0.70, near the
   0.65 where the running voice stops phonating cleanly: `crates/moppet-wasm`), its epilarynx
   0.55 (a narrow twang tube; the diagnostic `out/diag3.ts` hinted at it, measured alone), its
   tension 0.78.
2. **Pip (~83 %)**: velum 0.6 → 0.45 made no clear change (experiment 7). Next: its tongue root
   −0.5 (dark, pharyngeal vowels), or a smaller velum step after the root.
3. **Chip (~72 %)**: breathiness didn't matter (experiment 8). Next: larynx 1.3 (very high).
4. **Gruff (~70 %)**: roughness didn't matter and costs distinctness (experiment 9). Next: false
   folds 0.75.
5. **Speaking pitch**: + 1 semitone helped every Moppet (experiment 6); + 0, or a pitch per
   Moppet, is untested.
6. **The judge near the floor**: Whisper varies between runs and run contexts (experiments 6
   and 7); a runaway loop moves a Moppet ~40 points. Compare full runs, and read Moppets near
   100 % on errors capped per sentence as well. (Changing the judge is not allowed; this is
   reading it.)
7. **Singing isn't judged yet**; only speech (skits). Songs are a later judge. The nasal fix
   (experiment 3) also reaches songs and live play: not listened to there.

Done: the skit pace (old lead 1, experiment 1: not the cause); the singer engine's loss
(experiments 2 to 4: the nasal bug, fixed).

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

### 5. Scribe: velum 0.5 → 0.3 (reverted)

- Hypothesis (lead 2): Scribe's half-open velum makes every stop a nasal ("Moo! Moo! Moo!").
- Measured (`out/clarity/e5`, Scribe only): 94.7 → **102.0** WORSE. Reverted. Scribe sits at the
  floor (Whisper invents whole sentences); its velum isn't what's in the way.

### 6. Skits speak lower: register's low note + 1 semitone instead of + 4 (kept)

- Hypothesis: a speaking voice sits near the bottom of its range; at + 4 the higher Moppets
  (Scribe 370 Hz, Chip, Tabby) space their harmonics too widely to trace the formants, and the
  deep ones speak above their comfortable pitch.
- Change: `speakingMidi` in `src/choir/skits.ts`, `register[0] + 4` → `register[0] + 1` (every
  Moppet, skits only; songs keep their notes).
- Measured (`out/clarity/e6`, full run), training: plain 37.8 → **35.8**, Vee 41.1 → **38.4**,
  Clank 62.9 → **58.9**, Pip 88.1 → **83.4**, Gruff 78.2 → **70.2**, Tabby 64.9 → **58.9**, Chip
  75.5 → **72.2**: all BETTER. Scribe 94.7 → 107.3, called WORSE. Cast still distinct.
- Scribe's WORSE is Whisper, not the voice. Found while checking it:
  - Whisper isn't repeatable on identical audio: the same `best` Scribe WAVs (bit for bit) score
    94.7 % in a full run and **141.7 %** alone (`--only scribe`, or re-scored alone: 3 times,
    deterministic). What it transcribed earlier in the same process changes what it hears;
    16 of 40 Scribe transcripts differ between the two.
  - At the floor, one runaway loop ("Moo-Moo-Moo-…", 67 inserted words on one sentence) moves
    Scribe 47 points. Alone, experiment 6 scores Scribe 141.7 → 107.3 (BETTER); in the full
    run 94.7 → 107.3 (WORSE).
  - With each sentence's errors capped at its word count (analysis only, not the judge):
    Scribe 94.0 (best, full run), 94.7 (best, alone), 95.4 (e6, both). No change.
  - So kept, with Scribe's verdict judged noise. Your ear decides; revert this commit if Scribe
    sounds worse.
- Consequence for later runs: compare full runs with full runs (the `--only` context scores
  differently), and read Scribe and other Moppets near 100 % on capped errors too.
- Listen, before → after: Gruff `out/clarity/e2/gruff/12.wav` → `out/clarity/e6/gruff/12.wav`
  ("The thin road hears a loud milk", 10 → 6 errors), Tabby `out/clarity/e2/tabby/14.wav` →
  `out/clarity/e6/tabby/14.wav`, Pip `out/clarity/e2/pip/14.wav` → `out/clarity/e6/pip/14.wav`
  ("The wet bird pushes a heavy number"), Clank `out/clarity/e2/clank/13.wav` →
  `out/clarity/e6/clank/13.wav`, Scribe `out/clarity/e2/scribe/00.wav` →
  `out/clarity/e6/scribe/00.wav`.
- `out/clarity/best` is now `e6`.

### 7. Pip: velum 0.6 → 0.45 (reverted)

- Hypothesis (lead 3): Pip's open velum nasalizes its stops; 0.45 is the planner's own nasal
  opening, so Pip stays nasal but its nasals and stops differ again.
- Measured (`out/clarity/e7`, full run): Pip 83.4 → 86.1, no clear change. Reverted.
- Noise seen in the same run, on audio identical to `best`: plain 35.8 → 35.1, Vee 38.4 → 37.1,
  Tabby 58.9 → 60.9, and Scribe 107.3 → **168.9** (a hallucination loop). So Whisper also varies
  between runs, not only between contexts: about ±2 points away from the floor.

### 8. Chip: breathiness 0.3 → 0.2 (reverted)

- Hypothesis (lead 4): Chip's breath noise covers its consonants.
- Measured (`out/clarity/e8`, full run): Chip 72.2 → 74.8, no clear change. Reverted.
- Pip's audio, identical to `best`, scored 83.4 → **123.2** this run (a loop): Pip is near the
  floor too; read it on capped errors.

### 9. Gruff: roughness 0.72 → 0.6 (reverted)

- Hypothesis (lead 5): Gruff's rough source makes Whisper invent words.
- Measured (`out/clarity/e9`, full run): Gruff 70.2 → 72.2, no clear change; its grain moved
  closer to Clank's (4.5 → 3.1 dB apart, the distinct line is 3). Reverted.

## Found Things · Scribe's sung words · 2026-11-20

Reference: the four solo lines in the shipped score, 30 words total. Each run
rendered the same written pitches and note starts with SingerCore. The word-break
trial shortened note releases between words by 35 ms. The trials used the
installed whisper.cpp builds of small.en and medium.en with no previous text or
decoding fallback. This was a song-specific screen. The speech judge's
faster-whisper environment was unavailable, and its files and thresholds stayed
as they were.

| One change per run | Small.en edits, raw | Small.en edits, capped per line | Medium.en edits |
|---|---:|---:|---:|
| Current recipe | 134 | 29 | 23 |
| Tongue root 0.20 → 0 | 28 | 28 | |
| Tract size 0.95 → 1.12 | 28 | 28 | |
| Epilarynx 0.55 → 0.25 | 28 | 28 | |
| Raise consonant gesture strength 65% | 28 | 28 | 23 |
| Larynx 0.50 → 0 | 28 | 28 | |
| Vocal tension 0.78 → 0.45 | 27 | 27 | 23 |
| Lengthen onset and coda segments 60% | 134 | 29 | |
| Add 45 ms before vowels following stop onsets | 129 | 27 | |
| Plan each word with a 35 ms release gap | 28 | 28 | |

The raw baseline includes one long repeated syllable hallucination. Capping
errors per line shows how little the other runs changed. No run recovered the
opening line reliably. All trials remain local for audition. The reference and
lighter-tension clips are in `out/clarity-found/baseline/` and
`out/clarity-found/tension/`, respectively, with the first line in `00.wav`.

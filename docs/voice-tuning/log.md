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

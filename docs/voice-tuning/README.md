# Voice tuning: one measured step at a time toward Moppets you can understand

The Moppets' voices are tuned the way CHIMERA tunes its engine (`chimera/docs/hill-climb/`):
one hypothesis and one change per experiment, kept only when the judges call it better, every
experiment logged (kept or not) in [log.md](log.md), and nothing on `main` until you have listened.

What differs: CHIMERA's engine is never edited here. An experiment changes a Moppet's recipe
(`src/choir/cast/<id>.ts`), or how the Moppets use the engine (`src/choir/skits.ts`,
`src/choir/plan.ts`, `src/choir/character.ts`), never `chimera/`.

## The judges

1. **Clarity decides:** can Whisper understand the Moppet? `bun tools/moppet-clarity.ts <outdir>
   --against out/clarity/best/clarity.json` has every Moppet speak CHIMERA's judge sentences
   (20 training, 20 held out) through the skit path, and scores word errors with CHIMERA's own
   Whisper settings and scoring (`tools/moppet_clarity.py` loads them from
   `chimera/tools/asr/speech_wer.py`). A change is **BETTER** for a Moppet when its training word
   error rate falls by at least 1.5 points (CHIMERA's margin), **WORSE** past 3 points higher. The
   held-out sentences never decide. `plain`, CHIMERA's adult male with no recipe, is the control.
2. **Still distinct guards:** `bun tools/moppet-voices.ts` must still find every pair of Moppets
   different, so tuning can't flatten the cast into one voice.
3. **You listen:** every kept change comes with the Moppet's before and after WAVs
   (`out/clarity/<run>/<id>/NN.wav`); nothing reaches `main` before you've heard it.

## One experiment

1. Pick one hypothesis from the log's Leads and the sentences Whisper got wrong.
2. Make one small change with a reason (anatomy, acoustics, phonetics, or how lines are paced).
3. Measure: `bun tools/moppet-clarity.ts out/clarity/try --against out/clarity/best/clarity.json`
   (about 8 minutes; `--only <id>` for one Moppet), then `bun tools/moppet-voices.ts`.
4. Keep it if the targeted Moppets are BETTER, no Moppet is WORSE, and the cast stays distinct;
   then you listen. Otherwise revert.
5. Log it, kept or not, so the next run doesn't retry it.

## Rules

- **Don't change the judges:** CHIMERA's sentences, Whisper settings and scoring, and the margins.
- **No output tricks:** no EQ or effects to please Whisper; change the voice, not the recording.
- **Character stays:** a Moppet should still sound like itself. If a change makes it clearer but
  blander, the distinctness judge and your ear decide.
- **Noise:** the judge isn't perfectly repeatable (Pip measured 87.4 % and 85.4 % on two runs of
  the same voice), about the size of the 1.5-point margin. Re-measure a borderline result.

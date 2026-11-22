# Plan: songs you can rewrite without touching code

## Why

You want to change a song's words, and write the next songs, without editing TypeScript. Today
words live in code, tied note-for-note to their tunes, in five different shapes:

| Where | What's in it | How words meet notes |
|---|---|---|
| `src/choir/songbook.ts` (8 originals) | per line: `words`, `degrees`, `rhythm`, `chords`, `who`, `do`/`react`, answers (`with`) | one syllable per note, checked only when it plays |
| `src/choir/music.ts` Chip / Tabby / Gruff songs | word arrays (`CHIP_CHORUS`…) and melody arrays (`CHIP_LINES`…) paired by position | same, by array index |
| `src/choir/music.ts` round | `ROUND_LYRICS`: 4 lines × 8 one-syllable words, one word per note | word count |
| `src/choir/voices.ts` + `music.ts` introduction | each Moppet's two-line verse and the shared `CHORUS` | a fixed 8-note tune |
| `src/choir/skits.ts` | scenes of `{who, say, do, react}` | spoken, no notes |

Changing a word means finding the right file, keeping the syllable count equal to the note count
(by the pronouncing dictionary, so "violets" can be 2 or 3), and finding out at play time when it
isn't. A new song means writing a TypeScript function.

## Goal

1. **A song is a file, not code:** one readable file per song, tune and words separate.
2. **Words are swappable:** a song can have several sets of words on the same tune, as the round
   does now ("verses"), and switching them is a menu in the app.
3. **Editing is checked as you type:** syllables per line against notes, the stressed syllables
   against the strong beats, singer ranges, chords under every line.
4. **Help fitting words to a tune:** the app says which line is long or short and offers the fix.
   Claude can write new words for an existing tune, as "Write a new round" does today.
5. **The next songs are written in the same file,** and appear as tabs without a code change.

## The song file

One file per song in `songs/` (in git), e.g. `songs/autocomplete.song`. It's a small text format
rather than JSON, so it reads like a lead sheet and diffs well. A parser turns it into the same
`Song` object `songbook.ts` uses today.

```
title: Autocomplete
lead: scribe
key: G major
bpm: 120
beat: B . t K | . t B . | t B . K | . B t .   swing 0.12
backing: vee +0, pip +2, tabby +4, gruff +2

# tunes: scale degree/beats per note (a bare number is one beat); chords: roman numeral and beats
tune hook:  7/1.5 4/.5 4 5 4 2 4/2           | I 4, vi 4
tune tap:   2/.5 2/.5 2 1/.5 2/.5 4 5 4/3     | IV 4, V 4
tune start: 4 4 5 4 2                          | I 4
tune punch: 7 6 4/2                            | V 4

[verse]
pip:    start  "Good morning how are"
        punch  "pancakes made"            react gasp
gruff:  ...

[chorus, everyone]
        hook   "Ding I know just what you mean"      do nod
        tap    "Tap tap tap the guessing machine"

[words: "Second shift"]          # another set for the same tunes, picked from the Words menu
...
```

- **Tunes are named and reused,** so a chorus is written once and new words point at it.
- **Words are quoted per line,** with optional `do`/`react` gestures and `who`. Answers (the
  "doo wah"s) are `with` lines under their line.
- **Every existing kind fits:**
  - a round is one tune plus `parts: vee+clank, scribe+gruff, pip+tabby` and `entries: 8`;
  - the introduction is a tune with a verse per Moppet;
  - a skit is `[scene]` blocks of `who: "line"` with no tunes.
- **The schema is in TypeScript** (`src/choir/songFile.ts`: parse, print, and a type), so the app
  can also save a file it has edited.

## The checks (`src/choir/songCheck.ts`, uses the engine's dictionary)

Per line, as you type:

- **syllables vs notes:** "9 syllables, the tune has 8", naming the extra or missing ones;
- **stress:** a stressed syllable on a weak beat or the reverse (a warning; songs bend this);
- **harmony:** the strong-beat chord-tone rule `fitChord` already applies; show what it moved;
- **range:** each part inside its singer's register;
- **shape:** chords add up to the line, gestures name real clips, singers are real Moppets.

Fixes the editor offers when counts differ:

- **Fewer syllables than notes:** hold a syllable over two notes, a melisma. The engine has
  `planMelisma`; the file marks it `_` ("ma_ny").
- **More syllables than notes:** split a note in two (written `4/.5+.5`), or suggest a shorter
  word.

## Status

- **Format:** the text lead sheet, chosen. Edits save into `songs/`; melismas will be allowed.
- **Phase 1 is done for the 8 songbook originals, the 3 skits and the round's words**: they are
  `songs/*.song`, proven to build identical scores before the old code was deleted, and
  `tests/songs.test.ts` plans every song. The tunes are the songbook model (`degree/beats`, roman
  chords, named tunes, `[repeat …]`). Still in code: the lead songs (Chip, Tabby, Gruff, built by
  `buildLeadSong`) and the introduction; they need their own `kind:` or a move onto the songbook
  model. The guide is `docs/writing-songs.md`.

- **Phase 2 is done except the fix buttons**: the "Edit words" panel checks every line as you
  type (`src/choir/songCheck.ts`: syllables against notes, words sung against their stress), plays
  the new words once they fit, keeps edits in the browser, and saves into `songs/` from the dev
  server (`tools/song-bridge.ts`) or downloads. Not yet: melismas and note splits as fixes (they need
  the planner to hold one syllable over several notes), and editing the round's word sets there.

## Phases

1. **Extract, change nothing (about a day).** Write the parser and printer. Move the 8 songbook
   originals, the 3 lead songs, the round, the introduction and the 3 skits into `songs/`.
   - A test builds every song both ways and requires identical `Piece` JSON (notes, words, chords,
     cues).
   - The app loads `songs/*.song` at build time (Vite `import.meta.glob`), so the tabs come from
     the folder.
   - Delete the TypeScript song functions once the test passes.
2. **Checks and a words editor (about a day).**
   - `songCheck.ts` and an "Edit words" panel next to the score: one field per line, live
     counts, warnings and fix buttons.
   - Edits are kept in the browser per song. "Save song file" downloads it. In `bun run dev`, a
     bridge like the SoundCraft one writes it straight to `songs/`.
3. **Verses (half a day).** `[words: "…"]` blocks become a Words menu on every song, as on the
   round. Rounds get "every part its own words" for free.
4. **Claude writes words to a tune (half a day).** Generalize `tools/claude-writer.ts`:
   - send the tune's lines as syllable counts with the strong beats marked, the theme (a found
     object as a helpful AI), and the cast;
   - check the answer with `songCheck`, send the failures back, and retry, as the round does;
   - "Write new words" puts the result in as a new verse to keep or drop.
5. **Tunes from SoundCraft without losing words (half a day).** The MIDI round trip exists; when a
   part comes back with a different note count, refit the words with melismas or splits instead of
   keeping the old notes, and show the result in the words editor.
6. **A guide (an hour).** `docs/writing-songs.md`: the file format with one worked song,
   the checks, and how to try a song on the stage, export the video, and commit it.

Each phase is its own commit (or a few). Phase 1 changes no sound: the identical-`Piece` test is
its proof, and the golden and e2e checks must stay green.

## Decisions for you

- **File format:** the text lead sheet above (my recommendation: readable, diffable, writable by
  hand), or JSON (no parser, harder to write by hand).
- **Where edits are saved:** straight into `songs/` from the dev server (my recommendation, so a
  good edit is a commit), or only in the browser with download and upload.
- **Melismas:** allow one syllable over several notes (my recommendation; it makes fitting words
  much easier), or keep the strict one-syllable-per-note rule.

## Until then

- **The round's words** are in `ROUND_LYRICS` in `src/choir/music.ts`: four lines of eight
  one-syllable words. "Write a new round" makes new ones in the app.
- **A songbook line's words** are its `words:` in `src/choir/songbook.ts`. Keep the syllable count
  equal to the number of `degrees`; `bun run test` doesn't catch a mismatch, but the song refuses
  to play and says which line.
- **Skit lines** in `src/choir/skits.ts` can be changed freely; they're spoken, not sung.

# Writing Moppet songs

Every song, skit and set of round words is a lead sheet in `songs/`: a small text file you can edit
in any editor. The app, the tests and the video tools read these files; no code changes.

## Change a song's words

**In the app:** open the song's (or skit's) tab and press **✎ Edit words**. Each line shows how the
pronouncing dictionary splits it (`waf·fles·made · 3 ✓`). A line that doesn't fit its notes turns
red and says by how much. A word sung against its stress gets a gentle hint ("MOR·ning"). The score
follows your words as soon as every line fits; press play to hear them. Edits stay in this browser
until you press **Save to songs/…** (in `bun run dev` it writes the file, ready to commit; a built
app downloads it instead) or **Revert**.

**In a text editor:** open the song (e.g. `songs/autocomplete.song`) and edit the words in quotes. Keep **one syllable
per note**: the line `"pancakes made" = 7 6 4/2 | V 4` has three notes (`7`, `6`, `4/2`), so its
words need three syllables. Then:

```bash
bun test ./tests/songs.test.ts
```

It fails if a line's syllables don't match its notes, and says which song and singer. Syllables
come from the pronouncing dictionary, which sometimes disagrees with your ear ("violets" can be 2 or
3; "fire" is 1). Reload the app and the song sings the new words.

## A new song

Copy a song file, give it a new `id:`, `title:` and `tab:`, and add it to the list in
`src/choir/songs.ts`; its place in that list is its place in the tabs.

```
title: Autocomplete
id: autocomplete
tab: 07 · Autocomplete
about: 07 · The Moppets start a sentence, Scribe types the ending
lead: scribe                      # who sings a line with no name in front
key: G                            # a key, and optionally a mode: "D minor", "A dorian"
bpm: 120
beat: B . t K | . t B . | t B . K | . B t . (swing .12)   # optional: CHIMERA's beatbox
backing: vee +0, pip +2, tabby +4, gruff +2               # [choir] sections: who pads, steps above the chord
bass: clank                       # optional: who sings the bass line (default Clank)
finale: "Ding" on 7               # the last word, held by the lead on this degree

tune a = 7/1.5 4/.5 4 5 4 2 4/2 | I 4, VI 4               # optional: a named tune to reuse

[verse 1]
pip: "Good morning how are" = 4/.5 4/.5 5 4 2 | I 4
"pancakes made" = 7 6 4/2 | V 4 ; react gasp
  + tabby @2: "oo" = 4/2                                   # an answer, 2 beats into the line
rest 4                                                      # everyone stops, the band too

[chorus, choir]                                             # choir: the others pad the chords
"Ding I know just what you mean" = a ; do nod

[repeat chorus]
```

### Lines

`who: "words" = notes | chords ; do gesture ; react gesture`

- **who** (optional): a Moppet id (`vee`, `scribe`, `clank`, `pip`, `gruff`, `tabby`, `chip`).
  Without it, the lead sings.
- **notes**: one per syllable, each `degree` or `degree/beats`. Degrees count up the scale from the
  key's home note: `0` is home, `7` an octave up, `-1` one step below. Beats default to 1; `.5` is
  half a beat. Each Moppet sings in its own register, so write the tune once and it sits right
  for whoever sings it.
- **chords**: roman numerals of the scale with their beats, adding up to the line's length
  (`| I 4, V 2, I 2`). The key and mode decide which are major or minor. Held notes and notes on
  strong beats are nudged onto the chord's tones, so a tune always fits its harmony.
- **gestures** (optional): `do` plays on the singer as the line starts, and `react` on the
  previous line's singer as this one ends. The clips are `laugh`, `shrug`, `gasp`, `nod`, `tilt`
  and `bow` (animated in `tools/moppets/gestures.anicraft`).
- **answers**: `+ who @beats: "words" = notes` on the next line sings with the line above, starting
  that many beats in (the "doo wah"s).

A sung question tilts the singer's head, an entrance nods, and everyone bows on the last chord,
without being written.

## Skits

```
kind: skit
id: toaster
title: The Toaster Knows
about: Scribe finds a toaster that answers questions, more or less

[scene 1]
scribe: "I found a toaster in the junk drawer. It answers questions!" ; do gasp
tabby: "Toaster, what is the meaning of life?"
```

Spoken, so any words work. Each scene's cast comes downstage together. Add the file to
`src/choir/songs.ts` as well.

## The round's words

`songs/round.song` holds the round's word sets: four lines of exactly eight one-syllable words, and
the `last:` word everyone lands on. Every set fits the same tune, so add as many as you like; each
appears in the round's Words menu. In `bun run dev`, "Write a new round" has Claude write one.

## Hearing and sharing it

- In the app, pick the song's tab and press play.
- `bun tools/choir-render.ts` renders the songs to WAV in `out/listen/`.
- `bun tools/moppet-video.ts <id>` and `bun tools/moppet-edit.ts` make a video and FilmCraft and
  EffectCraft projects (see the README).
- "Open in SoundCraft" moves notes. Words stay with notes in order, so keep one note per syllable.

## Arrangements in the catalog

Chip, Tabby, and Gruff use the same parser and score builder as the other originals.
Their `breath` is the silence after each sung line while its final chord continues.
`registers` fixes a singer’s transposition in semitones and `tracks` sets the part order.
Gruff’s `double: clank 2 -12` gives Clank the same words two scale degrees above the melody,
transposed down an octave. Each `figure <singer> = ...` divides a backing chord among the
written steps in proportion to their durations.

The First Hello has classic and Studio 404 lyric sheets, `intro.song` and `intro-studio404.song`.
Each singer has a verse, a `turnaround V 4` gives the next singer four beats to enter, and the
cast sings the chorus together. The words editor opens the sheet for the selected cast.
The round’s words are also editable in **Music desk → Edit words**, including the final word.

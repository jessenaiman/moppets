/**
 * Every song, skit and round's words, from the lead sheets in songs/ (src/choir/songFile.ts).
 * A new file goes in this list; its place here is its place in the tabs.
 */
import { parseSongFile, type SongFile } from "./songFile.ts";
import loading from "../../songs/loading.song";
import autocomplete from "../../songs/autocomplete.song";
import rewind from "../../songs/rewind.song";
import mainframe from "../../songs/mainframe.song";
import lullaby from "../../songs/lullaby.song";
import askme from "../../songs/askme.song";
import pip from "../../songs/pip.song";
import found from "../../songs/found.song";
import rerun from "../../songs/skit-rerun.song";
import toaster from "../../songs/skit-toaster.song";
import letter from "../../songs/skit-letter.song";
import round from "../../songs/round.song";

const FILES: [string, string][] = [
  ["loading.song", loading],
  ["autocomplete.song", autocomplete],
  ["rewind.song", rewind],
  ["mainframe.song", mainframe],
  ["lullaby.song", lullaby],
  ["askme.song", askme],
  ["pip.song", pip],
  ["found.song", found],
  ["skit-rerun.song", rerun],
  ["skit-toaster.song", toaster],
  ["skit-letter.song", letter],
  ["round.song", round],
];

/** Each lead sheet's file name and text as loaded (updated in place when the app saves one). */
export const SONG_SOURCES = new Map<string, string>(FILES);

export const SONG_FILES: SongFile[] = FILES.map(([name, text]) => parseSongFile(text, `songs/${name}`));

/** The file a song, skit or the round's words came from. */
export function fileOf(id: string, kind: SongFile["kind"]): string {
  return kind === "skit" ? `skit-${id}.song` : `${id}.song`;
}

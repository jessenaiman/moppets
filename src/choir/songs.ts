/**
 * Every song, skit and round's words, from the lead sheets in songs/ (src/choir/songFile.ts).
 * A new file goes in this list; its place here is its place in the tabs.
 */
import { parseSongFile, type SongFile } from "./songFile.ts";
import tabbySolo from "../../songs/tabby-solo.song";
import loading from "../../songs/loading.song";
import autocomplete from "../../songs/autocomplete.song";
import rewind from "../../songs/rewind.song";
import mainframe from "../../songs/mainframe.song";
import lullaby from "../../songs/lullaby.song";
import askme from "../../songs/askme.song";
import pip from "../../songs/pip.song";
import found from "../../songs/found.song";
import bandNight from "../../songs/band-night.song";
import neonDuet from "../../songs/neon-duet.song";
import neonCanon from "../../songs/neon-canon.song";
import neonPlaybook from "../../songs/neon-playbook.song";
import borrowedLight from "../../songs/borrowed-light.song";
import takeTwo from "../../songs/take-two.song";
import rightOnCue from "../../songs/right-on-cue.song";
import line from "../../songs/line.song";
import lateAnswer from "../../songs/late-answer.song";
import everySocket from "../../songs/every-socket.song";
import closeUp from "../../songs/close-up.song";
import oneTape from "../../songs/one-tape.song";
import oneMoreThing from "../../songs/one-more-thing.song";
import zapSong from "../../songs/zap.song";
import cueIntro from "../../songs/cue-intro.song";
import cuePairs from "../../songs/cue-pairs.song";
import cueBlank from "../../songs/cue-blank.song";
import cuePlaybook from "../../songs/cue-playbook.song";
import rerun from "../../songs/skit-rerun.song";
import toaster from "../../songs/skit-toaster.song";
import letter from "../../songs/skit-letter.song";
import round from "../../songs/round.song";

const FILES: [string, string][] = [
  ["tabby-solo.song", tabbySolo],
  ["loading.song", loading],
  ["autocomplete.song", autocomplete],
  ["rewind.song", rewind],
  ["mainframe.song", mainframe],
  ["lullaby.song", lullaby],
  ["askme.song", askme],
  ["pip.song", pip],
  ["found.song", found],
  ["band-night.song", bandNight],
  ["neon-duet.song", neonDuet],
  ["neon-canon.song", neonCanon],
  ["neon-playbook.song", neonPlaybook],
  ["zap.song", zapSong],
  ["take-two.song", takeTwo],
  ["borrowed-light.song", borrowedLight],
  ["line.song", line],
  ["right-on-cue.song", rightOnCue],
  ["late-answer.song", lateAnswer],
  ["every-socket.song", everySocket],
  ["close-up.song", closeUp],
  ["one-tape.song", oneTape],
  ["one-more-thing.song", oneMoreThing],
  ["cue-intro.song", cueIntro],
  ["cue-pairs.song", cuePairs],
  ["cue-blank.song", cueBlank],
  ["cue-playbook.song", cuePlaybook],
  ["skit-rerun.song", rerun],
  ["skit-toaster.song", toaster],
  ["skit-letter.song", letter],
  ["round.song", round],
];

const draftKey = "studio404-rehearsal-drafts-v1";
export function draftSheets(): Record<string,string> {
  try {return JSON.parse(localStorage.getItem(draftKey) ?? "{}") ?? {}} catch {return {}}
}
for(const [name,text] of Object.entries(draftSheets())){
  if(!/^(skit-)?draft-[a-z0-9-]+\.song$/.test(name)||typeof text!=="string")continue;
  try {parseSongFile(text,name); FILES.push([name,text])} catch {/* Ignore a damaged browser draft. */}
}
export function persistDraft(file:string,text:string){
  localStorage.setItem(draftKey,JSON.stringify({...draftSheets(),[file]:text}));
  SONG_SOURCES.set(file,text);
}

/** Each lead sheet's file name and text as loaded (updated in place when the app saves one). */
export const SONG_SOURCES = new Map<string, string>(FILES);

export const SONG_FILES: SongFile[] = FILES.map(([name, text]) => parseSongFile(text, `songs/${name}`));

/** The file a song, skit or the round's words came from. */
export function fileOf(id: string, kind: SongFile["kind"]): string {
  return kind === "skit" ? `skit-${id}.song` : `${id}.song`;
}

/**
 * Pure Studio 404 Illustrated Songbook & Storyboard compiler (`S-57`, `D-143`, `D-144`, `D-145`).
 *
 * Bridges all 69 `.song` / `.mid` pieces with connected Character Master Bibles, Location Bibles,
 * Props, VexFlow musical lead sheets, `:5419` Three.js stage captures, and structured Image + I2V Motion Prompts.
 * Pure data module (zero React, Three.js, DOM, or WebAudio imports) so both the live studio and CLI scripts share it.
 */
import { CAST_MANIFEST, canonicalCastId, getSetPlateUrl } from "./castManifest.ts";
import { measures } from "./meter.ts";
import { makeRound, type CinemaShotPreset, type Piece } from "./music.ts";
import { resolvePerformerIdentity } from "./performer.ts";
import { makeSkit } from "./skits.ts";
import { buildSong } from "./songbook.ts";
import { getSongCastSpec, resolvePieceSetId } from "./songCasting.ts";
import { withSongMidi } from "./songMidi.ts";
import { SONG_FILES } from "./songs.ts";
import { beatSeconds, LEAD_IN, pieceSeconds } from "./timeline.ts";
import { stageVoicesForPiece, buildVideoProject } from "./videoProject.ts";
import { CAST } from "./voices.ts";

export const ASSETS_ROOT = "magic-studio-assets";
export const REPO_ROOT = ".";
export const DCBOOK_PATH = `${ASSETS_ROOT}/projects/Studio 404 Stage Studies/Studio-404-Songbook.dcbook`;

export interface PilotConfig {
  readonly id: string;
  readonly archetype: "Solo" | "Duet / Trio" | "Skit";
  readonly pilotSlug: string;
  readonly designcraftPath: string;
  readonly exportsDir: string;
  readonly framesDir: string;
}

export const PILOT_SONGBOOK_CONFIGS: Readonly<Record<string, PilotConfig>> = {
  zap: {
    id: "zap",
    archetype: "Solo",
    pilotSlug: "every-button",
    designcraftPath: `${ASSETS_ROOT}/projects/Studio 404 Stage Studies/every-button/storyboard.designcraft`,
    exportsDir: `${ASSETS_ROOT}/projects/Studio 404 Stage Studies/every-button/exports`,
    framesDir: `${ASSETS_ROOT}/projects/Studio 404 Stage Studies/every-button/frames`,
  },
  "two-taps-for-a-stamp": {
    id: "two-taps-for-a-stamp",
    archetype: "Duet / Trio",
    pilotSlug: "two-taps-for-a-stamp",
    designcraftPath: `${ASSETS_ROOT}/projects/Studio 404 Stage Studies/two-taps-for-a-stamp/storyboard.designcraft`,
    exportsDir: `${ASSETS_ROOT}/projects/Studio 404 Stage Studies/two-taps-for-a-stamp/exports`,
    framesDir: `${ASSETS_ROOT}/projects/Studio 404 Stage Studies/two-taps-for-a-stamp/frames`,
  },
  "all-rise": {
    id: "all-rise",
    archetype: "Skit",
    pilotSlug: "all-rise",
    designcraftPath: `${ASSETS_ROOT}/projects/Studio 404 Stage Studies/all-rise/storyboard.designcraft`,
    exportsDir: `${ASSETS_ROOT}/projects/Studio 404 Stage Studies/all-rise/exports`,
    framesDir: `${ASSETS_ROOT}/projects/Studio 404 Stage Studies/all-rise/frames`,
  },
};

export interface SongbookCastRef {
  readonly castId: string;
  readonly voiceId: string;
  readonly displayName: string;
  readonly role: string;
  readonly color: string;
  readonly heightDu: number;
  readonly renderMode: "multiplane" | "atlas";
  readonly portraitUrl: string;
  readonly bibleHeroUrl: string;
  readonly bibleDocPath: string;
  readonly heroImagePath: string;
  readonly usageInPiece: string;
}

export interface SongbookLocationRef {
  readonly setId: string;
  readonly label: string;
  readonly plateUrl: string;
  readonly locationBiblePath: string;
  readonly setAssetPath: string;
}

export interface SongbookPropRef {
  readonly name: string;
  readonly anchorTag: string;
  readonly description: string;
  readonly imageUrl?: string;
  readonly bibleDocPath: string;
  readonly assetPath: string;
}

export interface SongbookTimedLine {
  readonly timeSec: number;
  readonly durationSec: number;
  readonly speaker: string;
  readonly castId: string;
  readonly color: string;
  readonly text: string;
}

export interface SongbookSceneSpec {
  readonly index: number;
  readonly code: string;
  readonly title: string;
  readonly barsLabel: string;
  readonly startBeat: number;
  readonly endBeat: number;
  readonly startSec: number;
  readonly endSec: number;
  readonly lines: readonly SongbookTimedLine[];
  readonly blockingSummary: readonly string[];
  readonly takesSummary: readonly string[];
  readonly cameraPreset: CinemaShotPreset;
  readonly lensSpec: string;
  readonly stripTimestampsSec: readonly [number, number, number, number];
  readonly heroUrl: string | null;
  readonly stripFrameUrls: readonly [string, string, string, string] | null;
  readonly heroPath: string | null;
  readonly stripFramePaths: readonly [string, string, string, string] | null;
  readonly imagePrompt: string;
  readonly motionPrompt: string;
  readonly refAnchors: readonly string[];
  readonly bookendRule: string;
}

export interface IllustratedSongbookSpec {
  readonly id: string;
  readonly title: string;
  readonly about: string;
  readonly kind: "song" | "round" | "skit";
  readonly isPilot: boolean;
  readonly pilotArchetype?: PilotConfig["archetype"];
  readonly pilotSlug?: string;
  readonly keyLabel: string;
  readonly bpm: number;
  readonly meterLabel: string;
  readonly durationSec: number;
  readonly songFilePath: string;
  readonly midiFilePath: string;
  readonly watchUrl: string;
  readonly rehearseUrl: string;
  readonly songbookUrl: string;
  readonly designcraftPath: string | null;
  readonly dcbookPath: string;
  readonly pdfPublicUrl: string | null;
  readonly leadSheetPublicUrl: string | null;
  readonly leadSheetPath: string | null;
  readonly piece: Piece;
  readonly masterLookPrompt: string;
  readonly castRefs: readonly SongbookCastRef[];
  readonly locationRef: SongbookLocationRef;
  readonly propRefs: readonly SongbookPropRef[];
  readonly scenes: readonly SongbookSceneSpec[];
}

export interface SongbookCatalogItem {
  readonly id: string;
  readonly title: string;
  readonly kind: "song" | "round" | "skit";
  readonly isPilot: boolean;
  readonly pilotArchetype?: PilotConfig["archetype"];
  readonly bpm: number;
  readonly keyLabel: string;
}

const CAMERA_LENS_SPEC: Record<CinemaShotPreset, string> = {
  wide: "24mm f/5.6 deep-focus wide · Locked stop-motion tripod",
  "two-shot": "50mm f/2.8 2-plane two-shot · Gentle single-axis pan",
  closeup: "85mm f/1.8 macro/portrait · Controlled 4% axial push-in",
  reaction: "50mm f/2.8 eyeline cut · Hard rhythmic reaction cut",
  "low-angle": "18mm f/4 hero low-angle · Slight upward heroic tilt lock",
};

const SET_ASSET_ON_SPEEDY: Readonly<Record<string, string>> = {
  "bench-right": `${ASSETS_ROOT}/bibles/locations/Studio 404/img/plates/studio404_stage_right_bench.jpg`,
  "arena-lit": `${ASSETS_ROOT}/bibles/locations/Studio 404/img/candidates/Loc01_Studio404_StageWide_Empty_CANON.png`,
  "rhythm-riser": `${ASSETS_ROOT}/bibles/locations/Studio 404/img/plates/studio404_rhythm_riser_back.jpg`,
  "stage-dark": `${ASSETS_ROOT}/bibles/locations/Studio 404/img/candidates/Loc02_Studio404_StageDark_Standby_CANON.png`,
  "stage-left": `${ASSETS_ROOT}/bibles/locations/Studio 404/img/candidates/Loc03_Studio404_StageLeft_BoothPatchCorner_CANON.png`,
  "caretaker-door": `${ASSETS_ROOT}/bibles/locations/Studio 404/img/candidates/Loc04_Studio404_CaretakerDoorway_GoldenStripe_CANON.png`,
  "studio404-floor": `${ASSETS_ROOT}/bibles/locations/Studio 404/img/candidates/Loc01_Studio404_StageWide_Empty_CANON.png`,
  "right-on-cue": `${ASSETS_ROOT}/bibles/general/Cue/img/Cue_Studio404_Stage_CANON.jpg`,
};

const CURATED_HERO_PNG_ON_SPEEDY: Readonly<Record<string, string>> = {
  zap: `${ASSETS_ROOT}/bibles/general/Zap/crops/zap_app_rest.png`,
  cue: `${ASSETS_ROOT}/bibles/general/Cue/img/cue_hero_v2.png`,
  chip: `${ASSETS_ROOT}/bibles/general/Chip/img/chip_staged_front.png`,
  tabby: `${ASSETS_ROOT}/bibles/general/Tabby/crops/tabby_staged_front.png`,
  gruff: `${ASSETS_ROOT}/bibles/general/Gruff/img/gruff_staged_front_v3.png`,
  hertz: `${ASSETS_ROOT}/bibles/general/Hertz/img/Hertz_90sCRTTV_Redesign_CANON.png`,
  tracker: `${ASSETS_ROOT}/bibles/general/Tracker/img/Tracker_90sVHS_Redesign_CANON.png`,
};

function resolveHeroImageOnSpeedy(castId: string): string {
  const curated = CURATED_HERO_PNG_ON_SPEEDY[castId];
  if (curated) return curated;
  const ch = CAST_MANIFEST.characters[castId];
  const raw = ch?.bibleAudit?.bibleHeroSrc;
  if (raw) return `${ASSETS_ROOT}/${raw}`;
  return `${ASSETS_ROOT}/bibles/general/${ch?.bibleDir ?? "Cue"}/img/hero.png`;
}

function buildPieceForFile(f: (typeof SONG_FILES)[number]): { piece: Piece; fileBase: string } {
  if (f.kind === "song") {
    return {
      piece: withSongMidi(f.id, buildSong(f.song)),
      fileBase: f.id,
    };
  }
  if (f.kind === "round") {
    return {
      piece: withSongMidi(f.id, makeRound()),
      fileBase: "round",
    };
  }
  return {
    piece: withSongMidi(`skit-${f.id}`, makeSkit(f.skit)),
    fileBase: `skit-${f.id}`,
  };
}

function barsLabelForRange(piece: Piece, startBeat: number, endBeat: number): string {
  const ms = measures(piece);
  if (!ms.length) return "Scene 1";
  let b1 = 1;
  let b2 = 1;
  for (let i = 0; i < ms.length; i++) {
    if (ms[i].start <= startBeat + 0.05) b1 = i + 1;
    if (ms[i].start < endBeat - 0.05) b2 = i + 1;
  }
  return b1 === b2 ? `Bar ${b1}` : `Bars ${b1}–${b2}`;
}

function curatedScenePrompts(
  songId: string,
  sceneTitle: string,
  linesText: string,
  castNames: string,
  locationLabel: string,
): { imagePrompt: string; motionPrompt: string } | null {
  const key = `${songId}:${sceneTitle.toLowerCase()}`;
  if (songId === "zap") {
    const snippet = linesText || "Zap presses an unknown button on stage";
    if (sceneTitle.toLowerCase().includes("verse 1")) {
      return {
        imagePrompt: `Tactile miniature broadcast studio stage (${locationLabel}), warm tungsten overhead pools over worn parquet floor and crimson velour curtain, ${castNames} standing cleanly spaced: Zap angled cheerfully raising one mittened thumb over a glowing LED remote key, Slim 12:00 VHS Tracker (75 DU) popping its cassette drawer beside Console Hertz (150 DU) blinking static snow. 36mm studio plate look.`,
        motionPrompt: `12fps on-twos animation: Zap presses green/red keys with confident bounce, emits crimson IR pulse toward Hertz and Tracker; Hertz flickers static bars with startled eyebrow tilt, Tracker tape drawer pops out 8cm on beat; locked 24mm tripod holds wide three-shot.`,
      };
    }
    if (sceneTitle.toLowerCase().includes("xylophone") || sceneTitle.toLowerCase().includes("finale")) {
      return {
        imagePrompt: `Studio 404 stage bathed in amber keylight and phosphor glow: Zap mid-air leap over his own 28-button rubber keypad like a xylophone soloist with prismatic cyan/magenta key LEDs flaring under each tap, Console Hertz displaying razor-sharp SMPTE color bars behind braided RCA cable connecting to grinning 12:00 Slim Tracker.`,
        motionPrompt: `Fast pose-to-pose on-twos stagger: Zap darts left-to-right drumming consecutive illuminated keypad rows in sync with synthetic xylophone strikes; Hertz cycles SMPTE color bars on downbeats; Tracker nods drawer rhythmically; 24mm f/5.6 deep-focus wide tripod.`,
      };
    }
    return {
      imagePrompt: `Studio 404 workshop timber bench & velvet backdrop under warm keylight: ${castNames} framed cleanly on parquet boards during "${snippet}", Zap mid-stunt pressing a mystery keypad switch as crimson IR light glints on Hertz's CRT glass and Tracker's green 12:00 VFD display.`,
      motionPrompt: `Pose-to-pose 12fps choreography matching score beats: Zap executes cartwheel/backflip/handstand press into button mashing while Hertz & Tracker react with staggered 3-frame holds and crisp RCA cord sway.`,
    };
  }

  if (songId === "two-taps-for-a-stamp") {
    return {
      imagePrompt: `Warm tungsten-lit Studio 404 Post Bench (${locationLabel}) with timber desk lamp and broadcast mic at stage right: brass-hooded Cue holding a crisp folded paper letter, PCB-winged Chip inspecting the letter weight beside a chunky brass stamp, felt-jacketed Tabby listening intently with ears perked over the acoustic beat.`,
      motionPrompt: `6/8 waltz sway at 12fps on-twos: Chip delivers two crisp downward rubber-stamp taps on the desk, Cue raises the folded square envelope across the center sightline as Tabby steps left and sings the punchline overlap cleanly before Cue drops his shoulders in shock.`,
    };
  }

  if (songId === "all-rise") {
    return {
      imagePrompt: `Junk-drawer makeshift courtroom on Studio 404 timber workbench: brass-hooded Cue presiding on the left beside a lightly browned reversible slice of toast propped upright like a witness, colossal wired-cable Gruff towering calmly at stage left and felt Tabby popping upright behind the bench edge.`,
      motionPrompt: `Deadpan comedy pacing (locked camera cuts between 24mm wide and 50mm two-shot): Tabby hops vertically on "So am I", Gruff gives a heavy shoulder shrug over coiled bass leads during his deadpan rebuttal, and Cue flips focus toward the reversible toast slice for the "Crunch" verdict bow.`,
    };
  }

  return null;
}

function buildCuratedProps(songId: string): SongbookPropRef[] {
  const baseMic: SongbookPropRef = {
    name: "Studio 404 Brass Broadcast Mic",
    anchorTag: "@Prop_BroadcastMic_GLB",
    description: "Multi-material Blender 5.3 stage hero prop standing downstage to anchor depth and floor bounce.",
    bibleDocPath: `${ASSETS_ROOT}/bibles/assets/Studio 404 Assets.designcraft`,
    assetPath: "public/cast/props/studio404-broadcast-mic.glb",
  };

  if (songId === "zap") {
    return [
      baseMic,
      {
        name: "28-Button IR Keypad & LED Array",
        anchorTag: "@Prop_Zap_28ButtonXylophone",
        description: "Calibrated 28-key rubber grid (`buttons.json`) driving live chromakey flashes and directional crimson IR beam.",
        imageUrl: "/cast/zap/bible-hero.webp",
        bibleDocPath: `${ASSETS_ROOT}/bibles/general/Zap/Zap.designcraft`,
        assetPath: `${ASSETS_ROOT}/bibles/general/Zap/crops/zap_macro_lcd_ir.png`,
      },
      {
        name: "Braided RCA Umbilical Cord",
        anchorTag: "@Prop_TrackerHertz_RCACord",
        description: "14-segment slack-catenary composite cord tethering Slim 12:00 Tracker (75 DU) to Console Hertz (150 DU).",
        imageUrl: "/cast/tracker/bible-hero.webp",
        bibleDocPath: `${ASSETS_ROOT}/bibles/general/Tracker/Tracker.designcraft`,
        assetPath: `${ASSETS_ROOT}/bibles/general/Tracker/img/Tracker_Hertz_AVCart_OldFriends_v2.png`,
      },
    ];
  }

  if (songId === "two-taps-for-a-stamp") {
    return [
      baseMic,
      {
        name: "Folded One-Word Envelope",
        anchorTag: "@Prop_Cue_FoldedEnvelope",
        description: "Creased cream paper letter held in Cue's brown felt mitt (`cue_mitt_letter_v2.png`).",
        imageUrl: "/cast/cue/bible-hero.webp",
        bibleDocPath: `${ASSETS_ROOT}/bibles/general/Cue/Cue.designcraft`,
        assetPath: `${ASSETS_ROOT}/bibles/general/Cue/img/cue_mitt_letter_v2.png`,
      },
      {
        name: "Brass Postage Hand-Stamp",
        anchorTag: "@Prop_Chip_PostageStamp",
        description: "Turned wood-and-brass postage stamp slammed twice on Beat 1/4 for the chorus sting.",
        imageUrl: "/cast/chip/bible-hero.webp",
        bibleDocPath: `${ASSETS_ROOT}/bibles/general/Chip/Chip.designcraft`,
        assetPath: `${ASSETS_ROOT}/bibles/general/Chip/img/chip_stamp_two_taps_v2.png`,
      },
    ];
  }

  if (songId === "all-rise") {
    return [
      baseMic,
      {
        name: "Reversible Lightly-Browned Toast Slice",
        anchorTag: "@Prop_AllRise_ReversibleToast",
        description: "Two-sided practical cardboard/foam courtroom witness slice (`tabby_reversible_toast_prop_rgba.png`).",
        imageUrl: "/cast/tabby/bible-hero.webp",
        bibleDocPath: `${ASSETS_ROOT}/bibles/general/Tabby/Tabby.designcraft`,
        assetPath: `${ASSETS_ROOT}/bibles/general/Tabby/img/tabby_reversible_toast_prop_rgba.png`,
      },
      {
        name: "Studio 404 Stage-Right Judge Bench",
        anchorTag: "@Loc_Studio404_Bench",
        description: "Timber rehearsal workbench & desk lamp serving as the makeshift junk-drawer courtroom.",
        imageUrl: "/cast/sets/bench-right.webp",
        bibleDocPath: `${ASSETS_ROOT}/bibles/locations/Studio 404/Studio 404.designcraft`,
        assetPath: `${ASSETS_ROOT}/bibles/locations/Studio 404/img/plates/studio404_stage_right_bench.jpg`,
      },
    ];
  }

  return [
    baseMic,
    {
      name: "Studio 404 Band & Stage Prop Sheet",
      anchorTag: "@Prop_Studio404_Kit",
      description: "Approved wood-crate plinths, analog patch leads, and stage-floor markers from Studio 404 Assets Bible.",
      imageUrl: "/cast/sets/arena-lit.webp",
      bibleDocPath: `${ASSETS_ROOT}/bibles/assets/Studio 404 Assets.designcraft`,
      assetPath: `${ASSETS_ROOT}/bibles/locations/Studio 404/img/confirmed_band_props_sheet.png`,
    },
  ];
}

export function listSongbookCatalog(): SongbookCatalogItem[] {
  return SONG_FILES.map((f) => {
    const id = f.id;
    const pilot = PILOT_SONGBOOK_CONFIGS[id];
    const { piece } = buildPieceForFile(f);
    return {
      id,
      title: piece.title,
      kind: f.kind,
      isPilot: Boolean(pilot),
      ...(pilot ? { pilotArchetype: pilot.archetype } : {}),
      bpm: piece.bpm,
      keyLabel: `${piece.key} ${piece.mode}`,
    };
  });
}

export function compileIllustratedSongbook(lessonId: string): IllustratedSongbookSpec {
  const entry = SONG_FILES.find((f) => f.id === lessonId) ?? SONG_FILES.find((f) => f.id === "zap") ?? SONG_FILES[0];
  const { piece, fileBase } = buildPieceForFile(entry);
  const pilot = PILOT_SONGBOOK_CONFIGS[entry.id];
  const bs = beatSeconds(piece);
  const durationSec = Number(pieceSeconds(piece).toFixed(3));
  const ms = measures(piece);
  const meterLabel = ms[0]?.signature ?? piece.meter ?? "4/4";

  const stageIds = piece.stage?.filter((s) => s !== "band");
  const castSourceIds = stageIds && stageIds.length > 0
    ? stageIds
    : piece.tracks.length > 0
      ? piece.tracks.map((t) => t.id)
      : ["vee"];

  const castRefs: SongbookCastRef[] = stageVoicesForPiece(piece, CAST, true).map((sv, idx) => {
    const rawVoiceId = castSourceIds[idx] ?? sv.id;
    const voiceObj = CAST.find((v) => v.id === rawVoiceId) ?? CAST.find((v) => v.id === sv.id) ?? CAST[0];
    const ident = resolvePerformerIdentity(voiceObj, true, piece.title);
    const castId = canonicalCastId(ident.artKey);
    const ch = CAST_MANIFEST.characters[castId];
    const actorTakes = [...new Set((piece.takes ?? [])
      .filter((tk) => canonicalCastId(tk.who) === castId || tk.who === rawVoiceId)
      .map((tk) => tk.take))];
    const actorMoves = (piece.blocking ?? [])
      .filter((b) => canonicalCastId(b.who) === castId || b.who === rawVoiceId)
      .map((b) => (b.target ? `${b.action} ${b.target}` : b.action));
    const uniqueMoves = [...new Set(actorMoves)].slice(0, 5);
    const usageParts: string[] = [];
    if (actorTakes.length) usageParts.push(`Takes: ${actorTakes.join(", ")}`);
    if (uniqueMoves.length) usageParts.push(`Blocking: ${uniqueMoves.join(" -> ")}`);
    if (!usageParts.length) usageParts.push(ch?.role ?? ident.role);

    return {
      castId,
      voiceId: rawVoiceId,
      displayName: ch?.displayName ?? ident.name,
      role: ch?.role ?? ident.role,
      color: ch?.color ?? ident.color,
      heightDu: ch?.heightDu ?? 100,
      renderMode: ch?.renderMode ?? "atlas",
      portraitUrl: ch?.portraitUrl ?? `/cast/${castId}/portrait.webp`,
      bibleHeroUrl: ch?.bibleAudit?.bibleHeroUrl ?? `/cast/${castId}/bible-hero.webp`,
      bibleDocPath: `${ASSETS_ROOT}/bibles/general/${ch?.bibleDir ?? "Cue"}/${ch?.bibleDir ?? "Cue"}.designcraft`,
      heroImagePath: resolveHeroImageOnSpeedy(castId),
      usageInPiece: usageParts.join(" · "),
    };
  });

  const downCastKeys = castRefs.map((c) => c.castId);
  const setId = resolvePieceSetId(piece, downCastKeys, 0, true) ?? "studio404-floor";
  const setManifest = CAST_MANIFEST.sets[setId];
  const locationRef: SongbookLocationRef = {
    setId,
    label: setManifest?.label ?? "Studio 404 Stage Floor",
    plateUrl: getSetPlateUrl(setId) ?? "/cast/sets/studio404-floor.webp",
    locationBiblePath: `${ASSETS_ROOT}/bibles/locations/Studio 404/Studio 404.designcraft`,
    setAssetPath: SET_ASSET_ON_SPEEDY[setId] ?? `${ASSETS_ROOT}/bibles/locations/Studio 404/img/candidates/Loc01_Studio404_StageWide_Empty_CANON.png`,
  };

  const propRefs = buildCuratedProps(entry.id);
  const videoProj = buildVideoProject(piece, CAST, true);
  const bubbles = videoProj.bubbles;
  const castNames = castRefs.map((c) => `${c.displayName} (${c.heightDu} DU)`).join(", ");
  const spec = getSongCastSpec(piece.title);

  const rawSections = piece.sections?.length
    ? piece.sections.map((s, i) => ({
        name: s.name,
        startBeat: s.beat,
        endBeat: i + 1 < piece.sections!.length ? piece.sections![i + 1].beat : piece.beats,
      }))
    : (piece.scenes?.length && piece.kind === "skit")
      ? piece.scenes.map((sc, i) => ({
          name: `Scene ${i + 1}`,
          startBeat: sc.beat,
          endBeat: sc.beat + sc.beats,
        }))
      : [{ name: piece.title, startBeat: 0, endBeat: piece.beats }];

  const scenes: SongbookSceneSpec[] = rawSections.map((sec, idx) => {
    const startSec = Number((LEAD_IN + sec.startBeat * bs).toFixed(2));
    const endSec = Number(Math.min(durationSec - 0.1, LEAD_IN + sec.endBeat * bs).toFixed(2));
    const sceneLines: SongbookTimedLine[] = bubbles
      .filter((b) => b.startSec >= startSec - 0.25 && b.startSec < endSec - 0.15)
      .map((b) => ({
        timeSec: Number(b.startSec.toFixed(2)),
        durationSec: Number(b.durationSec.toFixed(2)),
        speaker: b.speaker,
        castId: canonicalCastId(b.speakerId),
        color: b.color,
        text: b.text,
      }));

    const blockingSummary = (piece.blocking ?? [])
      .filter((b) => b.beat >= sec.startBeat - 0.2 && b.beat < sec.endBeat)
      .map((b) => `${b.who}: ${b.action}${b.target ? ` ${b.target}` : ""}`);

    const takesSummary = (piece.takes ?? [])
      .filter((tk) => tk.beat >= sec.startBeat - 0.2 && tk.beat < sec.endBeat)
      .map((tk) => `${tk.who}: take ${tk.take}`);

    const camsInSec = (piece.cameraCues ?? []).filter(
      (c) => c.beat >= sec.startBeat - 0.2 && c.beat < sec.endBeat,
    );
    const cameraPreset: CinemaShotPreset = camsInSec[0]?.preset ?? (castRefs.length === 2 ? "two-shot" : "wide");
    const lensSpec = CAMERA_LENS_SPEC[cameraPreset];

    const span = Math.max(0.8, endSec - startSec);
    const ts = [0.12, 0.38, 0.65, 0.88].map((u) =>
      Number(Math.min(Math.max(0.4, durationSec - 0.25), startSec + span * u).toFixed(2)),
    ) as [number, number, number, number];

    const sNum = idx + 1;
    const code = `S${String(sNum).padStart(2, "0")}`;
    const linesJoined = sceneLines.map((l) => l.text).join(" / ");
    const curated = curatedScenePrompts(entry.id, sec.name, linesJoined, castNames, locationRef.label);
    const firstAction = blockingSummary.slice(0, 3).join(", ") || "steady performance pose with rhythmic beat settle";
    const activeTakeHint = takesSummary.slice(0, 2).join(", ") || "12fps cel-loop expressive turn";
    const imagePrompt = curated?.imagePrompt ??
      `Studio 404 stage (${locationRef.label}) under focused warm tungsten pool and deep velvet shadow: ${castNames} blocking [${firstAction}] while singing "${linesJoined.slice(0, 90) || sec.name}", with grounded boots/pedals beside Studio 404 brass broadcast mic.`;
    const motionPrompt = curated?.motionPrompt ??
      `${CAMERA_LENS_SPEC[cameraPreset]}; characters execute ${firstAction} and [${activeTakeHint}] in 12fps on-twos animation matching CHIMERA score beats (${piece.bpm} BPM) with crisp feet contact and clean character readability.`;

    const refAnchors = [
      `@Loc_${locationRef.setId.replace(/[^a-zA-Z0-9]+/g, "_")} -> ${locationRef.setAssetPath}`,
      ...castRefs.slice(0, 3).map((c) => `@Char_${c.displayName.replace(/\W+/g, "")} -> ${c.heroImagePath}`),
      ...propRefs.slice(0, 2).map((p) => `${p.anchorTag} -> ${p.assetPath}`),
    ];

    const bookendRule = idx === 0
      ? "Opening Establishing Lock — anchor stage floor coordinates & light levels for S02 relay"
      : cameraPreset === "closeup" || cameraPreset === "reaction"
        ? "Same-Axis Lens Reframe — preserve left/right character screen side from prior shot"
        : "Eyeline & Hardware State Lock — carry screen state, cable catenary & foot placement from previous beat";

    const pilotPublicBase = pilot ? `/songbook/${entry.id}` : null;
    return {
      index: sNum,
      code,
      title: sec.name,
      barsLabel: barsLabelForRange(piece, sec.startBeat, sec.endBeat),
      startBeat: sec.startBeat,
      endBeat: sec.endBeat,
      startSec,
      endSec,
      lines: sceneLines,
      blockingSummary: blockingSummary.slice(0, 6),
      takesSummary: takesSummary.slice(0, 4),
      cameraPreset,
      lensSpec,
      stripTimestampsSec: ts,
      heroUrl: pilotPublicBase ? `${pilotPublicBase}/s${sNum}-hero.webp` : null,
      stripFrameUrls: pilotPublicBase
        ? [
            `${pilotPublicBase}/s${sNum}-f1.webp`,
            `${pilotPublicBase}/s${sNum}-f2.webp`,
            `${pilotPublicBase}/s${sNum}-f3.webp`,
            `${pilotPublicBase}/s${sNum}-f4.webp`,
          ]
        : null,
      heroPath: pilot ? `${pilot.framesDir}/s${sNum}-hero.png` : null,
      stripFramePaths: pilot
        ? [
            `${pilot.framesDir}/s${sNum}-f1.png`,
            `${pilot.framesDir}/s${sNum}-f2.png`,
            `${pilot.framesDir}/s${sNum}-f3.png`,
            `${pilot.framesDir}/s${sNum}-f4.png`,
          ]
        : null,
      imagePrompt,
      motionPrompt,
      refAnchors,
      bookendRule,
    };
  });

  const masterLookPrompt = [
    `Studio 404 Tactile Mixed-Media Stagecraft (${piece.title}, ${piece.key} ${piece.mode}, ${meterLabel}, ${piece.bpm} BPM).`,
    `Set: ${locationRef.label} (${spec?.setId ?? setId}) lit by warm tungsten spots, crimson velour backdrop, wood floor grain, and 13-mesh broadcast mic prop.`,
    `Cast (${castRefs.length}): ${castNames}.`,
    `Continuity Laws: 36mm 4-lens kit (24mm wide / 50mm two-shot / 85mm closeup / 18mm low-angle), ~74% locked stop-motion tripod vs single-axis moves, 12fps on-twos replacement faces/takes, and F_start -> F_end relay discipline.`,
  ].join(" ");

  return {
    id: entry.id,
    title: piece.title,
    about: piece.description || `${piece.title} in ${piece.key} ${piece.mode} (${piece.bpm} BPM).`,
    kind: entry.kind,
    isPilot: Boolean(pilot),
    ...(pilot ? { pilotArchetype: pilot.archetype, pilotSlug: pilot.pilotSlug } : {}),
    keyLabel: `${piece.key} ${piece.mode}`,
    bpm: piece.bpm,
    meterLabel,
    durationSec,
    songFilePath: `songs/${fileBase}.song`,
    midiFilePath: `songs/${fileBase}.mid`,
    watchUrl: `?watch=${entry.id}`,
    rehearseUrl: `?act=${entry.id}`,
    songbookUrl: `?songbook=${entry.id}`,
    designcraftPath: pilot?.designcraftPath ?? null,
    dcbookPath: DCBOOK_PATH,
    pdfPublicUrl: null,
    leadSheetPublicUrl: pilot ? `/songbook/${entry.id}/lead-sheet.webp` : null,
    leadSheetPath: pilot ? `${pilot.framesDir}/lead-sheet.png` : null,
    piece,
    masterLookPrompt,
    castRefs,
    locationRef,
    propRefs,
    scenes,
  };
}

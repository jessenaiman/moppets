import exposureCatalog from "../rehearsal/exposure-catalog.json";
import type { PerformerAvatarCel, PerformerPoseInput } from "./performer.ts";

const pairedRigs = new Set(["chip", "clank", "hertz", "tabby", "tracking", "watt"]);
const exposures = new Map(exposureCatalog.map((study) => [study.slug, study]));

export function castExposureCel(
  artKey: string,
  pose: Pick<PerformerPoseInput, "singing">,
  beat: number,
  mouthOpen: boolean,
  still: boolean,
): PerformerAvatarCel | null {
  const at = still || !Number.isFinite(beat) ? 0 : Math.max(0, beat);
  const singing = !still && pose.singing;
  const open = singing && mouthOpen;
  const mouth = open ? "open" : "closed";
  const action = singing ? `sing-${mouth}` : "idle";

  if (pairedRigs.has(artKey)) {
    // Solo sheets store four 12-cel actions. The first is the shared movement
    // used for an unscored phrase, with the open and closed plates registered.
    const within = at % 4;
    const frame = singing ? Math.round(10 * Math.min(1, within / 0.9, (4 - within) / 0.85)) : 0;
    return {
      atlasUrl: `/rehearsal/rigs/${artKey}/solo/${mouth}.webp`,
      cols: 8, rows: 6, frame, action, source: "pin-atlas",
    };
  }

  if (artKey === "moonbeam") {
    // The Moonbeam solo uses these same expression plates for the answer.
    const frame = singing ? (open ? (Math.floor(at * 2) % 2 === 0 ? 2 : 6) : 1) : Math.floor(at * 4) % 8;
    return {
      atlasUrl: `/rehearsal/moonbeam/${singing ? "expressions" : "idle"}.webp`,
      cols: 4, rows: 2, frame, action, source: "pin-atlas",
    };
  }

  // Zap's published sheet contains idle, press and wave. The live mouth plates
  // preserve the voiced take without assigning an unrelated prop action.
  if (artKey === "zap" && singing) {
    return {
      atlasUrl: `/rehearsal/rigs/zap/${open ? "open" : "sing-closed"}.webp`,
      cols: 1, rows: 1, frame: 0, action, source: "sprite-pair",
    };
  }

  const study = exposures.get(artKey);
  if (!study) return null;
  const tick = Math.floor(at * (12 / study.hold));
  let frame: number;
  switch (artKey) {
    case "gruff":
      // The published order is eight idle, eight sing, eight chuckle, eight belt.
      frame = (open ? 8 : 0) + tick % 8;
      break;
    case "zap":
      frame = tick % 16;
      break;
    case "click":
      frame = singing ? 1 + 2 * (tick % 4) : 0;
      break;
    case "clacker":
    case "thrum":
      frame = singing ? tick % study.count : 0;
      break;
    default:
      return null;
  }
  return {
    atlasUrl: artKey === "thrum" || artKey === "clacker" ? `/rehearsal/band/${artKey}-action.webp` : `/rehearsal/exposure-keys/${artKey}.webp`,
    cols: 8, rows: Math.ceil(study.count / 8), frame, action, source: "pin-atlas",
  };
}

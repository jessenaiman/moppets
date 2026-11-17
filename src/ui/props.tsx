/**
 * Each Moppet's found object shows its own voice, from that singer's CHIMERA telemetry (no other
 * singing app can: there is no airway under a sample):
 *
 *  - Vee's tape reels turn with the air she pushes out (output level, smoothed)
 *  - Scribe's typewriter types the line she is singing, a few letters on the platen
 *  - Clank's drive bay is a breath meter: six lamps, lung pressure times how loud he sounds
 *  - Pip's throat sac swells with lung pressure while he sings, as a frog's does
 *  - Gruff's belly dial warms up the longer he sings, and cools in the rests
 *  - Tabby's screen traces her glottal flow: the air pulses her vocal folds let through
 *  - Chip's floppy has a drive light that blinks on each syllable (a new voicing onset)
 *
 * The effects sit inside each puppet's sprite, so they follow its lean, squash and gesture; within the
 * sprite they move to where the object is in the dance frame showing (prop-anchors.generated.json,
 * from tools/gen-prop-anchors.py: fractions of the 384×512 cel, one per frame).
 */
import type { Pose } from "../choir/pose.ts";
import ANCHORS from "./prop-anchors.generated.json";

const AT = ANCHORS as unknown as Record<string, [number, number][]>;
/** the settle frame, shown at rest */
const REST = 7;
const place = (id: string, cel: number) => ({ left: `${AT[id][cel][0] * 100}%`, top: `${AT[id][cel][1] * 100}%` });

export function PropFx({ id }: { id: string }) {
  if (!AT[id]) return null;
  const style = place(id, REST);
  return (
    <span className={`prop prop-${id}`} style={style} aria-hidden="true">
      {id === "vee" && (
        <>
          <i className="reel" />
          <i className="reel" />
        </>
      )}
      {id === "scribe" && <b className="platen" />}
      {id === "clank" && [0, 1, 2, 3, 4, 5].map((k) => <i key={k} className="lamp" />)}
      {id === "tabby" && <canvas className="scope" width={96} height={24} />}
      {id === "chip" && <i className="led" />}
    </span>
  );
}

/** Per Moppet, what the effects remember between frames. */
interface PropState {
  cel: number;
  reel: number;
  warm: number;
  wasVoiced: boolean;
  blink: number;
  typed: string;
}
const memory = new Map<string, PropState>();

/**
 * One frame of a Moppet's object. `cel`: the dance frame showing (0..7). `line`: the words it is
 * singing now and how far through them (0..1), for Scribe's typewriter. `scope`: its glottal flow,
 * for Tabby's screen.
 */
export function updateProp(el: HTMLElement | null, id: string, cel: number, p: Pose, dt: number, line: { text: string; at: number } | null, scope: Float32Array | null): void {
  if (!el || !AT[id]) return;
  let m = memory.get(id);
  if (!m) memory.set(id, (m = { cel: REST, reel: 0, warm: 0, wasVoiced: false, blink: 0, typed: "" }));
  if (cel !== m.cel) {
    m.cel = cel;
    Object.assign(el.style, place(id, cel));
  }
  const voiced = p.singing && p.voicing > 0.3;
  switch (id) {
    case "vee": {
      // a cassette turns at a steady speed when it plays; the air sets how fast
      m.reel = (m.reel + dt * (p.singing ? 120 + 600 * p.level : 0)) % 360;
      el.style.setProperty("--reel", `${m.reel.toFixed(1)}deg`);
      break;
    }
    case "scribe": {
      // the last few letters typed, as the carriage moves along the line
      const text = line ? line.text.slice(0, Math.round(line.text.length * line.at)) : "";
      const shown = text.slice(-7);
      if (shown !== m.typed) {
        m.typed = shown;
        el.firstElementChild!.textContent = shown;
      }
      break;
    }
    case "clank": {
      // the breath behind the voice, as loud as it is sounding now
      const lit = p.singing ? Math.round(6 * p.pressure * Math.min(1, 0.35 + p.level * 1.6)) : 0;
      el.querySelectorAll<HTMLElement>(".lamp").forEach((l, k) => l.classList.toggle("on", k < lit));
      break;
    }
    case "pip": {
      el.style.setProperty("--sac", (p.singing ? 0.4 + 0.6 * p.pressure * (0.5 + p.level) : 0).toFixed(3));
      break;
    }
    case "gruff": {
      // heats over ~3 s of singing, cools over ~2 s
      m.warm = Math.max(0, Math.min(1, m.warm + (p.singing ? dt / 3 : -dt / 2)));
      el.style.setProperty("--warm", m.warm.toFixed(3));
      break;
    }
    case "tabby": {
      const c = el.firstElementChild as HTMLCanvasElement;
      const g = c.getContext("2d");
      if (!g) break;
      g.clearRect(0, 0, c.width, c.height);
      if (!scope || !p.singing) break;
      let max = 1e-9;
      for (const v of scope) max = Math.max(max, Math.abs(v));
      g.strokeStyle = "#6dfcc4";
      g.lineWidth = 1.5;
      g.beginPath();
      for (let k = 0; k < scope.length; k++) {
        const x = (k / (scope.length - 1)) * c.width, y = c.height - 2 - (scope[k] / max) * (c.height - 4);
        if (k) g.lineTo(x, y);
        else g.moveTo(x, y);
      }
      g.stroke();
      break;
    }
    case "chip": {
      if (voiced && !m.wasVoiced) m.blink = 0.12;
      m.blink = Math.max(0, m.blink - dt);
      el.classList.toggle("blink", m.blink > 0);
      break;
    }
  }
  m.wasVoiced = voiced;
}

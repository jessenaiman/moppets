import { AbsoluteFill, Img, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { beatSeconds, LEAD_IN } from "../choir/timeline.ts";
import type { MoppetVideoProps } from "../choir/videoProject.ts";
import { vocalLevelAt } from "../choir/vocalTiming.ts";
import { Cue } from "./Cue.tsx";

const clamp = (value: number) => Math.max(0, Math.min(1, value));

function Latch({ angle, mouth, live }: { angle: number; mouth: number; live: boolean }) {
  return (
    <svg viewBox="0 0 480 367" role="img" aria-label="Latch, a hinged talkback footswitch"
      data-pedal-angle={angle.toFixed(2)} data-talkback={live ? "open" : "closed"}
      style={{ position: "absolute", left: 190, top: 219, width: 496, overflow: "visible" }}>
      <defs>
        <linearGradient id="latch-metal" x2="0.7" y2="1">
          <stop stopColor="#849085" /><stop offset=".4" stopColor="#444d47" /><stop offset="1" stopColor="#222923" />
        </linearGradient>
        <linearGradient id="latch-rubber" x2="0" y2="1">
          <stop stopColor="#434a44" /><stop offset="1" stopColor="#191e1a" />
        </linearGradient>
      </defs>
      <ellipse cx="218" cy="333" rx="199" ry="18" fill="#09090c" opacity=".6" />
      <path d="M87 291C40 290 54 331 21 331S-27 311 -63 325" fill="none" stroke="#1c1c19" strokeWidth="10" />
      <path d="M87 289C40 288 54 329 21 329S-27 309 -63 323" fill="none" stroke="#666250" strokeWidth="2" />
      <path d="M76 279 131 269 341 280 398 301 388 329 103 329 73 314Z" fill="url(#latch-metal)" stroke="#161c18" strokeWidth="4" />
      <path d="M75 302 110 314H394M122 318H363" fill="none" stroke="#899285" strokeOpacity=".4" strokeWidth="3" />
      <path d="M121 318H351" stroke="#c2ad7d" strokeOpacity=".45" strokeDasharray="13 27 5 18" />
      <path d="M104 328H139V337H104ZM342 328H375V337H342Z" fill="#131713" />
      <circle cx="112" cy="276" r="19" fill="#242c25" stroke="#858b74" strokeWidth="4" />
      <path d="M111 276c0-8 6-14 13-14v27c-8 0-13-6-13-13Z" fill="#a99669" />
      <g transform={`rotate(${angle} 112 276)`}>
        <path d="M109 256 155 217 329 204 395 245 390 278 135 284 107 274Z" fill="url(#latch-metal)" stroke="#161c18" strokeWidth="4" />
        <path d="M120 254 158 219 328 206 385 243 369 253 143 265Z" fill="url(#latch-rubber)" stroke="#9d9e87" strokeWidth="2" />
        <path d="M147 249 350 234M159 240 335 224M173 232 323 215" stroke="#73786c" strokeOpacity=".8" strokeWidth="3" strokeLinecap="round" />
        <path d="M145 261 358 254 373 269 147 278Z" fill="#313a32" stroke="#191f1a" strokeWidth="2" />
        <circle cx="171" cy="268" r="4.5" fill="#d5cfaa" />
        <circle cx="198" cy="267" r="4.5" fill="#d5cfaa" />
        <path d={`M211 268Q231 ${269 + mouth * 19} 253 266Q231 ${273 + mouth * 25} 211 268Z`} fill="#101712" stroke="#101712" strokeWidth="2" />
        <rect x="276" y="257" width="66" height="15" rx="2" fill="#d2c093" transform="rotate(-2 276 257)" />
        <text x="309" y="267" textAnchor="middle" fill="#332f24" fontSize="8.5" fontWeight="bold" fontFamily="monospace">TALKBACK</text>
        <circle cx="356" cy="263" r="5" fill={live ? "#ffb059" : "#69523c"} style={{ filter: live ? "drop-shadow(0 0 6px #ff9849)" : undefined }} />
        <path d="M148 263l-7 1m83-42 13-2m76 27 13-1m42-5 7 2" stroke="#c1ad7a" strokeWidth="1.5" opacity=".7" />
      </g>
      <circle cx="111" cy="276" r="8" fill="#757963" stroke="#242b24" strokeWidth="2" />
      <path d="M107 278l7-4" stroke="#282c21" strokeWidth="2" />
    </svg>
  );
}

type VoiceId = "pip" | "scribe" | "clank";

export function LatchAudition({ project }: { project: MoppetVideoProps }) {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const seconds = frame / fps;
  const bs = project.piece ? beatSeconds(project.piece) : 60 / project.bpm;
  const beat = (seconds - LEAD_IN) / bs;
  const cut = project.piece?.sections?.find(({ name }) => name === "the cut")?.beat ?? 68;
  const activity = (id: VoiceId) => {
    const line = project.bubbles.find((bubble) =>
      bubble.speakerId === id && seconds >= bubble.startSec && seconds < bubble.startSec + bubble.durationSec);
    const word = line?.words?.find((span) => seconds >= span.startSec && seconds < span.endSec);
    const mouth = word ? clamp(Math.min((seconds - word.startSec) / .04, (word.endSec - seconds) / .07)) : 0;
    return { line, word, mouth: vocalLevelAt(project.vocalTiming, id, seconds) ?? mouth };
  };
  const latch = activity("pip");
  const cue = activity("scribe");
  const clank = activity("clank");
  const latchLine = latch.line;
  const untilEnd = latchLine ? (latchLine.startSec + latchLine.durationSec - seconds) / bs : 0;
  const sinceStart = latchLine ? (seconds - latchLine.startSec) / bs : 0;
  const cutoff = cut + 5.5;
  const lateGap = clamp((beat - cutoff) / .06) * clamp((cutoff + .25 - beat) / .19);
  const pressing = latchLine ? clamp(sinceStart / .18) * clamp(untilEnd / .055) : 0;
  const waiting = cue.line || (beat >= cutoff && beat < cut + 8) ? 1 : 0;
  const angle = 4.6 * pressing - 1.65 * waiting + .9 * lateGap;
  const live = pressing > .4;
  const caption = latchLine ? latch : cue;
  const speaker = latchLine ? "Latch" : "Cue";
  const cutFocus = Math.min(clamp((beat - (cut + 3)) / 1), clamp((cut + 11 - beat) / 2));
  const scale = Math.min(width / 1280, height / 720);

  return (
    <AbsoluteFill style={{ background: "#252523" }} data-latch-rehearsal>
      <Img src={staticFile("rehearsal/sets/cue.webp")} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
      <AbsoluteFill style={{ background: "linear-gradient(180deg,#15191444,#17151545 60%,#141410c9)" }} />
      <div style={{ position: "absolute", width: 1280, height: 720, left: "50%", top: "50%",
        transform: `translate(-50%, -50%) scale(${scale})` }}>
        <div style={{ position: "absolute", inset: 0, transformOrigin: "36% 76%",
          transform: `scale(${1 + .14 * cutFocus})` }}>
          <div style={{ position: "absolute", left: 674, top: 275, width: 156, height: 260, transformOrigin: "50% 95%",
            transform: `rotate(${clank.mouth * 3}deg)` }}>
            <Img src={staticFile(`rehearsal/img/clank-${latchLine && (clank.mouth > .2 || latch.mouth > .2) ? "sing" : "rest"}.webp`)}
              style={{ width: "100%", height: "100%", objectFit: "contain", objectPosition: "center bottom" }} />
          </div>
          <Cue arm={cue.line ? 14 + 20 * cue.mouth : 10} head={-6 + 9 * cue.mouth} mouth={cue.mouth} />
          <Latch angle={angle} mouth={live ? latch.mouth : 0} live={live} />
        </div>
        {caption.line && (
          <div style={{ position: "absolute", top: 59, left: 190, right: 190, textAlign: "center",
            color: "#faeed6", textShadow: "0 2px 12px #16130b, 0 2px 2px #16130b" }}>
            <div style={{ color: latchLine ? "#ffe291" : "#d0dfb9", font: "bold 18px monospace",
              textTransform: "uppercase", letterSpacing: ".15em" }}>{speaker}</div>
            <div style={{ marginTop: 9, font: "bold 42px Georgia" }}>
              {caption.line.text === "A sur" ? "A sur—" : caption.line.words?.length
                ? caption.line.words.map((word, i) => (
                  <span key={i} style={{ color: word === caption.word ? "#ffcf7a" : undefined }}>{word.text}{" "}</span>
                ))
                : caption.line.text}
            </div>
          </div>
        )}
      </div>
    </AbsoluteFill>
  );
}

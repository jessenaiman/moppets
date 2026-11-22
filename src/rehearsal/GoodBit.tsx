import {AbsoluteFill, Img, staticFile, useCurrentFrame, useVideoConfig} from "remotion";
import {beatSeconds, LEAD_IN} from "../choir/timeline";
import type {MoppetVideoProps} from "../choir/videoProject";
import {atlasStyle} from "../stage/WorkshopSolo";
import {StageFit} from "./StageFit";

const actors = [
  {id: "tracking", name: "Tracking", left: 384, width: 272},
  {id: "hertz", name: "Hertz", left: 625, width: 288},
] as const;

const sheet = (actor: string, state: string) => staticFile(`rehearsal/rigs/${actor}/solo/${state}.webp`);
const clamp = (n: number) => Math.max(0, Math.min(1, n));
const envelope = (beat: number, start: number, end: number) =>
  clamp(Math.min((beat - start) / .8, (end - beat) / .95));

export function GoodBit({project}: {project: MoppetVideoProps}) {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const piece = project.piece!;
  const beat = (frame / fps - LEAD_IN) / beatSeconds(piece);
  const section = piece.sections?.filter(({beat: start}) => start <= beat).at(-1);
  const offset = beat - (section?.beat ?? 0);
  const rewind = section?.name === "rewind";
  const freeze = section?.name === "freeze";
  const stepping = section?.name === "try the step" || section?.name === "the good bit";
  const offer = rewind ? envelope(offset, 15.5, 23.5) : 0;
  const freezeFrame = freeze ? envelope(offset, 8.5, 24) : 0;
  const dance = stepping ? Math.sin(offset * Math.PI / 2) * envelope(offset, 0, 32) : 0;

  return <StageFit>
    <AbsoluteFill style={{overflow: "hidden", background: "#281d1a"}}>
      <Img src={staticFile("rehearsal/band/studio-404-empty-stage.webp")}
        style={{width: "100%", height: "100%", objectFit: "cover", filter: "brightness(.8)"}}/>
      <AbsoluteFill style={{transform: `translateX(${dance * 13}px)`}}>
        {actors.map(actor => {
          const isTracking = actor.id === "tracking";
          const note = piece.tracks.find(track => track.id === actor.id)?.events.find(
            event => event.beat <= beat && beat < event.beat + event.beats,
          );
          const age = note ? beat - note.beat : 0;
          const open = Boolean(note && age >= .025 && age < note.beats - .05);
          const phrase = note ? envelope(beat, note.beat - .2, note.beat + note.beats + .2) : 0;
          const action = stepping ? 3 : isTracking && offer > 0 ? 1 : !isTracking && freezeFrame > 0 ? 2 : 0;
          const strength = stepping ? Math.abs(dance) : Math.max(phrase, isTracking ? offer : freezeFrame);
          const cel = action * 12 + Math.round(strength * 10);

          return <div key={actor.id} data-good-bit-actor={actor.id} data-cel={cel} data-mouth={open ? "open" : "closed"}
            aria-label={actor.name} style={{position: "absolute", left: actor.left, bottom: 112, width: actor.width, aspectRatio: "3 / 4"}}>
            <div style={{position: "absolute", bottom: 0, left: "22%", width: "56%", height: 17,
              borderRadius: "50%", background: "radial-gradient(ellipse,#22100cc9,transparent 72%)"}}/>
            <div style={{position: "absolute", inset: 0, backgroundRepeat: "no-repeat",
              ...atlasStyle(sheet(actor.id, open ? "open" : "closed"), cel, 8, 6)}}>
              {isTracking && offer > 0 && <span data-good-bit-tape style={{position: "absolute", left: "35%", top: "30%",
                width: "30%", aspectRatio: "120 / 96", opacity: offer, backgroundRepeat: "no-repeat",
                ...atlasStyle(sheet(actor.id, "prop"), Math.round(offer * 15), 4, 4)}}/>}
            </div>
          </div>;
        })}
        <div data-good-bit-cable aria-hidden="true" style={{position: "absolute", left: 584, top: 487,
          width: 113, aspectRatio: "120 / 96", backgroundRepeat: "no-repeat",
          ...atlasStyle(sheet("hertz", "prop"), Math.round(Math.abs(dance) * 15), 4, 4)}}/>
      </AbsoluteFill>
    </AbsoluteFill>
  </StageFit>;
}

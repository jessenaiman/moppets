import { useEffect, useMemo, useRef } from "react";
import { buildCharacterClipSegments, characterClipUrl, type CharacterClipManifest } from "../choir/clipTimeline.ts";
import { useEnsemble } from "../choir/ensemble.ts";
import type { Piece } from "../choir/music.ts";
import { pieceSeconds } from "../choir/timeline.ts";

/** Replay the same authored takes the video exporter chooses, on the live score clock. */
export function EnsemblePuppet({piece, voice, manifest, onError}: {
  piece: Piece; voice: string; manifest: CharacterClipManifest; onError: () => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const segments = useMemo(()=>buildCharacterClipSegments(piece,voice,24,pieceSeconds(piece)),[piece,voice]);
  const segment = useEnsemble(s=>{
    const frame = Math.floor(s.time*24);
    return segments.find(seg=>frame < seg.startFrame+seg.durationInFrames) ?? segments[segments.length-1];
  });
  useEffect(()=>{
    const el=video.current;
    if (!el) return;
    const sync=()=>{
      if(el.readyState<2 || !el.duration)return;
      const s=useEnsemble.getState();
      const t=Math.max(0,s.time-segment.startFrame/24)*segment.playbackRate % el.duration;
      if(Math.abs(el.currentTime-t)>.16)el.currentTime=t;
      el.playbackRate=segment.playbackRate;
      if(s.status==="playing" && el.paused) void el.play().catch(()=>{});
      else if(s.status!=="playing" && !el.paused)el.pause();
    };
    el.addEventListener("loadeddata",sync);sync();
    const unsubscribe=useEnsemble.subscribe(sync);
    return ()=>{unsubscribe();el.removeEventListener("loadeddata",sync);};
  },[segment,manifest]);
  return <video ref={video} className="ensemble-puppet" data-take={segment.kind}
    src={characterClipUrl(manifest, segment.kind)} muted loop playsInline preload="auto" onError={onError} aria-hidden="true"/>;
}

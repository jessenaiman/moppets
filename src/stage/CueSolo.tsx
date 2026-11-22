import type { Piece } from "../choir/music.ts";

export function CuePromptStand({piece, beat,resolveAsset}: {piece: Piece; beat: number;resolveAsset:(p:string)=>string}) {
  const section = piece.sections?.filter(s => s.beat <= beat).at(-1);
  const elapsed = beat - (section?.beat ?? 0);
  const blank = section?.name === "blank card";
  const invite = section?.name === "invitation" || section?.name === "Finale";
  const turn = blank ? Math.min(1, Math.max(0, (elapsed - 3.5) * 2)) : 0;
  const open = invite || (section?.name === "prompt" && elapsed >= 8);
  return <>
    <div className="cue-prompt-stand" data-card={turn === 1 ? "blank" : "prompt"}>
      <div className="cue-prompt-card" style={{transform: `rotateY(${180 * turn}deg)`}}>
        <img src={resolveAsset("/rehearsal/pins/cord/prompt.png")} alt=""/><span>{invite ? "Places for two" : "Places, please"}</span>
      </div>
    </div>
    {open && <div className="cue-partner-mark" />}
  </>;
}

export type MeterChange = { beat:number; signature:string };
type Metered = { meter?:string; meterChanges?:MeterChange[]; beats:number };

export function beatsPerBar(signature="4/4") {
  const [count, unit] = signature.split("/").map(Number);
  return Number.isInteger(count) && count > 0 && Number.isInteger(unit) && unit > 0 ? count * 4 / unit : 4;
}

// The score clock counts quarter notes. A meter change begins a new measure;
// no lyric or note is moved to make a printed system come out even.
export function measures(piece:Metered) {
  const changes = (piece.meterChanges ?? []).filter(change=>Number.isFinite(change.beat) && change.beat>=0).sort((a,b)=>a.beat-b.beat);
  const bars: { start:number; end:number; signature:string; printMeter:boolean }[] = [];
  let start=0, signature=piece.meter ?? "4/4", index=0;
  while(start<piece.beats){
    const before=signature;
    while(index<changes.length && changes[index].beat<=start)signature=changes[index++].signature;
    const end=Math.min(start+beatsPerBar(signature),changes[index]?.beat ?? Infinity,piece.beats);
    bars.push({start,end,signature,printMeter:bars.length===0 || signature!==before});
    start=end;
  }
  return bars;
}

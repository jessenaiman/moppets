/**
 * The Launchkey Mini, drawn (issue #10): what each knob, pad and key does right now, which
 * changes with the mode (the voice workbench, Puppeteer, Sing the words), and the control you
 * just touched lit up. Above it, one first step for someone who has never played it.
 */
import { useEffect, useState } from "react";
import { CONTROLS, PAD_AUDITION, PAD_FIRST, touchControl, useController } from "../choir/controller.ts";
import { MOUTH, PAD_VOWELS, padVowel, useLive } from "../choir/live.ts";
import { useMoppet } from "../choir/store.ts";
import { play } from "../choir/ensemble.ts";
import { useAudio } from "../audio/audio.ts";

/** "Airway size: tiny → giant" → "Airway size" */
const short = (label: string) => label.split(/[:(]/)[0].trim();
/** how long a touched control stays lit (ms) */
const LIT = 700;

export function LaunchkeyMap() {
  const mode = useLive((s) => s.mode);
  const setMode = useLive((s) => s.setMode);
  const words = useLive((s) => s.words);
  const next = useLive((s) => s.next);
  const map = useController((s) => s.map);
  const touched = useController((s) => s.touched);
  const voices = useMoppet((s) => s.voices);
  const selected = useMoppet((s) => s.selected);
  const select = useMoppet((s) => s.select);
  const name = voices[selected].name;
  // a touched control lights for LIT ms, then the map draws again without it
  const [, redraw] = useState(0);
  useEffect(() => {
    if (!touched) return;
    const t = setTimeout(() => redraw((n) => n + 1), LIT);
    return () => clearTimeout(t);
  }, [touched]);
  const lit = (what: string, n: number) => !!touched && touched.what === what && touched.n === n && performance.now() - touched.at < LIT;

  const knobs = mode === "puppet" ? MOUTH.map((m) => m[3]) : Array.from({ length: 8 }, (_, i) => {
    const key = map[21 + i];
    const c = CONTROLS.find((x) => x[0] === key);
    return c ? short(c[1]) : "(free)";
  });
  const pads = mode === "puppet" ? PAD_VOWELS.map(([, label]) => `“${label}”`) : Array.from({ length: PAD_AUDITION - PAD_FIRST + 1 }, (_, i) => (i < PAD_AUDITION - PAD_FIRST ? (voices[i]?.name ?? "") : "Sing intro"));
  const keys = mode === "off" ? "Silent until you turn on a way to play (below)" : mode === "puppet" ? `${name} breathes the mouth you made, at the note you play` : words.length ? `${name} sings the next word: “${words[next]}”` : `${name} has no words in this piece`;
  const pad = (i: number) => {
    touchControl("pad", i);
    if (mode === "puppet") padVowel(i);
    else if (i === PAD_AUDITION - PAD_FIRST) {
      // the last pad sings the picked Moppet's introduction, as on the Launchkey
      useMoppet.getState().singSolo();
      void play(useAudio.getState().start);
    } else if (i < voices.length) select(i);
  };

  return (
    <div className="launchkey">
      {mode === "off" ? (
        <div className="first-step">
          <p><b>Start here.</b> 1 · Pick a Moppet (click one on the stage, or pads 1–7). 2 · Press the button. 3 · Play any key, and it sings.</p>
          <button className="primary" onClick={() => void setMode("words")}>▶ Let {name} sing with the keys</button>
        </div>
      ) : (
        <p className="first-step">Play any key. {mode === "words" ? "Each key sings the next word, at the note you play." : "Shape the mouth with the knobs or pads, then hold a key."}</p>
      )}
      <div className="lk-body" aria-label={`Launchkey Mini: ${mode === "puppet" ? "puppeteer" : mode === "words" ? "singing the words" : "voice workbench"}`}>
        <div className="lk-row lk-knobs">
          {knobs.map((label, i) => (
            <div key={i} className={`lk-knob${lit("knob", i) ? " lit" : ""}`}>
              <i aria-hidden="true" />
              <span>{label}</span>
            </div>
          ))}
        </div>
        <div className="lk-row lk-pads">
          {pads.map((label, i) => (
            <button key={i} className={`lk-pad${lit("pad", i) ? " lit" : ""}${mode !== "puppet" && i === selected ? " on" : ""}`} onClick={() => pad(i)}>{label}</button>
          ))}
        </div>
        <div className={`lk-keys${touched?.what === "key" && performance.now() - touched.at < LIT ? " lit" : ""}`}>
          <span className="lk-keys-label">Keys</span> {keys}
        </div>
      </div>
    </div>
  );
}

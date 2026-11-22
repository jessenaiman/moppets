import type { zapTake } from "./zapDirection.ts";
import React from "react";
import buttons from "../../moppets/zap/buttons.json";
import chassisTrack from "../../moppets/zap/chassis-track.json";

export function zapFrame(beat: number) {
  const phase = beat % 16;
  return phase < 8
    ? Math.min(95, Math.floor(phase * 12))
    : Math.round(9 * Math.sin(((phase - 8) * Math.PI) / 8));
}

/** Control coordinates are measured on the original 290 × 420 remote portrait. */
export function ZapSolo({
  level,
  midi,
  open,
  beat,
  take,
  still,
  resolveAsset,
}: {
  take: ReturnType<typeof zapTake> | null;
  still: boolean;
  level: number;
  midi: number;
  open: boolean;
  beat: number;
  resolveAsset: (path: string) => string;
}) {
  const active = Math.round(midi) % buttons.length;
  const power = take ? 0 : Math.min(1, level * 3);
  const frame = still ? 0 : (take?.frame ?? zapFrame(beat));
  const [x, y, angle] = take ? [145, 333, 0] : chassisTrack[frame];
  return (
    <span
      className="zap-solo"
      aria-hidden="true"
      style={{
        aspectRatio: "370 / 450",
        backgroundImage: `url("${resolveAsset(take ? "/rehearsal/rigs/zap/solo/keypad.webp" : "/rehearsal/rigs/zap/solo/zap-cart.webp")}")`,
        transformOrigin: "42% 96%",
        transform: take && !still ? `rotate(${take.tilt}deg)` : undefined,
        backgroundSize: "1200% 800%",
        backgroundPosition: `${((frame % 12) * 100) / 11}% ${(Math.floor(frame / 12) * 100) / 7}%`,
      }}
    >
      <span
        style={{
          position: "absolute",
          width: "78.3784%",
          height: "93.3333%",
          left: `${((x - 105) * 100) / 370}%`,
          top: `${((y - 317) * 100) / 450}%`,
          transformOrigin: "36.2069% 75.4762%",
          transform: `rotate(${angle}deg)`,
        }}
      >
        {open && (
          <img
            src={resolveAsset("/rehearsal/img/zap-sing.webp")}
            alt=""
            style={{
              clipPath: "inset(20.7% 55% 75% 35%)",
              position: "absolute",
              inset: 0,
            }}
          />
        )}
        {buttons.map(({ x, y, w, h, color }, i) => (
          <i
            key={i}
            style={{
              left: `${((x - w / 2) / 290) * 100}%`,
              top: `${((y - h / 2) / 420) * 100}%`,
              width: `${(w / 290) * 100}%`,
              height: `${(h / 420) * 100}%`,
              color,
              opacity:
                x < 113 && y < 234
                  ? 0
                  : i === active
                    ? power
                    : i === (active + 3) % buttons.length
                      ? Math.max(0, power - 0.58)
                      : 0,
            }}
          />
        ))}
        <i
          className="zap-transmit"
          style={{ opacity: take ? (still ? 0 : take.signal) : power }}
        />
      </span>
    </span>
  );
}
const tapeCells = { rain: 0, sun: 1, moon: 2, cake: 3, sky: 4, cat: 5 };
const screenColor = {
  rain: "#619bb2",
  sun: "#ffbe56",
  moon: "#9da3de",
  cake: "#ef95ab",
  sky: "#6ec8ee",
  cat: "#cd875d",
  bars: "#a9d39e",
  tabby: "#6fb781",
  zap: "#8ebc6a",
  black: "#242628",
  sunshower: "#c9af60",
  spark: "#465441",
};

export function ZapTelevision({
  take,
  still,
  resolveAsset,
}: {
  take: ReturnType<typeof zapTake>;
  still: boolean;
  resolveAsset: (path: string) => string;
}) {
  const picture = take.picture;
  if (!picture) return null;
  const cell =
    picture === "sunshower"
      ? tapeCells.sun
      : tapeCells[picture as keyof typeof tapeCells];
  const rolling = !still && take.roll !== null;
  return (
    <>
      <span
        className="zap-room-spill"
        style={{
          background: `radial-gradient(ellipse at 84% 23%, ${screenColor[picture]}55, transparent 45%)`,
        }}
      />
      <span
        className="zap-tv-glass"
        data-program={picture}
        style={{
          backgroundColor:
            picture === "black" ? "#171813" : screenColor[picture],
        }}
      >
        {cell !== undefined && (
          <span
            className="zap-tv-picture"
            style={{
              backgroundImage: `url("${resolveAsset("/rehearsal/sets/zap-programs.webp")}")`,
              backgroundSize: "300% 200%",
              backgroundPosition: `${(cell % 3) * 50}% ${Math.floor(cell / 3) * 100}%`,
            }}
          />
        )}
        {picture === "spark" && <i className="zap-crt-spark" />}
        {picture === "sunshower" && <span className="zap-sunshower" />}
        {picture === "zap" && (
          <img
            className="zap-tv-self"
            src={resolveAsset("/rehearsal/img/zap-rest.webp")}
            alt=""
          />
        )}
        {(picture === "bars" || picture === "tabby") && (
          <img
            className="zap-tv-archive"
            src={resolveAsset(
              `/rehearsal/sets/zap-crt-${picture === "bars" ? "bars" : "playing"}.webp`,
            )}
            alt=""
          />
        )}
        {rolling && (
          <i className="zap-tv-roll" style={{ top: `${take.roll! * 105}%` }} />
        )}
      </span>
      <i
        className="zap-deck-lamp"
        style={{
          backgroundColor: screenColor[picture],
          opacity: rolling ? 1 : 0.6,
        }}
      />
    </>
  );
}

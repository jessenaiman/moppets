import React from "react";
import { AbsoluteFill, Audio, Composition, Img, OffthreadVideo, registerRoot, staticFile } from "remotion";
import performance from "../../moppets/tabby/clips/ribbon-and-felt.webm";
import soundtrack from "../../moppets/tabby/(Footage)/6-tabby-solo.wav";

function RibbonAndFelt() {
  return (
    <AbsoluteFill style={{ background: "radial-gradient(ellipse at 50% 40%, #824a3b 0%, #40202a 43%, #140d16 88%)" }}>
      <AbsoluteFill style={{ background: "repeating-linear-gradient(90deg, transparent 0, #160a1880 58px, #904f4033 110px, transparent 140px)" }} />
      <div style={{ position: "absolute", inset: "85% 0 0", background: "linear-gradient(#291922, #57362b 40%, #25181c)" }} />
      <div style={{ position: "absolute", left: "32%", top: "87%", width: "36%", height: "5%", borderRadius: "50%", background: "#160d13", filter: "blur(16px)" }} />
      <OffthreadVideo transparent muted src={performance} style={{ position: "absolute", left: "32%", bottom: "9%", height: "85%" }} />
      <Img src={staticFile("rehearsal/props/mic-ribbon.webp")} style={{ position: "absolute", left: "65%", bottom: "10%", height: "48%" }} />
      <Audio src={soundtrack} />
    </AbsoluteFill>
  );
}

registerRoot(() => <Composition id="TabbySolo" component={RibbonAndFelt} width={1920} height={1080} durationInFrames={744} fps={24} />);

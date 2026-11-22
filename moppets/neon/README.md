# Neon · Take Two

The cyan tube sings the call and the rose tube answers. The warm desk lamp and the bench stay visible in the quiet bridge. On the last “Two,” both glass tubes light while the voice and electric piano sustain a major third.

## Caster performance

Open `neon.ecproj` in EffectCraft, composition **Take Two - twin tube poses**. Frames are zero-based at 24 fps.

| Frames | Action |
| --- | --- |
| 0–95 | Cyan call, rose answer, both arms open, then the quiet listening pose |
| 96–111 | The caster swings about its vertical kingpin. Each tine carries a tire and the worn tread marks rotate. |
| 112–125 | The fork binds. The wheels hold their positions while the ballast pitches forward and the taped leg braces. |
| 126–143 | The plug follows the caster as it frees itself. The boot takes up the weight and both hands settle. |

The entrance travels in a wide shot. In the bridge, the second approach cuts in on the foot and then pulls back on release. **Cam: Wide** keeps the full-body framing. Reduced motion retains the vocal mouth changes and static wide shot.

The native rig uses the separated head, ballast, felt sleeves, caster and taped boot from Neon's original cutouts sheet. Independent wrist and fingertip pins give both hands follow-through. The plug trails a pin on the cable. The dimmer layers retain the grille texture over the glass. An amber mouth plate follows the head and is enabled for the open-mouth atlas.

The four live atlases live in `public/rehearsal/rigs/neon/solo`. The 12 × 8 singing sheets and 8 × 6 rolling sheets contain the same poses in open and closed mouth versions. `src/stage/NeonSolo.tsx` maps the score to the frames and floor position, shared between the live stage and Remotion.

`neon.anicraft` contains the constrained caster and boot IK study, and a separate four-view turnaround from the original sheet. `views/` and `rig-plates/` contain its source artwork. The set source is `repair-bay.png`; `public/rehearsal/sets/neon-repair.webp` is the stage version.

Solo film: `out/neon-solo/take-two.mp4`. Lead sheet: `songs/take-two.song`.

# Every Button

Open `keypad.ecproj` in EffectCraft for the live solo. Its 370 × 450 composition runs at 24 fps. The two source plates are the existing `mitt-pass/cel-0001.png` and `public/rehearsal/rigs/zap/solo/plate-rest.png`. The older `zap.ecproj` contains the cable pin rigs and the edit-cart performance.

The keypad composition separates the planted case, each sleeve and each mitten with native masks. Sleeve rotations and lengths follow the keyed cuff positions. The mitts have their own wrist rotations. Fifteen rubber cap layers move down on contact with separate illuminated surfaces underneath the mitts.

| Native frames | Performance |
| --- | --- |
| 0–15 | Hover, aim, single press and release |
| 16–31 | Catch a neighboring key with the heel of the mitt |
| 32–47 | Both mitts press across several keys |
| 48–72 | Downstroke, answering upstroke, two taps, hands clear |
| 75–89 | Final single press and release |

The stage reads these poses from the 12-column, eight-row RGBA atlas at `public/rehearsal/rigs/zap/solo/keypad.webp`. The score sets the cue times in `src/stage/zapDirection.ts`. The four percussion attacks in `src/choir/zapBand.ts` also drive the four tape changes in the washboard bar. At 128 BPM the bridge begins at beat 88, the reprise at 104, the washboard at 124 and the final blackout follows the sung onset at 128.

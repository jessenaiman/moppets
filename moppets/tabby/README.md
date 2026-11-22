# Tabby

Open `tabby.ecproj` in EffectCraft. The collected footage includes the repaired torso, two ears, closed and open tablet faces, ribbon tail, hands, four turnaround views and the AniCraft walk frames. Open `tabby.anicraft` to edit the walk.

The live stage uses the 48-frame, 24 fps transparent loops in `clips/`. The idle and singing compositions share the same puppet motion. The singing composition swaps in the open bezel so the stage can switch mouths on the singer’s jaw and lip telemetry. Each ear tip follows its base by 0.12 seconds. The tail tip follows the inner tail control with the same delay.

| Layer | Leader pin | Following tip |
| --- | --- | --- |
| Left ear | 875 | 884 |
| Right ear | 898 | 907 |
| Ribbon tail | 997 | 1008 |

The pin IDs refer to the idle composition. The singing composition carries a duplicate of that rig.

## Ribbon and Felt

Two knocks on D open the verse. Tabby drops from the high “mew” into a lower register, then echoes the same dotted rhythm on a new starting note. The short call and echo return after a dance break. Four beats of silence give her time to hold her bow before the final “Mew.”

| Song cue at 112 bpm | EffectCraft action |
| --- | --- |
| 2.54 s, “Tap tap” | A recorded wrist-pin arc knocks twice. Hand pins travel with the palm. |
| 8.97 s, first call | The shoulders open. The tail tip trails the inner cable control by 0.14 s. |
| 15.94–19.15 s, “turn around” and dance break | The dance composition uses Tabby’s front, three-quarter, profile and rear plates, returning across the opposite shoulder. Each exposure has its own step and roll keys. |
| 24.78–28.12 s, curtain call | The profile composition separates Tabby at the coat hem. The upper body rotates 52 degrees around the hip while the boots and cable tail stay planted. She holds through the rest and recovers for the final note. |

Both 31-second takes contain the turn and bow. The closed and open bezels share the same body animation. The Remotion master uses the CHIMERA jaw data captured while rendering this lead sheet.

The live player selects the closed or open take using the current singer telemetry and follows the ensemble clock. The `Ribbon and Felt - Vocal Performance` composition stores the original song’s mouth switches on the open take’s opacity track for frame-accurate export. `Solo.tsx` frames that performance with the ribbon mic and original 48 kHz recording. Render from the repository root with `bunx remotion render moppets/tabby/Solo.tsx TabbySolo out/tabby-solo/ribbon-and-felt-curtain-call.mp4`.

## One Tape

The second solo uses a distinct cue sheet in the shared stage renderer. The word “steps” starts the full turnaround. The sung “bows” starts the planted profile hinge, with a recovery before the next phrase. The published open and closed sheets in `public/rehearsal/rigs/tabby/solo` sample the idle, turn, bow and open-arm performances from this project.

# Asset Breakout — UI Map & `cli-anything-asset-breakout` Reference

Live target: Google Flow `Asset Breakout` applet (`--session flow-live`, tab `t2`).

## Verified UI Structure

### Main Shell (`frame main`)
- Mode toggle radios: `radio "Tool"` | `radio "Edit"`
- Builder header: `Back`, `Asset Breakout` (`textbox`), `Share`, `More options`, `Done`
- Preview tabs: `Preview` | `Code`
- Workbench host: `Iframe [ref=eN]` (dynamic ref per snapshot; resolved at runtime)

### Inside Workbench Iframe (`frame @eN`)
1. **Top Mode Tabs (4):**
   - `Mode A: Sprite Grid` — Controls: `Columns` slider, `Rows` slider, `Margin (%)` slider, `Padding (%)` slider, `Chroma Key Matte Preview` checkbox + color picker (`#00FF00`), `Sprite Loop Preview` (`6 fps` / `12 fps` / `24 fps` + `Play Sprite Loop`), `Horizontal Foot-Baseline Guide` slider (`88.0%`).
   - `Mode B: Cutout Parts` — Controls: part templates (`Head`, `Torso`, `Upper Arm (L)`, `Fore Arm (L)`, `Wing (L)`, `Wing (R)`, `Leg (L)`, `Leg (R)`, `Prop / Weapon`), `Place "<part>" Box`, `TAGGED PLATES`.
   - `Mode C: Pin & Bone Rig` — Controls: node types (`Starch Pin`, `Deform Pin`, `Follow Pin`, `Bone Joint`), `Drop New Bone Joint`, `RIG NODES HIERARCHY`.
   - `Mode D: Turnaround Sheet` — Controls: `Reset Defaults`, `Crown Alignment`, `Eyes Alignment`, `Shoulders Alignment`, `Hips Alignment`, `Baseline Alignment`.
2. **Top Rig Actions:**
   - `SLUG` badge (`toasty` default, synced with Character Slug input)
   - `Copy Rig JSON` button
   - `Download Rig JSON` button
3. **Generation Input Gate (Zero Mutation — 3 of 3 Required):**
   - **01 · Storyboard Concept & Scene Context:**
     - Storyboard file input: `input[type="file"][accept*=".xml"]` (`.xml,.md,.txt,.json,.pdf`) labeled `"Upload Storyboard (.xml, .md, .txt, .json, .pdf)"`
     - Context `<textarea>` (populates automatically when single-page file uploaded or when selecting from parsed Page/Section `<select>` dropdown if shown)
   - **02 · Source / Reference Image(s):**
     - Image file input: `input[type="file"][accept*="image"]` (`Browse Files` / drag-drop, `0..4` selected)
     - `Flow Media Gallery` button
   - **03 · User Prompt (Verbatim Only):**
     - Verbatim prompt `<textarea>`
   - **Generation Parameters:**
     - `Include editable layout hint` checkbox
     - `Aspect Ratio` combobox (`1:1 (Square Sheet)`, `16:9 (Horizontal Sheet)`, `9:16 (Tall Turnaround)`, `4:3 (Classic Panel)`, `3:4 (Portrait Breakout)`)
     - `Output Count` combobox (`1 Output`, `2 Outputs`, `3 Outputs`, `4 Outputs`)
     - `Character Slug` textbox (placeholder `"toasty"`)
     - Submit button (`Complete All 3 Gate Inputs Above to Unlock Generate` -> unlocked Generate button once 3/3 pass)
4. **Bottom Tray:**
   - `Iterative Re-Seed Tray (N)` with per-asset `Send to Reference Slot`, `Open in Rig Inspector`, and `Download`.

## CLI Commands

```bash
cli-anything-asset-breakout map [--json]
cli-anything-asset-breakout status [--json]
cli-anything-asset-breakout tool-mode
cli-anything-asset-breakout mode <sprite|cutout|rig|turnaround>
cli-anything-asset-breakout import-storyboard <file> [--page <match>] [--json]
cli-anything-asset-breakout upload-refs <img1> [<img2> ...] [--json]
cli-anything-asset-breakout set-inputs [--context TEXT] [--prompt TEXT] [--slug SLUG] [--aspect TEXT] [--outputs 1..4] [--layout-hint on|off] [--json]
cli-anything-asset-breakout generate [--wait 120] [--json]
cli-anything-asset-breakout download-rig <out.json> [--json]
cli-anything-asset-breakout download-tray <out-dir> [--json]
```

/** The dev-only rig stage at /rig.html. See docs/rig.md. */
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { initChimera } from "../wasm/chimera.ts";
import { engine } from "../audio/AudioEngine.ts";
import { defaultF0, PRESETS as BODIES } from "../ui/body.ts";
import { V } from "../ui/colors.ts";
import { mouthWords } from "../ui/mouthWords.ts";
import type { HumanArtic } from "../wasm/types.ts";
import type { BodyName, TelemetryMessage } from "../worklet/protocol.ts";
import rigUrl from "./body.rig.bin?url";
import { Motion, readMotion } from "./motion.ts";
import { neutral, pose, PRESETS, RANGE, serializePose, type Pose } from "./pose.ts";
import { neckTurns, Rig } from "./rig.ts";
import { aimNeck } from "./aimNeck.ts";
import { RigView } from "./view.ts";
import type { Nerves, NerveView, NerveLook } from "./nerves.ts";

const rigBytes = fetch(rigUrl).then((res) => res.arrayBuffer());
await initChimera();
// These modules read the engine's tables when imported.
const [{ wearHead, HEAD_LOOKS, HEAD_LOOK }, { VoiceModel }, { REST_ARTIC }, nervesModule, speech, bytes] = await Promise.all([
  import("./head.ts"),
  import("../ui/analysis.ts"),
  import("../ui/render/anatomy3d.ts"),
  import("./nerves.ts"),
  import("../ui/speech.ts"),
  rigBytes,
]);

// WASM gives the same body and rate the same model handle. Keep the three possible models
// for the page's lifetime so removing one figure cannot drop another figure's model.
const models = new Map<BodyName, InstanceType<typeof VoiceModel>>();
const canvas = document.querySelector("canvas")!;
const wordsCanvas = document.querySelector<HTMLCanvasElement>("#words")!;
const wordsContext = wordsCanvas.getContext("2d")!;
void document.fonts.load('500 26px "Hershey"');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
renderer.setPixelRatio(Math.min(2, devicePixelRatio));
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000000);
const camera = new THREE.PerspectiveCamera(32, 1, 5, 5000);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
const composer = new EffectComposer(renderer);
const bloom = new UnrealBloomPass(new THREE.Vector2(512, 512), 0.25, 0.3, 0.7);
composer.addPass(new RenderPass(scene, camera));
composer.addPass(bloom);
composer.addPass(new OutputPass());

const NERVE_LOOKS = { function: "by function", xray: "x-ray by depth", signal: "signal" };
const isNerveLook = (look: string): look is NerveLook => Object.hasOwn(NERVE_LOOKS, look);
const SETTINGS_KEY = "chimera-rig-playground";
const SPACING = 60;
const clamp = THREE.MathUtils.clamp;
const lerp = THREE.MathUtils.lerp;
const smooth = (t: number) => t * t * (3 - 2 * t);
const cameraPosition = new THREE.Vector3();
const finite = (value: unknown, fallback: number) => typeof value === "number" && Number.isFinite(value) ? value : fallback;
const vector = (v: unknown): v is [number, number, number] =>
  Array.isArray(v) && v.length === 3 && v.every(Number.isFinite);

interface FigureState {
  voice: BodyName;
  pitch: number;
  size: number;
  look: string;
  pose: Pose;
  mouth: number;
}

interface StageState {
  figures: FigureState[];
  selected: number;
  camera: number[];
  target: number[];
  signal: number;
  speed: number;
}

type Angles = Record<string, number>;
type Ranges = Record<string, readonly [number, number]>;
function jointGroups(p: Pose): { label: string; angles: Angles; ranges: Ranges; mirror?: Angles }[] {
  const joints = <T extends Record<keyof T, number>>(part: T) => part as Angles;
  return [
    { label: "body", angles: p.body, ranges: RANGE.body },
    { label: "spine", angles: p.spine, ranges: RANGE.spine },
    { label: "neck", angles: p.neck, ranges: RANGE.neck },
    { label: "right arm", angles: joints(p.arms.R), ranges: RANGE.arm, mirror: joints(p.arms.L) },
    { label: "left arm", angles: joints(p.arms.L), ranges: RANGE.arm, mirror: joints(p.arms.R) },
    { label: "right leg", angles: joints(p.legs.R), ranges: RANGE.leg, mirror: joints(p.legs.L) },
    { label: "left leg", angles: joints(p.legs.L), ranges: RANGE.leg, mirror: joints(p.legs.R) },
  ];
}

function figureState(saved?: Partial<FigureState> | null): FigureState {
  const voice = saved?.voice && Object.hasOwn(BODIES, saved.voice) ? saved.voice : "male";
  const look = saved?.look && (Object.hasOwn(HEAD_LOOKS, saved.look) || isNerveLook(saved.look)) ? saved.look : HEAD_LOOK;
  const p = neutral();
  const stored = jointGroups(pose(saved?.pose ?? {}));
  jointGroups(p).forEach(({ angles, ranges }, i) => {
    for (const key of Object.keys(ranges)) angles[key] = finite(stored[i].angles[key], 0);
  });
  return {
    voice, look, pose: p,
    pitch: clamp(finite(saved?.pitch, defaultF0(BODIES[voice])), 60, 500),
    size: clamp(finite(saved?.size, 1), 0.5, 1.3),
    mouth: clamp(finite(saved?.mouth, 0), 0, 1),
  };
}

class Figure {
  readonly group = new THREE.Group();
  readonly rig = new Rig(bytes);
  readonly head: ReturnType<typeof wearHead>;
  readonly floor: number;
  view: RigView | null = null;
  xray: NerveView | null = null;
  private nerves: Nerves | null = null;
  private skinned: Float32Array | null = null;
  private posed: Pose | null = null;
  private rigMoved = true;
  private lookBlend = 0;
  private neckAim: Pose["neck"] | null = null;
  private readonly words = mouthWords(
    () => activeSpeech?.figure === this && activeSpeech.planId === engine.lastPlan?.id
      ? speech.spokenWordNow() : null,
    V.white,
    (view, lips) => {
      // where 1 cm ahead of the lips lands across the screen, in cm there: ±1 in profile, about 0
      // facing the camera (as a speaker turns to), where the sign is noise and would flip the
      // words from side to side frame by frame. So the side changes only once the face is turned.
      const ahead = (view.X({ x: lips.x + 1, y: lips.y }) - view.X(lips)) / view.pxPerCm;
      if (Math.abs(ahead) > 0.3) this.wordSide = ahead < 0 ? -1 : 1;
      return this.wordSide;
    },
  );
  private wordSide: 1 | -1 = 1;
  mouthBlend = 0;
  liveArtic: HumanArtic | null = null;
  tween: { from: Pose; to: Pose; start: number } | null = null;
  motion: Motion | null = null;
  motionTime = 0;
  motionRequest = 0;
  file: { data: ArrayBuffer; name: string; clips: string[]; index: number } | null = null;

  constructor(readonly state: FigureState) {
    const model = models.get(state.voice) ?? new VoiceModel(BODIES[state.voice], 48000);
    models.set(state.voice, model);
    this.head = wearHead(this.rig, model);
    this.floor = Math.min(...this.rig.rest.filter((_, i) => i % 3 === 1));
    this.group.add(this.head.mount);
    this.resize();
    this.setLook(state.look);
  }

  resize(): void {
    this.group.scale.setScalar(this.state.size);
    this.group.position.y = this.floor * (1 - this.state.size);
    this.head.resize(innerWidth, innerHeight);
    this.xray?.resize(innerWidth, innerHeight, renderer.getPixelRatio());
  }

  setLook(look: string): void {
    this.state.look = look;
    if (isNerveLook(look)) {
      if (this.view) {
        this.group.remove(this.view.group);
        this.view.dispose();
        this.view = this.skinned = null;
      }
      if (!this.xray) {
        // Construction samples the neutral skin and leaves the rig neutral.
        this.nerves ??= new nervesModule.Nerves(this.rig, this.head);
        this.xray = new nervesModule.NerveView(this.nerves);
        this.group.add(this.xray.mesh);
        this.resize();
        this.posed = null;
      }
      this.xray.look = look;
    } else {
      if (this.xray) {
        this.group.remove(this.xray.mesh);
        this.xray.dispose();
        this.xray = null;
      }
      this.head.setLook(HEAD_LOOKS[look]);
      this.view ??= new RigView(this.rig);
      this.skinned ??= new Float32Array(3 * this.rig.n);
      this.group.add(this.view.group);
      this.view.toneChanged();
    }
  }

  stopMotion(): void {
    this.motionRequest++;
    this.motion = null;
    this.posed = null;
  }

  updatePose(now: number, elapsed: number): void {
    const tween = this.tween;
    if (tween) {
      const t = clamp((now - tween.start) / 500, 0, 1);
      const eased = smooth(t);
      const from = jointGroups(tween.from), to = jointGroups(tween.to);
      const p = neutral();
      jointGroups(p).forEach(({ angles, ranges }, i) => {
        for (const key of Object.keys(ranges)) angles[key] = lerp(from[i].angles[key], to[i].angles[key], eased);
      });
      this.state.pose = t === 1 ? tween.to : p;
      if (t === 1) this.tween = null;
    }
    const speaking = activeSpeech?.figure === this && activeSpeech.planId === engine.lastPlan?.id;
    this.head.head.gazeAtCamera = speaking;
    this.lookBlend = clamp(this.lookBlend + elapsed * (speaking ? 1 / 0.3 : -1 / 0.4), 0, 1);
    const p = this.state.pose;
    if (this.motion) this.motion.pose(this.motionTime += Math.min(elapsed, 0.1));
    else if (this.posed !== p) this.rig.pose(p);
    else if (!this.lookBlend) return;
    this.posed = this.motion || this.lookBlend ? null : p;
    this.rigMoved = true;
    if (!this.lookBlend) {
      this.neckAim = null;
      return;
    }

    // Both slider poses and motion clips end in world turns. Replace just the neck chain,
    // blending its local joints so the rest of the moving skeleton stays on its clip.
    const { rig } = this;
    this.group.updateWorldMatrix(true, false);
    const aim = aimNeck(rig, this.group.matrixWorld, camera.getWorldPosition(cameraPosition));
    // Crossing directly behind the figure changes which shoulder is nearer the camera.
    const step = Math.min(elapsed, 0.1) * 360;
    if (this.neckAim) {
      aim.twist = clamp(aim.twist, this.neckAim.twist - step, this.neckAim.twist + step);
      aim.flex = clamp(aim.flex, this.neckAim.flex - step, this.neckAim.flex + step);
    }
    this.neckAim = aim;
    const [lower, upper] = neckTurns(aim);
    const neck = rig.bone("neck"), head = rig.bone("head");
    const trunk = rig.W[rig.bones[neck].parent];
    const headLocal = rig.W[neck].clone().invert().multiply(rig.W[head]);
    const blend = smooth(this.lookBlend);
    rig.W[neck].slerp(lower.premultiply(trunk), blend);
    rig.W[head].copy(headLocal.slerp(upper, blend).premultiply(rig.W[neck]));
    rig.poseWorld(rig.W, rig.P[0]);
  }

  draw(dt: number, artic: HumanArtic, tele: TelemetryMessage | null): void {
    if (this.xray) {
      this.xray.signal = signal;
      this.xray.speed = speed;
      this.xray.update(camera, artic, tele, dt, innerHeight);
      // Framing can pose the rig before the render loop; draw its latest pose once.
      if (this.rigMoved) this.xray.pose();
    } else if (this.view && this.skinned) {
      this.rig.skin(this.skinned);
      this.head.update(camera, artic, tele, dt);
      this.head.face(this.skinned, this.view.posed);
      this.view.update();
    }
    this.rigMoved = false;
    // Both looks update the mounted head: NerveView.update calls RigHead.update itself.
    // Use the stage projection, since the head's private camera has a different FOV.
    const { head, model } = this.head;
    const frame = model.frame(artic);
    this.words(wordsContext, head.faceView(model, frame, artic, camera), model, frame, artic,
      { w: innerWidth, h: innerHeight, dt });
  }

  dispose(): void {
    if (activeSpeech?.figure === this) cancelSpeech();
    this.stopMotion();
    this.group.removeFromParent();
    this.group.clear();
    this.view?.dispose();
    this.xray?.dispose();
    this.head.dispose();
  }
}

function restore(): Partial<StageState> {
  try {
    return JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "{}") ?? {};
  } catch {
    return {};
  }
}

const saved = restore();
let signal = clamp(finite(saved.signal, 0.3), 0, 1), speed = clamp(finite(saved.speed, 12), 0, 60);
const figures = Array.isArray(saved.figures) && saved.figures.length
  ? saved.figures.map((state) => new Figure(figureState(state)))
  : [new Figure(figureState())];
let selected = clamp(Math.trunc(finite(saved.selected, 0)), 0, figures.length - 1);
const current = () => figures[selected];

let saveTimer: number | undefined;
function save(): void {
  clearTimeout(saveTimer);
  saveTimer = undefined;
  const state: StageState = {
    figures: figures.map((f) => ({ ...f.state, pose: f.tween?.to ?? f.state.pose })), selected,
    camera: camera.position.toArray(), target: controls.target.toArray(), signal, speed,
  };
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(state));
  } catch {
    // Storage can be blocked or full; the stage remains usable for this session.
  }
}

function requestSave(): void {
  saveTimer ??= window.setTimeout(save, 150);
}

const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const field = (id: string) => el<HTMLInputElement>(id);
const select = (id: string) => el<HTMLSelectElement>(id);
const button = (id: string) => el<HTMLButtonElement>(id);
const options = (id: string, labels: string[]) => select(id).append(...labels.map((label) => new Option(label, label)));
options("voice", Object.keys(BODIES));
options("look", Object.keys(HEAD_LOOKS));
select("look").append(...Object.entries(NERVE_LOOKS).map(([key, label]) => new Option(label, key)));
options("preset", ["custom", ...Object.keys(PRESETS)]);
select("preset").options[0].disabled = true;

const notice = el<HTMLOutputElement>("notice");
const chat = field("line");
let lastLine = "";
interface SpeechRequest {
  figure: Figure;
  planId: number | null;
  tele: TelemetryMessage | null;
}
let activeSpeech: SpeechRequest | null = null;
let startingAudio: Promise<void> | null = null;
let audioBody: BodyName | null = null;

function cancelSpeech(): void {
  if (!activeSpeech) return;
  activeSpeech = null;
  speech.stopSpeaking();
}

async function say(text: string): Promise<void> {
  cancelSpeech();
  const request: SpeechRequest = { figure: current(), planId: null, tele: null };
  activeSpeech = request;
  notice.value = "";
  try {
    // Start/resume in the input gesture. Reuse a pending start so two quick picks share the worklet.
    startingAudio ??= engine.start().finally(() => { startingAudio = null; });
    await startingAudio;
    if (activeSpeech !== request) return;
    if (!engine.running) throw new Error("Audio did not start");
    const { voice, pitch } = request.figure.state;
    const body = BODIES[voice];
    if (voice !== audioBody) {
      engine.setBody(body);
      audioBody = voice;
    }
    // A fresh engine already has the human source defaults and gate off. The score supplies breath.
    engine.setSource({ f0: pitch });
    // the dictionary (or, if it won't load, the letter-to-sound rules), then plan and schedule with
    // no await between the check and the schedule, so a line cut off while it loaded never starts.
    // (speakText would load again after a failed load, and schedule a line cut off meanwhile.)
    await speech.g2p.load().catch(() => {});
    if (activeSpeech !== request) return;
    const phrases = speech.g2p.toPhrases(text);
    const plan = phrases.length ? speech.speakPhrases(phrases, { body, rate: 1, f0: pitch }) : null;
    if (plan?.plan.segments.length) request.planId = plan.id;
    else cancelSpeech();
  } catch (error) {
    if (activeSpeech !== request) return;
    cancelSpeech();
    notice.value = error instanceof Error ? error.message : String(error);
  }
}

engine.onRebuilt(() => {
  audioBody = null;
  cancelSpeech();
});
engine.onTelemetry((msg) => {
  const request = activeSpeech, plan = engine.lastPlan;
  if (!request || request.planId === null || plan?.id !== request.planId || msg.t.clock < plan.t0 || msg.t.clock >= plan.end) return;
  request.tele = msg;
  request.figure.liveArtic = VoiceModel.articFromArray(msg.t.artic);
});

el<HTMLFormElement>("chat").onsubmit = (e) => {
  e.preventDefault();
  const text = chat.value.trim();
  if (!text) return;
  lastLine = text;
  chat.value = "";
  if (document.body.classList.contains("shot")) chat.blur();
  void say(text);
};
chat.onblur = () => document.body.classList.remove("chat-open");
chat.onkeydown = (e) => {
  if (e.isComposing) return;
  if (e.key === "Escape") {
    e.preventDefault();
    chat.blur();
  } else if (e.key === "ArrowUp" && !chat.value && lastLine) {
    e.preventDefault();
    chat.value = lastLine;
  }
};

const sliders: ((groups: ReturnType<typeof jointGroups>) => void)[] = [];
jointGroups(neutral()).forEach(({ label, ranges }, index) => {
  const group = document.createElement("details"), summary = document.createElement("summary");
  summary.textContent = label;
  group.append(summary);
  for (const [key, [min, max]] of Object.entries(ranges)) {
    const row = document.createElement("label"), input = document.createElement("input"), output = document.createElement("output");
    row.className = "joint";
    input.type = "range";
    input.min = String(min);
    input.max = String(max);
    input.step = "1";
    input.setAttribute("aria-label", `${label} ${key}`);
    const unit = label === "body" && ["x", "y", "z"].includes(key) ? " cm" : "°";
    sliders.push((groups) => {
      const value = groups[index].angles[key];
      input.value = String(value);
      output.value = `${Math.round(value)}${unit}`;
    });
    input.oninput = () => {
      const f = current();
      f.stopMotion();
      f.tween = null;
      // The rig reflects left/right anatomical angles itself, so the same number mirrors it.
      const p = pose(f.state.pose), { angles, mirror } = jointGroups(p)[index];
      angles[key] = Number(input.value);
      if (mirror && field("mirror").checked) mirror[key] = angles[key];
      f.state.pose = p;
      select("preset").value = "custom";
      refreshPose();
      refreshMotion();
      requestSave();
    };
    row.append(key, input, output);
    group.append(row);
  }
  el("joints").append(group);
});

function refreshPose(): void {
  const groups = jointGroups(current().state.pose);
  for (const refresh of sliders) refresh(groups);
}

function refreshMotion(): void {
  const { file, motion } = current();
  const name = el("motion-name");
  name.textContent = file ? file.name + (motion ? "" : " (stopped)") : "";
  name.hidden = !file;
  name.title = name.textContent;
  select("clip").replaceChildren(...(file?.clips ?? []).map((label, i) => new Option(label, String(i), false, i === file?.index)));
  select("clip").hidden = !file || file.clips.length < 2;
}

function refreshSelection(): void {
  const { state } = current();
  el("cast").replaceChildren(...figures.map((_, i) => {
    const b = document.createElement("button");
    b.textContent = `Chimera ${i + 1}`;
    b.setAttribute("aria-pressed", String(selected === i));
    b.onclick = () => choose(i);
    return b;
  }));
  button("remove").disabled = figures.length === 1;
  select("voice").value = state.voice;
  field("pitch").value = String(state.pitch);
  field("size").value = String(state.size);
  el("size-value").textContent = `${state.size.toFixed(2)}×`;
  select("look").value = state.look;
  select("preset").value = Object.keys(PRESETS).find((key) => serializePose(PRESETS[key]) === serializePose(current().tween?.to ?? state.pose)) ?? "custom";
  field("mouth").value = String(state.mouth);
  field("signal").value = String(signal);
  field("speed").value = String(speed);
  el("pulses").hidden = !figures.some((f) => f.xray);
  notice.value = "";
  refreshMotion();
  refreshPose();
}

function choose(index: number): void {
  if (index === selected) return;
  selected = index;
  refreshSelection();
  requestSave();
}

function place(): void {
  figures.forEach((f, i) => {
    f.group.position.z = (i - (figures.length - 1) / 2) * SPACING;
    f.updatePose(performance.now(), 0);
    scene.add(f.group);
  });
}

const from: Record<string, THREE.Vector3> = {
  body: new THREE.Vector3(300, 40, 175),
  front: new THREE.Vector3(360, 20, 0),
  back: new THREE.Vector3(-300, 40, 175),
  torso: new THREE.Vector3(160, 20, 95),
  head: new THREE.Vector3(86, 10, 40),
  face: new THREE.Vector3(44, 2, 20),
  side: new THREE.Vector3(0, 4, 80),
};

function bonePoints(f: Figure): THREE.Vector3[] {
  const { rig, group } = f;
  group.updateWorldMatrix(true, false);
  return rig.bones.flatMap(({ tail }, i) => [
    rig.P[i].clone().applyMatrix4(group.matrixWorld),
    new THREE.Vector3().fromArray(tail).sub(rig.H[i]).applyQuaternion(rig.S[i]).add(rig.P[i]).applyMatrix4(group.matrixWorld),
  ]);
}

function frameStage(direction: THREE.Vector3): void {
  const points = figures.flatMap(bonePoints);
  const target = new THREE.Box3().setFromPoints(points).getCenter(controls.target);
  const back = direction.clone().normalize();
  const right = new THREE.Vector3().crossVectors(camera.up, back).normalize();
  const up = new THREE.Vector3().crossVectors(back, right);
  const tanY = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  const tanX = tanY * camera.aspect;
  const heightFraction = innerWidth <= 600 ? 0.65 : 0.82;
  // Fit the projected skeletons with room around the edges for the skin and the heads.
  const distance = Math.max(...points.map((p) => {
    const d = p.sub(target);
    return d.dot(back) + Math.max((Math.abs(d.dot(right)) + 17) / tanX, (Math.abs(d.dot(up)) + 17) / (tanY * heightFraction));
  }));
  camera.position.copy(target).addScaledVector(back, distance);
  controls.update();
}

function frame(which: string): void {
  if (which === "body" || which === "front" || which === "back") {
    frameStage(from[which]);
    return;
  }
  const f = current();
  const offset = from[which].clone().multiplyScalar(f.state.size);
  if (which === "torso") {
    // About halfway between the hips and neck, following the posed figure.
    controls.target.copy(f.rig.P[0]).lerp(f.rig.P[f.rig.bone("neck")], 0.7);
    f.group.localToWorld(controls.target);
  } else {
    const { artic, tele } = articulation(f);
    f.head.update(camera, artic, tele, 0);
    controls.target.set(1, 12, 0).applyMatrix4(f.head.mount.matrixWorld);
    offset.applyQuaternion(f.head.mount.getWorldQuaternion(new THREE.Quaternion()));
  }
  camera.position.copy(controls.target).add(offset);
  controls.update();
}

function resize(): void {
  wordsCanvas.width = Math.round(innerWidth * devicePixelRatio);
  wordsCanvas.height = Math.round(innerHeight * devicePixelRatio);
  wordsContext.setTransform(wordsCanvas.width / innerWidth, 0, 0, wordsCanvas.height / innerHeight, 0, 0);
  renderer.setSize(innerWidth, innerHeight, false);
  composer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  figures.forEach((f) => f.resize());
}

button("add").onclick = () => {
  figures.push(new Figure(figureState({ look: current().state.look })));
  selected = figures.length - 1;
  place();
  frameStage(camera.position.clone().sub(controls.target));
  refreshSelection();
  requestSave();
};
button("remove").onclick = () => {
  if (figures.length < 2) return;
  const [removed] = figures.splice(selected, 1);
  removed.dispose();
  selected = Math.min(selected, figures.length - 1);
  place();
  frameStage(camera.position.clone().sub(controls.target));
  refreshSelection();
  requestSave();
};
button("clear").onclick = () => {
  for (const f of figures) f.dispose();
  figures.splice(0, figures.length, new Figure(figureState()));
  selected = 0;
  signal = 0.3;
  speed = 12;
  field("mirror").checked = false;
  for (const detail of el("joints").querySelectorAll("details")) detail.open = false;
  place();
  frame("body");
  refreshSelection();
  save();
};

select("voice").onchange = () => {
  const old = current(), voice = select("voice").value as BodyName;
  const next = new Figure({ ...old.state, pose: old.tween?.to ?? old.state.pose, voice, pitch: defaultF0(BODIES[voice]) });
  next.file = old.file;
  old.dispose();
  figures[selected] = next;
  place();
  refreshSelection();
  requestSave();
};
field("pitch").onchange = () => {
  const f = current();
  f.state.pitch = clamp(finite(field("pitch").valueAsNumber, f.state.pitch), 60, 500);
  field("pitch").value = String(f.state.pitch);
  requestSave();
};
field("size").oninput = () => {
  const f = current();
  f.stopMotion();
  f.state.size = Number(field("size").value);
  el("size-value").textContent = `${f.state.size.toFixed(2)}×`;
  f.resize();
  refreshMotion();
  requestSave();
};
field("mouth").oninput = () => {
  const f = current();
  f.stopMotion();
  f.state.mouth = Number(field("mouth").value);
  refreshMotion();
  requestSave();
};
select("look").onchange = () => {
  current().setLook(select("look").value);
  el("pulses").hidden = !figures.some((f) => f.xray);
  requestSave();
};
field("signal").oninput = field("speed").oninput = () => {
  signal = Number(field("signal").value);
  speed = Number(field("speed").value);
  requestSave();
};

function preset(name: string): void {
  const f = current();
  f.stopMotion();
  f.tween = { from: f.state.pose, to: PRESETS[name], start: performance.now() };
  select("preset").value = name;
  refreshMotion();
  requestSave();
}
select("preset").onchange = () => preset(select("preset").value);
button("neutral").onclick = () => preset("neutral");
button("copy").onclick = async () => {
  try {
    const f = current();
    await navigator.clipboard.writeText(serializePose(f.tween?.to ?? f.state.pose));
    notice.value = "Pose copied";
  } catch {
    notice.value = "Clipboard unavailable";
  }
};

async function play(f: Figure, name: string, read: () => Promise<ArrayBuffer>, index?: number): Promise<void> {
  const request = ++f.motionRequest;
  try {
    const data = await read();
    if (request !== f.motionRequest) return;
    const { root, clips } = await readMotion(data, name);
    if (request !== f.motionRequest) return;
    if (!clips.length) throw new Error(`No animation clips in ${name}`);
    const clip = index ?? clips.reduce((best, c, i) => c.duration > clips[best].duration ? i : best, 0);
    const motion = new Motion(f.rig, root, clips[clip]);
    f.tween = null;
    f.motion = motion;
    f.motionTime = 0;
    f.file = { data, name, index: clip, clips: clips.map((c) => `${c.name} (${c.duration.toFixed(1)} s)`) };
    if (f === current()) {
      notice.value = "";
      refreshMotion();
    }
  } catch (e) {
    if (request === f.motionRequest) alert(e instanceof Error ? e.message : String(e));
  }
}
field("motion").onchange = () => {
  const input = field("motion"), file = input.files?.[0];
  if (file) void play(current(), file.name, () => file.arrayBuffer());
  input.value = "";
};
select("clip").onchange = () => {
  const f = current(), file = f.file;
  if (file) void play(f, file.name, async () => file.data, Number(select("clip").value));
};

for (const button of document.querySelectorAll<HTMLButtonElement>("[data-view]")) {
  button.onclick = () => frame(button.dataset.view!);
}

function pick(x: number, y: number): void {
  const screen = (p: THREE.Vector3) => {
    p.project(camera);
    return new THREE.Vector2((p.x + 1) * innerWidth / 2, (1 - p.y) * innerHeight / 2);
  };
  const cursor = new THREE.Vector2(x, y);
  let best = 22, found = -1;
  figures.forEach((f, i) => {
    const points = bonePoints(f);
    for (let j = 0; j < points.length; j += 2) {
      const a = screen(points[j]), b = screen(points[j + 1]);
      if (Math.abs(points[j].z) > 1 || Math.abs(points[j + 1].z) > 1) continue;
      const segment = b.sub(a);
      const t = clamp(cursor.clone().sub(a).dot(segment) / (segment.lengthSq() || 1), 0, 1);
      const distance = a.addScaledVector(segment, t).distanceTo(cursor);
      if (distance < best) {
        best = distance;
        found = i;
      }
    }
  });
  if (found >= 0) choose(found);
}

let press: { id: number; x: number; y: number } | null = null;
canvas.addEventListener("pointerdown", (e) => {
  press = e.isPrimary && e.button === 0 ? { id: e.pointerId, x: e.clientX, y: e.clientY } : null;
});
canvas.addEventListener("pointermove", (e) => {
  if (press && Math.hypot(e.clientX - press.x, e.clientY - press.y) > 5) press = null;
});
canvas.addEventListener("pointercancel", () => { press = null; });
canvas.addEventListener("pointerup", (e) => {
  if (press?.id === e.pointerId && Math.hypot(e.clientX - press.x, e.clientY - press.y) <= 5) pick(e.clientX, e.clientY);
  press = null;
});
// a mouse click leaves no focus behind on its button (or the motion file's picker), so Enter
// opens the chat bar instead of pressing + again
document.addEventListener("click", (e) => {
  if (e.detail > 0 && e.target instanceof Element) (e.target.closest("button, summary") as HTMLElement | null)?.blur();
});
field("motion").addEventListener("change", () => field("motion").blur());
window.addEventListener("keydown", (e) => {
  if (e.defaultPrevented || e.isComposing || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
  const target = e.target instanceof HTMLElement ? e.target : null;
  if (target?.matches("input[type=text], input[type=number], textarea") || target?.isContentEditable) return;
  if ((e.key === "Enter" && !target?.closest("button, summary, a[href], input[type=file]")) || e.key === "/") {
    e.preventDefault();
    if (document.body.classList.contains("shot")) document.body.classList.add("chat-open");
    chat.focus();
  } else if (e.key.toLowerCase() === "h" && !target?.matches("select")) {
    document.body.classList.toggle("shot");
  }
});

function articulation(f: Figure): { artic: HumanArtic; tele: TelemetryMessage | null } {
  const open = 1.8 * f.state.mouth;
  const artic = { ...REST_ARTIC, jaw: open, lipAp: open };
  if (f.liveArtic && f.mouthBlend) {
    for (const key of Object.keys(artic) as (keyof HumanArtic)[]) {
      artic[key] = lerp(artic[key], f.liveArtic[key], smooth(f.mouthBlend));
    }
  }
  return { artic, tele: activeSpeech?.figure === f ? activeSpeech.tele : null };
}

resize();
place();
if (vector(saved.camera) && vector(saved.target) && saved.camera.some((n, i) => n !== saved.target![i])) {
  camera.position.fromArray(saved.camera);
  controls.target.fromArray(saved.target);
  controls.update();
} else frame("body");
refreshSelection();
el("stage").inert = el("joints").inert = false;
addEventListener("resize", resize);
addEventListener("pagehide", save);
controls.addEventListener("change", requestSave);

let last = performance.now();
renderer.setAnimationLoop((now) => {
  const elapsed = Math.max(0, (now - last) / 1000);
  const dt = Math.min(elapsed, 0.1);
  last = now;
  const easing = current().tween !== null;
  controls.update();
  camera.updateMatrixWorld();
  wordsContext.clearRect(0, 0, innerWidth, innerHeight);
  if (activeSpeech?.planId != null && !speech.speakingNow()) activeSpeech = null;
  let xrays = 0, nerveStrength = 0, nerveClose = 0;
  for (const f of figures) {
    f.updatePose(now, elapsed);
    const live = activeSpeech?.figure === f && activeSpeech.tele !== null;
    f.mouthBlend = clamp(f.mouthBlend + elapsed * (live ? 1 / 0.08 : -1 / 0.12), 0, 1);
    const { artic, tele } = articulation(f);
    f.draw(dt, artic, tele);
    if (f.xray) {
      xrays++;
      nerveStrength = Math.max(nerveStrength, f.state.look === "function" ? 0.3 : 0.45);
      nerveClose = Math.max(nerveClose, f.xray.close);
    }
  }
  if (easing) refreshPose();
  // A single bloom pass affects everything. In a mixed stage, keep the wireframe threshold
  // so the grid stays crisp and allow a little of the nerves' glow.
  const nerveGlow = nerveStrength * (1 - 0.65 * nerveClose);
  bloom.threshold = xrays === figures.length ? 0.3 : 0.7;
  bloom.radius = xrays === figures.length ? 0.35 : 0.3;
  bloom.strength = xrays === figures.length ? nerveGlow : xrays === 0 ? 0.25 : (0.25 + nerveGlow) / 2;
  composer.render();
});

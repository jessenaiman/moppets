/**
 * Tier 1: Rigged true-3D `.glb` Moppet performer (`GlbPerformer3D`) with skeletal 6-clip
 * `AnimationMixer` smoothstep crossfading, flush `screen_face` CRT emissive driver,
 * Tabby head-bone-mounted pixel-LED eyes & CHIMERA muzzle, AniCraft 4x2 visemes,
 * morph targets, jaw bone, secondary pose drivers, and sole-vertex foot grounding.
 */
import * as THREE from "three";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import * as SkeletonUtils from "three/examples/jsm/utils/SkeletonUtils.js";
import type { AniCraftFaceSheetSpec, Moppet3DModelSpec } from "../../choir/castManifest.ts";
import { UNIT_PLANE_GEO } from "../stageGeometries.ts";
import { loadStageTexture } from "../stageTextures.ts";
import { naturalBlinkAmountAt } from "../visemeMapper.ts";
import {
  clamp,
  clamp01,
  createContactShadowMesh,
  resolve3DClipName,
  sanitizeThreeAnimationClip,
  zRenderOrder,
  type PerformerUpdateInput,
  type StageActor3D,
} from "./actorShared.ts";
import {
  computeAniCraftCellUvRect,
  createAniCraftFaceMat,
  createSoftPlateAlphaTexture,
  selectAniCraftFaceCell,
} from "./aniCraftFaceShader.ts";
import { createScreenFaceDriver, TabbyHeadPortals, type ScreenFaceDriver } from "./glbFacePainter.ts";
import {
  CHIP_CLAP_SPEC,
  CLANK_CLAP_SPEC,
  GlbSecondaryPoseState,
  THRUM_CLAP_SPEC,
  WATT_CLAP_SPEC,
  ZAP_CLAP_SPEC,
  type GlbSecondaryPoseBones,
} from "./glbSecondaryPose.ts";

interface SoleVertSample {
  readonly mesh: THREE.SkinnedMesh;
  readonly idx: number;
}

export class GlbPerformer3D implements StageActor3D {
  readonly group = new THREE.Group();
  private readonly bodyGroup = new THREE.Group();
  private readonly shadowMesh: THREE.Mesh;
  private readonly shadowMat: THREE.MeshBasicMaterial;
  private readonly footShadowL: THREE.Mesh;
  private readonly footShadowMatL: THREE.MeshBasicMaterial;
  private readonly footShadowR: THREE.Mesh;
  private readonly footShadowMatR: THREE.MeshBasicMaterial;
  private readonly root: THREE.Object3D;
  private readonly bindRootX: number;
  private readonly bindRootY: number;
  private readonly bindRootZ: number;
  private readonly soleVertsL: SoleVertSample[] = [];
  private readonly soleVertsR: SoleVertSample[] = [];
  private readonly soleBoneL: THREE.Object3D | null = null;
  private readonly soleBoneR: THREE.Object3D | null = null;
  private readonly soleOffsetL: number = 0;
  private readonly soleOffsetR: number = 0;
  private readonly mixer: THREE.AnimationMixer;
  private readonly actions = new Map<string, THREE.AnimationAction>();
  private readonly morphMeshes: THREE.Mesh[] = [];
  private readonly screenDrivers: ScreenFaceDriver[] = [];
  private readonly jawBone: THREE.Object3D | null = null;
  private readonly jawRestX: number = 0;
  private readonly poseBones: GlbSecondaryPoseBones;
  private readonly thighL: THREE.Object3D | null = null;
  private readonly thighR: THREE.Object3D | null = null;
  private readonly shinL: THREE.Object3D | null = null;
  private readonly shinR: THREE.Object3D | null = null;
  private readonly footL: THREE.Object3D | null = null;
  private readonly footR: THREE.Object3D | null = null;
  private readonly relaxArmsRad: number = 0;
  private readonly isCueModel: boolean = false;
  private readonly isClankModel: boolean = false;
  private readonly isWattModel: boolean = false;
  private readonly isChipModel: boolean = false;
  private readonly isZapModel: boolean = false;
  private readonly isThrumModel: boolean = false;
  private readonly tabbyPortals: TabbyHeadPortals | null = null;
  private readonly faceMesh: THREE.Mesh | null = null;
  private readonly faceMat: THREE.ShaderMaterial | null = null;
  private readonly faceSheet: AniCraftFaceSheetSpec | undefined;
  private readonly wattPlateMesh: THREE.Mesh | null = null;
  private readonly wattPlateMat: THREE.MeshStandardMaterial | null = null;
  private readonly chipEyeL: THREE.Mesh | null = null;
  private readonly chipEyeR: THREE.Mesh | null = null;
  private readonly chipEyeMatL: THREE.ShaderMaterial | null = null;
  private readonly chipEyeMatR: THREE.ShaderMaterial | null = null;
  private readonly chipLidL: THREE.Mesh | null = null;
  private readonly chipLidR: THREE.Mesh | null = null;
  private readonly chipLidMat: THREE.MeshStandardMaterial | null = null;

  private readonly tmpSoleVec = new THREE.Vector3();
  private readonly tmpFootVecL = new THREE.Vector3();
  private readonly tmpFootVecR = new THREE.Vector3();
  private readonly secondaryState = new GlbSecondaryPoseState();
  private readonly headAnchorPos = new THREE.Vector3();

  private readonly blend = {
    currentClip: "",
    prevClip: null as string | null,
    switchTimeSec: 0,
    prevLocalTime: 0,
    lastTimeSec: -1,
    lastLocalTime: 0,
  };

  constructor(private readonly spec: Moppet3DModelSpec, gltf: GLTF) {
    const aoShadow = createContactShadowMesh(0.36);
    this.shadowMesh = aoShadow.mesh;
    this.shadowMat = aoShadow.mat;
    this.shadowMesh.renderOrder = 160;
    this.group.add(this.shadowMesh);

    const fShadowL = createContactShadowMesh(0.68);
    this.footShadowL = fShadowL.mesh;
    this.footShadowMatL = fShadowL.mat;
    this.footShadowL.renderOrder = 161;
    this.group.add(this.footShadowL);

    const fShadowR = createContactShadowMesh(0.68);
    this.footShadowR = fShadowR.mesh;
    this.footShadowMatR = fShadowR.mat;
    this.footShadowR.renderOrder = 161;
    this.group.add(this.footShadowR);

    this.group.add(this.bodyGroup);

    const root = SkeletonUtils.clone(gltf.scene);
    root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(root);
    const size = new THREE.Vector3();
    box.getSize(size);
    const center = new THREE.Vector3();
    box.getCenter(center);
    const normScale = 1 / Math.max(0.001, size.y);

    // Sample extreme sole vertices across left/right feet in bind pose for sub-millimeter grounding & foot shadows
    const skinnedMeshes: THREE.SkinnedMesh[] = [];
    const skeletonBones: THREE.Bone[] = [];
    root.traverse((obj) => {
      if ((obj as THREE.SkinnedMesh).isSkinnedMesh) {
        skinnedMeshes.push(obj as THREE.SkinnedMesh);
      } else if ((obj as THREE.Bone).isBone) {
        skeletonBones.push(obj as THREE.Bone);
      }
    });

    interface RawSoleVert {
      mesh: THREE.SkinnedMesh;
      idx: number;
      x: number;
      y: number;
      z: number;
    }
    const lowVerts: RawSoleVert[] = [];
    let minYL = Infinity;
    let minYR = Infinity;
    const vTmp = new THREE.Vector3();
    const lowBandY = box.min.y + size.y * 0.14;
    for (const sm of skinnedMeshes) {
      sm.skeleton?.update();
      const posAttr = sm.geometry.getAttribute("position");
      if (!posAttr) continue;
      for (let i = 0; i < posAttr.count; i++) {
        vTmp.fromBufferAttribute(posAttr, i);
        sm.applyBoneTransform(i, vTmp);
        vTmp.applyMatrix4(sm.matrixWorld);
        if (vTmp.y <= lowBandY) {
          lowVerts.push({ mesh: sm, idx: i, x: vTmp.x, y: vTmp.y, z: vTmp.z });
          if (vTmp.x < center.x) {
            if (vTmp.y < minYL) minYL = vTmp.y;
          } else {
            if (vTmp.y < minYR) minYR = vTmp.y;
          }
        }
      }
    }
    const pickSideExtremes = (sideVerts: RawSoleVert[], sideMinY: number): SoleVertSample[] => {
      if (!Number.isFinite(sideMinY) || sideVerts.length === 0) return [];
      const band = sideVerts.filter((p) => p.y <= sideMinY + size.y * 0.035);
      if (band.length === 0) return [];
      const picked = new Map<string, SoleVertSample>();
      const addSlice = (sorted: RawSoleVert[]) => {
        for (let k = 0; k < Math.min(4, sorted.length); k++) {
          const item = sorted[k];
          picked.set(`${item.mesh.uuid}:${item.idx}`, { mesh: item.mesh, idx: item.idx });
        }
      };
      addSlice([...band].sort((a, b) => a.y - b.y));
      addSlice([...band].sort((a, b) => a.z - b.z));
      addSlice([...band].sort((a, b) => b.z - a.z));
      addSlice([...band].sort((a, b) => a.x - b.x));
      addSlice([...band].sort((a, b) => b.x - a.x));
      return [...picked.values()];
    };
    this.soleVertsL = pickSideExtremes(
      lowVerts.filter((p) => p.x < center.x),
      minYL,
    );
    this.soleVertsR = pickSideExtremes(
      lowVerts.filter((p) => p.x >= center.x),
      minYR,
    );

    const footObjL = root.getObjectByName("foot_L") ?? root.getObjectByName("foot_l") ?? null;
    const footObjR = root.getObjectByName("foot_R") ?? root.getObjectByName("foot_r") ?? null;

    let pivotCenterX = center.x;
    let pivotCenterZ = center.z;
    if (footObjL && footObjR) {
      footObjL.getWorldPosition(this.tmpFootVecL);
      footObjR.getWorldPosition(this.tmpFootVecR);
      pivotCenterX = (this.tmpFootVecL.x + this.tmpFootVecR.x) * 0.5;
      pivotCenterZ = (this.tmpFootVecL.z + this.tmpFootVecR.z) * 0.5;
    } else if (lowVerts.length > 0) {
      const bandAll = lowVerts.filter((p) => p.y <= box.min.y + size.y * 0.05);
      const src = bandAll.length > 0 ? bandAll : lowVerts;
      let sx = 0;
      let sz = 0;
      for (const p of src) {
        sx += p.x;
        sz += p.z;
      }
      pivotCenterX = sx / src.length;
      pivotCenterZ = sz / src.length;
    }

    this.bindRootX = -pivotCenterX * normScale;
    this.bindRootY = -box.min.y * normScale;
    this.bindRootZ = -pivotCenterZ * normScale;
    root.position.set(this.bindRootX, this.bindRootY, this.bindRootZ);
    root.scale.setScalar(normScale);
    root.updateMatrixWorld(true);

    if (footObjL && footObjR) {
      this.soleBoneL = footObjL;
      this.soleBoneR = footObjR;
      footObjL.getWorldPosition(this.tmpFootVecL);
      footObjR.getWorldPosition(this.tmpFootVecR);
      this.soleOffsetL = Math.max(0, this.tmpFootVecL.y);
      this.soleOffsetR = Math.max(0, this.tmpFootVecR.y);
    } else if (skeletonBones.length > 0) {
      const boneY = skeletonBones
        .map((b) => {
          b.getWorldPosition(vTmp);
          return { bone: b, x: vTmp.x, y: vTmp.y };
        })
        .sort((a, b) => a.y - b.y);
      const leftBone = boneY.find((b) => b.x < 0) ?? boneY[0];
      const rightBone = boneY.find((b) => b.x >= 0) ?? boneY[1] ?? boneY[0];
      this.soleBoneL = leftBone?.bone ?? null;
      this.soleBoneR = rightBone?.bone ?? null;
      this.soleOffsetL = Math.max(0, leftBone?.y ?? 0);
      this.soleOffsetR = Math.max(0, rightBone?.y ?? 0);
    }

    this.root = root;
    this.bodyGroup.add(root);

    this.mixer = new THREE.AnimationMixer(root);
    for (const clip of gltf.animations) {
      const cleanClip = sanitizeThreeAnimationClip(clip);
      this.actions.set(cleanClip.name.toLowerCase(), this.mixer.clipAction(cleanClip));
    }

    let jawBone: THREE.Object3D | null = null;
    let shoulderL: THREE.Object3D | null = null;
    let shoulderR: THREE.Object3D | null = null;
    let upperArmL: THREE.Object3D | null = null;
    let upperArmR: THREE.Object3D | null = null;
    let forearmL: THREE.Object3D | null = null;
    let forearmR: THREE.Object3D | null = null;
    let handL: THREE.Object3D | null = null;
    let handR: THREE.Object3D | null = null;
    let thighL: THREE.Object3D | null = null;
    let thighR: THREE.Object3D | null = null;
    let shinL: THREE.Object3D | null = null;
    let shinR: THREE.Object3D | null = null;
    let footL: THREE.Object3D | null = null;
    let footR: THREE.Object3D | null = null;
    let earL: THREE.Object3D | null = null;
    let earR: THREE.Object3D | null = null;
    let tail1: THREE.Object3D | null = null;
    let tail2: THREE.Object3D | null = null;
    let tail3: THREE.Object3D | null = null;
    let eyeMount: THREE.Object3D | null = null;
    let mouthMount: THREE.Object3D | null = null;
    let faceMount: THREE.Object3D | null = null;
    const jawName = (spec.jawBoneName ?? "jaw").toLowerCase();

    root.traverse((obj) => {
      if ((obj as THREE.Mesh).isMesh) {
        const mesh = obj as THREE.Mesh;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        const mats = Array.isArray(mesh.material) ? [...mesh.material] : [mesh.material];
        let replaced = false;
        for (let i = 0; i < mats.length; i++) {
          const m = mats[i];
          if (m && typeof m.name === "string" && m.name.toLowerCase().startsWith("screen_face")) {
            const drv = createScreenFaceDriver(spec.screenStyle ?? "neon-rings");
            if (drv) {
              mats[i] = drv.material;
              this.screenDrivers.push(drv);
              replaced = true;
              continue;
            }
          }
          const std = m as THREE.MeshStandardMaterial;
          if (std && "metalness" in std && typeof std.metalness === "number") {
            if (std.metalness > 0.35) std.metalness = 0.3;
            if (typeof std.roughness === "number" && std.roughness < 0.45) std.roughness = 0.5;
            std.needsUpdate = true;
          }
        }
        if (replaced) mesh.material = Array.isArray(mesh.material) ? mats : mats[0];
        if (mesh.morphTargetDictionary && mesh.morphTargetInfluences) {
          this.morphMeshes.push(mesh);
        }
      }
      const lower = obj.name.toLowerCase();
      if (!jawBone && lower.includes(jawName)) jawBone = obj;
      if (!shoulderL && lower === "shoulder_l") shoulderL = obj;
      if (!shoulderR && lower === "shoulder_r") shoulderR = obj;
      if (!upperArmL && lower === "upper_arm_l") upperArmL = obj;
      if (!upperArmR && lower === "upper_arm_r") upperArmR = obj;
      if (!forearmL && lower === "forearm_l") forearmL = obj;
      if (!forearmR && lower === "forearm_r") forearmR = obj;
      if (!handL && lower === "hand_l") handL = obj;
      if (!handR && lower === "hand_r") handR = obj;
      if (!thighL && lower === "thigh_l") thighL = obj;
      if (!thighR && lower === "thigh_r") thighR = obj;
      if (!shinL && lower === "shin_l") shinL = obj;
      if (!shinR && lower === "shin_r") shinR = obj;
      if (!footL && lower === "foot_l") footL = obj;
      if (!footR && lower === "foot_r") footR = obj;
      if (!earL && lower === "ear_l") earL = obj;
      if (!earR && lower === "ear_r") earR = obj;
      if (!tail1 && lower === "tail_1") tail1 = obj;
      if (!tail2 && lower === "tail_2") tail2 = obj;
      if (!tail3 && lower === "tail_3") tail3 = obj;
      if (!eyeMount && lower === "tabby_eye_screen_mount") eyeMount = obj;
      if (!mouthMount && lower === "tabby_mouth_mount") mouthMount = obj;
      if (!faceMount && lower === "moppet_face_mount") faceMount = obj;
    });
    const headBone = root.getObjectByName("head") ?? null;

    this.jawBone = jawBone;
    this.jawRestX = jawBone ? (jawBone as THREE.Object3D).rotation.x : 0;
    this.poseBones = {
      shoulderL,
      shoulderR,
      upperArmL,
      upperArmR,
      forearmL,
      forearmR,
      handL,
      handR,
      earL,
      earR,
      tail1,
      tail2,
      tail3,
    };
    this.thighL = thighL;
    this.thighR = thighR;
    this.shinL = shinL;
    this.shinR = shinR;
    this.footL = footL;
    this.footR = footR;
    this.relaxArmsRad = spec.url.includes("/hertz/")
      ? -0.44
      : spec.url.includes("/tracker/")
        ? -0.32
        : 0;
    this.isCueModel = spec.url.includes("/cue/");
    this.isClankModel = spec.url.includes("/clank/");
    this.isWattModel = spec.url.includes("/watt/");
    this.isChipModel = spec.url.includes("/chip/");
    this.isZapModel = spec.url.includes("/zap/");
    this.isThrumModel = spec.url.includes("/thrum/");

    if (spec.faceOverlay === "tabby-led-mouth" && (eyeMount || mouthMount)) {
      this.tabbyPortals = new TabbyHeadPortals(eyeMount, mouthMount);
    }

    if (spec.faceOverlay === "anicraft-face-sheet" && spec.faceSheet && faceMount) {
      this.faceSheet = spec.faceSheet;
      const tex = loadStageTexture(spec.faceSheet.url) ?? null;
      this.faceMat = createAniCraftFaceMat(
        tex,
        this.isCueModel || this.isClankModel,
        this.isClankModel || this.isThrumModel,
        this.isWattModel || this.isChipModel || this.isThrumModel,
      );
      this.faceMesh = new THREE.Mesh(UNIT_PLANE_GEO, this.faceMat);
      if (this.isWattModel) {
        const plateAlpha = createSoftPlateAlphaTexture("rounded-rect");
        this.wattPlateMat = new THREE.MeshStandardMaterial({
          color: "#cfc6b8",
          roughness: 0.78,
          metalness: 0.02,
          alphaMap: plateAlpha ?? undefined,
          transparent: true,
          depthWrite: false,
          side: THREE.DoubleSide,
        });
        this.wattPlateMesh = new THREE.Mesh(UNIT_PLANE_GEO, this.wattPlateMat);
        this.wattPlateMesh.position.set(0, 0, 0.013);
        this.wattPlateMesh.scale.set(0.104, 0.098, 1);
        this.wattPlateMesh.renderOrder = 194;
        (faceMount as THREE.Object3D).add(this.wattPlateMesh);
        this.faceMesh.position.set(0, 0, 0.015);
      } else if (this.isChipModel) {
        this.faceMesh.position.set(0, 0, 0.015);
        if (headBone) {
          const lidAlpha = createSoftPlateAlphaTexture("circle");
          this.chipLidMat = new THREE.MeshStandardMaterial({
            color: "#2b82b8",
            roughness: 0.72,
            metalness: 0.02,
            alphaMap: lidAlpha ?? undefined,
            transparent: true,
            depthWrite: false,
            side: THREE.DoubleSide,
          });
          this.chipLidL = new THREE.Mesh(UNIT_PLANE_GEO, this.chipLidMat);
          this.chipLidL.position.set(0.061, 0.121, 0.098);
          this.chipLidL.rotation.set(-0.18, 0.16, 0, "YXZ");
          this.chipLidL.scale.set(0.054, 0.054, 1);
          headBone.add(this.chipLidL);

          this.chipLidR = new THREE.Mesh(UNIT_PLANE_GEO, this.chipLidMat);
          this.chipLidR.position.set(-0.054, 0.118, 0.086);
          this.chipLidR.rotation.set(-0.18, -0.24, 0, "YXZ");
          this.chipLidR.scale.set(0.054, 0.054, 1);
          headBone.add(this.chipLidR);

          this.chipEyeMatL = createAniCraftFaceMat(tex, false, false, true);
          this.chipEyeL = new THREE.Mesh(UNIT_PLANE_GEO, this.chipEyeMatL);
          this.chipEyeL.position.set(0.0613, 0.1213, 0.1);
          this.chipEyeL.rotation.set(-0.18, 0.16, 0, "YXZ");
          this.chipEyeL.scale.set(0.052, 0.052, 1);
          headBone.add(this.chipEyeL);

          this.chipEyeMatR = createAniCraftFaceMat(tex, false, false, true);
          this.chipEyeR = new THREE.Mesh(UNIT_PLANE_GEO, this.chipEyeMatR);
          this.chipEyeR.position.set(-0.0545, 0.1183, 0.088);
          this.chipEyeR.rotation.set(-0.18, -0.24, 0, "YXZ");
          this.chipEyeR.scale.set(0.052, 0.052, 1);
          headBone.add(this.chipEyeR);
        }
      } else if (this.isThrumModel) {
        this.faceMesh.position.set(spec.faceSheet.offsetX ?? 0, spec.faceSheet.offsetY ?? -0.026, 0.013);
        if (headBone) {
          const lidAlpha = createSoftPlateAlphaTexture("rounded-rect");
          this.chipLidMat = new THREE.MeshStandardMaterial({
            color: "#1c1a1e",
            roughness: 0.78,
            metalness: 0.04,
            alphaMap: lidAlpha ?? undefined,
            transparent: true,
            depthWrite: false,
            side: THREE.DoubleSide,
          });
          this.chipLidL = new THREE.Mesh(UNIT_PLANE_GEO, this.chipLidMat);
          this.chipLidL.position.set(0.054, 0.194, 0.104);
          this.chipLidL.scale.set(0.058, 0.048, 1);
          headBone.add(this.chipLidL);

          this.chipLidR = new THREE.Mesh(UNIT_PLANE_GEO, this.chipLidMat);
          this.chipLidR.position.set(-0.056, 0.194, 0.104);
          this.chipLidR.scale.set(0.058, 0.048, 1);
          headBone.add(this.chipLidR);

          this.chipEyeMatL = createAniCraftFaceMat(tex, false, true, true);
          this.chipEyeL = new THREE.Mesh(UNIT_PLANE_GEO, this.chipEyeMatL);
          this.chipEyeL.position.set(0.054, 0.194, 0.107);
          this.chipEyeL.scale.set(0.054, 0.054, 1);
          headBone.add(this.chipEyeL);

          this.chipEyeMatR = createAniCraftFaceMat(tex, false, true, true);
          this.chipEyeR = new THREE.Mesh(UNIT_PLANE_GEO, this.chipEyeMatR);
          this.chipEyeR.position.set(-0.056, 0.194, 0.107);
          this.chipEyeR.scale.set(0.054, 0.054, 1);
          headBone.add(this.chipEyeR);
        }
      } else {
        this.faceMesh.position.set(
          spec.faceSheet.offsetX ?? 0,
          spec.faceSheet.offsetY ?? 0,
          Math.max(0.015, spec.faceSheet.offsetZ ?? 0.01),
        );
      }
      this.faceMesh.renderOrder = 195;
      (faceMount as THREE.Object3D).add(this.faceMesh);
    }
  }

  update(inp: PerformerUpdateInput): void {
    const rawClip = (inp.actionClip ?? "").trim().toLowerCase();
    const hasNativeClap = this.actions.has("clap");
    const isTabbyClap = this.tabbyPortals !== null && rawClip === "clap" && !hasNativeClap;
    const isClankClap = this.isClankModel && rawClip === "clap" && !hasNativeClap;
    const isWattClap = this.isWattModel && rawClip === "clap" && !hasNativeClap;
    const isChipClap = this.isChipModel && rawClip === "clap" && !hasNativeClap;
    const isZapClap = this.isZapModel && rawClip === "clap" && !hasNativeClap;
    const isThrumClap = this.isThrumModel && rawClip === "clap" && !hasNativeClap;
    const resolvedClip =
      isTabbyClap || isClankClap || isWattClap || isChipClap || isZapClap || isThrumClap
        ? inp.singing
          ? "sing"
          : "idle"
        : resolve3DClipName(inp.actionClip, inp.singing, this.actions);
    const chosenEntry: [string, THREE.AnimationAction] | undefined =
      (this.actions.has(resolvedClip) ? [resolvedClip, this.actions.get(resolvedClip)!] : undefined) ??
      (this.actions.has(inp.singing ? "sing" : "idle")
        ? [inp.singing ? "sing" : "idle", this.actions.get(inp.singing ? "sing" : "idle")!]
        : undefined) ??
      (this.actions.has("idle") ? ["idle", this.actions.get("idle")!] : undefined) ??
      this.actions.entries().next().value;

    if (chosenEntry) {
      const [chosenKey, chosen] = chosenEntry;
      const dur = Math.max(0.05, chosen.getClip().duration || 1);
      const isInteractiveWalk = chosenKey === "walk" && inp.actionElapsedSec !== undefined;
      const isReactionOneShot =
        chosenKey === "jump" ||
        chosenKey === "spin" ||
        chosenKey === "bow" ||
        chosenKey === "laugh" ||
        chosenKey === "shrug" ||
        chosenKey === "gasp" ||
        chosenKey === "nod" ||
        chosenKey === "tilt" ||
        chosenKey === "stagger" ||
        chosenKey === "yawn" ||
        chosenKey === "panic";
      const sampleSec = isInteractiveWalk
        ? inp.actionElapsedSec! + (this.isZapModel ? 0.36 : 0.2)
        : isReactionOneShot
          ? (inp.actionElapsedSec ?? inp.timeSec)
          : inp.timeSec + inp.phaseIndex * 0.43;
      const t =
        inp.clipProgress01 !== undefined && Number.isFinite(inp.clipProgress01)
          ? clamp01(inp.clipProgress01) * (dur - 0.001)
          : ((sampleSec % dur) + dur) % dur;

      const bs = this.blend;
      const dt = bs.lastTimeSec >= 0 ? inp.timeSec - bs.lastTimeSec : 0;
      if (!bs.currentClip || dt < -0.02 || dt > 0.6) {
        bs.currentClip = chosenKey;
        bs.prevClip = null;
        bs.switchTimeSec = inp.timeSec;
      } else if (chosenKey !== bs.currentClip) {
        bs.prevClip = bs.currentClip;
        bs.currentClip = chosenKey;
        bs.switchTimeSec = inp.timeSec;
        bs.prevLocalTime = bs.lastLocalTime;
      }

      const blendDur = isInteractiveWalk ? 0.09 : 0.22;
      const rawBlend = bs.prevClip ? clamp01((inp.timeSec - bs.switchTimeSec) / blendDur) : 1;
      const alpha = rawBlend * rawBlend * (3 - 2 * rawBlend);
      const prevAction = bs.prevClip && alpha < 0.995 ? this.actions.get(bs.prevClip) : undefined;

      for (const a of this.actions.values()) {
        if (a !== chosen && a !== prevAction) {
          a.setEffectiveWeight(0);
          a.stop();
        }
      }
      if (prevAction && prevAction !== chosen) {
        const pDur = Math.max(0.05, prevAction.getClip().duration || 1);
        const pT = (((bs.prevLocalTime + Math.max(0, inp.timeSec - bs.switchTimeSec)) % pDur) + pDur) % pDur;
        if (!prevAction.isRunning()) prevAction.play();
        prevAction.enabled = true;
        prevAction.paused = false;
        prevAction.setEffectiveWeight(1 - alpha);
        prevAction.time = pT;
      } else {
        bs.prevClip = null;
      }

      if (!chosen.isRunning()) chosen.play();
      chosen.enabled = true;
      chosen.paused = false;
      chosen.setEffectiveWeight(prevAction ? alpha : 1);
      chosen.time = t;

      this.mixer.update(0);
      if (this.relaxArmsRad !== 0 && (resolvedClip === "idle" || resolvedClip === "sing")) {
        this.poseBones.upperArmL?.rotateX(this.relaxArmsRad);
        this.poseBones.upperArmR?.rotateX(this.relaxArmsRad);
        this.poseBones.forearmL?.rotateX(-0.14);
        this.poseBones.forearmR?.rotateX(-0.14);
      }
      if (this.tabbyPortals !== null) {
        this.secondaryState.applyTabbySecondaryPose(this.poseBones, inp, isTabbyClap);
      }
      if (this.isClankModel) {
        this.secondaryState.applyTwoBeatClapPose(this.poseBones, inp, isClankClap, CLANK_CLAP_SPEC);
      }
      if (this.isWattModel) {
        this.secondaryState.applyTwoBeatClapPose(this.poseBones, inp, isWattClap, WATT_CLAP_SPEC);
      }
      if (this.isChipModel) {
        this.secondaryState.applyTwoBeatClapPose(this.poseBones, inp, isChipClap, CHIP_CLAP_SPEC);
      }
      if (this.isThrumModel) {
        this.secondaryState.applyTwoBeatClapPose(this.poseBones, inp, isThrumClap, THRUM_CLAP_SPEC);
      }
      if (this.isZapModel) {
        if (chosenKey === "walk") {
          const stepPhase =
            ((inp.actionElapsedSec !== undefined ? inp.actionElapsedSec + 0.02 : sampleSec) / dur) *
            Math.PI *
            2;
          const stepEnv = inp.actionElapsedSec !== undefined ? clamp01(inp.actionElapsedSec / 0.09) : 1;
          const liftL = Math.max(0, Math.sin(stepPhase)) * stepEnv;
          const liftR = Math.max(0, -Math.sin(stepPhase)) * stepEnv;
          if (liftL > 0.01) {
            this.thighL?.rotateX(liftL * 0.48);
            this.shinL?.rotateX(-liftL * 0.85);
            this.footL?.rotateX(liftL * 0.32);
          }
          if (liftR > 0.01) {
            this.thighR?.rotateX(liftR * 0.48);
            this.shinR?.rotateX(-liftR * 0.85);
            this.footR?.rotateX(liftR * 0.32);
          }
        }
        this.secondaryState.applyTwoBeatClapPose(this.poseBones, inp, isZapClap, ZAP_CLAP_SPEC);
      }
      this.root.updateMatrixWorld(true);
      bs.lastTimeSec = inp.timeSec;
      bs.lastLocalTime = t;
    }

    // CHIMERA articulators -> morphs, jaw bone, flush CRT screen, Tabby portals, AniCraft face
    const open = inp.artic ? clamp01(inp.artic.open) : 0;
    const jaw = inp.artic ? clamp01(inp.artic.jaw) : open;
    const round = inp.artic ? clamp01(inp.artic.round) : 0;
    const width = inp.artic ? clamp01(inp.artic.lipWidth) : 0.5;
    const closed = open <= 0.02 ? 1 : 0;

    for (const mesh of this.morphMeshes) {
      const dict = mesh.morphTargetDictionary!;
      const inf = mesh.morphTargetInfluences!;
      const setMorph = (names: readonly string[], v: number) => {
        for (const n of names) {
          const idx = dict[n];
          if (idx !== undefined) inf[idx] = v;
        }
      };
      setMorph(["jawOpen", "mouthOpen", "viseme_aa", "JawOpen", "MouthOpen"], open);
      setMorph(["mouthFunnel", "mouthPucker", "viseme_O", "viseme_U"], open > 0.02 ? round : 0);
      setMorph(["mouthSmile", "mouthStretch", "viseme_I"], open > 0.02 ? Math.max(0, width - 0.4) * 1.4 : 0);
      setMorph(["mouthClose", "viseme_PP"], closed);
    }

    if (this.jawBone) {
      const maxRad = ((this.spec.jawMaxDeg ?? 22) * Math.PI) / 180;
      this.jawBone.rotation.x = this.jawRestX + jaw * maxRad;
    }

    for (const drv of this.screenDrivers) {
      drv.sync(inp.artic, inp.singing, inp.timeSec, isZapClap ? "clap" : resolvedClip);
    }

    const baseOrder = zRenderOrder(inp.z);
    this.tabbyPortals?.sync(inp.tabbyFacial, isTabbyClap ? "clap" : resolvedClip, baseOrder);

    this.syncAniCraftFace(inp, baseOrder, resolvedClip, {
      isClankClap,
      isWattClap,
      isChipClap,
      isThrumClap,
      isZapClap,
    });

    const h = inp.worldHeight * (this.spec.scale ?? 1);
    const baseFloorY = inp.floorY ?? 0;
    const hopY = Math.max(0, inp.y - baseFloorY);
    const isOneShot = resolvedClip === "jump" || resolvedClip === "spin" || resolvedClip === "bow";
    const beatPhase = inp.beat * Math.PI * 2 + inp.phaseIndex * 0.7;
    const applySinGroove = inp.performing && !isOneShot && !inp.poseDrivenGroove;
    const grooveAmt = applySinGroove
      ? (0.5 - 0.5 * Math.cos(beatPhase)) * (inp.singing ? 0.024 : 0.014)
      : 0;
    const grooveSy = 1 - grooveAmt;
    const grooveSx = 1 / Math.sqrt(grooveSy);
    const grooveSway = applySinGroove ? Math.sin(beatPhase * 0.5) * (inp.singing ? 0.045 : 0.024) : 0;
    const breath = inp.poseDrivenGroove ? 1 : 1 + Math.sin(inp.timeSec * 2.1 + inp.phaseIndex) * 0.008;
    const yawRad = ((this.spec.yawOffsetDeg ?? 0) * Math.PI) / 180 + inp.rotY + (inp.facing < 0 ? -0.35 : 0);

    const bodySy = Math.max(0.2, h * inp.stretchY * breath * grooveSy);
    this.group.position.set(inp.x, baseFloorY, inp.z);
    this.bodyGroup.position.set(0, hopY + (this.spec.yOffset ?? 0), 0);
    this.bodyGroup.rotation.set(0, yawRad, inp.leanRad + grooveSway);
    this.bodyGroup.scale.set(h * inp.squashX * grooveSx, bodySy, h * grooveSx);
    this.root.position.set(this.bindRootX, this.bindRootY, this.bindRootZ);
    this.group.updateMatrixWorld(true);

    const sampleSideSole = (
      verts: readonly SoleVertSample[],
      bone: THREE.Object3D | null,
      soleOff: number,
    ): { minY: number; cx: number; cz: number } => {
      if (verts.length > 0) {
        let minY = Infinity;
        let sx = 0;
        let sz = 0;
        const v = this.tmpSoleVec;
        for (let i = 0; i < verts.length; i++) {
          const item = verts[i];
          const posAttr = item.mesh.geometry.getAttribute("position");
          v.fromBufferAttribute(posAttr, item.idx);
          item.mesh.applyBoneTransform(item.idx, v);
          v.applyMatrix4(item.mesh.matrixWorld);
          if (v.y < minY) minY = v.y;
          sx += v.x;
          sz += v.z;
        }
        return { minY, cx: sx / verts.length, cz: sz / verts.length };
      }
      if (bone) {
        bone.getWorldPosition(this.tmpSoleVec);
        return {
          minY: this.tmpSoleVec.y - soleOff * bodySy,
          cx: this.tmpSoleVec.x,
          cz: this.tmpSoleVec.z,
        };
      }
      return { minY: baseFloorY + hopY, cx: inp.x, cz: inp.z };
    };

    const soleL = sampleSideSole(this.soleVertsL, this.soleBoneL, this.soleOffsetL);
    const soleR = sampleSideSole(this.soleVertsR, this.soleBoneR, this.soleOffsetR);
    const minFootWorldY = Math.min(soleL.minY, soleR.minY);
    const isJumpClip = resolvedClip === "jump";
    let groundShiftWorldY = 0;
    if (hopY <= 0.004 && !isJumpClip && Number.isFinite(minFootWorldY)) {
      const deltaBodyY = clamp(-(minFootWorldY - baseFloorY) / bodySy, -0.22, 0.22);
      this.root.position.y = this.bindRootY + deltaBodyY;
      this.group.updateMatrixWorld(true);
      groundShiftWorldY = deltaBodyY * bodySy;
    }

    const liftL = Math.max(0, soleL.minY + groundShiftWorldY - baseFloorY);
    const liftR = Math.max(0, soleR.minY + groundShiftWorldY - baseFloorY);
    const footSpotR = clamp(h * 0.16, 0.17, 0.34);
    const footScaleL = clamp(1 - liftL * 0.9, 0.45, 1.0);
    const footScaleR = clamp(1 - liftR * 0.9, 0.45, 1.0);

    this.footShadowL.position.set(soleL.cx - inp.x, 0.002, soleL.cz - inp.z);
    this.footShadowL.scale.set(footSpotR * 1.45 * footScaleL, footSpotR * 1.15 * footScaleL, 1);
    this.footShadowL.renderOrder = baseOrder - 29;
    this.footShadowMatL.opacity = clamp(0.68 - liftL * 1.85, 0.04, 0.68);

    this.footShadowR.position.set(soleR.cx - inp.x, 0.002, soleR.cz - inp.z);
    this.footShadowR.scale.set(footSpotR * 1.45 * footScaleR, footSpotR * 1.15 * footScaleR, 1);
    this.footShadowR.renderOrder = baseOrder - 29;
    this.footShadowMatR.opacity = clamp(0.68 - liftR * 1.85, 0.04, 0.68);

    this.shadowMesh.position.set(
      (soleL.cx + soleR.cx) * 0.5 - inp.x,
      0.002,
      (soleL.cz + soleR.cz) * 0.5 - inp.z,
    );
    this.shadowMesh.renderOrder = baseOrder - 30;
    const shadowR = clamp(h * 0.28 * (1 - hopY * 0.2), 0.32, 0.76);
    this.shadowMesh.scale.set(shadowR * 2.15, shadowR * 1.4, 1);
    this.shadowMat.opacity = clamp(0.36 - hopY * 0.12, 0.08, 0.36);

    this.headAnchorPos.set(inp.x, baseFloorY + hopY + inp.worldHeight * 0.96, inp.z);
  }

  private syncAniCraftFace(
    inp: PerformerUpdateInput,
    baseOrder: number,
    resolvedClip: string,
    claps: {
      isClankClap: boolean;
      isWattClap: boolean;
      isChipClap: boolean;
      isThrumClap: boolean;
      isZapClap: boolean;
    },
  ): void {
    if (!this.faceMesh || !this.faceMat || !this.faceSheet) return;
    const tex = loadStageTexture(this.faceSheet.url) ?? null;
    const anyClap =
      claps.isClankClap || claps.isWattClap || claps.isChipClap || claps.isThrumClap || claps.isZapClap;
    const faceClip = anyClap ? "clap" : resolvedClip;
    const cell = selectAniCraftFaceCell(inp.artic, inp.singing, inp.timeSec, faceClip);
    const mouthOnly = Boolean(this.faceSheet.mouthOnly) && !this.isWattModel && !this.isChipModel;
    const uvRect = computeAniCraftCellUvRect(
      cell,
      this.faceSheet.cols,
      this.faceSheet.rows,
      mouthOnly,
      this.isClankModel ? "clank" : this.isWattModel ? "watt" : this.isChipModel ? "chip" : this.isCueModel,
    );
    this.faceMat.uniforms.uMap.value = tex;
    (this.faceMat.uniforms.uUvRect.value as THREE.Vector4).set(uvRect[0], uvRect[1], uvRect[2], uvRect[3]);
    const hideMouth =
      mouthOnly && ((!inp.singing && !claps.isThrumClap) || cell === 0 || (cell === 7 && !claps.isThrumClap));
    this.faceMesh.visible = Boolean(tex) && !hideMouth;
    this.faceMesh.renderOrder = baseOrder + 5;
    if (this.wattPlateMesh) {
      this.wattPlateMesh.visible = Boolean(tex);
      this.wattPlateMesh.renderOrder = baseOrder + 4;
    }
    if (this.chipEyeL && this.chipEyeR && this.chipEyeMatL && this.chipEyeMatR) {
      const blink = clamp01(naturalBlinkAmountAt(inp.timeSec, inp.singing));
      const happyEye =
        blink > 0.48 ||
        resolvedClip === "bow" ||
        resolvedClip === "jump" ||
        claps.isChipClap ||
        claps.isThrumClap;
      const eyeCell = happyEye ? 7 : 0;
      const cols = Math.max(1, this.faceSheet.cols);
      const rows = Math.max(1, this.faceSheet.rows);
      const col = eyeCell % cols;
      const row = Math.floor(eyeCell / cols);
      const cellU = col / cols;
      const cellV = 1 - (row + 1) / rows;
      const du = 1 / cols;
      const dv = 1 / rows;
      const uOffL = this.isThrumModel ? 0.535 : 0.55;
      const uOffR = this.isThrumModel ? 0.145 : 0.16;
      const vOff = this.isThrumModel ? 0.595 : 0.59;
      const uvSpan = this.isThrumModel ? 0.31 : 0.29;
      this.chipEyeMatL.uniforms.uMap.value = tex;
      (this.chipEyeMatL.uniforms.uUvRect.value as THREE.Vector4).set(
        cellU + du * uOffL,
        cellV + dv * vOff,
        du * uvSpan,
        dv * uvSpan,
      );
      this.chipEyeMatR.uniforms.uMap.value = tex;
      (this.chipEyeMatR.uniforms.uUvRect.value as THREE.Vector4).set(
        cellU + du * uOffR,
        cellV + dv * vOff,
        du * uvSpan,
        dv * uvSpan,
      );
      const showEyes = Boolean(tex);
      this.chipEyeL.visible = showEyes;
      this.chipEyeR.visible = showEyes;
      this.chipEyeL.renderOrder = baseOrder + 5;
      this.chipEyeR.renderOrder = baseOrder + 5;
      if (this.chipLidL && this.chipLidR) {
        this.chipLidL.visible = showEyes;
        this.chipLidR.visible = showEyes;
        this.chipLidL.renderOrder = baseOrder + 4;
        this.chipLidR.renderOrder = baseOrder + 4;
      }
    }
    const openBoostY =
      inp.singing && inp.artic && inp.artic.open > 0.05
        ? 1 + clamp01(inp.artic.open) * (this.isChipModel ? 0.16 : mouthOnly ? 0.14 : 0.06)
        : 1;
    const faceW = this.isCueModel
      ? 0.168
      : this.isClankModel
        ? 0.182
        : this.isWattModel
          ? 0.102
          : this.isChipModel
            ? 0.098
            : this.isThrumModel
              ? 0.162
              : this.faceSheet.width;
    const faceH = this.isCueModel
      ? 0.114
      : this.isClankModel
        ? 0.15
        : this.isWattModel
          ? 0.096
          : this.isChipModel
            ? 0.078
            : this.isThrumModel
              ? 0.092
              : this.faceSheet.height;
    this.faceMesh.scale.set(faceW, faceH * openBoostY, 1);
  }

  getHeadWorldPos(out: THREE.Vector3): THREE.Vector3 {
    return out.copy(this.headAnchorPos);
  }

  dispose(): void {
    this.mixer.stopAllAction();
    for (const d of this.screenDrivers) d.dispose();
    this.faceMat?.dispose();
    this.wattPlateMat?.alphaMap?.dispose();
    this.wattPlateMat?.dispose();
    this.chipEyeMatL?.dispose();
    this.chipEyeMatR?.dispose();
    this.chipLidMat?.alphaMap?.dispose();
    this.chipLidMat?.dispose();
    this.shadowMat.dispose();
    this.footShadowMatL.dispose();
    this.footShadowMatR.dispose();
  }
}

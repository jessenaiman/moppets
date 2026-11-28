/**
 * Tier 2: Articulated 2.5D Multiplane Rig (`MultiplanePerformer3D` / `MultiplaneActor3D`)
 * with Z-layered depth separation, IK kinematics, braided hose limbs, and live overlays.
 */
import * as THREE from "three";
import type { HoseDeformSpec, MultiplaneNodeSpec, MultiplaneRigSpec } from "../../choir/castManifest.ts";
import {
  evaluateHoseOffset,
  evaluateMultiplanePose,
  type EvaluatedMultiplanePose,
} from "../multiplaneKinematics.ts";
import { UNIT_PLANE_GEO } from "../stageGeometries.ts";
import { createSoftGlowTexture, loadStageTexture } from "../stageTextures.ts";
import {
  clamp,
  createContactShadowMesh,
  createMultiplaneDepthMaterial,
  getReadyImageDimensions,
  getTextureOpaqueBounds,
  zRenderOrder,
  type PerformerUpdateInput,
  type StageActor3D,
} from "./actorShared.ts";
import { MultiplaneOverlayRig } from "./multiplaneOverlays.ts";

interface MultiplaneNodeVisual {
  readonly spec: MultiplaneNodeSpec;
  readonly group: THREE.Group;
  readonly mesh: THREE.Mesh | null;
  readonly mat: THREE.MeshBasicMaterial | null;
  readonly depthMat: THREE.MeshDepthMaterial | null;
  readonly hoseGeo: THREE.PlaneGeometry | null;
  readonly hoseBasePos: Float32Array | null;
}

export class MultiplanePerformer3D implements StageActor3D {
  readonly group = new THREE.Group();
  private readonly rigRoot = new THREE.Group();
  private readonly shadowMesh: THREE.Mesh;
  private readonly shadowMat: THREE.MeshBasicMaterial;
  private readonly glowMesh: THREE.Mesh;
  private readonly glowMat: THREE.MeshBasicMaterial;
  private readonly nodeVisuals = new Map<number, MultiplaneNodeVisual>();
  private readonly overlays: MultiplaneOverlayRig;
  private readonly restPose: EvaluatedMultiplanePose;
  private restOpaqueMinY = 0;
  private measuredReadyCount = -1;
  private readonly effectiveRigHeightPx: number = 920;
  private readonly effectiveRigWidthPx: number = 680;
  private readonly headAnchorPos = new THREE.Vector3();

  constructor(private readonly rig: MultiplaneRigSpec) {
    const restPose = evaluateMultiplanePose(rig, {
      beat: 0,
      timeSec: 0,
      singing: false,
      level: 0,
      mouthOpen: false,
      gagActive: false,
      phaseIndex: 0,
      still: true,
    });
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const n of rig.nodes) {
      if (n.sourceType !== "Footage" || !n.publicSrc || n.width <= 0 || n.height <= 0) continue;
      const np = restPose.byId.get(n.id);
      if (!np) continue;
      const ancX = n.anchor[0] ?? 0;
      const ancY = n.anchor[1] ?? 0;
      const left = -ancX;
      const right = n.width - ancX;
      const top = ancY;
      const bottom = ancY - n.height;
      const m = np.worldMat;
      for (const [lx, ly] of [
        [left, top],
        [right, top],
        [left, bottom],
        [right, bottom],
      ]) {
        const wx = m.a * lx + m.c * ly + m.tx;
        const wy = m.b * lx + m.d * ly + m.ty;
        if (wx < minX) minX = wx;
        if (wx > maxX) maxX = wx;
        if (wy < minY) minY = wy;
        if (wy > maxY) maxY = wy;
      }
    }
    this.restPose = restPose;
    if (Number.isFinite(minY) && Number.isFinite(maxY) && maxY - minY > 80) {
      const spanY = maxY - minY;
      this.effectiveRigHeightPx = spanY < 620 ? clamp(spanY * 1.18, 520, 920) : 920;
    }
    if (Number.isFinite(minX) && Number.isFinite(maxX) && maxX - minX > 80) {
      this.effectiveRigWidthPx = clamp(maxX - minX, 340, 860);
    }

    const contactShadow = createContactShadowMesh(0.72);
    this.shadowMesh = contactShadow.mesh;
    this.shadowMat = contactShadow.mat;
    this.shadowMesh.renderOrder = 155;
    this.group.add(this.shadowMesh);

    const glowTex = createSoftGlowTexture("rgba(255,255,255,0.6)", "rgba(255,255,255,0.15)");
    this.glowMat = new THREE.MeshBasicMaterial({
      map: glowTex ?? undefined,
      color: "#ffd080",
      transparent: true,
      opacity: 0,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    this.glowMesh = new THREE.Mesh(UNIT_PLANE_GEO, this.glowMat);
    this.glowMesh.rotation.x = -Math.PI / 2;
    this.glowMesh.position.set(0, 0.003, 0);
    this.glowMesh.renderOrder = 158;
    this.group.add(this.glowMesh);

    this.group.add(this.rigRoot);

    for (const n of rig.nodes) {
      const grp = new THREE.Group();
      let mesh: THREE.Mesh | null = null;
      let mat: THREE.MeshBasicMaterial | null = null;
      let depthMat: THREE.MeshDepthMaterial | null = null;
      let hoseGeo: THREE.PlaneGeometry | null = null;
      let hoseBasePos: Float32Array | null = null;

      if (n.sourceType === "Footage" && n.publicSrc && n.width > 0 && n.height > 0) {
        const tex = loadStageTexture(n.publicSrc) ?? null;
        mat = new THREE.MeshBasicMaterial({
          map: tex,
          transparent: true,
          alphaTest: 0.03,
          depthWrite: false,
          side: THREE.DoubleSide,
          toneMapped: false,
        });
        depthMat = createMultiplaneDepthMaterial(tex);
        const ancX = n.anchor[0] ?? 0;
        const ancY = n.anchor[1] ?? 0;
        const cx = n.width / 2 - ancX;
        const cy = -(n.height / 2 - ancY);
        const meshZ = n.zPx * 0.18;

        if (n.hoseDeform) {
          hoseGeo = new THREE.PlaneGeometry(n.width, n.height, 14, 4);
          const posAttr = hoseGeo.getAttribute("position") as THREE.BufferAttribute;
          hoseBasePos = new Float32Array(posAttr.array.length);
          hoseBasePos.set(posAttr.array as Float32Array);
          mesh = new THREE.Mesh(hoseGeo, mat);
          mesh.position.set(cx, cy, meshZ);
        } else {
          mesh = new THREE.Mesh(UNIT_PLANE_GEO, mat);
          mesh.position.set(cx, cy, meshZ);
          mesh.scale.set(n.width, n.height, 1);
        }
        mesh.castShadow = true;
        mesh.customDepthMaterial = depthMat;
        grp.add(mesh);
      }

      this.nodeVisuals.set(n.id, { spec: n, group: grp, mesh, mat, depthMat, hoseGeo, hoseBasePos });
    }

    for (const n of rig.nodes) {
      const entry = this.nodeVisuals.get(n.id)!;
      if (n.parent !== null && this.nodeVisuals.has(n.parent)) {
        this.nodeVisuals.get(n.parent)!.group.add(entry.group);
      } else {
        this.rigRoot.add(entry.group);
      }
    }

    this.overlays = new MultiplaneOverlayRig(rig, this.nodeVisuals);
    this.recomputeRestOpaqueMinY();
  }

  private updateHose(entry: MultiplaneNodeVisual, hose: HoseDeformSpec, bendPx: number): void {
    if (!entry.hoseGeo || !entry.hoseBasePos) return;
    const posAttr = entry.hoseGeo.getAttribute("position") as THREE.BufferAttribute;
    const arr = posAttr.array as Float32Array;
    const base = entry.hoseBasePos;
    const w = Math.max(1, entry.spec.width);
    const h = Math.max(1, entry.spec.height);

    for (let i = 0; i < posAttr.count; i++) {
      const bx = base[i * 3];
      const by = base[i * 3 + 1];
      const u =
        hose.axis === "x-right"
          ? (bx + w * 0.5) / w
          : hose.axis === "x-left"
            ? (w * 0.5 - bx) / w
            : (h * 0.5 - by) / h;
      const offset = evaluateHoseOffset(entry.spec, bendPx, u);
      arr[i * 3] = bx + offset.dx;
      arr[i * 3 + 1] = by + offset.dy;
    }
    posAttr.needsUpdate = true;
  }

  private recomputeRestOpaqueMinY(): void {
    let readyCount = 0;
    for (const entry of this.nodeVisuals.values()) {
      if (getReadyImageDimensions(entry.mat?.map?.image)) {
        readyCount++;
      }
    }
    if (readyCount === this.measuredReadyCount) return;
    this.measuredReadyCount = readyCount;

    let minOpaqueY = Infinity;
    for (const n of this.rig.nodes) {
      if (n.sourceType !== "Footage" || !n.publicSrc || n.width <= 0 || n.height <= 0) continue;
      const np = this.restPose.byId.get(n.id);
      if (!np || !np.visible) continue;
      const entry = this.nodeVisuals.get(n.id);
      const tex = entry?.mat?.map ?? loadStageTexture(n.publicSrc) ?? null;
      const bounds = getTextureOpaqueBounds(tex) ?? { minXNorm: 0, maxXNorm: 1, topNorm: 0, bottomNorm: 1 };
      const ancX = n.anchor[0] ?? 0;
      const ancY = n.anchor[1] ?? 0;
      const left = -ancX + bounds.minXNorm * n.width;
      const right = -ancX + bounds.maxXNorm * n.width;
      const top = ancY - bounds.topNorm * n.height;
      const bottom = ancY - bounds.bottomNorm * n.height;
      const m = np.worldMat;
      for (const [lx, ly] of [
        [left, top],
        [right, top],
        [left, bottom],
        [right, bottom],
      ]) {
        const wy = m.b * lx + m.d * ly + m.ty;
        if (wy < minOpaqueY) minOpaqueY = wy;
      }
    }
    if (Number.isFinite(minOpaqueY)) {
      this.restOpaqueMinY = minOpaqueY;
    }
  }

  update(inp: PerformerUpdateInput): void {
    const playingInstrument = !inp.singing && inp.performing && inp.level > 0.05;
    const pose = evaluateMultiplanePose(this.rig, {
      beat: inp.beat,
      timeSec: inp.timeSec,
      singing: inp.singing,
      playingInstrument,
      level: inp.level,
      mouthOpen: inp.mouthOpen,
      gagActive: inp.gagActive,
      phaseIndex: inp.phaseIndex,
      still: false,
      actionClip: inp.actionClip,
      actionElapsedSec: inp.actionElapsedSec,
    });

    const baseOrder = zRenderOrder(inp.z);

    for (const entry of this.nodeVisuals.values()) {
      const np = pose.byId.get(entry.spec.id);
      if (!np) continue;
      entry.group.position.set(np.localX, np.localY, 0);
      entry.group.scale.set(np.scaleX, np.scaleY, 1);
      entry.group.rotation.set(0, 0, np.rotZ);
      entry.group.visible = np.visible;

      if (entry.mat && entry.spec.publicSrc) {
        const tex = loadStageTexture(entry.spec.publicSrc);
        if (tex && entry.mat.map !== tex) {
          entry.mat.map = tex;
          entry.mat.needsUpdate = true;
          if (entry.depthMat) {
            entry.depthMat.map = tex;
            entry.depthMat.needsUpdate = true;
          }
        }
      }
      if (entry.mesh) {
        entry.mesh.renderOrder = baseOrder + Math.round(entry.spec.zPx * 0.5);
      }
      if (entry.spec.hoseDeform) {
        this.updateHose(entry, entry.spec.hoseDeform, np.hoseBendPx);
      }
    }
    this.recomputeRestOpaqueMinY();

    this.overlays.update(inp, pose, baseOrder);

    const baseFloorY = inp.floorY ?? 0;
    const rigScale = inp.worldHeight / this.effectiveRigHeightPx;
    const hopY = Math.max(0, inp.y - baseFloorY) + (pose.rootHopPx ?? 0) * rigScale;
    const approxW = clamp(this.effectiveRigWidthPx * rigScale, 0.72, 2.05);
    this.group.position.set(inp.x, baseFloorY, inp.z);
    this.shadowMesh.renderOrder = baseOrder - 45;
    const shadowScale = clamp(1 - hopY * 0.28, 0.72, 1);
    this.shadowMesh.scale.set(approxW * 0.88 * shadowScale, approxW * 0.52 * shadowScale, 1);
    this.shadowMat.opacity = clamp(0.72 * (1 - hopY * 0.38), 0.14, 0.72);
    this.glowMesh.renderOrder = baseOrder - 42;
    this.glowMesh.visible = inp.level > 0.08;
    this.glowMesh.scale.set(approxW * 0.92, approxW * 0.54, 1);
    this.glowMat.color.set(inp.accentColor);
    this.glowMat.opacity = clamp(inp.level * 0.42, 0, 0.42);

    this.rigRoot.position.set(0, hopY - this.restOpaqueMinY * rigScale * inp.stretchY, 0);
    this.rigRoot.scale.set(
      rigScale * (inp.facing < 0 ? -1 : 1) * inp.squashX,
      rigScale * inp.stretchY,
      rigScale,
    );
    this.rigRoot.rotation.set(0, inp.rotY, inp.leanRad);
    const restingHopY = Math.max(0, inp.y - baseFloorY);
    this.headAnchorPos.set(inp.x, baseFloorY + restingHopY + inp.worldHeight * 0.96, inp.z);
  }

  getHeadWorldPos(out: THREE.Vector3): THREE.Vector3 {
    return out.copy(this.headAnchorPos);
  }

  dispose(): void {
    for (const e of this.nodeVisuals.values()) {
      e.mat?.dispose();
      e.depthMat?.dispose();
      e.hoseGeo?.dispose();
    }
    this.overlays.dispose();
    this.shadowMat.dispose();
    this.glowMat.dispose();
  }
}

export { MultiplanePerformer3D as MultiplaneActor3D };

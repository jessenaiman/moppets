/**
 * Unified 3-tier stage actor lifecycle manager & factory (`StageActorsManager`, `createStageActor3D`).
 */
import * as THREE from "three";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { canonicalCastId } from "../../choir/castManifest.ts";
import { hasGltfFailed, loadCachedGltf, type PerformerUpdateInput, type StageActor3D } from "./actorShared.ts";
import { AtlasPerformer3D } from "./fmvCutoutActor3D.ts";
import { GlbPerformer3D } from "./glbPerformer3D.ts";
import { MultiplanePerformer3D } from "./multiplaneActor3D.ts";

interface ManagedActorSlot {
  readonly key: string;
  voiceId: string;
  castId: string;
  tier: "glb" | "multiplane" | "atlas";
  specKey: string;
  actor: StageActor3D;
}

export function createStageActor3D(
  tier: "glb" | "multiplane" | "atlas",
  inp: PerformerUpdateInput,
  loadedGltf?: GLTF | null,
): StageActor3D {
  if (tier === "glb" && inp.manifest?.model3d && loadedGltf) {
    return new GlbPerformer3D(inp.manifest.model3d, loadedGltf);
  }
  if (tier === "multiplane" && inp.manifest?.multiplane) {
    return new MultiplanePerformer3D(inp.manifest.multiplane);
  }
  return new AtlasPerformer3D(inp.worldId);
}

export class StageActorsManager {
  readonly root = new THREE.Group();
  private readonly slots = new Map<string, ManagedActorSlot>();
  private readonly headAnchors = new Map<string, { voiceId: string; castId: string; pos: THREE.Vector3 }>();

  constructor(private readonly scene: THREE.Scene) {
    scene.add(this.root);
  }

  /** Sync every visible performer cleanly, returning active render tier summary for HUD badge. */
  syncAll(inputs: readonly PerformerUpdateInput[]): { glbCount: number; multiplaneCount: number; atlasCount: number } {
    const activeKeys = new Set<string>();
    let glbCount = 0;
    let multiplaneCount = 0;
    let atlasCount = 0;

    for (const inp of inputs) {
      activeKeys.add(inp.key);
      const voiceId = inp.key.includes(":") ? inp.key.slice(0, inp.key.indexOf(":")) : inp.key;
      const baseFloorY = inp.floorY ?? 0;
      const restingHopY = Math.max(0, inp.y - baseFloorY);
      let anchorEntry = this.headAnchors.get(inp.key);
      if (!anchorEntry) {
        anchorEntry = { voiceId, castId: inp.castId, pos: new THREE.Vector3() };
        this.headAnchors.set(inp.key, anchorEntry);
      } else {
        anchorEntry.voiceId = voiceId;
        anchorEntry.castId = inp.castId;
      }
      anchorEntry.pos.set(inp.x, baseFloorY + restingHopY + inp.worldHeight * 0.96, inp.z);

      const m = inp.manifest;
      const wantsMultiplane =
        Boolean(m?.multiplane) && (inp.rigPreference === "multiplane-first" || !m?.model3d);
      const wantsGlb = Boolean(m?.model3d) && !wantsMultiplane;

      let chosenTier: "glb" | "multiplane" | "atlas" = "atlas";
      let specKey = `atlas:${inp.castId}`;
      let loadedGltf: GLTF | null = null;

      if (wantsGlb && m?.model3d) {
        loadedGltf = loadCachedGltf(m.model3d.url);
        if (loadedGltf) {
          chosenTier = "glb";
          specKey = `glb:${m.model3d.url}`;
        } else if (!hasGltfFailed(m.model3d.url)) {
          // Wait cleanly while preferred .glb loads so performers never pop from a mismatched Multiplane/Atlas costume mid-act.
          const existing = this.slots.get(inp.key);
          if (!existing) continue;
          chosenTier = existing.tier;
          specKey = existing.specKey;
        } else if (m.multiplane) {
          chosenTier = "multiplane";
          specKey = `mp:${m.multiplane.id}`;
        }
      } else if (wantsMultiplane && m?.multiplane) {
        chosenTier = "multiplane";
        specKey = `mp:${m.multiplane.id}`;
      }

      let slot = this.slots.get(inp.key);
      if (slot && (slot.tier !== chosenTier || slot.specKey !== specKey)) {
        this.removeSlot(slot);
        slot = undefined;
      }

      if (!slot) {
        const actor = createStageActor3D(chosenTier, inp, loadedGltf);
        this.root.add(actor.group);
        slot = { key: inp.key, voiceId, castId: inp.castId, tier: chosenTier, specKey, actor };
        this.slots.set(inp.key, slot);
      } else {
        slot.voiceId = voiceId;
        slot.castId = inp.castId;
      }

      slot.actor.group.visible = true;
      slot.actor.update(inp);
      if (slot.tier === "glb") glbCount++;
      else if (slot.tier === "multiplane") multiplaneCount++;
      else atlasCount++;
    }

    for (const [k, slot] of this.slots.entries()) {
      if (!activeKeys.has(k)) {
        this.removeSlot(slot);
        this.slots.delete(k);
      }
    }
    for (const k of this.headAnchors.keys()) {
      if (!activeKeys.has(k)) this.headAnchors.delete(k);
    }

    return { glbCount, multiplaneCount, atlasCount };
  }

  /**
   * Resolve resting/smoothed crown world position `(x, floorY + hopY + worldHeight * 0.96, z)`
   * for a performer matched by slot key, `voiceId`, or `castId` (never micro-jitters).
   */
  getHeadWorldPos(key: string, out: THREE.Vector3): boolean {
    const canon = canonicalCastId(key);
    const exact = this.slots.get(key);
    if (exact) {
      exact.actor.getHeadWorldPos(out);
      return true;
    }
    for (const slot of this.slots.values()) {
      if (
        slot.voiceId === key ||
        slot.castId === key ||
        slot.castId === canon ||
        canonicalCastId(slot.voiceId) === canon
      ) {
        slot.actor.getHeadWorldPos(out);
        return true;
      }
    }
    const anchorExact = this.headAnchors.get(key);
    if (anchorExact) {
      out.copy(anchorExact.pos);
      return true;
    }
    for (const anchor of this.headAnchors.values()) {
      if (
        anchor.voiceId === key ||
        anchor.castId === key ||
        anchor.castId === canon ||
        canonicalCastId(anchor.voiceId) === canon
      ) {
        out.copy(anchor.pos);
        return true;
      }
    }
    return false;
  }

  private removeSlot(slot: ManagedActorSlot): void {
    this.root.remove(slot.actor.group);
    slot.actor.dispose();
  }

  dispose(): void {
    for (const slot of this.slots.values()) {
      this.removeSlot(slot);
    }
    this.slots.clear();
    this.scene.remove(this.root);
  }
}

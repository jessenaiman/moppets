/**
 * Interactive 3D Stage Props Manager (`WorldPropsManager`) for all 5 stage worlds:
 * `beat-pad`, `hanging-chime`, `glass-ripple`, `lunar-disc`, `cosmic-orb`,
 * `xylo-tile`, `toy-ball`, and `pinwheel`.
 */
import * as THREE from "three";
import type { StagePropState } from "../stageAutopilot.ts";
import {
  UNIT_BOX_GEO,
  UNIT_CIRCLE_GEO,
  UNIT_CONE_SHADE_GEO,
  UNIT_CYLINDER_BASE_GEO,
  UNIT_CYLINDER_DISC_GEO,
  UNIT_CYLINDER_GEO,
  UNIT_ICO_GEO,
  UNIT_PLANE_GEO,
  UNIT_RING_MED_GEO,
  UNIT_RING_THIN_GEO,
  UNIT_SPHERE_GEO,
  UNIT_TORUS_ORB_GEO,
  UNIT_TORUS_STRIPE_GEO,
} from "../stageGeometries.ts";
import { clamp } from "./worldLightingAndMaterials.ts";

interface DynamicPropEntry {
  readonly kind: StagePropState["kind"];
  readonly group: THREE.Group;
  readonly sync: (prop: StagePropState, timeSec: number, lightingEnabled: boolean) => void;
}

export class WorldPropsManager {
  readonly group = new THREE.Group();
  private readonly entries = new Map<string, DynamicPropEntry>();

  constructor(private readonly softGlowTex: THREE.CanvasTexture | null) {}

  syncAll(props: readonly StagePropState[], timeSec: number, lightingEnabled: boolean): void {
    const activeIds = new Set<string>();
    for (const p of props) {
      activeIds.add(p.id);
      const entry = this.getOrCreateProp(p);
      if (entry) {
        entry.group.visible = true;
        entry.sync(p, timeSec, lightingEnabled);
      }
    }
    for (const [id, entry] of this.entries.entries()) {
      if (!activeIds.has(id)) {
        entry.group.visible = false;
      }
    }
  }

  private getOrCreateProp(prop: StagePropState): DynamicPropEntry | null {
    const existing = this.entries.get(prop.id);
    if (existing && existing.kind === prop.kind) return existing;
    if (existing) {
      this.group.remove(existing.group);
      this.entries.delete(prop.id);
    }

    const group = new THREE.Group();
    let entry: DynamicPropEntry | null = null;

    if (prop.kind === "beat-pad") {
      const rim = new THREE.Mesh(
        UNIT_RING_MED_GEO,
        new THREE.MeshStandardMaterial({ color: "#b68846", metalness: 0.72, roughness: 0.3 }),
      );
      rim.rotation.x = -Math.PI / 2;
      rim.position.y = 0.004;
      group.add(rim);

      const coreMat = new THREE.MeshStandardMaterial({
        color: prop.color,
        emissive: prop.color,
        emissiveIntensity: 0.4,
        roughness: 0.35,
      });
      const core = new THREE.Mesh(UNIT_CYLINDER_DISC_GEO, coreMat);
      core.scale.set(prop.radius * 0.86, 0.036, prop.radius * 0.86);
      core.receiveShadow = true;
      group.add(core);

      const rippleMat = new THREE.MeshBasicMaterial({
        color: prop.color,
        transparent: true,
        opacity: 0.35,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      });
      const ripple = new THREE.Mesh(UNIT_RING_THIN_GEO, rippleMat);
      ripple.rotation.x = -Math.PI / 2;
      ripple.position.y = 0.025;
      group.add(ripple);

      entry = {
        kind: prop.kind,
        group,
        sync: (p, _t, lit) => {
          group.position.set(p.x, 0.018 - p.compression * 0.04, p.z);
          rim.scale.set(p.radius, p.radius, 1);
          coreMat.emissiveIntensity = lit ? 0.28 + p.energy * 1.15 : 0.12;
          const rs = p.radius * (1.06 + (1 - p.energy) * 0.68);
          ripple.scale.set(rs, rs, 1);
          rippleMat.opacity = lit ? clamp(0.14 + p.energy * 0.62, 0, 0.8) : 0.1;
        },
      };
    } else if (prop.kind === "hanging-chime") {
      const cord = new THREE.Mesh(
        UNIT_CYLINDER_GEO,
        new THREE.MeshStandardMaterial({ color: "#7a5e3b", metalness: 0.6, roughness: 0.4 }),
      );
      cord.position.y = -0.6;
      cord.scale.set(0.012, 1.2, 0.012);
      group.add(cord);

      const bellMat = new THREE.MeshStandardMaterial({
        color: "#e6c178",
        metalness: 0.85,
        roughness: 0.22,
        emissive: prop.color,
        emissiveIntensity: 0.2,
      });
      const bell = new THREE.Mesh(UNIT_CONE_SHADE_GEO, bellMat);
      bell.position.y = -1.25;
      bell.scale.set(0.16, 0.28, 0.16);
      bell.castShadow = true;
      group.add(bell);

      entry = {
        kind: prop.kind,
        group,
        sync: (p, _t, lit) => {
          group.position.set(p.x, p.y + 1.25, p.z);
          group.rotation.z = p.rotZ;
          bellMat.emissiveIntensity = lit ? 0.18 + p.energy * 0.95 : 0.08;
        },
      };
    } else if (prop.kind === "glass-ripple") {
      const outerMat = new THREE.MeshBasicMaterial({
        color: prop.color,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      });
      const outer = new THREE.Mesh(UNIT_RING_THIN_GEO, outerMat);
      group.add(outer);

      const innerMat = new THREE.MeshBasicMaterial({
        color: "#ffffff",
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      });
      const inner = new THREE.Mesh(UNIT_RING_THIN_GEO, innerMat);
      group.add(inner);

      entry = {
        kind: prop.kind,
        group,
        sync: (p) => {
          group.visible = p.energy > 0.08;
          group.position.set(p.x, p.y, p.z);
          const outerR = p.radius * (0.45 + (1 - p.energy) * 1.1);
          const innerR = outerR * 0.65;
          outer.scale.set(outerR, outerR, 1);
          inner.scale.set(innerR, innerR, 1);
          outerMat.opacity = p.energy * 0.65;
          innerMat.opacity = p.energy * 0.44;
        },
      };
    } else if (prop.kind === "lunar-disc") {
      const discMat = new THREE.MeshStandardMaterial({
        color: "#1a2142",
        metalness: 0.42,
        roughness: 0.55,
        emissive: "#253b6e",
        emissiveIntensity: 0.35,
      });
      const disc = new THREE.Mesh(UNIT_CYLINDER_DISC_GEO, discMat);
      disc.receiveShadow = true;
      group.add(disc);

      const runeMat = new THREE.MeshBasicMaterial({
        color: "#64f0d8",
        transparent: true,
        opacity: 0.55,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      });
      const rune = new THREE.Mesh(UNIT_RING_THIN_GEO, runeMat);
      rune.position.y = 0.064;
      group.add(rune);

      entry = {
        kind: prop.kind,
        group,
        sync: (p, _t, lit) => {
          group.position.set(p.x, -0.06, p.z);
          group.rotation.z = p.rotZ;
          disc.scale.set(p.radius, 0.12, p.radius);
          discMat.emissiveIntensity = lit ? 0.35 + p.energy * 0.4 : 0.15;
          rune.rotation.set(-Math.PI / 2, 0, p.rotY);
          rune.scale.set(p.radius * 0.99, p.radius * 0.99, 1);
          runeMat.opacity = lit ? 0.55 + p.energy * 0.35 : 0.25;
        },
      };
    } else if (prop.kind === "cosmic-orb") {
      const coreMat = new THREE.MeshStandardMaterial({
        color: prop.color,
        metalness: 0.28,
        roughness: 0.18,
        emissive: prop.color,
        emissiveIntensity: 0.55,
      });
      const core = new THREE.Mesh(UNIT_ICO_GEO, coreMat);
      group.add(core);

      const ringMat = new THREE.MeshBasicMaterial({
        color: "#ffffff",
        transparent: true,
        opacity: 0.52,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      });
      const ring = new THREE.Mesh(UNIT_TORUS_ORB_GEO, ringMat);
      group.add(ring);

      let aura: THREE.Mesh | null = null;
      let auraMat: THREE.MeshBasicMaterial | null = null;
      if (this.softGlowTex) {
        auraMat = new THREE.MeshBasicMaterial({
          map: this.softGlowTex,
          color: prop.color,
          transparent: true,
          opacity: 0.38,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          toneMapped: false,
        });
        aura = new THREE.Mesh(UNIT_PLANE_GEO, auraMat);
        aura.position.z = -0.04;
        group.add(aura);
      }

      entry = {
        kind: prop.kind,
        group,
        sync: (p, _t, lit) => {
          const pulse = 1 + p.energy * 0.26;
          const coreR = p.radius * 0.68 * pulse;
          const ringR = p.radius * 1.02 * pulse;
          group.position.set(p.x, p.y, p.z);
          core.rotation.set(0.4, p.rotY, 0.2);
          core.scale.setScalar(coreR);
          coreMat.emissiveIntensity = lit ? 0.55 + p.energy * 1.15 : 0.2;
          ring.rotation.set(Math.PI * 0.38, p.rotY * 1.4, 0.3);
          ring.scale.setScalar(ringR);
          ringMat.opacity = lit ? 0.52 + p.energy * 0.42 : 0.25;
          if (aura && auraMat) {
            aura.visible = lit;
            const s = p.radius * 4.4 * pulse;
            aura.scale.set(s, s, 1);
            auraMat.opacity = clamp(0.38 + p.energy * 0.45, 0, 0.85);
          }
        },
      };
    } else if (prop.kind === "xylo-tile") {
      const tileMat = new THREE.MeshStandardMaterial({
        color: prop.color,
        roughness: 0.42,
        metalness: 0.08,
        emissive: prop.color,
        emissiveIntensity: 0,
      });
      const tile = new THREE.Mesh(UNIT_BOX_GEO, tileMat);
      tile.scale.set(0.98, 0.08, 0.92);
      tile.receiveShadow = true;
      group.add(tile);

      const pinMat = new THREE.MeshStandardMaterial({ color: "#f5e6cc", metalness: 0.65, roughness: 0.3 });
      for (const pz of [-0.32, 0.32]) {
        const pin = new THREE.Mesh(UNIT_CYLINDER_GEO, pinMat);
        pin.position.set(0, 0.045, pz);
        pin.scale.set(0.045, 0.02, 0.045);
        group.add(pin);
      }

      entry = {
        kind: prop.kind,
        group,
        sync: (p, _t, lit) => {
          group.position.set(p.x, 0.04 - p.compression * 0.065, p.z);
          tileMat.emissiveIntensity = lit ? p.energy * 0.58 : 0;
        },
      };
    } else if (prop.kind === "toy-ball") {
      const shadowMat = new THREE.MeshBasicMaterial({
        color: "#2a160c",
        transparent: true,
        opacity: 0.4,
        depthWrite: false,
      });
      const shadow = new THREE.Mesh(UNIT_CIRCLE_GEO, shadowMat);
      shadow.rotation.x = -Math.PI / 2;
      group.add(shadow);

      const ballMat = new THREE.MeshStandardMaterial({
        color: prop.color,
        roughness: 0.35,
        metalness: 0.05,
        emissive: "#ffd166",
        emissiveIntensity: 0,
      });
      const ball = new THREE.Mesh(UNIT_SPHERE_GEO, ballMat);
      ball.castShadow = true;
      group.add(ball);

      const stripe = new THREE.Mesh(
        UNIT_TORUS_STRIPE_GEO,
        new THREE.MeshStandardMaterial({ color: "#ffe066", roughness: 0.3 }),
      );
      group.add(stripe);

      entry = {
        kind: prop.kind,
        group,
        sync: (p, t, lit) => {
          group.position.set(p.x, p.y, p.z);
          const sr = p.radius * clamp(1 - p.y * 0.16, 0.35, 1.05);
          shadow.position.set(0, -p.y + 0.015, 0);
          shadow.scale.set(sr, sr, 1);
          shadowMat.opacity = clamp(0.45 - p.y * 0.09, 0.08, 0.45);
          ball.rotation.set(0.3, t * 1.1, p.rotZ);
          ball.scale.setScalar(p.radius);
          ballMat.emissiveIntensity = lit ? p.energy * 0.42 : 0;
          stripe.rotation.set(0.3, t * 1.1, p.rotZ);
          stripe.scale.setScalar(p.radius * 0.99);
        },
      };
    } else if (prop.kind === "pinwheel") {
      const stick = new THREE.Mesh(
        UNIT_CYLINDER_GEO,
        new THREE.MeshStandardMaterial({ color: "#d4a373", roughness: 0.7 }),
      );
      group.add(stick);
      const base = new THREE.Mesh(
        UNIT_CYLINDER_BASE_GEO,
        new THREE.MeshStandardMaterial({ color: "#bc8a5f", roughness: 0.65 }),
      );
      base.position.y = 0.04;
      base.scale.set(0.3, 0.08, 0.3);
      group.add(base);

      const hub = new THREE.Group();
      const colors = ["#ff6b6b", "#ffd166", "#51cf96", "#4dabf7"];
      colors.forEach((c, i) => {
        const blade = new THREE.Mesh(UNIT_BOX_GEO, new THREE.MeshStandardMaterial({ color: c, roughness: 0.45 }));
        blade.rotation.z = (i * Math.PI) / 2;
        blade.scale.set(0.42, 0.14, 0.025);
        hub.add(blade);
      });
      const pin = new THREE.Mesh(
        UNIT_SPHERE_GEO,
        new THREE.MeshStandardMaterial({ color: "#fff3d6", roughness: 0.3 }),
      );
      pin.position.z = 0.03;
      pin.scale.setScalar(0.075);
      hub.add(pin);
      group.add(hub);

      entry = {
        kind: prop.kind,
        group,
        sync: (p) => {
          group.position.set(p.x, 0, p.z);
          stick.position.y = p.y * 0.5;
          stick.scale.set(0.04, p.y, 0.04);
          hub.position.set(0, p.y, 0.05);
          hub.rotation.z = p.rotZ;
        },
      };
    }

    if (entry) {
      this.group.add(group);
      this.entries.set(prop.id, entry);
    }
    return entry;
  }
}

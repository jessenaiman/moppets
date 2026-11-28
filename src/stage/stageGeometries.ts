/**
 * Shared immutable unit Three.js geometries & stable canvas constants (`S-2`).
 *
 * React Three Fiber destroys and reallocates a GPU BufferGeometry whenever an inline
 * `args={[...]}` array reference changes on render. Reusing module-level unit geometries
 * and sizing meshes via `scale` / `position` / shader uniforms eliminates per-frame GPU
 * buffer churn and stage flickering across both Remotion `<ThreeCanvas>` and live `<Canvas>`.
 */
import type React from "react";
import * as THREE from "three";

export const UNIT_PLANE_GEO = new THREE.PlaneGeometry(1, 1);
export const UNIT_CIRCLE_GEO = new THREE.CircleGeometry(1, 36);
export const UNIT_BOX_GEO = new THREE.BoxGeometry(1, 1, 1);

export const UNIT_CYLINDER_GEO = new THREE.CylinderGeometry(1, 1, 1, 16);
export const UNIT_CYLINDER_SOCKET_GEO = new THREE.CylinderGeometry(0.81, 1, 1, 14);
export const UNIT_CYLINDER_DISC_GEO = new THREE.CylinderGeometry(1, 0.92, 1, 56);
export const UNIT_CYLINDER_BASE_GEO = new THREE.CylinderGeometry(0.87, 1, 1, 20);

export const UNIT_CONE_SHADE_GEO = new THREE.ConeGeometry(1, 1, 24, 1, true);
export const UNIT_CONE_BEAM_GEO = new THREE.ConeGeometry(1, 1, 32, 1, true);
export const UNIT_CONE_FLAG_GEO = new THREE.ConeGeometry(1, 1, 3);

export const UNIT_SPHERE_GEO = new THREE.SphereGeometry(1, 20, 16);
export const SKY_DOME_SPHERE_GEO = new THREE.SphereGeometry(38, 32, 20);
export const UNIT_ICO_GEO = new THREE.IcosahedronGeometry(1, 2);

export const UNIT_RING_MED_GEO = new THREE.RingGeometry(0.82, 1, 36);
export const UNIT_RING_THIN_GEO = new THREE.RingGeometry(0.92, 1, 42);
export const RING_ZAP_ARC_GEO = new THREE.RingGeometry(10, 16, 16, 1, 0, Math.PI * 1.4);

export const UNIT_TORUS_THIN_GEO = new THREE.TorusGeometry(1, 0.011, 16, 80);
export const UNIT_TORUS_ORB_GEO = new THREE.TorusGeometry(1, 0.052, 12, 36);
export const UNIT_TORUS_STRIPE_GEO = new THREE.TorusGeometry(1, 0.1, 10, 28);

/** Stable initial camera props so `<Canvas>` / `<ThreeCanvas>` never reconcile camera objects per frame. */
export const INITIAL_STAGE_CAMERA: {
  position: [number, number, number];
  fov: number;
  near: number;
  far: number;
} = {
  position: [0, 1.62, 9.2],
  fov: 34,
  near: 0.1,
  far: 120,
};

export const STAGE_CANVAS_DPR: [number, number] = [1, 2];

export const STAGE_CANVAS_STYLE: React.CSSProperties = {
  width: "100%",
  height: "100%",
  display: "block",
};

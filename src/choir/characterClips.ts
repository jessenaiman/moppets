import type { CharacterClipManifest } from "./clipTimeline.ts";

// The rehearsal app uses Vite and the standalone Remotion renderer uses webpack.
// Both index the same release manifests. The WebMs themselves are loaded on demand.
declare const require: {
  context(directory: string, recursive: boolean, pattern: RegExp): {
    keys(): string[];
    (path: string): CharacterClipManifest;
  };
};

function publishedManifests(): CharacterClipManifest[] {
  if ((import.meta as ImportMeta & { webpack?: number }).webpack) {
    const files = require.context("../../public/clips", true, /^\.\/[^/]+\/manifest\.json$/);
    return files.keys().map(path => files(path));
  }
  return Object.values(import.meta.glob<CharacterClipManifest>("../../public/clips/*/manifest.json", {
    eager: true, import: "default",
  }));
}

const byArt = new Map<string, CharacterClipManifest>();
for (const manifest of publishedManifests()) {
  if (typeof manifest?.artKey !== "string" || typeof manifest.clips?.idle !== "string" ||
      typeof manifest.clips.sing !== "string" || !manifest.clips.idle || !manifest.clips.sing) continue;
  const clips = { ...manifest.clips };
  for (const [action, file] of Object.entries(clips)) {
    if (typeof file !== "string" || !file) {
      delete clips[action];
      continue;
    }
    clips[action] = /^(?:[a-z]+:|\/)/i.test(file) ? file : `/clips/${manifest.artKey}/${file}`;
  }
  byArt.set(manifest.artKey, { ...manifest, clips });
}

export function manifestForCharacter(artKey: string, studio404: boolean): CharacterClipManifest | null {
  return studio404 ? byArt.get(artKey) ?? null : null;
}

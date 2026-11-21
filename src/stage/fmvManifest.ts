/**
 * Engine-free client loader for sliced Google Flow FMV character manifests
 * (`public/rehearsal/fmv/<character>/manifest.json` produced by `tools/slice-flow-fmv.ts`).
 */
import { useEffect, useState } from "react";
import type { NeonFmvRigManifest } from "./neonWorlds.ts";

const cache = new Map<string, NeonFmvRigManifest | null>();
const inflight = new Map<string, Promise<NeonFmvRigManifest | null>>();

function fetchManifest(url: string): Promise<NeonFmvRigManifest | null> {
  if (cache.has(url)) return Promise.resolve(cache.get(url) ?? null);
  const existing = inflight.get(url);
  if (existing) return existing;
  const req = fetch(url)
    .then(async (res) => {
      if (!res.ok) return null;
      const data = (await res.json()) as Partial<NeonFmvRigManifest>;
      if (!data || typeof data.character !== "string" || typeof data.actions !== "object" || !data.actions) {
        return null;
      }
      return data as NeonFmvRigManifest;
    })
    .catch(() => null)
    .then((parsed) => {
      cache.set(url, parsed);
      inflight.delete(url);
      return parsed;
    });
  inflight.set(url, req);
  return req;
}

export function useCharacterFmvManifest(
  character: string | null,
  resolveAsset: (path: string) => string,
  override?: NeonFmvRigManifest | null,
): NeonFmvRigManifest | null {
  const url = character ? resolveAsset(`/rehearsal/fmv/${character}/manifest.json`) : null;
  const [loaded, setLoaded] = useState<NeonFmvRigManifest | null>(() =>
    override ?? (url && cache.has(url) ? (cache.get(url) ?? null) : null),
  );

  useEffect(() => {
    if (override !== undefined) {
      setLoaded(override);
      return;
    }
    if (!url) {
      setLoaded(null);
      return;
    }
    if (cache.has(url)) {
      setLoaded(cache.get(url) ?? null);
      return;
    }
    let alive = true;
    void fetchManifest(url).then((m) => {
      if (alive) setLoaded(m);
    });
    return () => {
      alive = false;
    };
  }, [url, override]);

  return override ?? loaded;
}

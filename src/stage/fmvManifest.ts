/**
 * Engine-free client loader for sliced Google Flow FMV character manifests
 * (`public/rehearsal/fmv/<artKey>/manifest.json` produced by `tools/slice-flow-fmv.ts`).
 * Supports loading manifests for an entire polymorphic cast at once.
 */
import { useEffect, useMemo, useState } from "react";
import type { CharacterFmvManifest } from "../choir/performer.ts";

const cache = new Map<string, CharacterFmvManifest | null>();
const inflight = new Map<string, Promise<CharacterFmvManifest | null>>();

function fetchManifest(url: string): Promise<CharacterFmvManifest | null> {
  if (cache.has(url)) return Promise.resolve(cache.get(url) ?? null);
  const existing = inflight.get(url);
  if (existing) return existing;
  const req = fetch(url)
    .then(async (res) => {
      if (!res.ok) return null;
      const data = (await res.json()) as Partial<CharacterFmvManifest>;
      if (!data || typeof data.character !== "string" || typeof data.actions !== "object" || !data.actions) {
        return null;
      }
      return data as CharacterFmvManifest;
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

export function useCastFmvManifests(
  artKeys: readonly string[],
  resolveAsset: (path: string) => string,
  overrides?: Partial<Record<string, CharacterFmvManifest | null>>,
): Record<string, CharacterFmvManifest | null> {
  const uniqueKey = useMemo(() => [...new Set(artKeys)].sort().join(","), [artKeys]);
  const [loaded, setLoaded] = useState<Record<string, CharacterFmvManifest | null>>({});

  useEffect(() => {
    const keys = uniqueKey ? uniqueKey.split(",") : [];
    let alive = true;
    for (const key of keys) {
      if (overrides && key in overrides) continue;
      const url = resolveAsset(`/rehearsal/fmv/${key}/manifest.json`);
      if (cache.has(url)) {
        setLoaded((prev) => (prev[key] === cache.get(url) ? prev : { ...prev, [key]: cache.get(url) ?? null }));
        continue;
      }
      void fetchManifest(url).then((manifest) => {
        if (!alive) return;
        setLoaded((prev) => (prev[key] === manifest ? prev : { ...prev, [key]: manifest }));
      });
    }
    return () => {
      alive = false;
    };
  }, [uniqueKey, resolveAsset, overrides]);

  return useMemo(() => {
    const result: Record<string, CharacterFmvManifest | null> = {};
    const keys = uniqueKey ? uniqueKey.split(",") : [];
    for (const key of keys) {
      if (overrides && key in overrides) result[key] = overrides[key] ?? null;
      else result[key] = loaded[key] ?? null;
    }
    return result;
  }, [uniqueKey, loaded, overrides]);
}

export function useCharacterFmvManifest(
  character: string | null,
  resolveAsset: (path: string) => string,
  override?: CharacterFmvManifest | null,
): CharacterFmvManifest | null {
  const keys = useMemo(() => (character ? [character] : []), [character]);
  const overrides = useMemo(
    () => (character && override !== undefined ? { [character]: override } : undefined),
    [character, override],
  );
  const map = useCastFmvManifests(keys, resolveAsset, overrides);
  return character ? (map[character] ?? null) : null;
}

/**
 * Engine-free client loader for sliced Google Flow FMV character manifests
 * (`public/rehearsal/fmv/<artKey>/manifest.json` produced by `tools/slice-flow-fmv.ts`).
 * Supports loading manifests for an entire polymorphic cast at once.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";
import { useDelayRender, useRemotionEnvironment } from "remotion";
import type { CharacterFmvManifest, FmvClipSpec } from "../choir/performer.ts";

const cache = new Map<string, CharacterFmvManifest>();
const inflight = new Map<string, Promise<CharacterFmvManifest | null>>();

function validClip(clip: FmvClipSpec | null | undefined): clip is FmvClipSpec {
  return !!clip && typeof clip.atlasUrl === "string" && !!clip.atlasUrl.trim() &&
    [clip.cols, clip.rows, clip.frames].every(n => Number.isSafeInteger(n) && n > 0) &&
    clip.frames <= clip.cols * clip.rows && Number.isFinite(clip.fps) && clip.fps > 0;
}

function fetchManifest(art: string, url: string): Promise<CharacterFmvManifest | null> {
  const existing = inflight.get(url);
  if (existing) return existing;
  const req = fetch(url).then(async res => {
    if (!res.ok) return null;
    const data = await res.json() as CharacterFmvManifest | null;
    if (data?.character !== art || !data.actions || typeof data.actions !== "object") return null;
    const actions: CharacterFmvManifest["actions"] = {};
    for (const [name, clip] of Object.entries(data.actions)) {
      if (!validClip(clip)) continue;
      const path = clip.atlasUrl;
      const atlasUrl = /^(?:[a-z]+:|\/)/i.test(path) ? path : `/rehearsal/fmv/${art}/${path}`;
      actions[name] = { ...clip, atlasUrl };
    }
    if (!Object.keys(actions).length) return null;
    const manifest = { ...data, actions };
    cache.set(url, manifest);
    return manifest;
  }).catch(() => null).finally(() => inflight.delete(url));
  inflight.set(url, req);
  return req;
}

export function useCastFmvManifests(
  artKeys: readonly string[],
  resolveAsset: (path: string) => string,
  overrides?: Partial<Record<string, CharacterFmvManifest | null>>,
) {
  const uniqueKey = [...new Set(artKeys)].sort().join(",");
  const entries = useMemo(() => (uniqueKey ? uniqueKey.split(",") : []).map(art => ({
    art, url: resolveAsset(`/rehearsal/fmv/${art}/manifest.json`),
  })), [uniqueKey, resolveAsset]);
  const [loaded, setLoaded] = useState<Record<string, CharacterFmvManifest | null>>({});
  const { isRendering } = useRemotionEnvironment();
  const { delayRender, continueRender } = useDelayRender();

  useEffect(() => {
    let mounted = true;
    // A failed load is local to this cast selection. Re-entering the song retries it.
    const missing = entries.filter(({ art, url }) => !(overrides && art in overrides) && !cache.has(url));
    if (missing.length) {
      void Promise.all(missing.map(async ({ art, url }) => [url, await fetchManifest(art, url)] as const))
        .then(pairs => { if (mounted) setLoaded(Object.fromEntries(pairs)); });
    }
    return () => { mounted = false; };
  }, [entries, overrides]);

  const pending = entries.some(({ art, url }) =>
    !(overrides && art in overrides) && !cache.has(url) && !(url in loaded));
  useLayoutEffect(() => {
    if (!isRendering || !pending) return;
    const handle = delayRender("Loading character animation manifests");
    return () => continueRender(handle);
  }, [isRendering, pending, delayRender, continueRender]);

  const [failed, setFailed] = useState<ReadonlySet<string>>(new Set());
  const onAtlasError = useCallback((url: string) => {
    setFailed(prev => prev.has(url) ? prev : new Set(prev).add(url));
  }, []);
  const manifests: Record<string, CharacterFmvManifest | null> = useMemo(() => Object.fromEntries(entries.map(({ art, url }) => {
    const manifest = overrides && art in overrides ? overrides[art] : cache.get(url) ?? loaded[url];
    if (!manifest || !failed.size) return [art, manifest ?? null];
    const actions = Object.fromEntries(Object.entries(manifest.actions).filter(
      ([, clip]) => clip && !failed.has(resolveAsset(clip.atlasUrl)),
    ));
    return [art, { ...manifest, actions }];
  })), [entries, overrides, loaded, failed, resolveAsset]);
  return { manifests, onAtlasError };
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
  const { manifests } = useCastFmvManifests(keys, resolveAsset, overrides);
  return character ? (manifests[character] ?? null) : null;
}

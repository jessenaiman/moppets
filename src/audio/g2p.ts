/**
 * The pronouncing dictionary (CHIMERA's English front end): one per page, read by every lyric and
 * speech call. `load()` fetches /data/cmudict.txt.gz (served from chimera/public/data).
 */
import { EnglishG2P } from "@chimera/wasm/engine.ts";

export const g2p = new EnglishG2P();

"""Transcribe the Moppets' sentences (tools/moppet-clarity.ts renders them) and score word errors
per Moppet, exactly as CHIMERA's speech judge does: its word counting, edit distance, 16 kHz
resampling, Whisper model and settings, and its thresholds, taken from
chimera/tools/asr/speech_wer.py itself (not copied, so the two never drift apart).

usage: moppet_clarity.py <outdir> [--against earlier/clarity.json]
Writes <outdir>/clarity.json. With --against, a verdict per Moppet on its training sentences:
BETTER from MARGIN points lower, WORSE past SLACK points higher, NO CLEAR CHANGE between.
The held-out sentences are reported and never decide.
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
JUDGE = os.path.join(HERE, "..", "chimera", "tools", "asr", "speech_wer.py")

# CHIMERA's judge ends by running itself; take its definitions without that last call
src = open(JUDGE).read()
judge = {"__file__": JUDGE, "__name__": "speech_wer"}
exec(compile(src[: src.rindex("\nmain()")], JUDGE, "exec"), judge)
words, edits, load16k, MARGIN, SLACK, CACHE = (judge[k] for k in ("words", "edits", "load16k", "MARGIN", "SLACK", "CACHE"))
WhisperModel = judge["WhisperModel"]


def main():
    out = sys.argv[1]
    against = sys.argv[sys.argv.index("--against") + 1] if "--against" in sys.argv else None
    jobs = json.load(open(os.path.join(out, "jobs.json")))
    model = WhisperModel("small.en", device="cpu", compute_type="int8", cpu_threads=os.cpu_count(), download_root=CACHE)
    rows, totals = [], {}
    for j in jobs:
        segs, _ = model.transcribe(load16k(j["wav"]), language="en", beam_size=1, temperature=0.0,
                                   condition_on_previous_text=False, vad_filter=False)
        heard = " ".join(s.text.strip() for s in segs)
        ref = words(j["text"])
        e = edits(ref, words(heard))
        rows.append({**j, "heard": heard, "errors": e, "words": len(ref)})
        t = totals.setdefault(j["id"], {"train": [0, 0], "held": [0, 0]})[j["set"]]
        t[0] += e
        t[1] += len(ref)
    wer = {id: {s: round(100.0 * e / n, 2) for s, (e, n) in sets.items() if n} for id, sets in totals.items()}
    json.dump({"wer": wer, "rows": rows}, open(os.path.join(out, "clarity.json"), "w"), indent=1)

    old = json.load(open(against))["wer"] if against else {}
    print(f"\n{'Moppet':8} {'training':>9} {'held out':>9}  verdict")
    for id, w in wer.items():
        verdict = ""
        if id in old:
            a, b = old[id]["train"], w["train"]
            verdict = "BETTER" if b <= a - MARGIN else "WORSE" if b > a + SLACK else "NO CLEAR CHANGE"
            verdict = f"{verdict} ({a} → {b} %)"
        print(f"{id:8} {w['train']:8.1f}% {w.get('held', 0):8.1f}%  {verdict}")
    print("\nTraining sentences heard wrong:")
    for r in rows:
        if r["set"] == "train" and r["errors"]:
            print(f"  {r['id']:7} {r['errors']}/{r['words']}  {r['text']}  →  {r['heard']}")


main()

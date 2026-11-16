/**
 * Dev-server bridge that has Claude write new words for the Moppets, through the local `claude`
 * CLI (the developer's own Claude Code sign-in; no API key in the page or the repo):
 *
 *  GET  /__claude/ping   204 when the CLI is installed
 *  POST /__claude/round  body {feedback?}        →  {title, lines: [4], last}
 *  POST /__claude/skit   body {feedback?, cast}  →  {title, description, scenes: [[{who, say}]]}
 *
 * Each call costs about half a cent on Haiku and takes 15 to 40 s. The page checks the result
 * (a round: one syllable per note; a skit: real Moppets, sayable lines) and asks again with the
 * problems as `feedback`. Only `vite` dev serves this; a build keeps the written rounds and skits.
 */
import { spawn, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import type { Plugin } from "vite";

/** Haiku: about half a cent a call. Set MOPPET_ROUND_MODEL=claude-sonnet-5-5 to try another (about 4 cents). */
export const MODEL = process.env.MOPPET_ROUND_MODEL || "claude-haiku-5-5";

/** Found objects to start from, so each round is about something new. */
const OBJECTS = ["a toaster", "a desk lamp", "a TV remote", "a rotary phone", "a music box", "a compass", "a pocket calculator", "a transistor radio", "an umbrella", "a flashlight", "an alarm clock", "a kazoo", "a cassette tape", "a lost glove", "a garden hose", "a snow globe", "a Polaroid camera", "a doorbell", "a jar of buttons", "a wind-up mouse", "a metronome", "a map with no names", "a spare key", "a broken clock that is right twice a day", "a dictionary missing the letter Q", "a microwave that beeps too much"];

const SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" },
    lines: { type: "array", items: { type: "string" }, minItems: 4, maxItems: 4 },
    last: { type: "string" },
  },
  required: ["title", "lines", "last"],
};

function prompt(object: string, feedback?: string): string {
  return [
    "Write the words for a silly, warm singing round for the Moppets: puppets built from discarded gadgets of old TV puppetry (a tape-deck fox, a typewriter rabbit, a robot tenor, a felt frog, a gravelly monster, a patchwork soprano) who learned everything from reruns.",
    `Start from ${object}, found in a junk drawer, as a metaphor for a helpful AI: what it is good at, what it gets funny-wrong, how it helps anyway. Be specific and playful, not preachy, and never mention AI, robots or computers by name.`,
    "Rules, all strict, because each word is sung on one note of a fixed tune:",
    "- exactly 4 lines, each exactly 8 words;",
    "- every word has exactly one syllable (no contractions, hyphens, numbers or names of more than one syllable);",
    "- lines 2 and 4 rhyme; the words that land on notes 2, 4, 6 and 8 carry the stress;",
    "- the 4 lines make sense sung in any order against each other, since it is a round;",
    "- `last` is one one-syllable word everyone sings together at the end (a sound the object makes is good);",
    "- `title`: 2 to 6 words.",
    feedback ? `Your previous try broke these rules: ${feedback}. Fix them.` : "",
  ].join("\n");
}

/** The stage's gesture clips (src/choir/gestures.generated.json), for a skit's `do` and `react`. */
const GESTURES = Object.keys(JSON.parse(readFileSync("src/choir/gestures.generated.json", "utf8")).clips);

const SKIT_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" },
    description: { type: "string" },
    scenes: { type: "array", minItems: 1, maxItems: 3, items: { type: "array", items: { type: "object", properties: { who: { type: "string" }, say: { type: "string" }, do: { enum: GESTURES }, react: { enum: GESTURES } }, required: ["who", "say"] } } },
  },
  required: ["title", "description", "scenes"],
};

type Cast = { id: string; name: string; role: string }[];

function skitPrompt(object: string, cast: Cast, feedback?: string): string {
  return [
    "Write a short comedy skit for the Moppets, puppets built from discarded gadgets of old TV puppetry. They assembled themselves, and everything they know comes from reruns that Vee (a VCR) and Tabby (an old TV set) show and lecture them on.",
    `The cast (use the id in "who"): ${cast.map((c) => `${c.id} = ${c.name}, ${c.role}`).join("; ")}.`,
    `The premise: someone found ${object} in a junk drawer, and it turns out to be a helpful assistant (a metaphor for a helpful AI: good at something, funny-wrong about something, warm in the end). Never mention AI, robots or computers by name.`,
    "Rules:",
    "- 2 or 3 scenes; each scene 2 to 4 lines between 2 or 3 Moppets; 6 to 12 lines in all;",
    "- each line is spoken aloud by a speech synthesizer: under 100 characters, plain words, no stage directions, no parentheses, no emoji, numbers spelled out;",
    "- a clear setup, a running joke that builds, and a last line that lands the punchline;",
    "- each Moppet sounds like itself (a fox, a rabbit, a robot, a frog, a monster, a soprano);",
    `- the puppets can act: \`do\` is a gesture the speaker makes as the line starts, \`react\` one everyone else in the scene makes as it ends (${GESTURES.join(", ")}); use them on the lines where they land a joke, not on every line;`,
    "- `description`: one short sentence; `title`: 2 to 5 words.",
    feedback ? `Your previous try broke these rules: ${feedback}. Fix them.` : "",
  ].join("\n");
}

function write(kind: "round" | "skit", feedback?: string, cast?: Cast): Promise<unknown> {
  const object = OBJECTS[Math.floor(Math.random() * OBJECTS.length)];
  const text = kind === "skit" ? skitPrompt(object, cast ?? [], feedback) : prompt(object, feedback);
  return new Promise((ok, no) => {
    const cli = spawn("claude", ["-p", "--model", MODEL, "--tools", "", "--strict-mcp-config", "--no-session-persistence", "--output-format", "json", "--json-schema", JSON.stringify(kind === "skit" ? SKIT_SCHEMA : SCHEMA), text], { stdio: ["ignore", "pipe", "pipe"] });
    let out = "", err = "";
    const timer = setTimeout(() => (cli.kill(), no(new Error("Claude took longer than 60 s"))), 60000);
    cli.stdout.on("data", (b: Buffer) => (out += b));
    cli.stderr.on("data", (b: Buffer) => (err += b));
    cli.on("error", (e) => (clearTimeout(timer), no(e)));
    cli.on("close", (code) => {
      clearTimeout(timer);
      try {
        const r = JSON.parse(out);
        if (code !== 0 || r.is_error) throw new Error(r.result || err || `claude exited ${code}`);
        ok({ ...(r.structured_output ?? JSON.parse(r.result)), object });
      } catch (e) {
        no(e instanceof Error ? e : new Error(String(e)));
      }
    });
  });
}

export function claudeWriter(): Plugin {
  return {
    name: "claude-writer",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/__claude", (req, res) => {
        const reply = (code: number, body: string, type = "text/plain") => ((res.statusCode = code), res.setHeader("content-type", type), res.end(body));
        if (req.url === "/ping") return reply(spawnSync("sh", ["-c", "command -v claude"]).status === 0 ? 204 : 404, "");
        const kind = req.url === "/round" ? "round" : req.url === "/skit" ? "skit" : null;
        if (!kind || req.method !== "POST") return reply(404, "no such call");
        let body = "";
        req.on("data", (c: Buffer) => (body += c));
        req.on("end", () => {
          let feedback: string | undefined, cast: Cast | undefined;
          try {
            ({ feedback, cast } = JSON.parse(body || "{}"));
          } catch {
            // no feedback
          }
          const castOk = Array.isArray(cast) ? cast.slice(0, 8).map((c) => ({ id: String(c.id).slice(0, 20), name: String(c.name).slice(0, 30), role: String(c.role).slice(0, 60) })) : undefined;
          write(kind, typeof feedback === "string" ? feedback.slice(0, 600) : undefined, castOk).then(
            (r) => reply(200, JSON.stringify(r), "application/json"),
            (e: Error) => reply(502, e.message),
          );
        });
      });
    },
  };
}

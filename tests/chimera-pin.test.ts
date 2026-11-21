import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scripts } from "../package.json";

test("build setup uses the recorded CHIMERA commit and stops if it cannot fetch it", () => {
  const root = mkdtempSync(join(tmpdir(), "moppet-pin-"));
  const upstream = join(root, "upstream");
  const app = join(root, "app");
  const checkout = join(app, "chimera");
  const git = (cwd: string, ...args: string[]) => {
    const command = Bun.spawnSync(["git", "-c", "user.name=Test", "-c", "user.email=test@localhost",
      "-c", "protocol.file.allow=always", "-c", "commit.gpgsign=false", ...args], { cwd });
    if (command.exitCode) throw new Error(command.stderr.toString());
    return command.stdout.toString().trim();
  };
  const prepare = () => Bun.spawnSync([process.execPath, "run", "chimera:update"], {
    cwd: app, env: { ...process.env, GIT_ALLOW_PROTOCOL: "file" },
  });
  try {
    mkdirSync(upstream);
    mkdirSync(app);
    git(upstream, "init");
    git(upstream, "commit", "--allow-empty", "-m", "pinned");
    const pin = git(upstream, "rev-parse", "HEAD");
    git(app, "init");
    git(app, "submodule", "add", upstream, "chimera");
    git(upstream, "commit", "--allow-empty", "-m", "newer");
    writeFileSync(join(app, "package.json"), JSON.stringify({
      scripts: { "chimera:update": scripts["chimera:update"], wasm: "true" },
    }));
    git(app, "submodule", "deinit", "-f", "--", "chimera");
    rmSync(join(app, ".git/modules/chimera"), { recursive: true });
    expect(prepare().exitCode).toBe(0);
    expect(git(checkout, "rev-parse", "HEAD")).toBe(pin);

    git(app, "update-index", "--cacheinfo", "160000", "1".repeat(40), "chimera");
    expect(prepare().exitCode).not.toBe(0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

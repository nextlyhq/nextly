/**
 * No package script may background a process with `&` and then `wait` for it.
 *
 * That construct is POSIX. pnpm runs scripts through `cmd.exe` on Windows, where `&` separates
 * commands SEQUENTIALLY and `wait` is not a builtin, so the first command holds the line and
 * everything after it never runs. When the first command is a watcher — which never exits by
 * design — the rest of the script is unreachable for the whole session.
 *
 * It is checked rather than merely fixed because of how it fails: nothing errors, nothing exits
 * non-zero, and the developer sees a running process. `packages/ui` carried it while producing a
 * healthy client bundle and stale server-safe artifacts beside it, and the fix — a `spawn` runner —
 * is ordinary JavaScript that a later edit could plausibly collapse back into a one-line script.
 *
 * Scanned across the whole workspace rather than this package alone. The construct is not specific
 * to anything here, `packages/builder` carried it too, and a guard that watches one package would
 * pass while the next copy of it landed somewhere else.
 */
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  ".."
);

/**
 * Backgrounding followed by a wait, in the forms a shell actually accepts.
 *
 * `&` between commands, or trailing, paired with a `wait` that stands alone as a command rather
 * than appearing inside a longer word. Matching `wait` loosely would reject `pnpm run wait-for-db`,
 * which is a perfectly portable script name.
 */
const BACKGROUND_THEN_WAIT = /&\s*(?:\S[\s\S]*)?(?:^|\s|;|&)wait(?:\s|;|$)/;

/** Every workspace manifest, found by walking the directories pnpm-workspace covers. */
function workspaceManifests(): {
  path: string;
  scripts: Record<string, string>;
}[] {
  const found: { path: string; scripts: Record<string, string> }[] = [];
  for (const group of ["packages", "apps", "templates"]) {
    const groupDir = join(repoRoot, group);
    if (!existsSync(groupDir)) continue;
    for (const entry of readdirSync(groupDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const manifest = join(groupDir, entry.name, "package.json");
      if (!existsSync(manifest)) continue;
      const parsed = JSON.parse(readFileSync(manifest, "utf8")) as {
        scripts?: Record<string, string>;
      };
      found.push({
        path: `${group}/${entry.name}`,
        scripts: parsed.scripts ?? {},
      });
    }
  }
  return found;
}

describe("package scripts run on every supported platform", () => {
  // A scan that reads nothing reports no violations, which is the same output as a clean
  // workspace. This is the control that separates them.
  it("finds manifests to scan", () => {
    const manifests = workspaceManifests();
    expect(manifests.length).toBeGreaterThan(5);
    expect(manifests.some(({ path }) => path === "packages/ui")).toBe(true);
  });

  it("recognises the construct it exists to reject", () => {
    expect(
      BACKGROUND_THEN_WAIT.test(
        "tsup --watch & tsup --config other.ts --watch & wait"
      )
    ).toBe(true);
    expect(BACKGROUND_THEN_WAIT.test("node a.mjs & node b.mjs & wait")).toBe(
      true
    );
  });

  it("does not reject portable scripts that merely contain the word", () => {
    expect(BACKGROUND_THEN_WAIT.test("node scripts/dev.mjs")).toBe(false);
    expect(BACKGROUND_THEN_WAIT.test("pnpm run wait-for-db && vitest")).toBe(
      false
    );
    expect(
      BACKGROUND_THEN_WAIT.test(
        "tsup && tsup --config tsup.server-safe.config.ts"
      )
    ).toBe(false);
  });

  it("no workspace script backgrounds a process and waits for it", () => {
    const offenders = workspaceManifests().flatMap(({ path, scripts }) =>
      Object.entries(scripts)
        .filter(([, command]) => BACKGROUND_THEN_WAIT.test(command))
        .map(([name, command]) => `${path} → ${name}: ${command}`)
    );
    expect(offenders).toEqual([]);
  });
});

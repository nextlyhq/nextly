/**
 * A plugin that bundles its own copy of the admin gets the host's card-tier
 * context, and the console is told so once, in the published build too.
 *
 * The built output is read, not only the source: the admin is built as a
 * library with `NODE_ENV` set to production, and a warning behind a
 * development guard reads as present in the source while the build folds it
 * away.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

const WARNED = Symbol.for("nextly.admin.card-tier-context.second-copy-warned");
const FRAGMENT = "A second copy of @nextlyhq/admin's widget kit was loaded";

/** Every file under `dir`. */
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("a second copy of the widget kit", () => {
  it("reads the first copy's context, and says so once however many copies load", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    delete (globalThis as Record<symbol, unknown>)[WARNED];
    vi.resetModules();
    const first = await import("../frame/tier");
    vi.resetModules();
    const second = await import("../frame/tier");
    vi.resetModules();
    await import("../frame/tier");
    expect(second.CardTierContext).toBe(first.CardTierContext);
    const said = warn.mock.calls.filter(([message]) =>
      String(message).includes(FRAGMENT)
    );
    expect(said).toHaveLength(1);
  });

  it("keeps the warning in the published build", () => {
    // 🔴 Absent from every built file when a development-only guard folded it
    // away, which is what this exists to catch.
    const dist = resolve(__dirname, "../../../../../dist");
    expect(existsSync(dist), "build the admin first").toBe(true);
    const holders = walk(dist).filter(
      file =>
        /\.m?js$/.test(file) && readFileSync(file, "utf8").includes(FRAGMENT)
    );
    expect(holders.length).toBeGreaterThan(0);
  });
});

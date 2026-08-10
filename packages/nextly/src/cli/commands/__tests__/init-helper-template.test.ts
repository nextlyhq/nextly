/**
 * The startup helper a generated project gets.
 *
 * It lives in a template literal, so the compiler never sees it and no test
 * runs it: every property below shipped broken at least once. These assert on
 * the emitted text, which is the only thing that reaches a user's project.
 */
import { describe, expect, it } from "vitest";

import { generateNextlyHelperTemplate } from "../init";

/** The emitted module, with comments removed so prose cannot satisfy a check. */
function emitted(): string {
  const raw = generateNextlyHelperTemplate();
  return raw
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter(line => !line.trim().startsWith("//"))
    .join("\n");
}

function bodyOf(source: string, fn: string): string {
  const start = source.indexOf(`export async function ${fn}`);
  expect(start, `${fn} should be exported`).toBeGreaterThan(-1);
  const rest = source.slice(start + 1);
  const next = rest.indexOf("\nexport ");
  return next === -1 ? rest : rest.slice(0, next);
}

describe("generated nextly helper", () => {
  it("boots with the project's config", () => {
    // `getNextly()` rejects a call without one, so a helper that omits it
    // fails every startup rather than only unusual ones.
    expect(bodyOf(emitted(), "getNextlyInstance")).toMatch(
      /getNextly\(\{\s*config:\s*nextlyConfig/
    );
  });

  it("does not route its two startup paths through each other", () => {
    // Each exported path called the other, and the guard flag was set only
    // after the await, so both recursed forever.
    const source = emitted();
    expect(bodyOf(source, "getNextlyInstance")).not.toContain(
      "await initializeNextly()"
    );
    expect(bodyOf(source, "initializeNextly")).toContain(
      "await getNextlyInstance()"
    );
  });

  it("marks initialization complete only once the boot resolves", () => {
    // Set beforehand, a failed boot leaves the app marked initialized and the
    // retry a caller then makes returns early without ever booting.
    const body = bodyOf(emitted(), "getNextlyInstance");
    const boot = body.indexOf("await getNextly({");
    const flag = body.indexOf("initialized = true");
    expect(boot).toBeGreaterThan(-1);
    expect(flag).toBeGreaterThan(boot);
  });

  it("reports initialization from either documented path", () => {
    // Both options are documented, so `isNextlyInitialized()` has to answer
    // for a caller who used the instance getter directly.
    expect(bodyOf(emitted(), "getNextlyInstance")).toContain(
      "initialized = true"
    );
  });
});

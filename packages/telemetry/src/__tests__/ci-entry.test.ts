import { describe, expect, it, vi } from "vitest";

// The `ci` entry exists so a caller can ask "is this CI?" without loading the
// usage-data client. If anything in its import graph reached posthog-node,
// this factory would run and the import below would fail.
vi.mock("posthog-node", () => {
  throw new Error("the ci entry must not load posthog-node");
});

describe("the ci entry", () => {
  it("exports the same detectIsCi as the package's environment module", async () => {
    const entry = await import("../ci.js");
    const environment = await import("../environment.js");
    expect(entry.detectIsCi).toBe(environment.detectIsCi);
  });

  it("exports nothing but detectIsCi", async () => {
    const entry = await import("../ci.js");
    expect(Object.keys(entry)).toEqual(["detectIsCi"]);
  });

  it("answers from the environment it is given", async () => {
    const { detectIsCi } = await import("../ci.js");
    expect(detectIsCi({ GITHUB_ACTIONS: "true" })).toBe(true);
    expect(detectIsCi({ CI: "false" })).toBe(false);
    expect(detectIsCi({})).toBe(false);
  });
});

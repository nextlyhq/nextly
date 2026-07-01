import { describe, it, expect } from "vitest";
import type { PluginDefinition } from "./plugin-context";
import { validatePluginVersions } from "./validate-versions";

const p = (over: Partial<PluginDefinition>): PluginDefinition => ({
  name: "x",
  version: "1.0.0",
  nextly: "*",
  ...over,
});

/** Capture the NextlyError a thunk throws so we can assert on its structured fields. */
function thrownError(fn: () => unknown): {
  logMessage?: string;
  logContext?: { reason?: string };
} {
  try {
    fn();
  } catch (e) {
    return e as { logMessage?: string; logContext?: { reason?: string } };
  }
  throw new Error("expected the function to throw, but it did not");
}

describe("validatePluginVersions", () => {
  it("passes when the core version satisfies every nextly range (prerelease)", () => {
    expect(() =>
      validatePluginVersions(
        [p({ name: "a", nextly: ">=0.0.2-alpha.0" })],
        "0.0.2-alpha.21"
      )
    ).not.toThrow();
  });

  it("throws when core is below the nextly range", () => {
    const err = thrownError(() =>
      validatePluginVersions(
        [p({ name: "a", nextly: ">=1.0.0" })],
        "0.0.2-alpha.21"
      )
    );
    expect(err.logContext?.reason).toBe("core-incompatible");
    expect(err.logMessage).toMatch(/requires Nextly/i);
  });

  it("throws on an invalid nextly range", () => {
    const err = thrownError(() =>
      validatePluginVersions([p({ name: "a", nextly: "nonsense" })], "1.0.0")
    );
    expect(err.logContext?.reason).toBe("invalid-nextly-range");
  });

  it("validates dependsOn version ranges against the target plugin version", () => {
    const a = p({ name: "a", dependsOn: { b: "^2.0.0" } });
    const b = p({ name: "b", version: "1.5.0" });
    const err = thrownError(() => validatePluginVersions([a, b], "1.0.0"));
    expect(err.logContext?.reason).toBe("version-incompatible");
    expect(err.logMessage).toMatch(/requires "b"/i);
  });

  it("ignores an absent optional dependency but checks a present incompatible one", () => {
    const a = p({ name: "a", optionalDependsOn: { b: "^2.0.0" } });
    expect(() => validatePluginVersions([a], "1.0.0")).not.toThrow();

    const b = p({ name: "b", version: "1.0.0" });
    const err = thrownError(() => validatePluginVersions([a, b], "1.0.0"));
    expect(err.logContext?.reason).toBe("optional-version-incompatible");
    expect(err.logMessage).toMatch(/optionally depends/i);
  });
});

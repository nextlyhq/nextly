import { afterEach, describe, expect, it } from "vitest";

import { definePlugin } from "../plugin-context";
import { createTestNextly, type TestNextly } from "../test-nextly";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

describe("plugin resolution wired into runtime boot", () => {
  it("runs init in dependency order, not array order", async () => {
    const order: string[] = [];
    const a = definePlugin({
      name: "@test/a",
      version: "1.0.0",
      nextly: ">=0.0.0",
      init() {
        order.push("a");
      },
    });
    const b = definePlugin({
      name: "@test/b",
      version: "1.0.0",
      nextly: ">=0.0.0",
      dependsOn: { "@test/a": ">=1.0.0" },
      init() {
        order.push("b");
      },
    });

    // Declared b-before-a; topo sort must still init a first.
    current = await createTestNextly({ plugins: [b, a] });

    expect(order).toEqual(["a", "b"]);
  });

  it("fails fast on an incompatible core version (reason: core-incompatible)", async () => {
    const bad = definePlugin({
      name: "@test/bad-core",
      version: "1.0.0",
      nextly: "^99.0.0",
      init() {},
    });

    let captured: unknown;
    try {
      current = await createTestNextly({ plugins: [bad] });
    } catch (err) {
      captured = err;
    }
    expect(
      (captured as { logContext?: { reason?: string } } | undefined)?.logContext
        ?.reason
    ).toBe("core-incompatible");
  });

  it("fails fast on a missing required dependency (reason: missing-dependency)", async () => {
    const needsMissing = definePlugin({
      name: "@test/needs-missing",
      version: "1.0.0",
      nextly: ">=0.0.0",
      dependsOn: { "@test/not-installed": ">=1.0.0" },
      init() {},
    });

    let captured: unknown;
    try {
      current = await createTestNextly({ plugins: [needsMissing] });
    } catch (err) {
      captured = err;
    }
    expect(
      (captured as { logContext?: { reason?: string } } | undefined)?.logContext
        ?.reason
    ).toBe("missing-dependency");
  });
});

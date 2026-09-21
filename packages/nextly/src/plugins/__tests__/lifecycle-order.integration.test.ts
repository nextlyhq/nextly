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

describe("onReady", () => {
  it("runs after every plugin's init, and in dependency order itself", async () => {
    // The property that makes onReady worth having: a plugin reading the
    // assembled system must not see a half-initialised one.
    const order: string[] = [];
    const make = (name: string, dependsOn?: Record<string, string>) =>
      definePlugin({
        name,
        version: "1.0.0",
        nextly: ">=0.0.0",
        ...(dependsOn ? { dependsOn } : {}),
        init() {
          order.push(`init ${name}`);
        },
        onReady() {
          order.push(`ready ${name}`);
        },
      });

    current = await createTestNextly({
      plugins: [
        make("@test/c"),
        make("@test/b", { "@test/a": ">=1.0.0" }),
        make("@test/a"),
      ],
    });

    const inits = order.filter(e => e.startsWith("init"));
    const readies = order.filter(e => e.startsWith("ready"));
    expect(order.slice(0, inits.length)).toEqual(inits);
    expect(readies).toHaveLength(3);
    expect(order.indexOf("ready @test/a")).toBeLessThan(
      order.indexOf("ready @test/b")
    );
  });

  it("fails boot with the plugin's name when onReady throws", async () => {
    const boom = definePlugin({
      name: "@test/boom",
      version: "1.0.0",
      nextly: ">=0.0.0",
      onReady() {
        throw new Error("could not finish starting");
      },
    });

    await expect(createTestNextly({ plugins: [boom] })).rejects.toThrow(
      /@test\/boom.*onReady/
    );
  });

  it("never calls onInstall or onUninstall during a boot", async () => {
    // They belong to install and uninstall, which a boot is neither. Calling
    // them here would re-run one-time setup on every start.
    let installs = 0;
    let uninstalls = 0;
    const p = definePlugin({
      name: "@test/lifecycle",
      version: "1.0.0",
      nextly: ">=0.0.0",
      onInstall() {
        installs += 1;
      },
      onUninstall() {
        uninstalls += 1;
      },
    });

    current = await createTestNextly({ plugins: [p] });

    expect(installs).toBe(0);
    expect(uninstalls).toBe(0);
  });
});

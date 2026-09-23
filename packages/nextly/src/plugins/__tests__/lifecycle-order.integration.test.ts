import { afterEach, describe, expect, it } from "vitest";

import { NextlyError } from "../../errors/nextly-error";
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

    // The plugin's name is in the log context rather than the public message:
    // a boot failure reaches an operator through the log, and NextlyError
    // keeps the public text generic on purpose.
    await expect(createTestNextly({ plugins: [boom] })).rejects.toSatisfy(
      (err: unknown) => {
        if (!NextlyError.is(err)) return false;
        const ctx = err.logContext as { reason?: string; plugin?: string };
        return (
          ctx.reason === "plugin-onready-failed" && ctx.plugin === "@test/boom"
        );
      }
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

describe("a failed boot destroys what it started", () => {
  it("destroys earlier plugins when a later plugin's init throws", async () => {
    // The boot fails before `initializePlugins` returns, so nothing else can
    // run the destroy callbacks: the caller never receives them, and
    // `shutdownServices` returns early because registration never completed.
    // A timer or connection opened by the earlier plugin then survived the
    // failed boot — and a retry booted a second copy beside it.
    const destroyed: string[] = [];
    const healthy = definePlugin({
      name: "@test/healthy",
      version: "1.0.0",
      nextly: ">=0.0.0",
      init() {},
      destroy() {
        destroyed.push("@test/healthy");
      },
    });
    const laterBoom = definePlugin({
      name: "@test/later-boom",
      version: "1.0.0",
      nextly: ">=0.0.0",
      dependsOn: { "@test/healthy": ">=1.0.0" },
      init() {
        throw new Error("no");
      },
      destroy() {
        destroyed.push("@test/later-boom");
      },
    });

    await expect(
      createTestNextly({ plugins: [healthy, laterBoom] })
    ).rejects.toThrow();

    // The initialized plugin is cleaned up; the one whose init THREW is not —
    // a plugin that cannot finish starting has not started, and its destroy
    // expects a state that never came to exist.
    expect(destroyed).toEqual(["@test/healthy"]);
  });

  it("destroys every initialized plugin, reverse order, when onReady throws", async () => {
    const destroyed: string[] = [];
    const make = (name: string, boom: boolean) =>
      definePlugin({
        name,
        version: "1.0.0",
        nextly: ">=0.0.0",
        init() {},
        onReady() {
          if (boom) throw new Error("cannot finish starting");
        },
        destroy() {
          destroyed.push(name);
        },
      });

    await expect(
      createTestNextly({
        plugins: [
          make("@test/first", false),
          make("@test/second", false),
          make("@test/ready-boom", true),
        ],
      })
    ).rejects.toSatisfy((err: unknown) => {
      if (!NextlyError.is(err)) return false;
      return (
        (err.logContext as { reason?: string }).reason ===
        "plugin-onready-failed"
      );
    });

    // Reverse init order, mirroring the shutdown path, so a plugin that
    // depends on another tears down before its dependency does.
    expect(destroyed).toEqual([
      "@test/ready-boom",
      "@test/second",
      "@test/first",
    ]);
  });
});

describe("a failed boot destroys what it started", () => {
  it("destroys a plugin whose only lifecycle is onReady", async () => {
    // `init` is optional, and a plugin may open every timer and connection it
    // owns inside `onReady`. Recording only init-ran plugins left such a
    // plugin out of the rollback, so a later plugin's onReady failure let
    // its resources survive the failed boot and duplicate on the retry.
    const destroyed: string[] = [];
    const onReadyOnly = definePlugin({
      name: "@test/onready-only",
      version: "1.0.0",
      nextly: ">=0.0.0",
      onReady() {},
      destroy() {
        destroyed.push("@test/onready-only");
      },
    });
    const boom = definePlugin({
      name: "@test/onready-boom",
      version: "1.0.0",
      nextly: ">=0.0.0",
      onReady() {
        throw new Error("cannot finish starting");
      },
    });

    await expect(
      createTestNextly({ plugins: [onReadyOnly, boom] })
    ).rejects.toSatisfy((err: unknown) => {
      if (!NextlyError.is(err)) return false;
      return (
        (err.logContext as { reason?: string }).reason ===
        "plugin-onready-failed"
      );
    });

    expect(destroyed).toEqual(["@test/onready-only"]);
  });
});

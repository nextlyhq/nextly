import { afterEach, describe, expect, it, vi } from "vitest";

import { defineConfig } from "../../collections/config/define-config";
import { container } from "../../di/container";
import { clearServices, registerServices } from "../../di/register";
import { getService } from "../../di/service-access";
import { getNextly } from "../../init";
import { getImageProcessor } from "../../storage/image-processor";
import {
  definePlugin,
  type PluginContext,
  type PluginDefinition,
} from "../plugin-context";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../test-nextly";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

describe("plugin destroy() on shutdown", () => {
  it("runs destroy in reverse init order, skipping disabled plugins", async () => {
    const order: string[] = [];
    const a = definePlugin({
      name: "@test/d-a",
      version: "1.0.0",
      nextly: ">=0.0.0",
      init() {},
      destroy() {
        order.push("a");
      },
    });
    const b = definePlugin({
      name: "@test/d-b",
      version: "1.0.0",
      nextly: ">=0.0.0",
      dependsOn: { "@test/d-a": ">=1.0.0" },
      init() {},
      destroy() {
        order.push("b");
      },
    });
    const disabled = definePlugin({
      name: "@test/d-disabled",
      version: "1.0.0",
      nextly: ">=0.0.0",
      enabled: false,
      destroy() {
        order.push("disabled");
      },
    });

    current = await createTestNextly({ plugins: [a, b, disabled] });
    await current.destroy();
    current = undefined; // already torn down

    // Init order is [a, b]; destroy runs in reverse and skips the disabled one.
    expect(order).toEqual(["b", "a"]);
  });

  it("isolates a throwing destroy so the others still run and shutdown completes", async () => {
    const order: string[] = [];
    const safe = definePlugin({
      name: "@test/d-safe",
      version: "1.0.0",
      nextly: ">=0.0.0",
      init() {},
      destroy() {
        order.push("safe");
      },
    });
    const boom = definePlugin({
      name: "@test/d-boom",
      version: "1.0.0",
      nextly: ">=0.0.0",
      dependsOn: { "@test/d-safe": ">=1.0.0" },
      init() {},
      destroy() {
        throw new Error("destroy boom");
      },
    });

    const t = await createTestNextly({ plugins: [safe, boom] });
    // boom destroys first (reverse order) and throws; shutdown must not reject.
    await expect(t.destroy()).resolves.toBeUndefined();
    expect(order).toEqual(["safe"]);
  });
});

/**
 * Two plugins, the second depending on the first, that record each init and
 * each destroy in one shared list, so the order across both is observable.
 */
function recordingPair(order: string[]): PluginDefinition[] {
  const a = definePlugin({
    name: "@test/r-a",
    version: "1.0.0",
    nextly: ">=0.0.0",
    init() {
      order.push("init a");
    },
    destroy() {
      order.push("destroy a");
    },
  });
  const b = definePlugin({
    name: "@test/r-b",
    version: "1.0.0",
    nextly: ">=0.0.0",
    dependsOn: { "@test/r-a": ">=1.0.0" },
    init() {
      order.push("init b");
    },
    destroy() {
      order.push("destroy b");
    },
  });
  return [a, b];
}

describe("plugin destroy() when services are registered again", () => {
  it("tears down the previous registration's plugins, in reverse, before any plugin initialises again", async () => {
    const order: string[] = [];
    const plugins = recordingPair(order);
    current = await createTestNextly({ plugins });

    // Re-registration as `registerServices` tells a caller to do it: clear,
    // then register again. The adapter stays connected across the two, so
    // the earlier plugins' teardown can still reach the database.
    clearServices();
    await registerServices({
      adapter: current.adapter,
      imageProcessor: getImageProcessor(),
      plugins,
    });

    expect(order).toEqual([
      "init a",
      "init b",
      "destroy b",
      "destroy a",
      "init a",
      "init b",
    ]);
  });
});

describe("plugin destroy() through nextly.shutdown()", () => {
  it("runs destroy in reverse init order", async () => {
    const order: string[] = [];
    current = await createTestNextly({ plugins: recordingPair(order) });

    // The public handle over the registration the harness just made: with
    // services already registered, `getNextly` builds its instance on them
    // rather than registering again, so its `shutdown()` is the one an
    // application calls.
    const nextly = await getNextly({ config: defineConfig({}) });
    await nextly.shutdown();

    expect(order).toEqual(["init a", "init b", "destroy b", "destroy a"]);
  });
});

describe.each(getConfiguredTestDialects())(
  "a cleared registration's plugin teardown on %s",
  (dialect: TestDialect) => {
    it("still reaches the services the plugin was started with", async () => {
      // `clearServices()` empties the container at once, and the plugin is
      // torn down only when the next registration starts. A teardown that
      // opens a transaction reaches for the adapter, which on SQLite is
      // looked up through the container, so it found nothing and the plugin
      // was left half torn down while the boot went on.
      const order: string[] = [];
      const plugin = definePlugin({
        name: "@test/d-db",
        version: "1.0.0",
        nextly: ">=0.0.0",
        init() {},
        async destroy(ctx) {
          await ctx.db.transaction(async () => {
            order.push("destroyed inside a transaction");
          });
        },
      });
      current = await createTestNextly(
        dialect === "sqlite"
          ? { plugins: [plugin] }
          : { dialect, plugins: [plugin] }
      );

      clearServices();
      await registerServices({
        adapter: current.adapter,
        imageProcessor: getImageProcessor(),
        plugins: [plugin],
      });

      expect(order).toEqual(["destroyed inside a transaction"]);
    });

    it("queues a job through ctx.services.jobs, which reads the container itself", async () => {
      // Not every service a context offers is looked up through the plugin's
      // own resolvers: the jobs repository behind `ctx.services.jobs` is read
      // from the container directly, and was not there after the clear. A
      // teardown that restored only the adapter would still fail this.
      const plugin = definePlugin({
        name: "@test/d-jobs",
        version: "1.0.0",
        nextly: ">=0.0.0",
        init() {},
        async destroy(ctx) {
          await ctx.services.jobs.queue({
            task: "test-d-jobs.final-sweep",
            input: null,
          });
        },
      });
      current = await createTestNextly(
        dialect === "sqlite"
          ? { plugins: [plugin] }
          : { dialect, plugins: [plugin] }
      );

      clearServices();
      await registerServices({
        adapter: current.adapter,
        imageProcessor: getImageProcessor(),
        plugins: [plugin],
      });

      const jobs = await current.adapter.select<{ slug: string }>(
        "nextly_jobs"
      );
      expect(jobs.map(job => job.slug)).toEqual(["test-d-jobs.final-sweep"]);
    });

    it("writes an audit row through ctx.audit, which reads the container itself", async () => {
      // The audit writer resolves the adapter from the container directly,
      // not through the context. It swallows its own failures, so a missing
      // adapter is a row that never appears rather than a throw.
      const plugin = definePlugin({
        name: "@test/d-audit",
        version: "1.0.0",
        nextly: ">=0.0.0",
        contributes: { audit: { kinds: [{ kind: "test-d-audit.stopped" }] } },
        init() {},
        async destroy(ctx) {
          await ctx.audit?.write({ kind: "test-d-audit.stopped" });
        },
      });
      current = await createTestNextly(
        dialect === "sqlite"
          ? { plugins: [plugin] }
          : { dialect, plugins: [plugin] }
      );

      clearServices();
      await registerServices({
        adapter: current.adapter,
        imageProcessor: getImageProcessor(),
        plugins: [plugin],
      });

      const rows = await current.adapter.select<{ kind: string }>("audit_log");
      expect(
        rows.filter(row => row.kind === "test-d-audit.stopped")
      ).toHaveLength(1);
    });

    it("still reaches them after a second clear before the next registration", async () => {
      // Moved aside again, the empty container would have replaced the one
      // holding them.
      const order: string[] = [];
      const plugin = definePlugin({
        name: "@test/d-twice",
        version: "1.0.0",
        nextly: ">=0.0.0",
        init() {},
        async destroy(ctx) {
          await ctx.db.transaction(async () => {
            order.push("destroyed inside a transaction");
          });
        },
      });
      current = await createTestNextly(
        dialect === "sqlite"
          ? { plugins: [plugin] }
          : { dialect, plugins: [plugin] }
      );

      clearServices();
      clearServices();
      await registerServices({
        adapter: current.adapter,
        imageProcessor: getImageProcessor(),
        plugins: [plugin],
      });

      expect(order).toEqual(["destroyed inside a transaction"]);
    });

    it("keeps them for the rest of a teardown when services are cleared while a destroy awaits", async () => {
      // The teardown has already taken the moved-aside services back into
      // the container, so a clear arriving now finds nothing moved aside and
      // empties the container, which the rest of the `destroy` reads.
      let release!: () => void;
      const released = new Promise<void>(resolve => {
        release = resolve;
      });
      let reached!: () => void;
      const destroying = new Promise<void>(resolve => {
        reached = resolve;
      });
      const plugin = definePlugin({
        name: "@test/d-mid-clear",
        version: "1.0.0",
        nextly: ">=0.0.0",
        init() {},
        async destroy(ctx) {
          reached();
          await released;
          await ctx.services.jobs.queue({
            task: "test-d-mid-clear.final-sweep",
            input: null,
          });
        },
      });
      current = await createTestNextly(
        dialect === "sqlite"
          ? { plugins: [plugin] }
          : { dialect, plugins: [plugin] }
      );

      clearServices();
      const registering = registerServices({
        adapter: current.adapter,
        imageProcessor: getImageProcessor(),
      });
      await destroying;
      clearServices();
      release();
      await registering;

      const jobs = await current.adapter.select<{ slug: string }>(
        "nextly_jobs"
      );
      expect(jobs.map(job => job.slug)).toEqual([
        "test-d-mid-clear.final-sweep",
      ]);
    });

    it("leaves a callback the plugin left running on the services it was started with", async () => {
      // A `destroy` that throws before stopping a timer leaves the timer
      // running into the next registration. Whatever it later resolves
      // lazily through its context has to be its own registration's, not
      // the next one's, which it would read and write as if it were.
      let kept: PluginContext | undefined;
      const plugin = definePlugin({
        name: "@test/d-left-running",
        version: "1.0.0",
        nextly: ">=0.0.0",
        init(ctx) {
          kept = ctx;
        },
        destroy() {
          throw new Error("failed before stopping its timer");
        },
      });
      current = await createTestNextly(
        dialect === "sqlite"
          ? { plugins: [plugin] }
          : { dialect, plugins: [plugin] }
      );
      const startedWith = getService("versionsService");

      const errors = vi.spyOn(console, "error").mockImplementation(() => {});
      clearServices();
      await registerServices({
        adapter: current.adapter,
        imageProcessor: getImageProcessor(),
      });
      errors.mockRestore();
      const next = getService("versionsService");
      // The control: the next registration built a service of its own, so
      // which of the two the context reaches is observable.
      expect(next).not.toBe(startedWith);

      const ownList = vi.spyOn(startedWith, "list").mockResolvedValue([]);
      const nextList = vi.spyOn(next, "list").mockResolvedValue([]);
      await kept?.services.versions.list({
        scopeKind: "collection",
        scopeSlug: "posts",
        entryId: "1",
      });

      expect(ownList).toHaveBeenCalledTimes(1);
      expect(nextList).not.toHaveBeenCalled();
    });

    it("leaves a service registered after the clear for the registration that follows", async () => {
      // Registered through the published container between the clear and the
      // next registration; the teardown in between takes out only what it
      // put back.
      const plugin = definePlugin({
        name: "@test/d-own-service",
        version: "1.0.0",
        nextly: ">=0.0.0",
        init() {},
      });
      current = await createTestNextly(
        dialect === "sqlite"
          ? { plugins: [plugin] }
          : { dialect, plugins: [plugin] }
      );

      clearServices();
      container.registerSingleton("test-own-service", () => ({ mine: true }));
      await registerServices({
        adapter: current.adapter,
        imageProcessor: getImageProcessor(),
        plugins: [plugin],
      });

      expect(container.has("test-own-service")).toBe(true);
    });
  }
);

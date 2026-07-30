/**
 * Reloads triggered by the watched file never overlap.
 *
 * A load clears and rebuilds the process-wide field-type registry, then records
 * on its result what it registered. Two loads running at once share that
 * registry, so each can capture the other's registrations and hand a caller a
 * config paired with another config's types — defeating the pairing the
 * snapshot exists to guarantee, and letting a sync classify one config's
 * columns with another's storage primitives.
 *
 * Driven through the real watcher: the `watch` listener is captured and fired,
 * rather than reaching for a test-only export of the scheduler.
 */
import { existsSync, watch } from "node:fs";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearFieldTypes,
  getFieldType,
} from "../../domains/schema/field-types/field-type-registry";
import { NextlyError } from "../../errors/nextly-error";

import { clearConfigCache, loadConfig, watchConfig } from "./config-loader";

const bundleAndRequire = vi.hoisted(() => vi.fn());
vi.mock("./config-bundler", () => ({ bundleAndRequire }));

vi.mock("node:fs", async importOriginal => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    existsSync: vi.fn(actual.existsSync),
    // The loader attaches an error handler and closes it on restart, so the
    // stub has to look like a watcher rather than just record the call.
    watch: vi.fn(() => ({ on: vi.fn(), close: vi.fn() })),
  };
});

const CONFIG_PATH = "/virtual/nextly.config.ts";
const OTHER_CONFIG_PATH = "/virtual/other.config.ts";

/** The change listener the loader registered with `watch`. */
function capturedListener(): (event: string) => void {
  const call = vi.mocked(watch).mock.calls.at(-1);
  if (!call) {
    throw NextlyError.internal("the loader never started a watcher");
  }
  return call[1] as unknown as (event: string) => void;
}

const loaded = { mod: { default: { plugins: [] } }, dependencies: [] };

/** A config whose single plugin contributes one field type. */
function configContributing(type: string): typeof loaded {
  return {
    mod: {
      default: {
        plugins: [
          {
            name: `@t/${type}`,
            version: "1.0.0",
            nextly: ">=0.0.0",
            contributes: {
              fieldTypes: [
                { type, storage: "number", component: `@t/${type}#Input` },
              ],
            },
          },
        ],
      },
    },
    dependencies: [],
  } as unknown as typeof loaded;
}

beforeEach(() => {
  vi.mocked(existsSync).mockImplementation(
    path => path === CONFIG_PATH || path === OTHER_CONFIG_PATH
  );
  clearConfigCache();
  clearFieldTypes();
});

afterEach(() => {
  vi.restoreAllMocks();
  bundleAndRequire.mockReset();
  clearConfigCache();
  clearFieldTypes();
});

describe("watched config reloads", () => {
  it("never runs two loads at once", async () => {
    // The initial load must not be gated, or the watcher is never installed.
    bundleAndRequire.mockResolvedValue(loaded);
    await loadConfig({ configPath: CONFIG_PATH, cwd: "/virtual", watch: true });
    const fire = capturedListener();

    let active = 0;
    let maxActive = 0;
    let release!: () => void;
    const gate = new Promise<void>(resolve => {
      release = resolve;
    });
    let call = 0;

    bundleAndRequire.mockImplementation(async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      call += 1;
      // The first reload is held open so the second change lands inside it.
      if (call === 1) await gate;
      active -= 1;
      return loaded;
    });

    fire("change");
    fire("change");
    release();
    // Let the queued trailing reload run to completion.
    await new Promise(resolve => setTimeout(resolve, 0));
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(maxActive).toBe(1);
  });

  it("drains against the watcher that is installed, not the one that queued", async () => {
    bundleAndRequire.mockResolvedValue(loaded);
    await loadConfig({ configPath: CONFIG_PATH, cwd: "/virtual", watch: true });
    const fireFirst = capturedListener();

    let release!: () => void;
    const gate = new Promise<void>(resolve => {
      release = resolve;
    });
    let call = 0;
    const bundled: string[] = [];

    bundleAndRequire.mockImplementation(async (args: { filepath: string }) => {
      bundled.push(args.filepath);
      call += 1;
      // Hold the first reload open so the watcher is replaced underneath it.
      if (call === 1) await gate;
      return loaded;
    });

    // A reload is now in flight against the first watcher, with a second change
    // queued behind it.
    fireFirst("change");
    fireFirst("change");

    // The first watcher is stopped and a different config is watched instead,
    // which is what `clearConfigCache()` followed by another watched load does.
    clearConfigCache();
    // Started rather than awaited: the replacement load rebuilds the same
    // registry as the reload in flight, so it queues behind it instead of
    // running beside it, and awaiting it before the gate opens would wait on a
    // reload that only this test can release.
    const replacement = loadConfig({
      configPath: OTHER_CONFIG_PATH,
      cwd: "/virtual",
      watch: true,
    });

    release();
    await replacement;
    await new Promise(resolve => setTimeout(resolve, 0));
    await new Promise(resolve => setTimeout(resolve, 0));

    // The drained reload has to be the second watcher's config. Reloading the
    // first again would hand its result to callbacks registered for the
    // second, and the second's change would never be loaded at all.
    expect(bundled.at(-1)).toBe(OTHER_CONFIG_PATH);
  });

  it("does not deliver a reload whose watcher was replaced mid-load", async () => {
    bundleAndRequire.mockResolvedValue(loaded);
    await loadConfig({ configPath: CONFIG_PATH, cwd: "/virtual", watch: true });
    const fireFirst = capturedListener();

    let release!: () => void;
    const gate = new Promise<void>(resolve => {
      release = resolve;
    });
    let call = 0;
    bundleAndRequire.mockImplementation(async () => {
      call += 1;
      if (call === 1) await gate;
      return loaded;
    });

    // In flight against the first watcher.
    fireFirst("change");

    clearConfigCache();
    // Queued behind the reload in flight, so it is started before the gate
    // opens and awaited after.
    const replacement = loadConfig({
      configPath: OTHER_CONFIG_PATH,
      cwd: "/virtual",
      watch: true,
    });

    // Registered by whoever is watching now, so it must not be handed the
    // config the superseded reload was loading when its watcher was stopped.
    const seen: string[] = [];
    watchConfig(result => {
      seen.push(result.configPath);
    });

    release();
    await replacement;
    await new Promise(resolve => setTimeout(resolve, 0));
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(seen).not.toContain(CONFIG_PATH);
  });

  it("leaves the installed config's field types live after a superseded reload", async () => {
    bundleAndRequire.mockResolvedValue(configContributing("first-type"));
    await loadConfig({ configPath: CONFIG_PATH, cwd: "/virtual", watch: true });
    const fireFirst = capturedListener();

    let release!: () => void;
    const gate = new Promise<void>(resolve => {
      release = resolve;
    });
    let call = 0;
    bundleAndRequire.mockImplementation(async () => {
      call += 1;
      // Hold the first reload open so the watcher is replaced underneath it,
      // and let it finish LAST so its registrations are the ones left behind.
      if (call === 1) {
        await gate;
        return configContributing("first-type");
      }
      return configContributing("second-type");
    });

    fireFirst("change");

    clearConfigCache();
    // Queued behind the reload in flight rather than running beside it, so the
    // superseded reload puts the installed set back BEFORE this one registers,
    // instead of over the top of it.
    const replacement = loadConfig({
      configPath: OTHER_CONFIG_PATH,
      cwd: "/virtual",
      watch: true,
    });

    release();
    await replacement;
    await new Promise(resolve => setTimeout(resolve, 0));

    // The superseded reload rebuilt the live registry on its way through. What
    // has to remain is the set belonging to the config now installed, or every
    // later lookup classifies its fields with the obsolete storage mappings.
    expect(getFieldType("second-type")).toBeDefined();
    expect(getFieldType("first-type")).toBeUndefined();
  });

  it("does not run an explicit load beside an in-flight reload", async () => {
    bundleAndRequire.mockResolvedValue(loaded);
    await loadConfig({ configPath: CONFIG_PATH, cwd: "/virtual", watch: true });
    const fireFirst = capturedListener();

    let active = 0;
    let maxActive = 0;
    let release!: () => void;
    const gate = new Promise<void>(resolve => {
      release = resolve;
    });
    let call = 0;

    bundleAndRequire.mockImplementation(async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      call += 1;
      if (call === 1) await gate;
      active -= 1;
      return loaded;
    });

    // A reload is in flight, and an explicit load arrives while it is.
    fireFirst("change");
    clearConfigCache();
    const replacement = loadConfig({
      configPath: OTHER_CONFIG_PATH,
      cwd: "/virtual",
      watch: true,
    });

    release();
    await replacement;

    // Both rebuild the one process-wide registry, so an explicit load has to
    // wait for the reload rather than clear and re-register underneath it: each
    // would otherwise capture what the other left behind, and a reload that
    // finds itself superseded would restore the installed set over the
    // registrations of the load that replaced it.
    expect(maxActive).toBe(1);
  });
});

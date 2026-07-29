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

import { clearFieldTypes } from "../../domains/schema/field-types/field-type-registry";
import { NextlyError } from "../../errors/nextly-error";

import { clearConfigCache, loadConfig } from "./config-loader";

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

/** The change listener the loader registered with `watch`. */
function capturedListener(): (event: string) => void {
  const call = vi.mocked(watch).mock.calls.at(-1);
  if (!call) {
    throw NextlyError.internal("the loader never started a watcher");
  }
  return call[1] as unknown as (event: string) => void;
}

const loaded = { mod: { default: { plugins: [] } }, dependencies: [] };

beforeEach(() => {
  vi.mocked(existsSync).mockImplementation(path => path === CONFIG_PATH);
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
});

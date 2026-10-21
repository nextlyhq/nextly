/**
 * A project that starts Nextly at server start never hears "not detected".
 *
 * Both placements an instrumentation file can take — the project root and
 * `src/` — enter through the same `createRegister(config)` call, so each
 * placement's boot passes through the path asserted here. The two windows are
 * driven against the real boot machinery, with the migrations gate held open
 * to park a start deterministically: a first request arriving while that start
 * is under way, and one arriving in the window before the start has called
 * Nextly at all. In neither window may the server's output claim that no
 * instrumentation was detected.
 *
 * The notice itself is unit-tested beside this (`cold-boot-notice.test.ts`);
 * what this adds is that the request-path boot, driven end to end with real
 * registration, picks the wording the observed boot state dictates.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { defineConfig } from "../../collections/config/define-config";
import { shutdownServices } from "../../di/register";
import {
  allowBootMigrations,
  openBootMigrationsGate,
  _resetBootMigrationsGateForTest,
} from "../../init/boot-migrations-gate";
import { createRegister, getNextly, shutdownNextly } from "../../init";

import { ensureServicesInitialized, setHandlerConfig } from "../auth-handler";

/** Everything console.warn received while a window was being driven. */
function captureWarn(): string[] {
  const lines: string[] = [];
  const spy = vi
    .spyOn(console, "warn")
    .mockImplementation((...args: unknown[]) => {
      lines.push(args.map(String).join(" "));
    });
  return lines;
}

/** Whether any previous boot left state that would make this one not cold. */
async function resetBootState(): Promise<void> {
  await shutdownNextly().catch(() => undefined);
  await shutdownServices().catch(() => undefined);
  _resetBootMigrationsGateForTest();
  delete (globalThis as { __nextly_cachedInstance?: unknown })
    .__nextly_cachedInstance;
  delete (globalThis as { __nextly_initPromise?: unknown })
    .__nextly_initPromise;
}

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await resetBootState();
});

beforeAll(async () => {
  await resetBootState();
});

describe("the cold-boot notice against real boots", () => {
  it("says the request arrived before Nextly finished starting when it races a start under way", async () => {
    // The dev-only notice fires; the HMR side channel a dev boot would open is
    // not under test and stays off.
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("NEXTLY_DISABLE_HMR", "1");
    // eslint-disable-next-line turbo/no-undeclared-env-vars
    delete process.env.NEXTLY_DISABLE_INSTRUMENTATION_WARNING;
    const config = defineConfig({});
    // What an instrumentation.ts holds: the register() a project's root or
    // src/ file exports.
    const register = createRegister(config);

    // Park the start with nothing registered: the gate is open, so the boot
    // publishes its in-flight promise and stops before registering.
    openBootMigrationsGate();
    const lines = captureWarn();

    const start = register();
    const requestBoot = (async () => {
      setHandlerConfig(config);
      await ensureServicesInitialized();
    })();
    try {
      // Both the boot's registration and its end wait on the held gate; the
      // notice itself fires before any of that waiting.
      await vi.waitFor(() =>
        expect(lines.join("\n")).toContain("Cold-boot triggered")
      );
      expect(lines.join("\n")).toContain("before Nextly finished starting");
      expect(lines.join("\n")).not.toContain("instrumentation.ts detected");
    } finally {
      // Settles the gate even when an assertion above failed, so a failed
      // run leaves no boot parked and nothing for the next test to inherit.
      allowBootMigrations();
      await Promise.allSettled([start, requestBoot]);
    }
  });

  it("claims only that no start was observed when the request precedes any start", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("NEXTLY_DISABLE_HMR", "1");
    // eslint-disable-next-line turbo/no-undeclared-env-vars
    delete process.env.NEXTLY_DISABLE_INSTRUMENTATION_WARNING;
    const config = defineConfig({});

    // The window before a start has called Nextly at all is indistinguishable
    // from no start existing: the request boots first.
    const lines = captureWarn();
    setHandlerConfig(config);
    await ensureServicesInitialized();

    expect(lines.join("\n")).toContain("no start was observed in this process");
    expect(lines.join("\n")).not.toContain("instrumentation.ts detected");

    // The start a project runs still completes afterwards, beside the
    // services the request path registered.
    await getNextly({ config });
  });
});

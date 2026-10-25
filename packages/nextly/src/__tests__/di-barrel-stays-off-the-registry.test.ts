/**
 * Loading the DI barrel never loads the service registry.
 *
 * `di/index` is imported across the package for `getService` and
 * `isServicesRegistered`. Those read a container that boot has already filled,
 * so they need nothing from `di/register` or the registrations under
 * `di/registrations/`, and loading those pulls in every service the package
 * has. Until the barrel stopped re-exporting `register`'s values, every
 * importer of it paid that load, and the import cycle the registry sits on ran
 * through every one of them.
 *
 * What is asserted is the LOAD, not the source text. A type-only re-export of
 * `register` is erased before the barrel runs and loads nothing, so it is
 * allowed; a value re-export, a side-effect import, or a value import reached
 * through `service-access` or `container` all load the registry and fail here.
 * Each registry module is replaced by a factory that records that it was asked
 * for and then returns the real module, so the barrel's own evaluation is
 * unchanged.
 *
 * That `services/index` stays off the import cycle is the lint's job:
 * `import/no-cycle` covers it, since it is not on the cycle allowlist.
 */

import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it, vi } from "vitest";

const di = new URL("../di/", import.meta.url);

/** The registry: `register` itself and every registration module beside it. */
const REGISTRY = [
  fileURLToPath(new URL("register.ts", di)),
  ...readdirSync(new URL("registrations/", di), { withFileTypes: true })
    .filter(entry => entry.isFile() && /\.ts$/.test(entry.name))
    .filter(entry => !/\.test\.ts$/.test(entry.name))
    .map(entry => fileURLToPath(new URL(`registrations/${entry.name}`, di))),
];

/** Replaces each registry module with one that records its own load. */
function watchRegistry(): Set<string> {
  const loaded = new Set<string>();
  vi.resetModules();
  for (const file of REGISTRY) {
    vi.doMock(file, async importOriginal => {
      loaded.add(file);
      return importOriginal();
    });
  }
  return loaded;
}

afterEach(() => {
  for (const file of REGISTRY) vi.doUnmock(file);
  vi.resetModules();
});

describe("the DI barrel stays off the service registry", () => {
  it("watches register and every registration module", () => {
    // Discovered rather than listed, so a registration added later is watched
    // without editing this file. A count below this means the directory moved
    // and the test below would be watching nothing.
    expect(REGISTRY.length).toBeGreaterThan(10);
    expect(REGISTRY).toContain(fileURLToPath(new URL("register.ts", di)));
  });

  it("sees a load when the registry is imported directly", async () => {
    // The positive control: the same watch, on an import that does reach the
    // registry, has to record it. Without this, a watch that never fires
    // would pass the assertion below for any barrel.
    const loaded = watchRegistry();
    await import("../di/register");
    expect([...loaded]).toContain(fileURLToPath(new URL("register.ts", di)));
  });

  it("loads the barrel without loading the registry", async () => {
    const loaded = watchRegistry();
    const barrel = await import("../di/index");
    expect(typeof barrel.getService).toBe("function");
    expect(typeof barrel.isServicesRegistered).toBe("function");
    expect([...loaded]).toEqual([]);
  });
});

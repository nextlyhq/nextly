/**
 * The builder editor routes must survive ANY value of NODE_ENV the package was
 * built under. The registry is PREBUILT into the published dist, so a
 * module-load `process.env.NODE_ENV` check there answers where the library was
 * BUILT, never where it runs — a production-folding define once deleted these
 * six routes out of every published bundle while the sidebar's Builders links
 * kept resolving, dropping every New/Edit entry into NotFound.
 *
 * Availability belongs to the runtime layers (BuilderGuard on the host's
 * showBuilder answer, the sidebar's visibility, the server's
 * isBuilderEnabled), not to a build-time fold. Each test below re-evaluates
 * the registry module from scratch under one folded value and asserts the six
 * keys are still present — so reintroducing an env-based drop under EITHER
 * value fails here.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ROUTES } from "@admin/constants/routes";

const BUILDER_EDITOR_ROUTES = [
  ROUTES.BUILDER_COLLECTIONS_NEW,
  ROUTES.BUILDER_COLLECTIONS_EDIT,
  ROUTES.BUILDER_SINGLES_NEW,
  ROUTES.BUILDER_SINGLES_EDIT,
  ROUTES.BUILDER_FIELD_GROUPS_NEW,
  ROUTES.BUILDER_FIELD_GROUPS_EDIT,
] as const;

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
const ORIGINAL_EVENT_SOURCE = globalThis.EventSource;

beforeEach(() => {
  vi.resetModules();
  process.env.NODE_ENV = ORIGINAL_NODE_ENV;
  // The dev-folded evaluation runs the fetcher's module scope, which opens
  // the dev-reload stream; jsdom has no EventSource, so the import dies there
  // before the registry is ever reached. The stream's behavior is pinned in
  // dev-reload-guard.test.ts — here it only needs to not explode.
  globalThis.EventSource = class {
    addEventListener = vi.fn();
  } as unknown as typeof EventSource;
});

afterEach(() => {
  globalThis.EventSource = ORIGINAL_EVENT_SOURCE;
});

async function registryKeysUnder(
  nodeEnv: "development" | "production"
): Promise<string[]> {
  process.env.NODE_ENV = nodeEnv;
  const registry = (await import("../registry")).default;
  return Object.keys(registry);
}

describe("registry: builder editor routes survive the build-time NODE_ENV fold", () => {
  // Each test re-evaluates the whole page registry from scratch, and the
  // module graph (every page, Lexical, CodeMirror) costs seconds per pass.
  it(
    "keeps the six builder editor routes when the bundle folded development",
    { timeout: 60_000 },
    async () => {
      const keys = await registryKeysUnder("development");
      for (const route of BUILDER_EDITOR_ROUTES) {
        expect(keys).toContain(route);
      }
    }
  );

  it(
    "keeps the six builder editor routes when the bundle folded production",
    { timeout: 60_000 },
    async () => {
      // The regression this pins: a `NODE_ENV === "production"` module-load drop
      // deleted these keys from the published dist, dead-ending the builder's
      // New/Edit entries behind runtime guards that never got the chance to
      // apply the host's real showBuilder answer.
      const keys = await registryKeysUnder("production");
      for (const route of BUILDER_EDITOR_ROUTES) {
        expect(keys).toContain(route);
      }
    }
  );
});

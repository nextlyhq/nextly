// Regression: a single's reads/writes must survive a process whose table
// resolver never saw the single's registration.
//
// Runtime tables are registered per process (boot `loadDynamicTables` +
// create-time dispatcher registration). With several Next.js dev workers, a
// UI single created in worker A is invisible to worker B's resolver, and
// every read there failed with `Table "single_<slug>" not found in schema
// registry` until a restart (observed live). Collections recover via the
// FileManager's lazy schema rebuild; the singles services now do the
// equivalent through `ensureSingleRuntimeTable`.
//
// The "unaware worker" is simulated by swapping the adapter's resolver for
// one that answers null for the single's tables until something registers
// them — exactly worker B's starting state.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { defineSingle, text, textarea } from "../../../config";
import { dispatchSingles } from "../../../dispatcher/handlers/single-dispatcher";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";

beforeEach(() => {
  // The UI-create path only runs its migration in development. `vi.stubEnv`
  // rather than assigning: `NODE_ENV` is declared read-only.
  vi.stubEnv("NODE_ENV", "development");
});

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
  vi.unstubAllEnvs();
});

const LOCALIZATION = {
  locales: ["en", "de"],
  defaultLocale: "en",
};

interface ResolverLike {
  getTable(name: string): unknown;
}

/**
 * Swap the adapter's resolver for one that resolves `blocked` names ONLY
 * from its own registrations (initially none), delegating everything else
 * to the current registry — the state of a worker that booted before the
 * single existed.
 */
function blockSingleTables(t: TestNextly, ...blocked: string[]): void {
  // The adapter's own resolver, not the DI service: it is the object the
  // read path actually consults, and it is what the replacement below
  // delegates to for every table this test does not block.
  const inner = (t.adapter as unknown as { tableResolver: ResolverLike })
    .tableResolver;
  const blockedSet = new Set(blocked);
  const own = new Map<string, unknown>();
  const adapter = t.adapter as unknown as {
    setTableResolver: (r: unknown) => void;
  };
  adapter.setTableResolver({
    getTable(name: string) {
      if (own.has(name)) return own.get(name);
      if (blockedSet.has(name)) return null;
      return inner.getTable(name);
    },
    registerDynamicSchema(name: string, table: unknown) {
      own.set(name, table);
    },
  });
}

function entryServiceOf(t: TestNextly) {
  return t.getService("singleEntryService") as unknown as {
    get: (
      slug: string,
      options?: Record<string, unknown>
    ) => Promise<{
      success: boolean;
      statusCode?: number;
      message?: string;
      data?: Record<string, unknown>;
    }>;
    update: (
      slug: string,
      data: Record<string, unknown>,
      options?: Record<string, unknown>
    ) => Promise<{ success: boolean; message?: string }>;
  };
}

describe("singles lazy runtime-table registration (integration)", () => {
  it("reads and writes a UI-created localized single from an unaware resolver", async () => {
    current = await createTestNextly({
      collections: [],
      localization: LOCALIZATION,
    });

    // The real builder flow: wizard create (empty, localized), then the
    // canvas save adds a translatable field.
    await dispatchSingles(
      "createSingle",
      {},
      {
        slug: "test-page",
        label: "Test page",
        status: true,
        localized: true,
        fields: [],
      }
    );
    await dispatchSingles(
      "updateSingleSchema",
      { slug: "test-page" },
      {
        fields: [
          {
            name: "description",
            label: "Description",
            type: "text",
            required: false,
          },
        ],
        localized: true,
        status: true,
      }
    );

    // Simulate the worker that never saw the create.
    blockSingleTables(current, "single_test_page", "single_test_page_locales");

    // Read: previously DatabaseError `Table "single_test_page" not found in
    // schema registry`; the lazy registration now rebuilds it from the row.
    const read = await entryServiceOf(current).get("test-page", {
      overrideAccess: true,
      status: "all",
    });
    expect(read.success).toBe(true);

    // Write a translatable value — must route to the companion.
    const write = await entryServiceOf(current).update(
      "test-page",
      { description: "hello" },
      { overrideAccess: true }
    );
    expect(write.success).toBe(true);
    const adapter = current.adapter as unknown as {
      executeQuery: (sql: string) => Promise<Record<string, unknown>[]>;
    };
    const companionRows = await adapter.executeQuery(
      `SELECT "_locale", "description" FROM "single_test_page_locales"`
    );
    expect(companionRows.length).toBeGreaterThan(0);
    expect(companionRows[0]?.description).toBe("hello");
  });

  it("reads a code-first localized single from an unaware resolver", async () => {
    current = await createTestNextly({
      collections: [],
      singles: [
        defineSingle({
          slug: "landing",
          localized: true,
          fields: [text({ name: "title" }), textarea({ name: "intro" })],
        }),
      ],
      localization: LOCALIZATION,
    });

    blockSingleTables(current, "single_landing", "single_landing_locales");

    const read = await entryServiceOf(current).get("landing", {
      overrideAccess: true,
      status: "all",
    });
    expect(read.success).toBe(true);
  });
});

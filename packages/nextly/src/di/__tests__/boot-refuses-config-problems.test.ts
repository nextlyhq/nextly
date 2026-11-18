/**
 * What a start does with a configuration whose entities have problems. An entity declared
 * through its `define*` function is refused before anything connects, every problem named: those
 * functions record a problem rather than throw at import, so the start is where an app passing its
 * configuration to the runtime meets the refusal. An entity written as a plain object was never
 * judged at the start, so a site serving one is told of each problem and starts as it did; every
 * command refuses it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { _resetBootMigrationsGateForTest } from "../../init/boot-migrations-gate";

const created = vi.hoisted(() => ({ adapters: 0 }));

vi.mock("../../database/factory", async importOriginal => {
  const original =
    await importOriginal<typeof import("../../database/factory")>();
  return {
    ...original,
    createAdapterFromEnv: async () => {
      created.adapters += 1;
      return original.createAdapter({
        type: "sqlite",
        memory: true,
      } as Parameters<typeof original.createAdapter>[0]);
    },
  };
});
vi.mock("../../route-handler/auth-handler", () => ({
  setBootedConfig: () => undefined,
}));

const { registerServices } = await import("../register");
const { defineCollection } = await import(
  "../../collections/config/define-collection"
);
const { defineSingle } = await import("../../singles/config/define-single");
const { isServicesRegistered } = await import("../service-access");

/** The refusal `registerServices` ends with, or undefined when it ends with none. */
async function refusalOf(
  config: Parameters<typeof registerServices>[0]
): Promise<unknown> {
  return registerServices(config).then(
    () => undefined,
    (error: unknown) => error
  );
}

const DB = { migrationsDir: "./migrations", uiSchemaFile: "./ui-schema.json" };

beforeEach(() => {
  _resetBootMigrationsGateForTest();
  created.adapters = 0;
  vi.stubEnv("DB_DIALECT", "sqlite");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  _resetBootMigrationsGateForTest();
});

describe("a start given entities declared through define* with problems", () => {
  it("refuses with every problem before it connects anything", async () => {
    const config = {
      collections: [
        defineCollection({
          slug: "Blog Posts",
          fields: [{ name: "title", type: "text" }],
        }),
      ],
      singles: [
        defineSingle({
          slug: "home page",
          fields: [{ name: "heading", type: "text" }],
        }),
      ],
      db: DB,
    } as unknown as Parameters<typeof registerServices>[0];

    const refused = await refusalOf(config);

    expect(refused).toMatchObject({
      code: "VALIDATION_ERROR",
      logContext: { reason: "config-invalid" },
    });
    const paths = (
      (refused as { publicData?: { errors?: Array<{ path?: string }> } })
        .publicData?.errors ?? []
    ).map(problem => problem.path);
    expect(paths).toEqual(["collections[0].slug", "singles[0].slug"]);
    expect(created.adapters).toBe(0);
    expect(isServicesRegistered()).toBe(false);
  });
});

describe("a start given an entity written as a plain object with a problem", () => {
  it("warns of the problem, with its place, and goes on to connect", async () => {
    const warned: string[] = [];
    vi.spyOn(console, "warn").mockImplementation((...parts: unknown[]) => {
      warned.push(parts.map(String).join(" "));
    });
    // A field named by an SQL keyword: the general rules judge it, and no check the start made
    // before does, so a site declaring one starts today.
    const config = {
      collections: [
        { slug: "notes", fields: [{ name: "select", type: "text" }] },
      ],
      db: DB,
    } as unknown as Parameters<typeof registerServices>[0];

    const refused = await refusalOf(config);

    expect(refused).not.toMatchObject({
      logContext: { reason: "config-invalid" },
    });
    expect(
      warned.some(line => line.includes("collections[0].fields[0].name")),
      warned.join("\n")
    ).toBe(true);
    // Past the check, on to what the start does next.
    expect(created.adapters).toBe(1);
  });
});

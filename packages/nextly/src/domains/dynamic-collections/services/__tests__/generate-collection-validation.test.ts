/**
 * Request-shape validation before any dereference.
 *
 * The REST dispatcher forwards the raw request body, so `generateCollection`
 * receives caller-controlled input. It used to read `data.name.toLowerCase()`
 * immediately, so a body missing `name` threw a TypeError — a shape that is
 * indistinguishable from a genuine defect in our own code, and so could not be
 * reported as the 400 it actually is.
 */
import { beforeAll, describe, expect, it } from "vitest";

import { NextlyError } from "../../../../errors";
import { DynamicCollectionService } from "../dynamic-collection-service";

type Input = Parameters<DynamicCollectionService["generateCollection"]>[0];

beforeAll(() => {
  // The schema service reads the dialect at construction; these cases never
  // reach a database, but the constructor must still resolve it.
  process.env.DB_DIALECT ??= "sqlite";
  process.env.DATABASE_URL ??= "file::memory:";
});

function service(): DynamicCollectionService {
  const logger = {
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
  };
  // Minimal adapter slice: the constructor resolves the dialect eagerly, but
  // these cases reject before any query is attempted.
  const adapter = {
    getCapabilities: () => ({ dialect: "sqlite" as const }),
  } as unknown as ConstructorParameters<typeof DynamicCollectionService>[0];
  return new DynamicCollectionService(adapter, logger);
}

describe("generateCollection request validation", () => {
  it("rejects a body with no name as a validation error, not a crash", async () => {
    const err = await service()
      .generateCollection({ fields: [] } as unknown as Input)
      .catch((e: unknown) => e);

    expect(NextlyError.is(err)).toBe(true);
    expect((err as NextlyError).statusCode).toBe(400);
    expect(err).not.toBeInstanceOf(TypeError);
  });

  it("rejects a blank name", async () => {
    const err = await service()
      .generateCollection({ name: "   ", fields: [] } as unknown as Input)
      .catch((e: unknown) => e);

    expect(NextlyError.is(err)).toBe(true);
    expect((err as NextlyError).statusCode).toBe(400);
  });

  it("rejects a body whose fields are not an array", async () => {
    const err = await service()
      .generateCollection({ name: "posts" } as unknown as Input)
      .catch((e: unknown) => e);

    expect(NextlyError.is(err)).toBe(true);
    expect((err as NextlyError).statusCode).toBe(400);
  });
});

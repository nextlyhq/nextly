/**
 * Relationship expansion spreads the entire related row into the parent
 * entry, so it must strip secrets that belong to the RELATED collection: the
 * source collection's own field list never describes a related row. Two
 * leaks are guarded here — the users system entity's password hash (a column,
 * not a schema field) and a related dynamic collection's `password` field.
 */
import { afterAll, describe, it, expect, vi } from "vitest";

import { NextlyError } from "../../../../errors/nextly-error";
import { CollectionRelationshipService } from "../collection-relationship-service";

// getSystemEntityTable() resolves the users table via env.DB_DIALECT (not the
// adapter); sqlite needs no DATABASE_URL, so it validates cleanly in a unit
// test while still exposing a users table with a password_hash column.
const ORIGINAL_DB_DIALECT = process.env.DB_DIALECT;
process.env.DB_DIALECT = "sqlite";
afterAll(() => {
  if (ORIGINAL_DB_DIALECT === undefined) delete process.env.DB_DIALECT;
  else process.env.DB_DIALECT = ORIGINAL_DB_DIALECT;
});

function silentLogger() {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  } as never;
}

/**
 * Minimal adapter whose Drizzle handle answers the single-row
 * `select().from().where().limit()` chain fetchRelatedEntry uses.
 */
function adapterReturning(row: Record<string, unknown> | null) {
  const chain = {
    select: () => chain,
    from: () => chain,
    where: () => chain,
    limit: () => Promise.resolve(row ? [row] : []),
  };
  return {
    getDrizzle: () => chain,
    getDialect: () => "postgresql",
    dialect: "postgresql",
    getCapabilities: () => ({ dialect: "postgresql" }),
  } as never;
}

describe("relationship expansion secret redaction", () => {
  it("strips the users password hash from an expanded system-entity relation", async () => {
    const service = new CollectionRelationshipService(
      adapterReturning({
        id: "u1",
        email: "a@b.co",
        name: "Ada",
        password_hash: "$2b$12$storedhashstoredhashstored",
      }),
      silentLogger(),
      {} as never, // fileManager — unused on the system-entity path
      {} as never // collectionService — unused on the system-entity path
    );

    const related = await service.fetchRelatedEntry("users", "u1");

    expect(related).toMatchObject({ id: "u1", email: "a@b.co", name: "Ada" });
    expect(related).not.toHaveProperty("password_hash");
    expect(related).not.toHaveProperty("passwordHash");
  });

  it("strips a related dynamic collection's password field", async () => {
    // getCollection returns the RAW dynamic_collections row, whose fields live
    // at the top level (there is no schemaDefinition column) — a
    // schemaDefinition-only lookup would resolve to [] and never strip.
    const collectionService = {
      getCollection: vi.fn().mockResolvedValue({
        fields: [
          { name: "email", type: "text" },
          { name: "secret", type: "password" },
        ],
      }),
    };
    const fileManager = {
      loadDynamicSchema: vi.fn().mockResolvedValue({ id: {} }),
    };

    const service = new CollectionRelationshipService(
      adapterReturning({ id: "m1", email: "a@b.co", secret: "$2b$12$hash" }),
      silentLogger(),
      fileManager as never,
      collectionService as never
    );

    const related = await service.fetchRelatedEntry("members", "m1");

    expect(related).toMatchObject({ id: "m1", email: "a@b.co" });
    expect(related).not.toHaveProperty("secret");
  });

  it("strips a password nested in a JSON-string group container (sqlite shape)", async () => {
    // SQLite stores group/repeater as a JSON string; redaction must parse it,
    // strip the nested password, and re-serialize so the hash never leaks.
    const collectionService = {
      getCollection: vi.fn().mockResolvedValue({
        fields: [
          {
            name: "creds",
            type: "group",
            fields: [
              { name: "user", type: "text" },
              { name: "secret", type: "password" },
            ],
          },
        ],
      }),
    };
    const fileManager = {
      loadDynamicSchema: vi.fn().mockResolvedValue({ id: {} }),
    };

    const service = new CollectionRelationshipService(
      adapterReturning({
        id: "m1",
        creds: JSON.stringify({ user: "ada", secret: "$2b$12$hash" }),
      }),
      silentLogger(),
      fileManager as never,
      collectionService as never
    );

    const related = await service.fetchRelatedEntry("members", "m1");
    const creds = JSON.parse((related as Record<string, string>).creds);
    expect(creds).toEqual({ user: "ada" });
    expect(creds).not.toHaveProperty("secret");
  });

  it("fails closed to identity when the target schema cannot be resolved", async () => {
    // If the related collection's schema can't be loaded we cannot tell which
    // fields are secret, so every non-identity field is dropped rather than
    // returned unredacted.
    const collectionService = {
      getCollection: vi
        .fn()
        .mockRejectedValue(
          NextlyError.notFound({ logContext: { slug: "members" } })
        ),
    };
    const fileManager = {
      loadDynamicSchema: vi.fn().mockResolvedValue({ id: {} }),
    };

    const service = new CollectionRelationshipService(
      adapterReturning({ id: "m1", email: "a@b.co", secret: "$2b$12$hash" }),
      silentLogger(),
      fileManager as never,
      collectionService as never
    );

    const related = await service.fetchRelatedEntry("members", "m1");
    expect(related).toEqual({ id: "m1" });
  });

  it("returns null when the related row does not exist", async () => {
    const service = new CollectionRelationshipService(
      adapterReturning(null),
      silentLogger(),
      { loadDynamicSchema: vi.fn().mockResolvedValue({ id: {} }) } as never,
      { getCollection: vi.fn() } as never
    );

    expect(await service.fetchRelatedEntry("members", "missing")).toBeNull();
  });
});

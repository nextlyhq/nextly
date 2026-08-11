/**
 * Relationship expansion spreads the entire related row into the parent
 * entry, so it must strip secrets that belong to the RELATED collection: the
 * source collection's own field list never describes a related row. Two
 * leaks are guarded here — the users system entity's password hash (a column,
 * not a schema field) and a related dynamic collection's `password` field.
 */
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  it,
  expect,
  vi,
} from "vitest";

import { NextlyError } from "../../../../errors/nextly-error";
import {
  clearFieldFunctions,
  registerFieldFunctions,
} from "../../../../shared/lib/field-level-registry";
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
 * Minimal adapter whose Drizzle handle answers the
 * `select().from().where()` chain every related-row read uses.
 *
 * Resolves at `where()` rather than at a trailing `limit()`: one reader now
 * fetches by id list, so a single reference is a one-element list rather than a
 * limited query. A double that still answered only the limited shape would
 * resolve to nothing here and report a refusal that never happened.
 */
function adapterReturning(row: Record<string, unknown> | null) {
  const chain = {
    select: () => chain,
    from: () => chain,
    where: () => Promise.resolve(row ? [row] : []),
  };
  return {
    getDrizzle: () => chain,
    getDialect: () => "postgresql",
    dialect: "postgresql",
    getCapabilities: () => ({ dialect: "postgresql" }),
  } as never;
}

describe("relationship expansion secret redaction", () => {
  it("withholds a system-entity row a bounded caller refused", async () => {
    // A system entity has no stored collection rules, so the enforced path has
    // nothing to evaluate — the row is normally returned with its secrets
    // stripped. That is right for a caller with no bypass and wrong for one
    // that holds a bypass and did not name this target: the bound means "read
    // this as the audience would", and an anonymous audience cannot read
    // `users` at all. Stripping the password hash leaves email and name.
    const service = new CollectionRelationshipService(
      adapterReturning({
        id: "u1",
        email: "a@b.co",
        name: "Ada",
        password_hash: "$2b$12$storedhashstoredhashstored",
      }),
      silentLogger(),
      {} as never,
      {} as never
    );

    const related = await service.fetchRelatedEntry("users", "u1", {
      enforceCollectionAccess: true,
      overrideAccess: true,
      trusted: () => false,
      trustedIsSet: undefined,
    } as never);

    expect(related).toBeNull();
  });

  it("still returns a system-entity row for a caller with no bypass", async () => {
    // The positive control, and it is load-bearing: without it the check above
    // passes for a change that withholds system entities from EVERY enforced
    // read, which is every ordinary page that populates an author.
    const service = new CollectionRelationshipService(
      adapterReturning({ id: "u1", email: "a@b.co" }),
      silentLogger(),
      {} as never,
      {} as never
    );

    const related = await service.fetchRelatedEntry("users", "u1", {
      enforceCollectionAccess: true,
      overrideAccess: false,
      trusted: () => false,
    } as never);

    expect(related).toMatchObject({ id: "u1", email: "a@b.co" });
  });

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

  it("drops a hash-shaped label on the fail-closed path", async () => {
    const collectionService = {
      getCollection: vi.fn().mockRejectedValue(NextlyError.notFound()),
    };
    const fileManager = {
      loadDynamicSchema: vi.fn().mockResolvedValue({ id: {} }),
    };
    const service = new CollectionRelationshipService(
      // A legacy row that carried a bcrypt hash in `label` before password
      // fields were blocked from becoming labels.
      adapterReturning({ id: "m1", label: "$2b$12$leakedhashleakedhash" }),
      silentLogger(),
      fileManager as never,
      collectionService as never
    );

    const related = await service.fetchRelatedEntry("members", "m1");
    expect(related).toEqual({ id: "m1" });
    expect(related).not.toHaveProperty("label");
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

  /**
   * Secret stripping is unconditional; field-level `access.read` is a decision
   * about a specific caller. Expansion spreads the whole related row into the
   * parent entry, and the parent's own redaction pass runs against the SOURCE
   * collection's field registry — which never describes a related collection's
   * fields. So without the caller reaching the target collection's rules, a
   * field that collection protects is returned to anyone who populates the
   * relationship.
   */
  describe("field-level read access on related rows", () => {
    const TARGET_FIELDS = [
      { name: "email", type: "text" },
      {
        name: "salary",
        type: "number",
        // Only finance may read it. Registered as a live function, which is how
        // a code-first config supplies field access.
        access: {
          read: ({ req }: { req: { user?: { roles?: string[] } } }) =>
            req.user?.roles?.includes("finance") === true,
        },
      },
    ];

    function serviceWithTarget() {
      const collectionService = {
        getCollection: vi.fn().mockResolvedValue({ fields: TARGET_FIELDS }),
      };
      const fileManager = {
        loadDynamicSchema: vi.fn().mockResolvedValue({ id: {} }),
      };
      return new CollectionRelationshipService(
        adapterReturning({ id: "m1", email: "a@b.co", salary: 120000 }),
        silentLogger(),
        fileManager as never,
        collectionService as never
      );
    }

    beforeEach(() => {
      clearFieldFunctions();
      registerFieldFunctions("collection", "members", TARGET_FIELDS);
    });

    afterEach(() => {
      clearFieldFunctions();
    });

    it("strips a protected field from a related row for a caller the rule denies", async () => {
      const related = await serviceWithTarget().fetchRelatedEntry(
        "members",
        "m1",
        {
          trusted: undefined,
          enforceFieldAccess: true,
          user: { id: "u1", roles: ["editor"] },
        }
      );

      expect(related).toMatchObject({ id: "m1", email: "a@b.co" });
      expect(related).not.toHaveProperty("salary");
    });

    it("keeps the field for a caller the rule allows", async () => {
      const related = await serviceWithTarget().fetchRelatedEntry(
        "members",
        "m1",
        {
          trusted: undefined,
          enforceFieldAccess: true,
          user: { id: "u2", roles: ["finance"] },
        }
      );

      expect(related).toMatchObject({ salary: 120000 });
    });

    it("strips a protected field for an anonymous caller", async () => {
      // No user means no rule can be satisfied, matching how the parent entry
      // is redacted rather than treating "absent" as trusted.
      const related = await serviceWithTarget().fetchRelatedEntry(
        "members",
        "m1",
        { trusted: undefined, enforceFieldAccess: true }
      );

      expect(related).not.toHaveProperty("salary");
    });

    it("keeps the field for a trusted read", async () => {
      const related = await serviceWithTarget().fetchRelatedEntry(
        "members",
        "m1",
        { trusted: undefined, enforceFieldAccess: true, overrideAccess: true }
      );

      expect(related).toMatchObject({ salary: 120000 });
    });

    it("withholds the field when the caller does not trust this target", async () => {
      // `overrideAccess` says the CALLER is trusted; it says nothing about a
      // collection reached through a relationship, which the caller never named.
      // A caller that can state its trusted set keeps the bypass for what it
      // declared, and everything outside is read as its audience would read it.
      const related = await serviceWithTarget().fetchRelatedEntry(
        "members",
        "m1",
        {
          enforceFieldAccess: true,
          overrideAccess: true,
          trusted: () => false,
        }
      );

      expect(related).toMatchObject({ id: "m1", email: "a@b.co" });
      expect(related).not.toHaveProperty("salary");
    });

    it("keeps the field when the caller names THIS target as trusted", async () => {
      // The positive control, and it is what makes the case above evidence.
      // Without it, a predicate ignored entirely and a predicate that denies
      // everything produce the same result, and the check passes for a seam
      // that was never wired to the target's identity at all.
      const related = await serviceWithTarget().fetchRelatedEntry(
        "members",
        "m1",
        {
          enforceFieldAccess: true,
          overrideAccess: true,
          trusted: collection => collection === "members",
        }
      );

      expect(related).toMatchObject({ salary: 120000 });
    });

    it("still strips secrets on a trusted read", async () => {
      // overrideAccess waives the caller's field rules, not secret stripping: a
      // system reader has no more use for a password hash than anyone else.
      const fields = [
        { name: "email", type: "text" },
        { name: "secret", type: "password" },
      ];
      registerFieldFunctions("collection", "members", fields);
      const service = new CollectionRelationshipService(
        adapterReturning({ id: "m1", email: "a@b.co", secret: "$2b$12$hash" }),
        silentLogger(),
        { loadDynamicSchema: vi.fn().mockResolvedValue({ id: {} }) } as never,
        { getCollection: vi.fn().mockResolvedValue({ fields }) } as never
      );

      const related = await service.fetchRelatedEntry("members", "m1", {
        trusted: undefined,
        enforceFieldAccess: true,
        overrideAccess: true,
      });

      expect(related).not.toHaveProperty("secret");
    });

    it("leaves related rows alone for a caller that has not opted in", async () => {
      // "No user supplied" and "anonymous caller" are indistinguishable here and
      // want opposite outcomes, so enforcement is explicit: an expansion entry
      // point that has not been given the caller yet keeps its behavior instead
      // of stripping fields from everyone who reads through it.
      const related = await serviceWithTarget().fetchRelatedEntry(
        "members",
        "m1"
      );

      expect(related).toMatchObject({ salary: 120000 });
    });

    it("strips a denied field nested in a JSON-string container (sqlite shape)", async () => {
      // SQLite stores group/repeater as a JSON string. The rules have to reach
      // inside it and the container has to be written back as a string, or a
      // denied nested field rides out in the serialized value.
      const fields = [
        {
          name: "comp",
          type: "group",
          fields: [
            { name: "public", type: "text" },
            {
              name: "private",
              type: "text",
              access: { read: () => false },
            },
          ],
        },
      ];
      clearFieldFunctions();
      registerFieldFunctions("collection", "members", fields);
      const service = new CollectionRelationshipService(
        adapterReturning({
          id: "m1",
          comp: JSON.stringify({ public: "ok", private: "secret" }),
        }),
        silentLogger(),
        { loadDynamicSchema: vi.fn().mockResolvedValue({ id: {} }) } as never,
        { getCollection: vi.fn().mockResolvedValue({ fields }) } as never
      );

      const related = await service.fetchRelatedEntry("members", "m1", {
        trusted: undefined,
        enforceFieldAccess: true,
        user: { id: "u1" },
      });

      const comp = JSON.parse((related as Record<string, string>).comp);
      expect(comp).toEqual({ public: "ok" });
      // Still a string, so the column type survives the round trip.
      expect(typeof (related as Record<string, unknown>).comp).toBe("string");
    });

    it("does not leak a denied field through the derived label", async () => {
      // The label is a copy of a field's value under another key, so redacting
      // the source field does not touch it. Taken from an unredacted row, a
      // protected value walks straight out as `label`.
      const fields = [
        {
          name: "codename",
          type: "text",
          access: { read: () => false },
        },
      ];
      clearFieldFunctions();
      registerFieldFunctions("collection", "members", fields);

      const rows = [{ id: "m1", codename: "classified" }];
      const batchAdapter = {
        getDrizzle: () => ({
          select: () => ({
            from: () => ({ where: () => Promise.resolve(rows) }),
          }),
        }),
        getDialect: () => "postgresql",
        dialect: "postgresql",
        getCapabilities: () => ({ dialect: "postgresql" }),
      } as never;

      const service = new CollectionRelationshipService(
        batchAdapter,
        silentLogger(),
        { loadDynamicSchema: vi.fn().mockResolvedValue({ id: {} }) } as never,
        { getCollection: vi.fn().mockResolvedValue({ fields }) } as never
      );

      const map = await service.batchFetchRelatedEntries(
        "members",
        ["m1"],
        {
          name: "member",
          type: "relationship",
          options: { targetLabelField: "codename" },
        } as never,
        { trusted: undefined, enforceFieldAccess: true, user: { id: "u1" } }
      );

      const related = map.get("m1");
      expect(related).not.toHaveProperty("codename");
      // Falls back to the id rather than carrying the denied value.
      expect(related?.label).toBe("m1");
    });

    it("evaluates rules on a target with no password field", async () => {
      // The secret pass returns early when the target has no password field, so
      // an access pass folded into it would never run for the common case.
      expect(TARGET_FIELDS.some(f => f.type === "password")).toBe(false);

      const related = await serviceWithTarget().fetchRelatedEntry(
        "members",
        "m1",
        {
          trusted: undefined,
          enforceFieldAccess: true,
          user: { id: "u1", roles: ["editor"] },
        }
      );

      expect(related).not.toHaveProperty("salary");
    });
  });

  describe("label field never resolves to a secret", () => {
    function labelService(getCollection: () => unknown) {
      return new CollectionRelationshipService(
        adapterReturning(null),
        silentLogger(),
        { loadDynamicSchema: vi.fn() } as never,
        { getCollection: vi.fn(getCollection) } as never
      );
    }

    it("rejects a secret column configured as a users label", async () => {
      const service = labelService(() => ({}));
      // Both the camelCase and stored snake_case secret columns are refused.
      expect(await service.getBestLabelField("users", "passwordHash")).toBe(
        "name"
      );
      expect(await service.getBestLabelField("users", "password_hash")).toBe(
        "name"
      );
    });

    it("never auto-selects a password field as the label", async () => {
      // A `password` field named like a priority label ("email") must be
      // skipped; the next non-secret priority field wins.
      const service = labelService(() => ({
        fields: [
          { name: "email", type: "password" },
          { name: "title", type: "text" },
        ],
      }));
      expect(await service.getBestLabelField("members")).toBe("title");
    });

    it("rejects an explicit password targetLabelField and falls back", async () => {
      const service = labelService(() => ({
        fields: [
          { name: "secret", type: "password" },
          { name: "name", type: "text" },
        ],
      }));
      expect(await service.getBestLabelField("members", "secret")).toBe("name");
    });
  });
});

/**
 * Two relationship fields can point at the SAME related row while asking for
 * DIFFERENT display labels. Batch expansion fetches per field, so each holds its
 * own row object carrying its own label, and rebuilding the response has to keep
 * them apart: a snapshot keyed on the row alone would let one field's
 * presentation replace the other's.
 */
describe("related-row re-derivation keeps per-field presentation", () => {
  afterEach(() => {
    clearFieldFunctions();
  });

  function labelledService() {
    const collectionService = {
      getCollection: vi.fn().mockImplementation((slug: string) => {
        if (slug === "posts") {
          return Promise.resolve({
            fields: [
              { name: "author", type: "relationship", relationTo: "authors" },
              {
                name: "reviewer",
                type: "relationship",
                relationTo: "authors",
                options: { targetLabelField: "handle" },
              },
            ],
          });
        }
        return Promise.resolve({
          fields: [
            { name: "name", type: "text" },
            { name: "handle", type: "text" },
          ],
        });
      }),
    };
    return new CollectionRelationshipService(
      adapterReturning(null),
      silentLogger(),
      { loadDynamicSchema: vi.fn().mockResolvedValue({ id: {} }) } as never,
      collectionService as never
    );
  }

  it("keeps each field's own label when both point at the same row", async () => {
    const service = labelledService();
    // Distinct objects with the same id, as per-field batch expansion produces.
    const entry = {
      id: "p1",
      author: { id: "a1", name: "Ada", handle: "adah", label: "Ada" },
      reviewer: { id: "a1", name: "Ada", handle: "adah", label: "adah" },
    };
    const access = {
      enforceFieldAccess: true,
      user: { id: "u1" },
      trusted: undefined,
    };
    const state = service.createNestedHookState();

    await service.applyNestedFieldHooks(entry, "posts", access, state);
    await service.finalizeRelatedRows(state, access);
    await service.reprojectRelatedRows([entry], "posts", access, state);

    const author = entry.author as Record<string, unknown>;
    const reviewer = entry.reviewer as Record<string, unknown>;
    expect(author.label).toBe("Ada");
    expect(reviewer.label).toBe("adah");
  });
});

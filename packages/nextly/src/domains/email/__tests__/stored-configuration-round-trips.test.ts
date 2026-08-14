/**
 * What is stored must survive being read back and parsed again.
 *
 * The service persists the value `parseConfig` returned, and an adapter is
 * built by re-parsing what the column holds. So the write is only safe when
 * parsing the stored form returns the stored form — otherwise the operator
 * saves one configuration and the adapter runs on another, with nothing in
 * between reporting a difference.
 */

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { getCoreSchema } from "../../../schemas";
import type { Logger } from "../../../services/shared";
import { createTableBody } from "../../schema/pipeline/sql-templates/create-table-body";
import { defineEmailProvider } from "../provider-definition";
import {
  getEmailProviderRegistry,
  resetEmailProviderRegistry,
} from "../services/email-provider-registry";
import { EmailProviderService } from "../services/email-provider-service";

vi.mock("../../../lib/env", () => ({
  env: {
    NEXTLY_SECRET: "test-secret-must-be-32chars-long!!",
    DB_DIALECT: "sqlite",
    DATABASE_URL: undefined,
    NODE_ENV: "test",
  },
}));

function makeAdapter(db: ReturnType<typeof drizzle>): DrizzleAdapter {
  return {
    dialect: "sqlite" as const,
    getDrizzle: () => db,
    getCapabilities: () => ({ dialect: "sqlite" as const }),
    connect: async () => {},
    disconnect: async () => {},
    executeQuery: async () => [],
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(db),
  } as unknown as DrizzleAdapter;
}

const logger: Logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

/**
 * The real `email_providers` table, built from the core schema.
 *
 * A hand-copied `CREATE TABLE` keeps passing after the production column list
 * moves, and reports coverage it never re-checked.
 */
function createInMemoryDb() {
  const sqlite = new Database(":memory:");
  const spec = getCoreSchema("sqlite").tables.find(
    t => t.name === "email_providers"
  );
  if (!spec) {
    // A vitest failure rather than a thrown error: the table vanishing from
    // the core schema is a broken precondition of this fixture, not a runtime
    // fault, and naming it that way names the file that needs updating.
    expect.fail(
      "email_providers is absent from the core schema — this fixture can no longer be derived from it."
    );
  }
  sqlite.exec(
    `CREATE TABLE "email_providers" (\n${createTableBody(spec, (id: string) => `"${id}"`)}\n)`
  );
  // No `schema` option: these tests only ever go through the service.
  return { sqlite, db: drizzle({ client: sqlite }) };
}

/** A provider whose parser is whatever the case under test needs it to be. */
function register(type: string, parseConfig: (input: unknown) => object) {
  getEmailProviderRegistry().register(
    defineEmailProvider<object>({
      type,
      label: type,
      configFields: [
        { name: "apiKey", label: "API Key", kind: "password", secret: true },
      ],
      parseConfig,
      createAdapter: () => ({
        send: () => Promise.resolve({ success: true }),
      }),
    })
  );
}

describe("a configuration whose parse is not a fixed point", () => {
  let sqlite: Database.Database;
  let service: EmailProviderService;

  const write = (type: string, configuration: Record<string, unknown>) =>
    service.createProvider({
      name: "Test",
      type: type as never,
      fromEmail: "from@example.com",
      configuration,
    });

  beforeEach(() => {
    resetEmailProviderRegistry();
    const { sqlite: s, db } = createInMemoryDb();
    sqlite = s;
    service = new EmailProviderService(makeAdapter(db), logger);
  });

  afterEach(() => {
    sqlite.close();
    resetEmailProviderRegistry();
  });

  // The POSITIVE CONTROL. A parser that reshapes rather than derives is the
  // ordinary case, and it has to keep working — a check that refused every
  // write would pass the three below while telling nobody anything.
  it("stores a configuration a reshaping parser accepts back", async () => {
    register("reshaping", input => ({
      apiKey: String((input as { apiKey: unknown }).apiKey).trim(),
    }));

    const provider = await write("reshaping", { apiKey: "  k  " });

    // Read BACK, not just "the insert succeeded". A truthy id is true whether
    // the column holds the trimmed parsed value or the padded input, which is
    // the one difference this PR exists to make.
    const stored = await service.getProviderDecrypted(provider.id);
    expect(stored.configuration).toEqual({ apiKey: "k" });
  });

  // Encoding on the way in and encoding the encoding on the way out. The
  // operator entered a correct key and the provider would answer "bad key".
  it("refuses a parser that derives its value", async () => {
    register("deriving", input => ({
      apiKey: Buffer.from(
        String((input as { apiKey: unknown }).apiKey)
      ).toString("base64"),
    }));

    await expect(write("deriving", { apiKey: "secret" })).rejects.toThrow(
      /parsing what would be saved does not return what was saved/
    );
  });

  // JSON carries no `Date`, so the column holds its ISO string. That coercion
  // is the accepted cost of defining the stored configuration AS its
  // serialisation: the adapter is handed the string. Asserted on the value
  // READ BACK, because "the write succeeded" is true of a refusal-free
  // implementation that stored anything at all.
  it("stores a value JSON cannot carry as the form the column holds", async () => {
    register("dated", input => ({
      apiKey: String((input as { apiKey: unknown }).apiKey),
      issuedAt: new Date(0),
    }));

    const provider = await write("dated", { apiKey: "k" });

    const stored = await service.getProviderDecrypted(provider.id);
    expect(stored.configuration).toEqual({
      apiKey: "k",
      issuedAt: "1970-01-01T00:00:00.000Z",
    });
  });

  // The comparison is made in the JSON domain, and the naive way to do that is
  // to compare the two serialisations as TEXT. Insertion order changes the
  // text and changes nothing about the value, and a parser that rebuilds its
  // output field by field is an ordinary thing to write — so a text
  // comparison would refuse this while a structural one accepts it.
  it("stores a configuration whose parser reorders its own fields", async () => {
    register("reordering", input => {
      const value = input as { apiKey: unknown; region?: unknown };
      return value.region === undefined
        ? { apiKey: String(value.apiKey), region: "eu" }
        : { region: String(value.region), apiKey: String(value.apiKey) };
    });

    const provider = await write("reordering", { apiKey: "k" });

    const stored = await service.getProviderDecrypted(provider.id);
    expect(stored.configuration).toEqual({ apiKey: "k", region: "eu" });
  });

  // The same property reached by throwing rather than by returning something
  // different, which is what a parser that rejects its own output does.
  it("refuses a parser that rejects its own output", async () => {
    register("self-rejecting", input => {
      const value = input as { apiKey: unknown; parsed?: boolean };
      if (value.parsed === true) throw new Error("already parsed");
      return { apiKey: String(value.apiKey), parsed: true };
    });

    await expect(write("self-rejecting", { apiKey: "k" })).rejects.toThrow(
      /parsing what would be saved does not return what was saved/
    );
  });

  // `undefined` is another value JSON cannot carry: the column drops the key.
  // Under the same rule as the `Date` above the write is accepted and the key
  // is simply absent, which is what an optional field means anyway.
  it("stores a parser's undefined-valued key as an absent one", async () => {
    register("optional", input => ({
      apiKey: String((input as { apiKey: unknown }).apiKey),
      label: undefined,
    }));

    const provider = await write("optional", { apiKey: "k" });

    const stored = await service.getProviderDecrypted(provider.id);
    expect(stored.configuration).toEqual({ apiKey: "k" });
    expect(Object.keys(stored.configuration as object)).not.toContain("label");
  });

  // A parser that OMITS the key instead round-trips cleanly, which is the
  // shape an optional field normally takes and has to keep working.
  it("stores a configuration whose parser omits an absent optional", async () => {
    register("omitting", input => {
      const value = input as { apiKey: unknown; label?: unknown };
      return typeof value.label === "string"
        ? { apiKey: String(value.apiKey), label: value.label }
        : { apiKey: String(value.apiKey) };
    });

    const provider = await write("omitting", { apiKey: "k" });

    expect(provider.id).toBeTruthy();
  });

  // `toJSON` turns the record into a scalar, so the value the column holds is
  // not an object however the parsed value looked.
  it("refuses a parser whose value serialises to a scalar", async () => {
    register("to-json", input => ({
      apiKey: String((input as { apiKey: unknown }).apiKey),
      toJSON: () => "flattened",
    }));

    await expect(write("to-json", { apiKey: "k" })).rejects.toThrow(
      /must be an object of fields/
    );
  });

  // A `bigint` cannot be written as JSON at all, and the raw TypeError would
  // reach the caller as a generic internal failure naming nothing.
  it("refuses a parser returning a value JSON cannot serialise", async () => {
    register("bigint", input => ({
      apiKey: String((input as { apiKey: unknown }).apiKey),
      window: 1n,
    }));

    await expect(write("bigint", { apiKey: "k" })).rejects.toThrow(
      /cannot be written as JSON/
    );
  });

  // A parser that normalises IN PLACE and returns its input. The comparison
  // must not end up holding the same object on both sides.
  it("refuses a parser that derives by mutating its input", async () => {
    register("mutating", input => {
      const value = input as { apiKey: string };
      value.apiKey = Buffer.from(value.apiKey).toString("base64");
      return value;
    });

    await expect(write("mutating", { apiKey: "secret" })).rejects.toThrow(
      /parsing what would be saved does not return what was saved/
    );
  });

  // A PASS-THROUGH parser: it accepts both the typed value and its JSON form.
  // Under the previous contract this was the case the round-trip comparison
  // existed to catch, because re-parsing agrees with itself while the stored
  // value lost its type. Losing the type is now the defined outcome rather
  // than a fault, so the assertion is on WHAT IS STORED — which is the only
  // thing that separates this from a check that stopped looking.
  it("stores the coerced value a pass-through parser accepts back", async () => {
    register("passthrough-date", input => {
      const value = input as { apiKey: unknown; issuedAt?: unknown };
      return value.issuedAt === undefined
        ? { apiKey: String(value.apiKey), issuedAt: new Date(0) }
        : (value as object);
    });

    const provider = await write("passthrough-date", { apiKey: "k" });

    const stored = await service.getProviderDecrypted(provider.id);
    expect(stored.configuration).toEqual({
      apiKey: "k",
      issuedAt: "1970-01-01T00:00:00.000Z",
    });
  });

  // A root `toJSON` returning undefined makes JSON.stringify return undefined
  // WITHOUT throwing, so the catch never fires and JSON.parse then throws a
  // raw SyntaxError the caller sees as a generic internal failure.
  it("refuses a parser whose value serialises to undefined", async () => {
    register("to-json-undefined", input => ({
      apiKey: String((input as { apiKey: unknown }).apiKey),
      toJSON: () => undefined,
    }));

    await expect(write("to-json-undefined", { apiKey: "k" })).rejects.toThrow(
      /cannot be written as JSON/
    );
  });

  // A STATEFUL toJSON: the first serialisation is validated, and encryption
  // serialises the object a second time to a different result.
  it("stores the serialisation that was validated, not a later one", async () => {
    let calls = 0;
    register("stateful", input => {
      const apiKey = String((input as { apiKey: unknown }).apiKey);
      return { apiKey, toJSON: () => ({ apiKey, call: ++calls }) };
    });

    const provider = await write("stateful", { apiKey: "k" }).catch(
      () => undefined
    );
    // Either it is refused, or what was stored is what passed the check --
    // never a third value produced by serialising again after validation.
    if (provider) {
      const stored = await service.getProviderDecrypted(provider.id);
      expect((stored.configuration as { call?: number }).call).toBe(1);
    }
  });

  // An INHERITED field is materialised by zod into its parsed output as an own
  // property, so a caller that never sent the credential has one persisted.
  it("does not persist a configuration field the caller never sent", async () => {
    register("inheriting", input => ({
      apiKey: String((input as { apiKey?: unknown }).apiKey ?? ""),
      ...(typeof (input as { token?: unknown }).token === "string"
        ? { token: (input as { token: string }).token }
        : {}),
    }));

    const provider = await write(
      "inheriting",
      Object.create(
        { token: "injected-by-prototype" },
        {
          apiKey: { value: "k", enumerable: true, writable: true },
        }
      ) as Record<string, unknown>
    );

    const stored = await service.getProviderDecrypted(provider.id);
    expect(stored.configuration).toEqual({ apiKey: "k" });
  });

  // An ARRAY is ordinary configuration and JSON preserves it exactly. Its
  // `length` is a non-enumerable own key, so a naive own-key comparison
  // rejects every provider that has one.
  it("stores a configuration containing an array", async () => {
    register("with-array", input => ({
      apiKey: String((input as { apiKey: unknown }).apiKey),
      scopes: ["send", "read"],
    }));

    const provider = await write("with-array", { apiKey: "k" });
    const stored = await service.getProviderDecrypted(provider.id);
    expect(stored.configuration).toEqual({
      apiKey: "k",
      scopes: ["send", "read"],
    });
  });

  // Coercion and DESTRUCTION are different, and only the first is accepted.
  // A `Map`'s entries are not own enumerable properties, so it serialises to
  // `{}` — the operator's headers are gone and the adapter runs without them.
  // The fixed-point comparison cannot see this on its own: both of its sides
  // are already past the column, so an empty projection agrees with an empty
  // projection and the write looks clean.
  it("refuses a value whose serialisation keeps nothing", async () => {
    register("mapped", input => {
      const value = input as { apiKey: unknown; headers?: unknown };
      return {
        apiKey: String(value.apiKey),
        headers:
          value.headers instanceof Map
            ? value.headers
            : new Map([["x-team", "ops"]]),
      };
    });

    await expect(write("mapped", { apiKey: "k" })).rejects.toThrow(
      /at headers that keeps nothing when written as JSON/
    );
  });

  // Reached through an array rather than a key, so the walk is not only over
  // object properties. A `Set` empties the same way a `Map` does.
  it("refuses an emptied value nested inside an array", async () => {
    register("nested-set", input => ({
      apiKey: String((input as { apiKey: unknown }).apiKey),
      routes: [{ region: "eu", tags: new Set(["primary"]) }],
    }));

    await expect(write("nested-set", { apiKey: "k" })).rejects.toThrow(
      /at routes\.\[0\]\.tags that keeps nothing/
    );
  });

  // An ORDINARY object can empty itself too, by defining a `toJSON` that
  // returns nothing while the object holds real values. Deciding this by
  // prototype would exempt it — the prototype is `Object.prototype` — so
  // emptiness has to be judged by whether the value genuinely held nothing.
  it("refuses a plain object whose own toJSON discards its fields", async () => {
    register("self-emptying", input => {
      const value = input as { apiKey: unknown; headers?: unknown };
      return {
        apiKey: String(value.apiKey),
        headers: value.headers ?? { token: "ops", toJSON: () => ({}) },
      };
    });

    await expect(write("self-emptying", { apiKey: "k" })).rejects.toThrow(
      /at headers that keeps nothing when written as JSON/
    );
  });

  // The boundary case that stops the rule above from over-reaching: a plain
  // empty object also serialises to `{}` and has lost nothing, because there
  // was nothing to lose. Refusing it would reject an ordinary configuration
  // that happens to carry an empty map of options.
  it("stores a configuration containing an empty plain object", async () => {
    register("empty-object", input => ({
      apiKey: String((input as { apiKey: unknown }).apiKey),
      headers: {},
    }));

    const provider = await write("empty-object", { apiKey: "k" });
    const stored = await service.getProviderDecrypted(provider.id);
    expect(stored.configuration).toEqual({ apiKey: "k", headers: {} });
  });
});

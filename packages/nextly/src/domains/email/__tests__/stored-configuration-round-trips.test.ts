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

  // JSON carries no `Date`, so the column holds a string and the adapter is
  // handed a shape this provider's own parser just rejected.
  it("refuses a parser returning a value JSON cannot carry", async () => {
    register("dated", input => ({
      apiKey: String((input as { apiKey: unknown }).apiKey),
      issuedAt: new Date(0),
    }));

    await expect(write("dated", { apiKey: "k" })).rejects.toThrow(
      /parsing what would be saved does not return what was saved/
    );
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

  // `undefined` is a third value JSON cannot carry, not an exception to the
  // rule: the column drops the key and the parser puts it back, so what is
  // held and what is stored are different objects on every read.
  it("refuses a parser that returns an undefined-valued key", async () => {
    register("optional", input => ({
      apiKey: String((input as { apiKey: unknown }).apiKey),
      label: undefined,
    }));

    await expect(write("optional", { apiKey: "k" })).rejects.toThrow(
      /parsing what would be saved does not return what was saved/
    );
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

  // A PASS-THROUGH parser: it accepts both the typed value and its JSON form,
  // so re-parsing agrees with itself while the value actually stored lost its
  // type. The Date test above recreates the Date and cannot see this.
  it("refuses a pass-through parser whose value loses type in the column", async () => {
    register("passthrough-date", input => {
      const value = input as { apiKey: unknown; issuedAt?: unknown };
      return value.issuedAt === undefined
        ? { apiKey: String(value.apiKey), issuedAt: new Date(0) }
        : (value as object);
    });

    await expect(write("passthrough-date", { apiKey: "k" })).rejects.toThrow(
      /parsing what would be saved does not return what was saved|cannot be written as JSON/
    );
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

  // A non-enumerable own property is dropped by JSON and ignored by
  // isDeepStrictEqual, so both comparisons agree over a property the column
  // never holds and the adapter gets back on every reparse.
  it("refuses a parser returning a non-enumerable property", async () => {
    register("hidden", input => {
      const out = { apiKey: String((input as { apiKey: unknown }).apiKey) };
      Object.defineProperty(out, "token", {
        value: "derived",
        enumerable: false,
      });
      return out;
    });

    await expect(write("hidden", { apiKey: "k" })).rejects.toThrow(
      /properties JSON cannot write/
    );
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

  // The same hole one level down: a non-enumerable property on a NESTED object
  // is dropped by JSON and ignored by isDeepStrictEqual just as a root one is.
  it("refuses a non-enumerable property below the root", async () => {
    register("hidden-nested", input => {
      const auth = {};
      Object.defineProperty(auth, "token", {
        value: "derived",
        enumerable: false,
      });
      return { apiKey: String((input as { apiKey: unknown }).apiKey), auth };
    });

    await expect(write("hidden-nested", { apiKey: "k" })).rejects.toThrow(
      /properties JSON cannot write/
    );
  });

  // Inspecting the parsed value runs USER code when it is a proxy, and that
  // has to fail as a provider-configuration fault rather than a raw TypeError.
  it("reports a parsed value whose inspection throws", async () => {
    register("hostile-proxy", input => {
      void input;
      return new Proxy(
        {},
        {
          ownKeys() {
            throw new TypeError("ownKeys trap exploded");
          },
        }
      );
    });

    await expect(write("hostile-proxy", { apiKey: "k" })).rejects.toThrow(
      /Email provider "hostile-proxy"/
    );
  });
});

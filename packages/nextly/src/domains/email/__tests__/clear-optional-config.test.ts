/**
 * How a patch says "unset this", and why it needs a third state.
 *
 * A patch merged over stored configuration has two states on its own: absent
 * means "leave it" and a value means "set it". An optional field therefore
 * became permanent the moment it was first saved — clearing it in the form
 * omitted it, and omission is indistinguishable from not touching it.
 */

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { getCoreSchema } from "../../../schemas";
import type { Logger } from "../../../services/shared";
import { createTableBody } from "../../schema/pipeline/sql-templates/create-table-body";
import { defineEmailProvider } from "../provider-definition";
import { getEmailProviderRegistry } from "../services/email-provider-registry";
import { EmailProviderService } from "../services/email-provider-service";

vi.mock("../../../lib/env", () => ({
  env: {
    NEXTLY_SECRET: "test-secret-that-is-long-enough-for-derivation",
    DB_DIALECT: "sqlite",
    DATABASE_URL: undefined,
    NODE_ENV: "test",
  },
}));

const logger: Logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

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

function createEmailProvidersTable(sqlite: Database.Database): void {
  const { tables } = getCoreSchema("sqlite");
  const spec = tables.find(table => table.name === "email_providers");
  if (!spec) {
    expect.fail(
      "email_providers is absent from the core schema — this fixture can no longer be derived from it."
    );
  }
  sqlite.exec(
    `CREATE TABLE "email_providers" (\n${createTableBody(spec, (id: string) => `"${id}"`)}\n)`
  );
}

/**
 * A provider with an OPTIONAL select, parsed the way a provider author would
 * naturally write it. `z.enum(...).optional()` accepts an absent key and
 * rejects both an empty string and a null, which is precisely why removal has
 * to be removal rather than a sentinel value.
 */
const optionalSelectProvider = defineEmailProvider<{
  apiKey: string;
  tier?: "standard" | "priority";
}>({
  type: "tiered",
  label: "Tiered",
  configFields: [
    {
      name: "apiKey",
      label: "API Key",
      kind: "password",
      required: true,
      secret: true,
    },
    {
      name: "tier",
      label: "Tier",
      kind: "select",
      options: [
        { value: "standard", label: "Standard" },
        { value: "priority", label: "Priority" },
      ],
    },
  ],
  parseConfig: input => {
    const config = input as { apiKey?: unknown; tier?: unknown };
    if (typeof config.apiKey !== "string" || config.apiKey === "") {
      throw new Error("apiKey is required");
    }
    if (
      config.tier !== undefined &&
      config.tier !== "standard" &&
      config.tier !== "priority"
    ) {
      throw new Error("tier must be standard or priority");
    }
    return config as { apiKey: string; tier?: "standard" | "priority" };
  },
  createAdapter: () => ({
    send: () => Promise.resolve({ success: true, messageId: "x" }),
  }),
});

describe("clearing an optional configuration value", () => {
  let sqlite: Database.Database;
  let service: EmailProviderService;
  let providerId: string;

  beforeEach(async () => {
    sqlite = new Database(":memory:");
    createEmailProvidersTable(sqlite);
    service = new EmailProviderService(
      makeAdapter(drizzle({ client: sqlite })),
      logger
    );
    getEmailProviderRegistry().register(optionalSelectProvider);

    const created = await service.createProvider({
      name: "Tiered",
      type: "tiered",
      fromEmail: "noreply@example.com",
      fromName: null,
      configuration: { apiKey: "k-1", tier: "priority" },
      isDefault: false,
      isActive: true,
    });
    providerId = created.id;
  });

  afterEach(() => {
    sqlite.close();
    getEmailProviderRegistry().reset();
  });

  it("removes the key when the patch carries null", async () => {
    await service.updateProvider(providerId, {
      configuration: { tier: null },
    });

    const stored = await service.getProviderDecrypted(providerId);
    expect(stored.configuration).not.toHaveProperty("tier");
    // The control: removal must not take the rest of the configuration with
    // it, or "clear one field" becomes "lose the credential".
    expect(stored.configuration).toMatchObject({ apiKey: "k-1" });
  });

  it("leaves the key alone when the patch omits it", async () => {
    // The other half of the distinction. Omission has to keep meaning "leave
    // it", or every partial edit would erase everything it did not mention.
    await service.updateProvider(providerId, { name: "Renamed" });

    const stored = await service.getProviderDecrypted(providerId);
    expect(stored.configuration).toMatchObject({ tier: "priority" });
  });

  it("still refuses to remove a value the provider requires", async () => {
    // Removal is a request, not an instruction: the provider's own parser
    // decides, and a credential it needs cannot be cleared.
    await expect(
      service.updateProvider(providerId, { configuration: { apiKey: null } })
    ).rejects.toThrow();
  });
});

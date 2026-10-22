/**
 * The brand store's copy of the settings, and when a render reads them.
 *
 * Inside a caller's open transaction a render answers from the copy, so the
 * copy must never fall behind a save this instance made: a read that began
 * before the save and finished after it must not put the older settings back.
 * And a render that cannot use the settings must not wait on the table at all.
 *
 * On a real in-memory SQLite table; only whether a transaction is open, and
 * the timing of one read, are arranged.
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { createSqliteAdapter } from "@nextlyhq/adapter-sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getDrizzleKitForDialect } from "../../../database/drizzle-kit-lazy";
import { emailBrandTables } from "../../../schemas/email-brand";
import { emailTemplatesSqlite } from "../../../schemas/email-templates/sqlite";
import { splitStatements } from "../../schema/pipeline/sql-statement-utils";
import { STARTING_BRAND, type BrandSettings } from "../brand-settings";
import { EmailBrandStore } from "../services/email-brand-store";
import { EmailTemplateService } from "../services/email-template-service";

import { silentLogger } from "./template-ownership-fixture";

let adapter: DrizzleAdapter;
let transactionOpen = false;

beforeEach(async () => {
  adapter = createSqliteAdapter({ memory: true }) as unknown as DrizzleAdapter;
  await adapter.connect();
  const kit = await getDrizzleKitForDialect("sqlite");
  const statements = await kit.generateMigration(
    await kit.generateDrizzleJson({}),
    await kit.generateDrizzleJson({
      emailTemplatesSqlite,
      ...emailBrandTables("sqlite"),
    })
  );
  for (const statement of splitStatements(statements)) {
    await adapter.executeQuery(statement);
  }
  transactionOpen = false;
  // Whether the calling flow holds a transaction, as the adapter says.
  Object.assign(adapter, { transactionOpenInFlow: () => transactionOpen });
});

afterEach(async () => {
  vi.restoreAllMocks();
  await adapter.disconnect();
});

/** The store's own read of the table, which the race below holds back. */
type TableReader = { readTable: () => Promise<BrandSettings> };

describe("the copy of the settings a render inside a transaction reads", () => {
  it("is never replaced by a read that began before a save", async () => {
    const store = new EmailBrandStore(adapter, silentLogger);
    await store.load();

    // A render outside a transaction starts reading the table, and its read
    // comes back only after a save has landed.
    let release: (settings: BrandSettings) => void = () => {};
    const slow = new Promise<BrandSettings>(resolve => {
      release = resolve;
    });
    const reader = store as unknown as TableReader;
    const original = reader.readTable.bind(store);
    const spy = vi
      .spyOn(reader, "readTable")
      .mockImplementationOnce(() => slow)
      .mockImplementation(original);
    const pending = store.read();

    await store.update({ accentColor: "#ff0066" });
    release({ ...STARTING_BRAND, footerLinks: [] });
    expect((await pending).accentColor).toBe(STARTING_BRAND.accentColor);
    expect(spy).toHaveBeenCalledTimes(2);

    // Inside a transaction the copy is read, and it holds the save.
    transactionOpen = true;
    expect((await store.read()).accentColor).toBe("#ff0066");
  });

  it("is what a read outside a transaction last found", async () => {
    const store = new EmailBrandStore(adapter, silentLogger);
    await store.load();
    // Another instance saves; this one sees it at its next outside read.
    await new EmailBrandStore(adapter, silentLogger).update({
      backgroundColor: "#102030",
    });
    transactionOpen = true;
    expect((await store.read()).backgroundColor).toBe(
      STARTING_BRAND.backgroundColor
    );
    transactionOpen = false;
    expect((await store.read()).backgroundColor).toBe("#102030");
    transactionOpen = true;
    expect((await store.read()).backgroundColor).toBe("#102030");
  });
});

describe("a render that cannot use the settings", () => {
  it("does not read them; one that can, does", async () => {
    const service = new EmailTemplateService(adapter, silentLogger);
    service.configureOwnership({ plugins: [] });
    await service.ensureBuiltInTemplates();
    const read = vi.spyOn(EmailBrandStore.prototype, "read");

    const plain = await service.createTemplate({
      name: "Plain",
      slug: "plain",
      subject: "Hi",
      htmlContent: "<p>Hi</p>",
      useLayout: false,
    });
    await service.renderStored(plain, {});
    expect(read).not.toHaveBeenCalled();

    // Its own text reads them, though it has no layout.
    const reset = await service.getTemplateBySlug("password-reset");
    if (!reset) throw new Error("no password-reset");
    await service.renderStored({ ...reset, useLayout: false }, {});
    expect(read).toHaveBeenCalledTimes(1);

    // A layout reads them.
    await service.renderStored({ ...plain, useLayout: true }, {});
    expect(read).toHaveBeenCalledTimes(2);
  });
});

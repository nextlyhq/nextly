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
import { SNAPSHOT_MAX_AGE_MS } from "../transaction-flow";

import { silentLogger } from "./template-ownership-fixture";

let adapter: DrizzleAdapter;
let transactionOpen = false;
let clock = 1_000_000;

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
  clock = 1_000_000;
  vi.spyOn(Date, "now").mockImplementation(() => clock);
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
    // Past the window, so the read goes to the table.
    clock += SNAPSHOT_MAX_AGE_MS + 1;
    const pending = store.read();

    await store.update({ accentColor: "#ff0066" });
    release({ ...STARTING_BRAND, footerLinks: [] });
    expect((await pending).accentColor).toBe(STARTING_BRAND.accentColor);
    expect(spy).toHaveBeenCalledTimes(2);

    // Inside a transaction the copy is read, and it holds the save.
    transactionOpen = true;
    expect((await store.read()).accentColor).toBe("#ff0066");
  });

  it("runs two saves made at once one after the other, and holds the later", async () => {
    const store = new EmailBrandStore(adapter, silentLogger);
    await store.load();

    // The first save's read-back is held back; the second save waits for it
    // rather than writing in between.
    let release: (settings: BrandSettings) => void = () => {};
    const slow = new Promise<BrandSettings>(resolve => {
      release = resolve;
    });
    const reader = store as unknown as TableReader;
    const original = reader.readTable.bind(store);
    vi.spyOn(reader, "readTable")
      .mockImplementationOnce(() => slow)
      .mockImplementation(original);

    const first = store.update({ accentColor: "#111111" });
    const second = store.update({ accentColor: "#222222" });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect((await store.readCurrent()).accentColor).toBe("#111111");

    release({ ...STARTING_BRAND, footerLinks: [], accentColor: "#111111" });
    await first;
    await second;

    // The table and the copy agree, on the save that started last.
    expect((await store.readCurrent()).accentColor).toBe("#222222");
    transactionOpen = true;
    expect((await store.read()).accentColor).toBe("#222222");
  });

  it("makes one read of the table for a burst of sends after the copy expires", async () => {
    const store = new EmailBrandStore(adapter, silentLogger);
    await store.load();
    const spy = vi.spyOn(store as unknown as TableReader, "readTable");

    clock += SNAPSHOT_MAX_AGE_MS + 1;
    await Promise.all(Array.from({ length: 5 }, () => store.read()));

    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("gives an editor reading after a save the saved settings, not a read from before it", async () => {
    const store = new EmailBrandStore(adapter, silentLogger);
    await store.load();
    let release: (settings: BrandSettings) => void = () => {};
    const slow = new Promise<BrandSettings>(resolve => {
      release = resolve;
    });
    const reader = store as unknown as TableReader;
    const original = reader.readTable.bind(store);
    vi.spyOn(reader, "readTable")
      .mockImplementationOnce(() => slow)
      .mockImplementation(original);

    // A render past the window starts a read, still in flight when a save lands.
    clock += SNAPSHOT_MAX_AGE_MS + 1;
    const pending = store.read();
    await store.update({ accentColor: "#ff0066" });

    expect((await store.readCurrent()).accentColor).toBe("#ff0066");
    release({ ...STARTING_BRAND, footerLinks: [] });
    await pending;
  });

  it("reads the table for an editor, whatever the copy's age", async () => {
    const store = new EmailBrandStore(adapter, silentLogger);
    await store.load();
    await new EmailBrandStore(adapter, silentLogger).update({
      backgroundColor: "#102030",
    });
    // A render still answers from the copy; the editor sees the save.
    expect((await store.read()).backgroundColor).toBe(
      STARTING_BRAND.backgroundColor
    );
    expect((await store.readCurrent()).backgroundColor).toBe("#102030");
  });

  it("is answered on every send within the window, with no read of the table", async () => {
    const store = new EmailBrandStore(adapter, silentLogger);
    await store.load();
    const reader = store as unknown as TableReader;
    const spy = vi.spyOn(reader, "readTable");

    for (let i = 0; i < 3; i++) await store.read();
    clock += SNAPSHOT_MAX_AGE_MS;
    await store.read();

    expect(spy).not.toHaveBeenCalled();
  });

  it("sees another instance's save once older than the window, outside a transaction only", async () => {
    const store = new EmailBrandStore(adapter, silentLogger);
    await store.load();
    await new EmailBrandStore(adapter, silentLogger).update({
      backgroundColor: "#102030",
    });

    // Within the window the copy answers.
    expect((await store.read()).backgroundColor).toBe(
      STARTING_BRAND.backgroundColor
    );
    // Past it, inside a transaction, the copy still answers: a read there
    // would run on another connection.
    clock += SNAPSHOT_MAX_AGE_MS + 1;
    transactionOpen = true;
    expect((await store.read()).backgroundColor).toBe(
      STARTING_BRAND.backgroundColor
    );
    // Outside one, the table is read again, and the copy follows it.
    transactionOpen = false;
    expect((await store.read()).backgroundColor).toBe("#102030");
    transactionOpen = true;
    expect((await store.read()).backgroundColor).toBe("#102030");
  });

  it("follows this instance's own save at once", async () => {
    const store = new EmailBrandStore(adapter, silentLogger);
    await store.load();
    await store.update({ accentColor: "#ff0066" });
    expect((await store.read()).accentColor).toBe("#ff0066");
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

/**
 * The template engine state is answered from the instance's copy on every
 * send, so a send reads nothing from the meta table, and nothing on another
 * connection inside a caller's open transaction. Outside a transaction the
 * copy is read again once it is older than SNAPSHOT_MAX_AGE_MS, which is
 * how long a confirmation another instance made can go unseen here.
 *
 * On a real in-memory SQLite database; two service objects on it stand for
 * two instances of a site, and the clock and whether a transaction is open
 * are arranged.
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { createSqliteAdapter } from "@nextlyhq/adapter-sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getDrizzleKitForDialect } from "../../../database/drizzle-kit-lazy";
import type { EmailTemplateRecord } from "../../../schemas/email-templates/types";
import { emailTemplatesSqlite } from "../../../schemas/email-templates/sqlite";
import { nextlyMetaTables } from "../../../schemas/nextly-meta";
import { MetaService } from "../../meta";
import { splitStatements } from "../../schema/pipeline/sql-statement-utils";
import { EmailTemplateService } from "../services/email-template-service";
import { SNAPSHOT_MAX_AGE_MS } from "../transaction-flow";

import { silentLogger } from "./template-ownership-fixture";

/** Liquid would read the tag; the engine before it sends it as text. */
const STORED = "<p>Members: {% if vip %}VIP{% endif %} {{name}}</p>";
/** The same template rewritten for Liquid, as the editor confirms it. */
const REWRITTEN = "<p>Members: {% if vip %}VIP{% endif %} {{ name }}</p>";
const DATA = { vip: true, name: "Priya" };

let adapter: DrizzleAdapter;
let clock = 1_000_000;
let transactionOpen = false;

/** Create `tables`, on a database that already has `existing`. */
async function createTables(
  tables: Record<string, unknown>,
  existing: Record<string, unknown> = {}
): Promise<void> {
  const kit = await getDrizzleKitForDialect("sqlite");
  const statements = await kit.generateMigration(
    await kit.generateDrizzleJson(existing),
    await kit.generateDrizzleJson({ ...existing, ...tables })
  );
  for (const statement of splitStatements(statements)) {
    await adapter.executeQuery(statement);
  }
}

/** A booted instance of the site. */
async function boot(): Promise<EmailTemplateService> {
  const service = new EmailTemplateService(adapter, silentLogger);
  service.configureOwnership({ plugins: [] });
  await service.ensureBuiltInTemplates();
  return service;
}

let kept: EmailTemplateRecord;

beforeEach(async () => {
  clock = 1_000_000;
  transactionOpen = false;
  vi.spyOn(Date, "now").mockImplementation(() => clock);
  adapter = createSqliteAdapter({ memory: true }) as unknown as DrizzleAdapter;
  await adapter.connect();
  Object.assign(adapter, { transactionOpenInFlow: () => transactionOpen });

  // A template stored before Liquid: the meta table doesn't exist yet, so
  // nothing records it as written for Liquid, and the first boot on Liquid
  // keeps it on the engine it was written for.
  await createTables({ emailTemplatesSqlite });
  kept = await new EmailTemplateService(adapter, silentLogger).createTemplate({
    name: "Members",
    slug: "members",
    subject: "Members",
    htmlContent: STORED,
    useLayout: false,
  });
  await createTables(nextlyMetaTables("sqlite"), { emailTemplatesSqlite });
});

afterEach(async () => {
  vi.restoreAllMocks();
  await adapter.disconnect();
});

/** Every read of the meta table, from the moment it is called. */
function watchMetaReads() {
  const getEntry = vi.spyOn(MetaService.prototype, "getEntry");
  const getAll = vi.spyOn(MetaService.prototype, "getAll");
  return () => getEntry.mock.calls.length + getAll.mock.calls.length;
}

describe("the template engine state", () => {
  it("is answered from memory on every send", async () => {
    const site = await boot();
    const reads = watchMetaReads();

    const first = await site.renderStored(kept, DATA);
    await site.renderStored(kept, DATA);

    expect(reads()).toBe(0);
    // It was answered: the template is kept, and sends as it always has.
    expect(first.html).toBe("<p>Members: {% if vip %}VIP{% endif %} Priya</p>");
  });

  it("sees another instance's confirmation once its copy is older than the window", async () => {
    const site = await boot();
    const other = await boot();
    await other.updateTemplate(kept.id, { htmlContent: REWRITTEN });
    await other.confirmLiquid(kept.id);
    const rewritten = await site.getTemplate(kept.id);

    // Within the window this instance still reads it as kept.
    clock += SNAPSHOT_MAX_AGE_MS;
    expect((await site.renderStored(rewritten, DATA)).html).toBe(
      "<p>Members: {% if vip %}VIP{% endif %} Priya</p>"
    );

    // Past it, the next send reads the state again and renders it as Liquid.
    clock += 1;
    expect((await site.renderStored(rewritten, DATA)).html).toBe(
      "<p>Members: VIP Priya</p>"
    );
  });

  it("sees its own confirmation at once", async () => {
    const site = await boot();
    await site.updateTemplate(kept.id, { htmlContent: REWRITTEN });
    await site.confirmLiquid(kept.id);
    const reads = watchMetaReads();
    expect(
      (await site.renderStored(await site.getTemplate(kept.id), DATA)).html
    ).toBe("<p>Members: VIP Priya</p>");
    expect(reads()).toBe(0);
  });

  it("makes one read of the meta table for a burst of sends after the copy expires", async () => {
    const site = await boot();
    clock += SNAPSHOT_MAX_AGE_MS + 1;
    const getAll = vi.spyOn(MetaService.prototype, "getAll");
    await Promise.all(
      Array.from({ length: 5 }, () => site.renderStored(kept, DATA))
    );
    expect(getAll).toHaveBeenCalledTimes(1);
  });

  it("reads nothing from the meta table inside an open transaction, however old its copy", async () => {
    const site = await boot();
    clock += SNAPSHOT_MAX_AGE_MS * 10;
    transactionOpen = true;
    const reads = watchMetaReads();

    expect((await site.renderStored(kept, DATA)).html).toBe(
      "<p>Members: {% if vip %}VIP{% endif %} Priya</p>"
    );
    expect(reads()).toBe(0);
  });
});

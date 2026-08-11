/**
 * What a template mutation writes to the activity log, and what it must not.
 *
 * A template decides what Nextly's own password-reset and verification mail
 * says, and `fromOverride` decides who it appears to come from. The trail is
 * read by more people than the templates themselves, so its value depends on it
 * naming what changed without carrying any of it.
 */

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { container } from "../../../di/container";
import { getCoreSchema } from "../../../schemas";
import type { LogActivityInput } from "../../../services/dashboard/activity-log-service";
import type { Logger } from "../../../services/shared";
import { SYSTEM_CONTEXT } from "../../../shared/types";
import { createTableBody } from "../../schema/pipeline/sql-templates/create-table-body";
import { EmailTemplateService } from "../services/email-template-service";
import { EMAIL_TEMPLATE_ACTIVITY_COLLECTION } from "../template-activity";

const ACTOR = { type: "user" as const, id: "user-1" };

const logger: Logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

const logged: LogActivityInput[] = [];

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

/** Rendered from the shipped core schema, never hand-copied DDL. */
function createEmailTemplatesTable(sqlite: Database.Database): void {
  const { tables } = getCoreSchema("sqlite");
  const spec = tables.find(table => table.name === "email_templates");
  if (!spec) {
    expect.fail(
      "email_templates is absent from the core schema — this fixture can no longer be derived from it."
    );
  }
  sqlite.exec(
    `CREATE TABLE "email_templates" (\n${createTableBody(spec, (id: string) => `"${id}"`)}\n)`
  );
}

const INPUT = {
  name: "Password reset",
  slug: "password-reset",
  subject: "Reset your password",
  htmlContent: "<p>Hello {{name}}</p>",
};

describe("email template activity", () => {
  let sqlite: Database.Database;
  let service: EmailTemplateService;

  beforeEach(() => {
    sqlite = new Database(":memory:");
    createEmailTemplatesTable(sqlite);
    service = new EmailTemplateService(
      makeAdapter(drizzle({ client: sqlite })),
      logger
    );

    logged.length = 0;
    container.register("activityLogService", () => ({
      logActivity: (input: LogActivityInput) => {
        logged.push(input);
        return Promise.resolve();
      },
    }));
  });

  afterEach(() => {
    sqlite.close();
    container.clear?.();
  });

  it("records a create under its own collection", async () => {
    const created = await service.createTemplate(INPUT, ACTOR);

    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatchObject({
      action: "create",
      collection: EMAIL_TEMPLATE_ACTIVITY_COLLECTION,
      entryId: created.id,
      entryTitle: "Password reset",
      userId: ACTOR.id,
    });
    // Filed apart from providers on purpose: one is a credential change and the
    // other is a wording change, and the feed groups by this column.
    expect(logged[0]?.collection).not.toBe("email-providers");
  });

  it("names the fields an update touched and carries none of their values", async () => {
    const created = await service.createTemplate(INPUT, ACTOR);
    logged.length = 0;

    await service.updateTemplate(
      created.id,
      {
        subject: "A completely different subject line",
        fromOverride: "security@attacker.example",
      },
      ACTOR
    );

    expect(logged).toHaveLength(1);
    const changed = (logged[0]?.metadata as { changedFields?: string[] })
      ?.changedFields;
    expect(changed).toEqual(
      expect.arrayContaining(["subject", "fromOverride"])
    );

    // The whole entry, serialised. A value reaching ANY field of the row is the
    // failure this guards, so the assertion is made against the row rather than
    // against the one key it was expected to arrive in.
    const serialised = JSON.stringify(logged[0]);
    expect(serialised).not.toContain("A completely different subject line");
    expect(serialised).not.toContain("security@attacker.example");
  });

  it("records nothing for an update that moved nothing", async () => {
    const created = await service.createTemplate(INPUT, ACTOR);
    logged.length = 0;

    // The form submits every field whether or not the operator touched one.
    await service.updateTemplate(
      created.id,
      { subject: INPUT.subject, htmlContent: INPUT.htmlContent },
      ACTOR
    );

    expect(logged).toHaveLength(0);
  });

  it("records a delete with the name the row had", async () => {
    const created = await service.createTemplate(INPUT, ACTOR);
    logged.length = 0;

    await service.deleteTemplate(created.id, ACTOR);

    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatchObject({
      action: "delete",
      entryId: created.id,
      // Read before the row went: after the delete there is nothing left to
      // label the entry with.
      entryTitle: "Password reset",
    });
  });

  it("records nothing for a write with no signed-in actor", async () => {
    await service.createTemplate(INPUT, null);
    expect(logged).toHaveLength(0);
  });

  it("records nothing for the system actor", async () => {
    // Boot-time seeding resolves to a USER actor carrying the reserved id, and
    // no account owns it — an entry would be filed as an already-erased
    // identity, which is a worse record than none.
    const system = SYSTEM_CONTEXT.user;
    if (!system) expect.fail("SYSTEM_CONTEXT carries no user to test against");
    await service.createTemplate(INPUT, {
      type: "user" as const,
      id: system.id,
    });
    expect(logged).toHaveLength(0);
  });
});

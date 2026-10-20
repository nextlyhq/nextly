/**
 * The brand settings through the REST routes, as the catch-all handler
 * reaches them: the path parsed, then dispatched, to the real service on a
 * real table. A body is checked at the route, before the service is asked.
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { createSqliteAdapter } from "@nextlyhq/adapter-sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getDrizzleKitForDialect } from "../../../database/drizzle-kit-lazy";
import { emailBrandTables } from "../../../schemas/email-brand";
import { emailTemplatesSqlite } from "../../../schemas/email-templates/sqlite";
import { splitStatements } from "../../schema/pipeline/sql-statement-utils";
import { STARTING_BRAND } from "../brand-settings";
import { EmailTemplateService } from "../services/email-template-service";

import { silentLogger } from "./template-ownership-fixture";

let service: EmailTemplateService;

vi.mock("../../../dispatcher/helpers/di", () => ({
  getEmailProviderServiceFromDI: () => null,
  getEmailTemplateServiceFromDI: () => service,
}));

const { dispatchEmailTemplates } = await import(
  "../../../dispatcher/handlers/email-dispatcher"
);
const { parseRestRoute } = await import("../../../route-handler/route-parser");

let adapter: DrizzleAdapter;

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
  service = new EmailTemplateService(adapter, silentLogger);
  service.configureOwnership({ plugins: [] });
  await service.ensureBuiltInTemplates();
});

afterEach(async () => {
  await adapter.disconnect();
});

/** A REST call as the catch-all handler makes it: parse the path, then dispatch. */
async function rest(method: string, body?: unknown) {
  const route = parseRestRoute(["email-templates", "brand"], method);
  if (!route.method) throw new Error(`no route for ${method} brand`);
  return (await dispatchEmailTemplates(
    route.method,
    route.routeParams ?? {},
    body
  )) as Response;
}

describe("GET /email-templates/brand", () => {
  it("returns the settings, their starting values, the fonts and the reach", async () => {
    const response = await rest("GET");
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      settings: unknown;
      starting: unknown;
      fonts: Array<{ key: string; stack: string }>;
      reach: Array<{ slug: string; reached: boolean }>;
    };
    expect(body.settings).toEqual(STARTING_BRAND);
    expect(body.starting).toEqual(STARTING_BRAND);
    expect(body.fonts[0]).toMatchObject({ key: "system" });
    expect(body.reach.map(r => r.slug).sort()).toEqual([
      "email-verification",
      "password-reset",
      "welcome",
    ]);
    expect(body.reach.every(r => r.reached)).toBe(true);
  });
});

describe("PATCH /email-templates/brand", () => {
  it("saves a change and returns the settings as they now are", async () => {
    const response = await rest("PATCH", { accentColor: "#FF0066" });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      message: "Email brand settings saved.",
      item: { ...STARTING_BRAND, accentColor: "#ff0066" },
    });
    expect((await service.getBrand()).settings.accentColor).toBe("#ff0066");
  });

  it.each([
    ["a colour that is not one", { accentColor: "red" }, "accentColor"],
    ["a setting it does not know", { borderRadius: 4 }, ""],
    ["a font outside the list", { fontFamily: "Comic Sans" }, "fontFamily"],
  ])("refuses %s before anything is saved", async (_case, body, path) => {
    await expect(rest("PATCH", body)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
    if (path) {
      await expect(rest("PATCH", body)).rejects.toMatchObject({
        publicData: { errors: [expect.objectContaining({ path })] },
      });
    }
    expect((await service.getBrand()).settings).toEqual(STARTING_BRAND);
  });
});

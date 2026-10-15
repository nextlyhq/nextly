/**
 * The ownership rules hold on every surface a template is reached through:
 * the REST routes (parsed as the catch-all handler parses them, then
 * dispatched) and the Direct API. Both reach the same service, on a real
 * table, so a refusal decided there is a refusal everywhere.
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { createSqliteAdapter } from "@nextlyhq/adapter-sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getDrizzleKitForDialect } from "../../../database/drizzle-kit-lazy";
import type { NextlyContext } from "../../../direct-api/namespaces/context";
import { createEmailTemplatesNamespace } from "../../../direct-api/namespaces/email";
import { emailTemplatesSqlite } from "../../../schemas/email-templates/sqlite";
import { splitStatements } from "../../schema/pipeline/sql-statement-utils";
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

const PLUGIN = "@acme/plugin-orders";

let adapter: DrizzleAdapter;

beforeEach(async () => {
  adapter = createSqliteAdapter({ memory: true }) as unknown as DrizzleAdapter;
  await adapter.connect();
  const kit = await getDrizzleKitForDialect("sqlite");
  const statements = await kit.generateMigration(
    await kit.generateDrizzleJson({}),
    await kit.generateDrizzleJson({ emailTemplatesSqlite })
  );
  for (const statement of splitStatements(statements)) {
    await adapter.executeQuery(statement);
  }
  service = new EmailTemplateService(adapter, silentLogger);
  service.configureOwnership({
    plugins: [
      {
        name: PLUGIN,
        templates: [
          {
            slug: "orders-paid",
            name: "Paid",
            subject: "Paid",
            htmlContent: "<p>Paid</p>",
          },
        ],
      },
    ],
  });
  await service.ensureBuiltInTemplates();
});

afterEach(async () => {
  await adapter.disconnect();
});

const idOf = async (slug: string) =>
  (await service.getTemplateBySlug(slug))!.id;

/** A REST call as the catch-all handler makes it: parse the path, then dispatch. */
async function rest(method: string, path: string[], body?: unknown) {
  const route = parseRestRoute(["email-templates", ...path], method);
  if (!route.method)
    throw new Error(`no route for ${method} ${path.join("/")}`);
  const response = (await dispatchEmailTemplates(
    route.method,
    route.routeParams ?? {},
    body
  )) as Response;
  return { route, response };
}

describe("REST", () => {
  it("refuses to delete core's template or an installed plugin's", async () => {
    for (const slug of ["password-reset", "orders-paid"]) {
      await expect(rest("DELETE", [await idOf(slug)])).rejects.toMatchObject({
        code: "BUSINESS_RULE_VIOLATION",
      });
      expect(await service.getTemplateBySlug(slug)).not.toBeNull();
    }
  });

  it("deletes the site's own template", async () => {
    const own = await service.createTemplate({
      name: "Newsletter",
      slug: "newsletter",
      subject: "Hi",
      htmlContent: "<p>Hi</p>",
    });
    const { response } = await rest("DELETE", [own.id]);
    expect(response.status).toBe(200);
    expect(await service.getTemplateBySlug("newsletter")).toBeNull();
  });

  it("routes the ownership steps as updates, and the comparison as a read", async () => {
    const id = await idOf("orders-paid");
    for (const step of ["override", "reset", "apply-update", "undo-update"]) {
      const route = parseRestRoute(["email-templates", id, step], "PATCH");
      expect(route.operation).toBe("update");
      // The permission comes from the HTTP method; a POST would ask for create.
      expect(
        parseRestRoute(["email-templates", id, step], "POST").method
      ).toBeUndefined();
    }
    expect(
      parseRestRoute(["email-templates", id, "compare"], "GET")
    ).toMatchObject({
      operation: "single",
      method: "compareTemplate",
      routeParams: { templateId: id },
    });
  });

  it("overrides, compares and resets through the routes", async () => {
    const id = await idOf("orders-paid");
    const overridden = await rest("PATCH", [id, "override"], {
      version: { subject: "Paid, thanks!" },
    });
    const body = (await overridden.response.json()) as {
      item: { overridden: boolean; subject: string; owner: unknown };
    };
    expect(body.item).toMatchObject({
      overridden: true,
      subject: "Paid, thanks!",
      owner: { kind: "plugin", name: PLUGIN, installed: true },
    });

    const compared = await rest("GET", [id, "compare"]);
    expect(await compared.response.json()).toMatchObject({ changes: [] });

    const reset = await rest("PATCH", [id, "reset"]);
    expect(
      ((await reset.response.json()) as { item: { subject: string } }).item
        .subject
    ).toBe("Paid");
  });

  it("refuses a malformed review body before the service sees it", async () => {
    const id = await idOf("orders-paid");
    await service.overrideTemplate(id);
    await expect(
      rest("PATCH", [id, "apply-update"], {
        choices: { "subject:0": { use: "everything" } },
      })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });
});

describe("Direct API", () => {
  const api = () =>
    createEmailTemplatesNamespace({
      emailTemplateService: service,
      defaultConfig: {},
    } as unknown as NextlyContext);

  it("refuses to delete core's template or an installed plugin's", async () => {
    for (const slug of ["welcome", "default-layout", "orders-paid"]) {
      await expect(
        api().delete({ id: await idOf(slug) })
      ).rejects.toMatchObject({
        code: "BUSINESS_RULE_VIOLATION",
      });
    }
  });

  it("deletes the site's own template", async () => {
    const { item } = await api().create({
      data: {
        name: "Own",
        slug: "own",
        subject: "S",
        htmlContent: "<p/>",
        description: "Ours.",
      },
    });
    expect(item).toMatchObject({
      owner: { kind: "site" },
      description: "Ours.",
    });
    await api().delete({ id: item.id });
    expect(await service.getTemplateBySlug("own")).toBeNull();
  });

  it("overrides and resets an owned template, reading its owner from the server", async () => {
    const id = await idOf("password-reset");
    const found = await api().findByID({ id });
    expect(found).toMatchObject({
      owner: { kind: "core" },
      overridden: false,
      ownerChanged: false,
    });

    const { item } = await api().override({
      id,
      version: { subject: "Reset it" },
    });
    expect(item).toMatchObject({ overridden: true, subject: "Reset it" });
    expect(await api().compare({ id })).toMatchObject({ changes: [] });

    const reset = await api().reset({ id });
    expect(reset.item).toMatchObject({
      overridden: false,
      subject: "Reset your {{appName}} password",
    });
  });
});

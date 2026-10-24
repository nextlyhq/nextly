// The standalone email-template handlers (`nextly/api/email-templates` and
// `nextly/api/email-templates-detail`) take a template's description, and a
// written template's format and blocks, on create and update and return them
// on every read, as the dispatcher routes and the Direct API do.
//
// The service is the real one on an in-memory SQLite table, so "stored" is
// read back from the row rather than inferred from what a mock was handed.
// Only the container lookup, the boot and the permission guard are mocked.
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { createSqliteAdapter } from "@nextlyhq/adapter-sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthContext } from "../../auth/middleware";
import { getDrizzleKitForDialect } from "../../database/drizzle-kit-lazy";
import { silentLogger } from "../../domains/email/__tests__/template-ownership-fixture";
import { splitStatements } from "../../domains/schema/pipeline/sql-statement-utils";
import { emailTemplatesSqlite } from "../../schemas/email-templates/sqlite";
import { EmailTemplateService } from "../../services/email/email-template-service";

let service: EmailTemplateService;

vi.mock("../../di", () => ({
  container: { get: vi.fn(() => service) },
  isServicesRegistered: vi.fn(() => true),
}));

vi.mock("../../init", () => ({
  getCachedNextly: vi.fn(async () => undefined),
}));

const auth: AuthContext = {
  userId: "user-1",
  permissions: [],
  roles: [],
  authMethod: "session",
};

vi.mock("../route-auth", () => ({
  requireRouteAnyPermission: vi.fn(async () => auth),
}));

const list = await import("../email-templates");
const detail = await import("../email-templates-detail");

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
  service.configureOwnership({ plugins: [] });
});

afterEach(async () => {
  await adapter.disconnect();
});

interface Template {
  id: string;
  slug: string;
  description: string | null;
}

function request(method: string, path: string, body?: unknown): Request {
  return new Request(`http://localhost/api/email-templates${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const context = (id: string) => ({ params: Promise.resolve({ id }) });

const newsletter = {
  name: "Newsletter",
  slug: "newsletter",
  subject: "Hi",
  htmlContent: "<p>Hi</p>",
};

async function create(body: Record<string, unknown>) {
  const res = await list.POST(request("POST", "", body));
  return { res, body: (await res.json()) as { item: Template } };
}

// Update tests start from a row the service wrote, so each one exercises only
// the PATCH handler and cannot pass on what create did or failed to do.
async function seed(description: string | null): Promise<string> {
  return (await service.createTemplate({ ...newsletter, description })).id;
}

async function patch(id: string, body: Record<string, unknown>) {
  const res = await detail.PATCH(request("PATCH", `/${id}`, body), context(id));
  return { res, body: (await res.json()) as { item: Template } };
}

async function readOne(id: string): Promise<Template> {
  const res = await detail.GET(request("GET", `/${id}`), context(id));
  expect(res.status).toBe(200);
  return (await res.json()) as Template;
}

async function readFromList(slug: string): Promise<Template | undefined> {
  const res = await list.GET(request("GET", ""));
  expect(res.status).toBe(200);
  const { templates } = (await res.json()) as { templates: Template[] };
  return templates.find(t => t.slug === slug);
}

describe("creating a template through the standalone handler", () => {
  it("stores the description and returns it from create, detail and list", async () => {
    const { res, body } = await create({
      ...newsletter,
      description: "Sent on the first of each month.",
    });

    expect(res.status).toBe(201);
    expect(body.item.description).toBe("Sent on the first of each month.");
    expect((await service.getTemplate(body.item.id)).description).toBe(
      "Sent on the first of each month."
    );
    expect((await readOne(body.item.id)).description).toBe(
      "Sent on the first of each month."
    );
    expect((await readFromList("newsletter"))?.description).toBe(
      "Sent on the first of each month."
    );
  });

  it("still creates a template sent without a description, with none", async () => {
    const { res, body } = await create(newsletter);

    expect(res.status).toBe(201);
    expect(body.item.description).toBeNull();
    expect((await readOne(body.item.id)).description).toBeNull();
  });

  it("refuses a description that is not text", async () => {
    const res = await list.POST(
      request("POST", "", { ...newsletter, description: 42 })
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: { data: { errors: [{ path: "description" }] } },
    });
    expect(await service.getTemplateBySlug("newsletter")).toBeNull();
  });
});

describe("updating a template through the standalone detail handler", () => {
  it("sets the description and returns it from update, detail and list", async () => {
    const id = await seed(null);

    const { res, body } = await patch(id, {
      description: "Sent when a reader subscribes.",
    });

    expect(res.status).toBe(200);
    expect(body.item.description).toBe("Sent when a reader subscribes.");
    expect((await service.getTemplate(id)).description).toBe(
      "Sent when a reader subscribes."
    );
    expect((await readOne(id)).description).toBe(
      "Sent when a reader subscribes."
    );
    expect((await readFromList("newsletter"))?.description).toBe(
      "Sent when a reader subscribes."
    );
  });

  it("clears the description with null", async () => {
    const id = await seed("Sent monthly.");

    const { res, body } = await patch(id, { description: null });

    expect(res.status).toBe(200);
    expect(body.item.description).toBeNull();
    expect((await readOne(id)).description).toBeNull();
  });

  it("keeps the description when an update leaves it out", async () => {
    const id = await seed("Sent monthly.");

    const { res, body } = await patch(id, { subject: "Hello" });

    expect(res.status).toBe(200);
    expect(body.item).toMatchObject({
      subject: "Hello",
      description: "Sent monthly.",
    });
  });

  it("refuses a description that is not text, and changes nothing", async () => {
    const id = await seed("Sent monthly.");

    const res = await detail.PATCH(
      request("PATCH", `/${id}`, { subject: "Hello", description: 42 }),
      context(id)
    );

    expect(res.status).toBe(400);
    // The refusal names the field, so a client can show it beside that input.
    expect(await res.json()).toMatchObject({
      error: { data: { errors: [{ path: "description" }] } },
    });
    expect(await service.getTemplate(id)).toMatchObject({
      subject: "Hi",
      description: "Sent monthly.",
    });
  });
});

const WRITTEN = {
  version: 1,
  blocks: [{ type: "heading", text: [{ type: "text", text: "Your order" }] }],
};

describe("a written template through the standalone handlers", () => {
  it("is created written, from its blocks", async () => {
    const { res, body } = await create({
      ...newsletter,
      htmlContent: "",
      format: "written",
      blocks: WRITTEN,
    });

    expect(res.status).toBe(201);
    const stored = await service.getTemplate(body.item.id);
    expect(stored).toMatchObject({ format: "written", blocks: WRITTEN });
    expect(stored.htmlContent).toContain("Your order</h1>");
  });

  it("still needs HTML for a coded template", async () => {
    const res = await list.POST(
      request("POST", "", { ...newsletter, htmlContent: "" })
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: { data: { errors: [{ path: "htmlContent" }] } },
    });
  });

  it("takes new blocks on update", async () => {
    const id = (
      await service.createTemplate({
        ...newsletter,
        htmlContent: "",
        format: "written",
        blocks: WRITTEN as never,
      })
    ).id;
    const next = {
      version: 1,
      blocks: [{ type: "heading", text: [{ type: "text", text: "Shipped" }] }],
    };

    const { res } = await patch(id, { blocks: next });

    expect(res.status).toBe(200);
    expect(await service.getTemplate(id)).toMatchObject({
      format: "written",
      blocks: next,
    });
  });

  it("refuses blocks on a coded template instead of dropping them", async () => {
    const id = await seed(null);

    const { res } = await patch(id, { blocks: WRITTEN });

    expect(res.ok).toBe(false);
    expect(await service.getTemplate(id)).toMatchObject({
      format: "code",
      htmlContent: "<p>Hi</p>",
    });
  });
});

// The standalone email-template handlers (`nextly/api/email-templates` and
// `nextly/api/email-templates-detail`) take a template's cc and bcc on create
// and update, return them on every read, and pass each address to the
// service to judge: a variable or a copy on a template that carries a secret
// is refused, naming the field.
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
  cc: string[] | null;
  bcc: string[] | null;
}

interface Refusal {
  error: { data: { errors: Array<{ path: string; code: string }> } };
}

function request(method: string, path: string, body?: unknown): Request {
  return new Request(`http://localhost/api/email-templates${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const context = (id: string) => ({ params: Promise.resolve({ id }) });

const shipped = {
  name: "Order shipped",
  slug: "order-shipped",
  subject: "Shipped",
  htmlContent: "<p>Shipped</p>",
};

async function create(body: Record<string, unknown>) {
  const res = await list.POST(request("POST", "", body));
  return { res, body: (await res.json()) as { item: Template } & Refusal };
}

async function patch(id: string, body: Record<string, unknown>) {
  const res = await detail.PATCH(request("PATCH", `/${id}`, body), context(id));
  return { res, body: (await res.json()) as { item: Template } & Refusal };
}

async function readOne(id: string): Promise<Template> {
  const res = await detail.GET(request("GET", `/${id}`), context(id));
  expect(res.status).toBe(200);
  return (await res.json()) as Template;
}

const paths = (body: Refusal) =>
  body.error.data.errors.map(({ path, code }) => ({ path, code }));

describe("a template's copies through the standalone handlers", () => {
  it("stores them on create and returns them from create and detail", async () => {
    const { res, body } = await create({
      ...shipped,
      cc: ["staff@shop.example"],
      bcc: ["audit@shop.example"],
    });

    expect(res.status).toBe(201);
    expect(body.item).toMatchObject({
      cc: ["staff@shop.example"],
      bcc: ["audit@shop.example"],
    });
    expect(await readOne(body.item.id)).toMatchObject({
      cc: ["staff@shop.example"],
      bcc: ["audit@shop.example"],
    });
  });

  it("still creates a template sent without copies, with none", async () => {
    const { res, body } = await create(shipped);
    expect(res.status).toBe(201);
    expect(body.item).toMatchObject({ cc: null, bcc: null });
  });

  it("sets them on update, keeps them when an update leaves them out, and clears them with null", async () => {
    const id = (await service.createTemplate(shipped)).id;

    const set = await patch(id, { bcc: ["audit@shop.example"] });
    expect(set.res.status).toBe(200);
    expect(set.body.item.bcc).toEqual(["audit@shop.example"]);

    const other = await patch(id, { subject: "On its way" });
    expect(other.body.item.bcc).toEqual(["audit@shop.example"]);

    const cleared = await patch(id, { bcc: null });
    expect(cleared.body.item.bcc).toBeNull();
    expect((await readOne(id)).bcc).toBeNull();
  });

  it("refuses a variable, naming the entry, and stores nothing", async () => {
    const { res, body } = await create({
      ...shipped,
      cc: ["{{ manager.email }}"],
    });
    expect(res.status).toBe(400);
    expect(paths(body)).toEqual([{ path: "cc.0", code: "VARIABLE_ADDRESS" }]);
    expect(await service.getTemplateBySlug("order-shipped")).toBeNull();
  });

  it("refuses copies that are not a list, and changes nothing", async () => {
    const id = (await service.createTemplate(shipped)).id;
    const { res, body } = await patch(id, {
      subject: "On its way",
      cc: "staff@shop.example",
    });
    expect(res.status).toBe(400);
    expect(paths(body)).toEqual([expect.objectContaining({ path: "cc" })]);
    expect(await service.getTemplate(id)).toMatchObject({
      subject: "Shipped",
      cc: null,
    });
  });

  it("refuses copies on a template that carries a secret", async () => {
    // Core's password reset, as its owner declares it.
    const id = (
      await service.createTemplate({
        ...shipped,
        name: "Password reset",
        slug: "password-reset",
      })
    ).id;
    const { res, body } = await patch(id, { cc: ["spy@evil.example"] });
    expect(res.status).toBe(400);
    expect(paths(body)).toEqual([{ path: "cc", code: "CARRIES_SECRET" }]);
    expect((await readOne(id)).cc).toBeNull();
  });
});

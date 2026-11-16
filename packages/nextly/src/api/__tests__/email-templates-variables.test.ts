// Standalone email-template handlers (`nextly/api/email-templates` and
// `nextly/api/email-templates-detail`) accept typed variable declarations
// on create and update, and refuse malformed ones.
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
  variables: unknown;
}

function request(method: string, path: string, body?: unknown): Request {
  return new Request(`http://localhost/api/email-templates${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const context = (id: string) => ({ params: Promise.resolve({ id }) });

const baseTemplate = {
  name: "Welcome",
  slug: "welcome",
  subject: "Hi",
  htmlContent: "<p>Hi</p>",
};

describe("standalone POST /api/email-templates variables", () => {
  it("persists typed variable declarations with presentation", async () => {
    const typedVars = [
      {
        name: "user",
        description: "The user",
        type: "object",
        label: "User",
        fields: [{ name: "email", type: "text" }],
      },
    ];
    const res = await list.POST(
      request("POST", "", {
        ...baseTemplate,
        variables: typedVars,
      })
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { item: Template };
    expect(body.item.variables).toEqual(typedVars);
  });

  it("refuses malformed variable declarations", async () => {
    const res = await list.POST(
      request("POST", "", {
        ...baseTemplate,
        variables: [{ name: "bad", type: "unknown-type" }],
      })
    );
    expect(res.status).toBe(400);
  });
});

describe("standalone PATCH /api/email-templates/[id] variables", () => {
  it("persists typed variable declarations with presentation on update", async () => {
    const created = await service.createTemplate(baseTemplate);
    const typedVars = [
      {
        name: "count",
        description: "Items count",
        type: "number",
        label: "Count",
        example: 5,
      },
    ];
    const res = await detail.PATCH(
      request("PATCH", `/${created.id}`, { variables: typedVars }),
      context(created.id)
    );
    expect(res.status).toBe(200);
    const stored = await service.getTemplate(created.id);
    expect(stored.variables).toEqual(typedVars);
  });

  it("refuses malformed variable declarations on update", async () => {
    const created = await service.createTemplate(baseTemplate);
    const res = await detail.PATCH(
      request("PATCH", `/${created.id}`, {
        variables: [{ name: "bad", type: "invalid" }],
      }),
      context(created.id)
    );
    expect(res.status).toBe(400);
  });
});

// The REST create route reaches the service that owns the table, rather than writing the row itself.
//
// This route used to call `registerComponent` directly. That wrote a registry row and no table, so
// it answered `201 Field group created.` for a field group whose `comp_<slug>` did not exist, and
// every later read and write to it failed against the database.
//
// The half this file proves is the DELEGATION. The other half — that the service actually
// provisions the table on a real engine — is proved against live databases in
// `domains/field-groups/__tests__/field-group-create-transports.integration.test.ts`, through the
// two transports the harness can reach without a session. This route is permission-gated and the
// harness cannot authenticate a request, so proving it there would mean faking a session and
// testing the fake. Split deliberately, and neither half stands alone: delegation without
// provisioning proves nothing, and provisioning without delegation would leave this route still
// writing its own row.

import { beforeEach, describe, expect, it, vi } from "vitest";

const createFieldGroup = vi.fn();
const registerComponent = vi.fn();

vi.mock("../../di", () => ({
  getService: vi.fn((name: string) =>
    name === "fieldGroupMetadataService"
      ? { createFieldGroup }
      : { registerComponent }
  ),
}));

vi.mock("../../init", () => ({
  getCachedNextly: vi.fn(async () => undefined),
}));

vi.mock("../route-auth", () => ({
  requireRouteAnyPermission: vi.fn(async () => undefined),
}));

describe("the field-group create route", () => {
  beforeEach(() => {
    createFieldGroup.mockReset();
    registerComponent.mockReset();
    createFieldGroup.mockResolvedValue({
      record: {
        id: "fg-1",
        slug: "hero",
        label: "Hero",
        tableName: "comp_hero",
        fields: [],
        migrationStatus: "applied",
      },
      migrationStatus: "applied",
    });
  });

  it("creates through the service that owns the table, not the registry", async () => {
    const { POST } = await import("../field-groups");

    await POST(
      new Request("http://localhost/api/field-groups", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          slug: "hero",
          label: "Hero",
          fields: [{ name: "heading", type: "text" }],
        }),
      })
    );

    expect(createFieldGroup).toHaveBeenCalledTimes(1);
    // Stated as well as the positive, because the defect was not that the row went unwritten: it
    // was that the row was written ALONE. A route that called both would look correct here.
    expect(registerComponent).not.toHaveBeenCalled();
    expect(createFieldGroup.mock.calls[0]?.[0]?.tableName).toBe("comp_hero");
  });

  it("says so when the table could not be provisioned", async () => {
    createFieldGroup.mockResolvedValue({
      record: {
        id: "fg-2",
        slug: "hero",
        label: "Hero",
        tableName: "comp_hero",
        fields: [],
        migrationStatus: "failed",
      },
      migrationStatus: "failed",
    });
    const { POST } = await import("../field-groups");

    const response = await POST(
      new Request("http://localhost/api/field-groups", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          slug: "hero",
          label: "Hero",
          fields: [{ name: "heading", type: "text" }],
        }),
      })
    );
    const body = (await response.json()) as { message?: string };

    // An unqualified success for a create whose table was never made is what let this ship unnoticed
    // for as long as it did.
    expect(body.message).not.toBe("Field group created.");
    expect(body.message).toContain("could not be provisioned");
  });

  it("refuses a slug too long to survive becoming a table name", async () => {
    // 48 characters: one past the bound. The bound is not the slug's own length limit, it is
    // whatever leaves the LONGEST generated identifier legal — `idx_comp_<slug>_parent`, sixteen
    // characters longer than this. At 48 that index name is 64: rejected by MySQL, and past the 63
    // where PostgreSQL stops rejecting and starts silently truncating.
    const { POST } = await import("../field-groups");

    const response = await POST(
      new Request("http://localhost/api/field-groups", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          slug: `a${"b".repeat(47)}`,
          label: "Too long",
          fields: [{ name: "heading", type: "text" }],
        }),
      })
    );

    expect(response.status).toBe(400);
    // The point is WHERE it is refused. Accepted here, it reaches the DDL, provisions a table the
    // verification then cannot find under the name it asked for, records the field group as failed,
    // and still answers 201 for input the route declared valid.
    expect(createFieldGroup).not.toHaveBeenCalled();
  });

  it("accepts a slug at the bound", async () => {
    // The positive control. Without it, a rule that rejected everything would satisfy the case
    // above while breaking every real create.
    const { POST } = await import("../field-groups");

    const response = await POST(
      new Request("http://localhost/api/field-groups", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          slug: `a${"b".repeat(46)}`,
          label: "At the bound",
          fields: [{ name: "heading", type: "text" }],
        }),
      })
    );

    expect(response.status).toBe(201);
    expect(createFieldGroup).toHaveBeenCalledTimes(1);
  });
});

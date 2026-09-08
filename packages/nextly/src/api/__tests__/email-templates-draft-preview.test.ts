// The draft-preview route renders fields that were never saved, and gates on the
// same permissions as the saved-template preview.
//
// The permission half is asserted by OBSERVING the call the route makes, not by
// sending an unauthenticated request: this harness mocks `route-auth`, so a
// request that "fails to authenticate" here would be failing against the mock.
// Asserting the arguments the real guard receives is the property that survives
// someone editing the route — a reconstructed permission list in the test would
// keep passing after the route stopped asking for it.
import { beforeEach, describe, expect, it, vi } from "vitest";

// Typed to the real signatures, so `mock.calls` carries the argument types and
// the assertions below read them rather than casting a value they assumed.
const previewDraft =
  vi.fn<
    (
      fields: Record<string, unknown>,
      data: Record<string, unknown>
    ) => Promise<unknown>
  >();
const requireRouteAnyPermission =
  vi.fn<
    (
      request: Request,
      permissions: Array<{ action: string; resource: string }>
    ) => Promise<void>
  >();

vi.mock("../../di", () => ({
  container: { get: vi.fn(() => ({ previewDraft })) },
  isServicesRegistered: vi.fn(() => true),
}));

vi.mock("../../init", () => ({
  getCachedNextly: vi.fn(async () => undefined),
}));

vi.mock("../route-auth", () => ({
  requireRouteAnyPermission: (
    request: Request,
    permissions: Array<{ action: string; resource: string }>
  ) => requireRouteAnyPermission(request, permissions),
}));

function post(body: unknown): Request {
  return new Request("http://localhost/api/email-templates/preview", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const draft = {
  subject: "Hi {{name}}",
  htmlContent: "<p>{{name}}</p>",
  useLayout: false,
  kind: "template" as const,
};

describe("the draft email-template preview route", () => {
  beforeEach(() => {
    previewDraft.mockReset();
    requireRouteAnyPermission.mockClear();
    requireRouteAnyPermission.mockResolvedValue(undefined);
    previewDraft.mockResolvedValue({
      subject: "Hi Priya",
      html: "<p>Priya</p>",
      text: "Priya",
    });
  });

  it("renders fields that were never saved", async () => {
    const { POST } = await import("../email-templates-draft-preview");

    const res = await POST(post({ template: draft, data: { name: "Priya" } }));
    const body: unknown = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({
      subject: "Hi Priya",
      html: "<p>Priya</p>",
      text: "Priya",
    });
  });

  it("hands the service the fields and the data it was given", async () => {
    const { POST } = await import("../email-templates-draft-preview");

    await POST(post({ template: draft, data: { name: "Priya" } }));

    expect(previewDraft).toHaveBeenCalledTimes(1);
    const [fields, data] = previewDraft.mock.calls[0];
    expect(fields.subject).toBe("Hi {{name}}");
    expect(fields.htmlContent).toBe("<p>{{name}}</p>");
    expect(data).toEqual({ name: "Priya" });
  });

  it("defaults the optional fields rather than passing them undefined", async () => {
    const { POST } = await import("../email-templates-draft-preview");

    await POST(post({ template: draft, data: {} }));

    const [fields] = previewDraft.mock.calls[0];
    expect(fields.plainTextContent).toBeNull();
    expect(fields.preheader).toBeNull();
    expect(fields.layoutId).toBeNull();
  });

  it("gates on the same permissions as the saved-template preview", async () => {
    const { POST } = await import("../email-templates-draft-preview");

    await POST(post({ template: draft, data: {} }));

    expect(requireRouteAnyPermission).toHaveBeenCalledTimes(1);
    const [, permissions] = requireRouteAnyPermission.mock.calls[0];
    expect(permissions).toEqual([
      { action: "create", resource: "email-templates" },
      { action: "manage", resource: "email-templates" },
    ]);
  });

  it("authorizes BEFORE it renders", async () => {
    const { POST } = await import("../email-templates-draft-preview");
    const order: string[] = [];
    requireRouteAnyPermission.mockImplementationOnce(async () => {
      order.push("authorize");
    });
    previewDraft.mockImplementationOnce(() => {
      order.push("render");
      return Promise.resolve({ subject: "", html: "", text: "" });
    });

    await POST(post({ template: draft, data: {} }));

    expect(order).toEqual(["authorize", "render"]);
  });

  it("rejects a body carrying no template", async () => {
    const { POST } = await import("../email-templates-draft-preview");

    const res = await POST(post({ data: {} }));

    expect(res.status).toBe(400);
    expect(previewDraft).not.toHaveBeenCalled();
  });

  it("rejects a template whose kind is not one this renderer knows", async () => {
    const { POST } = await import("../email-templates-draft-preview");

    const res = await POST(
      post({ template: { ...draft, kind: "banner" }, data: {} })
    );

    expect(res.status).toBe(400);
    expect(previewDraft).not.toHaveBeenCalled();
  });
});

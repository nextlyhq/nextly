import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the init/DI/auth boundary so the PATCH handler can be exercised in
// isolation: we assert the authenticated identity reaches SingleEntryService.
const updateSpy = vi.fn();
const requireRouteCollectionAccessSpy = vi.fn();
const readJsonBodySpy = vi.fn();

vi.mock("../../init", () => ({
  getCachedNextly: vi.fn().mockResolvedValue({}),
}));

vi.mock("../../di", () => ({
  getService: vi.fn((name: string) =>
    name === "singleEntryService"
      ? { update: updateSpy, get: vi.fn() }
      : { getSingleBySlug: vi.fn() }
  ),
}));

vi.mock("../route-auth", () => ({
  requireRouteCollectionAccess: (...args: unknown[]) =>
    requireRouteCollectionAccessSpy(...args),
}));

vi.mock("../read-json-body", () => ({
  readJsonBody: (...args: unknown[]) => readJsonBodySpy(...args),
}));

// Identity passthrough: the timezone formatter is not under test here.
vi.mock("../../lib/date-formatting", () => ({
  withTimezoneFormatting: (response: Response) => response,
}));

import { PATCH } from "../singles-detail";

describe("singles-detail PATCH route auth forwarding", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireRouteCollectionAccessSpy.mockResolvedValue({
      userId: "u-1",
      userName: "Ada",
      userEmail: "ada@example.com",
      roles: ["editor"],
      permissions: [],
      authMethod: "session",
    });
    readJsonBodySpy.mockResolvedValue({ title: "Updated" });
    updateSpy.mockResolvedValue({
      success: true,
      statusCode: 200,
      data: { id: "s1", title: "Updated" },
    });
  });

  it("forwards the authenticated user, overrideAccess, and routeAuthorized to update", async () => {
    const request = new Request("http://localhost/api/singles/site-settings", {
      method: "PATCH",
    });
    const context = { params: Promise.resolve({ slug: "site-settings" }) };

    const response = await PATCH(request, context);

    expect(response.status).toBe(200);
    // The standalone route must run the update as the authorized user (route
    // auth already ran -> overrideAccess), while keeping the response redacted
    // to what the user may read (routeAuthorized), matching the dispatcher's
    // updateSingleDocument path.
    expect(updateSpy).toHaveBeenCalledWith(
      "site-settings",
      { title: "Updated" },
      {
        locale: undefined,
        user: { id: "u-1", name: "Ada", email: "ada@example.com" },
        overrideAccess: true,
        routeAuthorized: true,
      }
    );
  });
});

// Pins the canonical respondData (GET) and respondMutation (PATCH) wire
// shapes for general-settings. The timezone-formatting wrapper is a
// structural pass-through here because we stub out the lookup that pulls
// the configured timezone.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../auth/middleware", () => ({
  requireAnyPermission: vi.fn(),
  isErrorResponse: vi.fn(),
}));

vi.mock("../auth/middleware/to-nextly-error", () => ({
  toNextlyAuthError: vi.fn((errResponse: unknown) => {
    return new Error(`auth error: ${JSON.stringify(errResponse)}`);
  }),
}));

vi.mock("../init", () => ({
  getCachedNextly: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../di", () => ({
  container: {
    // `withTimezoneFormatting` calls `container.has` to see if the
    // generalSettingsService is registered; we keep it false so the
    // wrapper short-circuits to a UTC pass-through.
    has: vi.fn().mockReturnValue(false),
    get: vi.fn(),
  },
}));

import { isErrorResponse, requireAnyPermission } from "../auth/middleware";
import { container } from "../di";

import {
  getGeneralSettings,
  updateGeneralSettings,
} from "./general-settings";

const SETTINGS = {
  applicationName: "Nextly",
  siteUrl: "https://example.test",
  adminEmail: "admin@example.test",
  timezone: null,
  dateFormat: null,
  timeFormat: null,
  logoUrl: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  (requireAnyPermission as ReturnType<typeof vi.fn>).mockResolvedValue({
    userId: "user-1",
  });
  (isErrorResponse as ReturnType<typeof vi.fn>).mockReturnValue(false);
});

describe("getGeneralSettings", () => {
  it("emits respondData (bare body) for the settings row", async () => {
    (container.get as ReturnType<typeof vi.fn>).mockReturnValue({
      getSettings: vi.fn().mockResolvedValue(SETTINGS),
    });

    const res = await getGeneralSettings(
      new Request("http://x/api/nextly/general-settings")
    );

    expect(res.status).toBe(200);
    const json = (await res.json()) as Record<string, unknown>;
    expect(json).not.toHaveProperty("data");
    expect(json).toEqual(SETTINGS);
  });
});

describe("updateGeneralSettings", () => {
  it("emits respondMutation { message, item } on a successful PATCH", async () => {
    const updated = { ...SETTINGS, applicationName: "Nextly Updated" };
    (container.get as ReturnType<typeof vi.fn>).mockReturnValue({
      updateSettings: vi.fn().mockResolvedValue(updated),
    });

    const res = await updateGeneralSettings(
      new Request("http://x/api/nextly/general-settings", {
        method: "PATCH",
        body: JSON.stringify({ applicationName: "Nextly Updated" }),
      })
    );

    expect(res.status).toBe(200);
    const json = (await res.json()) as { message: string; item: unknown };
    expect(json).not.toHaveProperty("data");
    expect(json.message).toMatch(/updated/i);
    expect(json.item).toEqual(updated);
  });
});

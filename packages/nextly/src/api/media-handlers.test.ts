import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { container } from "../di/container";

import { createMediaHandlers } from "./media-handlers";

const mocks = vi.hoisted(() => {
  return {
    mediaService: {
      listMedia: vi.fn(),
    },
  };
});

vi.mock("../init", () => ({
  getNextly: vi.fn(async () => ({})),
}));

vi.mock("../di", () => ({
  getService: vi.fn(() => mocks.mediaService),
}));

describe("createMediaHandlers timezone formatting", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    container.clear();
  });

  afterEach(() => {
    container.clear();
  });

  it("normalizes media timestamps with configured timezone for dynamic route handlers", async () => {
    container.registerSingleton("generalSettingsService", () => ({
      getTimezone: async () => "Asia/Tokyo",
    }));

    mocks.mediaService.listMedia.mockResolvedValue({
      data: [
        {
          id: "media-1",
          filename: "sample.png",
          originalFilename: "sample.png",
          mimeType: "image/png",
          size: 1234,
          url: "/uploads/sample.png",
          uploadedAt: "2026-04-03T12:34:56",
          updatedAt: "2026-04-03 13:00:00",
        },
      ],
      pagination: {
        total: 1,
      },
    });

    const handlers = createMediaHandlers();
    const response = await handlers.GET(
      new Request("http://localhost/api/media"),
      {
        params: Promise.resolve({}),
      }
    );

    expect(response.status).toBe(200);

    const json = (await response.json()) as {
      data: Array<{ uploadedAt: string; updatedAt: string }>;
    };

    expect(json.data[0].uploadedAt).toContain("+09:00");
    expect(json.data[0].updatedAt).toContain("+09:00");
  });
});

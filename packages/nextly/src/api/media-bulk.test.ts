/**
 * Regression tests for the media-bulk DELETE wire shape.
 *
 * Pins:
 *   DELETE /api/media/bulk -> respondBulk({ message, items, errors })
 *
 * The DELETE route exercises `respondBulk` end-to-end through the same
 * `mediaService.bulkDelete` boundary the admin client hits. POST tests
 * are intentionally NOT in this file: the POST route's pre-validation
 * (zod parse on `UploadMediaInputSchema`) and base64-decode pipeline
 * are pre-existing concerns; the wire-shape contract for
 * `respondBulkUpload` is asserted via direct helper tests in
 * `response-shapes.test.ts` and via the integration-level coverage
 * in `media-service-edge-cases.test.ts`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { container } from "../di/container";

const mocks = vi.hoisted(() => {
  return {
    mediaService: {
      bulkDelete: vi.fn(),
    },
  };
});

vi.mock("../di", () => ({
  getService: vi.fn(() => mocks.mediaService),
  isServicesRegistered: vi.fn(() => true),
}));

// Import after mocks so the route module picks up the mocked di.
import { DELETE } from "./media-bulk";

describe("media-bulk DELETE -> respondBulk", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    container.clear();
    mocks.mediaService.bulkDelete.mockReset();
  });

  afterEach(() => {
    container.clear();
  });

  it("returns canonical { message, items, errors } with 200 on all-success", async () => {
    mocks.mediaService.bulkDelete.mockResolvedValue({
      successes: [{ id: "m1" }, { id: "m2" }],
      failures: [],
      total: 2,
      successCount: 2,
      failedCount: 0,
    });

    const response = await DELETE(
      new Request("http://localhost/api/media/bulk", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mediaIds: ["m1", "m2"] }),
      })
    );

    expect(response.status).toBe(200);
    const body = await response.json();

    // Canonical respondBulk envelope.
    expect(body).toEqual({
      message: expect.any(String),
      items: [{ id: "m1" }, { id: "m2" }],
      errors: [],
    });
    // Regression guards: legacy `data` wrapper, `totalFiles`, and `results`
    // must not appear on the wire.
    expect(body).not.toHaveProperty("data");
    expect(body).not.toHaveProperty("totalFiles");
    expect(body).not.toHaveProperty("results");
  });

  it("surfaces partial failures keyed by id in errors[]", async () => {
    mocks.mediaService.bulkDelete.mockResolvedValue({
      successes: [{ id: "m1" }],
      failures: [
        {
          id: "m-missing",
          code: "NOT_FOUND",
          message: "Not found.",
        },
      ],
      total: 2,
      successCount: 1,
      failedCount: 1,
    });

    const response = await DELETE(
      new Request("http://localhost/api/media/bulk", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mediaIds: ["m1", "m-missing"] }),
      })
    );

    // Partial-success returns 200; per-item failures are data.
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.items).toEqual([{ id: "m1" }]);
    expect(body.errors).toHaveLength(1);
    expect(body.errors[0]).toMatchObject({
      id: "m-missing",
      code: "NOT_FOUND",
      message: "Not found.",
    });
  });
});

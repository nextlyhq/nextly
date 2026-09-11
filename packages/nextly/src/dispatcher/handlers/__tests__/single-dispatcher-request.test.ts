/**
 * A Single's doors hand the request down to the operation.
 *
 * Singles run the same hook phases collections do, on the same shared context
 * type, so a Single's hooks read `ctx.req.http` and take its absence to mean no
 * request produced the write. Their dispatcher takes the request as an optional
 * argument, which is exactly the shape that compiles while delivering nothing:
 * this wiring was already in place and receiving `undefined`, because the entry
 * point above it never accepted one. No type could catch that, so it is pinned
 * here.
 *
 * @module dispatcher/handlers/__tests__/single-dispatcher-request
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../helpers/di", () => ({
  getSingleRegistryFromDI: vi.fn(),
  getSingleEntryServiceFromDI: vi.fn(),
  getSingleMetadataServiceFromDI: vi.fn(),
  getComponentRegistryFromDI: vi.fn().mockReturnValue(undefined),
  getAdapterFromDI: vi.fn(),
  getConfigFromDI: vi.fn(() => undefined),
  getSchemaRegistryFromDI: vi.fn(() => undefined),
}));

vi.mock("../../../di/container", () => ({
  container: { has: vi.fn(() => false), get: vi.fn(() => undefined) },
}));

import {
  getSingleEntryServiceFromDI,
  getSingleMetadataServiceFromDI,
  getSingleRegistryFromDI,
} from "../../helpers/di";
import { dispatchSingles } from "../single-dispatcher";

const request = new Request("https://example.test/api/singles/settings", {
  method: "PATCH",
  headers: { "x-forwarded-for": "203.0.113.7" },
});

const ok = { success: true, statusCode: 200, data: { slug: "settings" } };

function wireEntry(entry: Record<string, unknown>) {
  vi.mocked(getSingleRegistryFromDI).mockReturnValue({} as never);
  vi.mocked(getSingleMetadataServiceFromDI).mockReturnValue({} as never);
  vi.mocked(getSingleEntryServiceFromDI).mockReturnValue(entry as never);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("the Single doors", () => {
  it("hands the request to the update it performs", async () => {
    const update = vi.fn().mockResolvedValue(ok);
    wireEntry({ update });
    await dispatchSingles(
      "updateSingleDocument",
      { slug: "settings" },
      { title: "hi" },
      request
    ).catch(() => undefined);
    expect(update).toHaveBeenCalled();
    // Identity, not `toMatchObject({ request })`. A `Request` keeps everything
    // on its prototype, so it has no own enumerable properties and matching
    // one structurally succeeds against `undefined`. The first version of this
    // test did that and passed against the dropped request it was written for.
    const passed = update.mock.calls[0]![2] as { request?: unknown };
    expect(passed.request).toBe(request);
  });

  it("hands the request to the read it performs", async () => {
    const get = vi.fn().mockResolvedValue(ok);
    wireEntry({ get });
    await dispatchSingles(
      "getSingleDocument",
      { slug: "settings" },
      undefined,
      request
    ).catch(() => undefined);
    expect(get).toHaveBeenCalled();
    const passed = get.mock.calls[0]![1] as { request?: unknown };
    expect(passed.request).toBe(request);
  });

  it("says there was none when the caller passed none", async () => {
    // The control, and the state this test was written for: the wiring below
    // the entry point looked complete while the entry point dropped it, so
    // every one of these operations reported no request for browser traffic.
    const update = vi.fn().mockResolvedValue(ok);
    wireEntry({ update });
    await dispatchSingles(
      "updateSingleDocument",
      { slug: "settings" },
      { title: "hi" }
    ).catch(() => undefined);
    const passed = update.mock.calls[0]![2] as { request?: unknown };
    expect(passed.request).toBeUndefined();
  });
});

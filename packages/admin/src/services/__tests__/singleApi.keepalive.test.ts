/**
 * A Single update that must outlive the page: sent with `keepalive`, so the
 * browser finishes it after the tab is hidden or closed, while its body fits
 * the 64 KB browsers allow such a request; a larger one goes as an ordinary
 * request rather than being refused outright.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/api/protectedApi", () => ({
  protectedApi: {
    patch: vi.fn(async () => ({ message: "ok", item: { id: "s1" } })),
  },
}));

import { protectedApi } from "../../lib/api/protectedApi";
import { KEEPALIVE_BODY_LIMIT } from "../../lib/api/keepalive";
import { singleApi } from "../singleApi";

const patch = protectedApi.patch as unknown as ReturnType<typeof vi.fn>;

describe("singleApi.updateDocument — keepalive", () => {
  beforeEach(() => patch.mockClear());

  it("sends an update asked to outlive the page with keepalive", async () => {
    await singleApi.updateDocument(
      "site-style",
      { tokens: { tokens: [] } },
      { keepalive: true }
    );
    expect(patch.mock.calls[0]?.[2]).toEqual({ keepalive: true });
  });

  it("sends an ordinary request when the body is larger than keepalive allows", async () => {
    const large = { tokens: "x".repeat(KEEPALIVE_BODY_LIMIT) };
    await singleApi.updateDocument("site-style", large, { keepalive: true });
    expect(patch.mock.calls[0]?.[2]).toEqual({});
  });

  it("sends an ordinary request unless asked", async () => {
    await singleApi.updateDocument("site-style", { tokens: null });
    expect(patch.mock.calls[0]?.[2]).toEqual({});
  });
});

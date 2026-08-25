/**
 * `previewDraftGate()` with nothing passed to it.
 *
 * The gate is short and security-critical, and it was previously unwritable
 * without three values an application has no reason to hold. The cases that
 * matter are the refusals: an unwired gate is the difference between a preview
 * link that works and one that answers 404 on a page that looks entirely
 * correct, and a gate that grants too much turns one link into a key to every
 * draft in the collection.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { signPreviewToken } from "../../../auth/preview/preview-token";
import { previewDraftGate } from "../preview-draft-gate";

const TEST_SECRET = "preview-gate-test-secret-at-least-32-chars!!";

let cookieValue: string | undefined;
// A binding rather than a captured literal: the revocation case moves it
// mid-suite, which is the whole point of reading it per request.
let generation = 1;

// The identity lookup reaches the container and the database; these cases are
// about the unwired gate's defaults. Who a draft renders as is covered in
// `preview-identity.test.ts`.
const resolvePreviewIdentity = vi.hoisted(() => vi.fn());
vi.mock("../preview-identity", () => ({ resolvePreviewIdentity }));

// The per-render re-authorization. It reaches the container and the database;
// what it decides is covered in the integration suite, where a real revocation
// can actually be performed. Here it stands aside so these cases stay about
// CONFINEMENT — which document a token reaches.
const assertEntryPreviewable = vi.hoisted(() => vi.fn());
vi.mock("../../../api/preview-access", () => ({ assertEntryPreviewable }));

vi.mock("../preview-route-defaults", () => ({
  defaultSecret: () => TEST_SECRET,
  defaultGeneration: () => Promise.resolve(generation),
  defaultCookies: () =>
    Promise.resolve({
      get: (name: string) =>
        name === "__nextly_preview" && cookieValue !== undefined
          ? { value: cookieValue }
          : undefined,
    }),
}));

async function cookieFor(
  scope: { collection: string; entryId: string; locale?: string },
  options: { generation?: number; ttlSeconds?: number } = {}
): Promise<void> {
  const { token } = await signPreviewToken(scope, TEST_SECRET, {
    generation: options.generation ?? 1,
    minter: "minter-1",
    ...(options.ttlSeconds === undefined
      ? {}
      : { ttlSeconds: options.ttlSeconds }),
  });
  cookieValue = encodeURIComponent(token);
}

describe("previewDraftGate with no arguments", () => {
  beforeEach(() => {
    cookieValue = undefined;
    generation = 1;
    resolvePreviewIdentity.mockClear();
    assertEntryPreviewable.mockClear();
    assertEntryPreviewable.mockResolvedValue(undefined);
    resolvePreviewIdentity.mockResolvedValue({
      id: "minter-1",
      roles: ["editor"],
      role: "editor",
    });
  });

  it("grants the entry its token names", async () => {
    await cookieFor({ collection: "pages", entryId: "entry-1" });

    const gate = previewDraftGate();

    await expect(gate({ collection: "pages", slug: "about" })).resolves.toEqual(
      expect.objectContaining({ entryId: "entry-1" })
    );
  });

  // The grant carries the identity the draft is READ as, because the row is
  // read TRUSTED and trust switched field-level read rules off with it. Without
  // one the page renders every field, including any the sharer cannot see.
  it("carries the sharer's identity when the token records who shared it", async () => {
    await cookieFor({ collection: "pages", entryId: "entry-1" });

    const grant = await previewDraftGate()({
      collection: "pages",
      slug: "about",
    });

    expect(resolvePreviewIdentity).toHaveBeenCalledWith("minter-1");
    expect(grant).toMatchObject({
      entryId: "entry-1",
      readAs: { id: "minter-1" },
    });
  });

  it("refuses a request with no preview cookie", async () => {
    const gate = previewDraftGate();

    await expect(gate({ collection: "pages", slug: "about" })).resolves.toBe(
      false
    );
  });

  it("refuses a token minted for a different collection", async () => {
    await cookieFor({ collection: "posts", entryId: "entry-1" });

    const gate = previewDraftGate();

    await expect(gate({ collection: "pages", slug: "about" })).resolves.toBe(
      false
    );
  });

  // The promise the gate exists to keep: one link is a key to ONE document,
  // never to every draft in its collection. The gate cannot settle that alone —
  // it hands back the token's own entry id and the route compares it against
  // the row actually resolved — so what is asserted here is that the id coming
  // back is the TOKEN's, never the requested path's.
  it("grants the entry its token names, not whatever the path resolves to", async () => {
    await cookieFor({ collection: "pages", entryId: "entry-A" });

    const gate = previewDraftGate();

    await expect(
      gate({ collection: "pages", slug: "some-other-page" })
    ).resolves.toEqual(expect.objectContaining({ entryId: "entry-A" }));
  });

  it("refuses an expired token", async () => {
    await cookieFor(
      { collection: "pages", entryId: "entry-1" },
      { ttlSeconds: 1 }
    );

    vi.useFakeTimers();
    vi.advanceTimersByTime(5000);
    const gate = previewDraftGate();
    const verdict = await gate({ collection: "pages", slug: "about" });
    vi.useRealTimers();

    expect(verdict).toBe(false);
  });

  // Revocation has to reach sessions ALREADY in flight, not merely refuse new
  // links, which is why the generation is re-read per request rather than
  // captured when the gate was built.
  it("refuses a token minted under a superseded generation", async () => {
    await cookieFor({ collection: "pages", entryId: "entry-1" });

    generation = 2;
    const gate = previewDraftGate();

    await expect(gate({ collection: "pages", slug: "about" })).resolves.toBe(
      false
    );
  });

  it("refuses a token whose locale is not the one the route is reading", async () => {
    await cookieFor({ collection: "pages", entryId: "entry-1", locale: "en" });

    const gate = previewDraftGate();

    await expect(
      gate({ collection: "pages", slug: "about", locale: "fr" })
    ).resolves.toBe(false);
  });
});

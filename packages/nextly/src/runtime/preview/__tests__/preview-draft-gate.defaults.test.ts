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
  });

  it("grants the entry its token names", async () => {
    await cookieFor({ collection: "pages", entryId: "entry-1" });

    const gate = previewDraftGate();

    await expect(gate({ collection: "pages", slug: "about" })).resolves.toEqual(
      {
        entryId: "entry-1",
      }
    );
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
    ).resolves.toEqual({ entryId: "entry-A" });
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

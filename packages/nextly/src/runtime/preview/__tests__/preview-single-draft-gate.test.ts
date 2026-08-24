/**
 * The gate that decides whether a request may read a Single's working draft.
 *
 * The refusals are what matter. An unwired gate answers 404 on a page that looks
 * entirely correct; a gate that grants too much turns one shared link into a key
 * to every unpublished Single on the site.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { signPreviewToken } from "../../../auth/preview/preview-token";
import { previewSingleDraftGate } from "../preview-single-draft-gate";

const TEST_SECRET = "single-gate-test-secret-at-least-32-chars!!";

let cookieValue: string | undefined;
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
  scope: Parameters<typeof signPreviewToken>[0],
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

beforeEach(() => {
  cookieValue = undefined;
  generation = 1;
});

describe("previewSingleDraftGate", () => {
  it("grants the Single its token names", async () => {
    await cookieFor({ kind: "single", single: "homepage" });

    await expect(previewSingleDraftGate()({ slug: "homepage" })).resolves.toBe(
      true
    );
  });

  it("refuses a request with no preview cookie", async () => {
    await expect(previewSingleDraftGate()({ slug: "homepage" })).resolves.toBe(
      false
    );
  });

  // The promise the gate exists to keep: one link opens ONE Single, never every
  // unpublished Single on the site.
  it("refuses a different Single", async () => {
    await cookieFor({ kind: "single", single: "footer" });

    await expect(previewSingleDraftGate()({ slug: "homepage" })).resolves.toBe(
      false
    );
  });

  // A Single named `pages` and a collection named `pages` are different
  // documents, so the kind is compared and not only the name.
  it("refuses a collection entry's token, even one naming the same slug", async () => {
    await cookieFor({ collection: "homepage", entryId: "homepage" });

    await expect(previewSingleDraftGate()({ slug: "homepage" })).resolves.toBe(
      false
    );
  });

  // The POSITIVE half, and the one that separates a correct locale comparison
  // from a gate that simply refuses every locale. Without it, deleting the
  // locale entirely still passes the refusal below.
  it("grants the locale its token names", async () => {
    await cookieFor({ kind: "single", single: "homepage", locale: "en" });

    await expect(
      previewSingleDraftGate()({ slug: "homepage", locale: "en" })
    ).resolves.toBe(true);
  });

  it("refuses a token whose locale is not the one the route reads", async () => {
    await cookieFor({ kind: "single", single: "homepage", locale: "en" });

    await expect(
      previewSingleDraftGate()({ slug: "homepage", locale: "fr" })
    ).resolves.toBe(false);
  });

  // A token minted without a locale is a link to the document rather than to
  // one translation of it.
  it("grants any locale when the token names none", async () => {
    await cookieFor({ kind: "single", single: "homepage" });

    await expect(
      previewSingleDraftGate()({ slug: "homepage", locale: "fr" })
    ).resolves.toBe(true);
  });

  it("refuses an expired token", async () => {
    await cookieFor({ kind: "single", single: "homepage" }, { ttlSeconds: 1 });

    vi.useFakeTimers();
    vi.advanceTimersByTime(5000);
    const verdict = await previewSingleDraftGate()({ slug: "homepage" });
    vi.useRealTimers();

    expect(verdict).toBe(false);
  });

  // Revocation has to reach sessions already in flight, not merely refuse new
  // links, which is why the generation is re-read per request.
  it("refuses a token minted under a superseded generation", async () => {
    await cookieFor({ kind: "single", single: "homepage" });

    generation = 2;

    await expect(previewSingleDraftGate()({ slug: "homepage" })).resolves.toBe(
      false
    );
  });
});

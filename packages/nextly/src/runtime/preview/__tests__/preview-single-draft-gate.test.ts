/**
 * The gate that decides whether a request may read a Single's working draft.
 *
 * The refusals are what matter. An unwired gate answers 404 on a page that looks
 * entirely correct; a gate that grants too much turns one shared link into a key
 * to every unpublished Single on the site.
 */
import { hkdfSync } from "node:crypto";

import { SignJWT } from "jose";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { signPreviewToken } from "../../../auth/preview/preview-token";
import { previewSingleDraftGate } from "../preview-single-draft-gate";

const TEST_SECRET = "single-gate-test-secret-at-least-32-chars!!";

let cookieValue: string | undefined;
let generation = 1;

// The identity lookup and the per-render re-authorization both reach the
// container and the database. These cases are about CONFINEMENT — which
// document a token reaches — so the sharer is a fixture here; who the draft
// renders as is covered in `preview-identity.test.ts`, and what the
// re-authorization DECIDES is covered where a permission can actually be
// revoked.
const SHARER = { id: "minter-1", roles: ["editor"], role: "editor" };
const resolvePreviewIdentity = vi.hoisted(() => vi.fn());
vi.mock("../preview-identity", () => ({ resolvePreviewIdentity }));
const assertSinglePreviewable = vi.hoisted(() => vi.fn());
vi.mock("../../../api/preview-access", () => ({ assertSinglePreviewable }));

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
  resolvePreviewIdentity.mockClear();
  resolvePreviewIdentity.mockResolvedValue(SHARER);
  assertSinglePreviewable.mockClear();
  assertSinglePreviewable.mockResolvedValue(undefined);
});

describe("previewSingleDraftGate", () => {
  it("grants the Single its token names", async () => {
    await cookieFor({ kind: "single", single: "homepage" });

    await expect(
      previewSingleDraftGate()({ slug: "homepage" })
    ).resolves.toEqual({ readAs: SHARER });
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
    ).resolves.toEqual({ readAs: SHARER });
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
    ).resolves.toEqual({ readAs: SHARER });
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
  // A grant with no identity is a grant with no field rules, which is the leak
  // the identity exists to close — so the draft is refused outright and the
  // request resolves published-only, indistinguishable from an expired link.
  it("refuses the draft when the sharer cannot be identified", async () => {
    resolvePreviewIdentity.mockResolvedValue(null);
    await cookieFor({ kind: "single", single: "homepage" });

    await expect(previewSingleDraftGate()({ slug: "homepage" })).resolves.toBe(
      false
    );
  });

  // A sharer who is still ACTIVE but no longer authorized — an update role
  // withdrawn, a custom rule they stopped satisfying. Rebuilding their identity
  // re-evaluates FIELD rules and nothing else, because the read runs with the
  // Single's own document rules bypassed, so without this the link kept serving
  // the draft until it expired.
  it("refuses once the sharer may no longer preview the Single", async () => {
    assertSinglePreviewable.mockRejectedValue(new Error("forbidden"));
    await cookieFor({ kind: "single", single: "homepage" });

    await expect(previewSingleDraftGate()({ slug: "homepage" })).resolves.toBe(
      false
    );
    // Asked about the Single the TOKEN names, as the SHARER, and told that
    // nothing gated this request — a render has no route gate, and claiming one
    // ran skips the only check that notices a withdrawn role.
    expect(assertSinglePreviewable).toHaveBeenCalledWith(
      "homepage",
      undefined,
      SHARER,
      { routeAuthorized: false }
    );
  });
  // A token minted BEFORE the claim existed, built the way one would actually
  // arrive: signed with the same derived key, carrying no `mnt`. The signer
  // refuses to produce one now, so it is hand-built rather than asserted
  // against a shape this module can no longer make. Honouring it would read the
  // document with no field rules at all, which is the leak.
  it("refuses a token minted before it recorded who shared it", async () => {
    const legacy = await new SignJWT({
      kind: "single",
      sng: "homepage",
      gen: 1,
    })
      .setProtectedHeader({ alg: "HS256" })
      .setAudience("nextly:preview")
      .setSubject("single:homepage")
      .setIssuedAt()
      .setExpirationTime("10m")
      .sign(
        new Uint8Array(
          hkdfSync("sha256", TEST_SECRET, "", "nextly:preview-token:v1", 32)
        )
      );
    cookieValue = encodeURIComponent(legacy);

    await expect(previewSingleDraftGate()({ slug: "homepage" })).resolves.toBe(
      false
    );
    // And it never reached the identity lookup: there was no id to look up.
    expect(resolvePreviewIdentity).not.toHaveBeenCalled();
  });
});

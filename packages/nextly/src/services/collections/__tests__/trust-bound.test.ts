/**
 * A trusted read's bound must reach the media table too.
 *
 * Upload expansion does not go through the per-target decision the relationship
 * fetches make: it reads the media table directly. So a route that bounded its
 * bypass to its own collections still pulled whole media rows — the file AND
 * who uploaded it, which folder it sits in, and how it is tagged — into a page
 * served to everyone.
 *
 * The bound narrows rather than withholds here, because an upload field exists
 * to be rendered and the file's URL is public by construction. What comes off is
 * the ownership and filing.
 */
import { describe, expect, it } from "vitest";

import type { RelatedRowReadContext } from "../related-row-read-context";
import { applyMediaTrustBound, boundRefuses } from "../trust-bound";
import { TRUSTS_EVERY_COLLECTION } from "../trust-grant";

/** A media row as the fetch returns it, camelCased. */
function mediaRow(): Record<string, unknown> {
  return {
    id: "m1",
    url: "https://cdn.example.com/hero.png",
    altText: "A hero image",
    width: 1920,
    height: 1080,
    mimeType: "image/png",
    uploadedBy: "user-7",
    folderId: "folder-3",
    tags: ["internal", "unreleased-campaign"],
  };
}

/** The columns the bound must remove, and those it must keep. */
const INTERNAL = ["uploadedBy", "folderId", "tags"] as const;
const RENDERABLE = ["id", "url", "altText", "width", "height"] as const;

/** A read that holds a bypass and bounded it to the collections named. */
function bounded(
  trustedNames: string[],
  extra: Partial<RelatedRowReadContext> = {}
): RelatedRowReadContext {
  return {
    overrideAccess: true,
    trusted: (name: string) => trustedNames.includes(name),
    ...extra,
  };
}

describe("the trust bound applies to upload expansion", () => {
  it("is exercised — the fixture carries the columns under test", () => {
    // Without this, every assertion below passes against a row that never had
    // the columns, which is the shape of a guard that reports success because
    // it found nothing.
    const row = mediaRow();
    for (const column of INTERNAL) expect(row).toHaveProperty(column);
    for (const column of RENDERABLE) expect(row).toHaveProperty(column);
  });

  it("strips ownership and filing when the bound refuses media", async () => {
    const [row] = await applyMediaTrustBound([mediaRow()], bounded(["posts"]));

    for (const column of INTERNAL) {
      expect(
        row,
        `a public route pre-renders ${column} from a media row it never trusted`
      ).not.toHaveProperty(column);
    }
  });

  it("keeps what the page needs to render the file", async () => {
    // Withholding the row entirely would be the narrower answer and the wrong
    // one: the upload field exists to be rendered, and the URL is already
    // public — the page serves it to anyone who loads it.
    const [row] = await applyMediaTrustBound([mediaRow()], bounded(["posts"]));

    for (const column of RENDERABLE) expect(row).toHaveProperty(column);
    expect(row.url).toBe("https://cdn.example.com/hero.png");
  });

  it("strips the stored snake_case spelling too", async () => {
    const stored = {
      id: "m1",
      url: "/u/a.png",
      uploaded_by: "u1",
      folder_id: "f1",
    };
    const [row] = await applyMediaTrustBound([stored], bounded(["posts"]));

    expect(row).not.toHaveProperty("uploaded_by");
    expect(row).not.toHaveProperty("folder_id");
    expect(row).toHaveProperty("url");
  });

  it("leaves an UNBOUNDED trusted read exactly as it was", async () => {
    // The Direct API's existing semantics. A caller that has already decided
    // who is asking supplies no bound, and narrowing it here would change what
    // every admin read returns.
    const [row] = await applyMediaTrustBound([mediaRow()], {
      overrideAccess: true,
      trusted: TRUSTS_EVERY_COLLECTION,
    });

    for (const column of INTERNAL) expect(row).toHaveProperty(column);
  });

  it("leaves a read that holds no bypass exactly as it was", async () => {
    // Not trusting a target and refusing it are different states. An enforced
    // read never held a bypass to narrow, and its rows are judged by the
    // ordinary path.
    const [row] = await applyMediaTrustBound([mediaRow()], {
      overrideAccess: false,
      trusted: (name: string) => name === "posts",
    });

    for (const column of INTERNAL) expect(row).toHaveProperty(column);
  });

  it("keeps the whole row when the bound NAMES media", async () => {
    const [row] = await applyMediaTrustBound(
      [mediaRow()],
      bounded(["posts", "media"])
    );

    for (const column of INTERNAL) expect(row).toHaveProperty(column);
  });

  it("honours a scoped API key that holds read-media", async () => {
    // A refused target falls back to the caller's own grant rather than to an
    // assumption that the caller is anonymous. A key stamped with `read-media`
    // is entitled to the row a direct read would give it.
    const [row] = await applyMediaTrustBound(
      [mediaRow()],
      bounded(["posts"], {
        authenticatedScope: {
          actorType: "apiKey",
          permissions: ["read-media"],
        },
      })
    );

    for (const column of INTERNAL) expect(row).toHaveProperty(column);
  });

  it("does not extend a key's OTHER grants to media", async () => {
    const [row] = await applyMediaTrustBound(
      [mediaRow()],
      bounded(["posts"], {
        authenticatedScope: {
          actorType: "apiKey",
          permissions: ["read-posts", "manage-settings"],
        },
      })
    );

    for (const column of INTERNAL) expect(row).not.toHaveProperty(column);
  });
});

describe("boundRefuses separates refusal from absence of trust", () => {
  it("is true only for a bypass that named a bound excluding the target", () => {
    expect(boundRefuses(bounded(["posts"]), "media")).toBe(true);
    expect(boundRefuses(bounded(["posts", "media"]), "media")).toBe(false);
  });

  it("is false for a read holding no bypass, however narrow its bound", () => {
    // The distinction the media strip depends on: an enforced read has refused
    // nothing, so treating it as a refusal would strip columns from every
    // ordinary authenticated read.
    expect(
      boundRefuses({ overrideAccess: false, trusted: () => false }, "media")
    ).toBe(false);
    expect(boundRefuses({ trusted: () => false }, "media")).toBe(false);
  });

  it("is false for a bypass with no bound at all", () => {
    expect(
      boundRefuses(
        { overrideAccess: true, trusted: TRUSTS_EVERY_COLLECTION },
        "media"
      )
    ).toBe(false);
  });
});

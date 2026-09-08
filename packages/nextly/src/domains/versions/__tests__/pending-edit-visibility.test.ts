/**
 * What a version row is translated INTO before anyone decides about it.
 *
 * The decision itself moved to `services/lib/document-visibility`, where the
 * activity feed asks the same question, and is driven there against a real
 * database. What is left here is the translation, and it is worth its own file
 * for one reason: `VersionScopeKind` is WIDER than the two kinds a content read
 * path can answer for, so this is the seam where a row that nothing can judge
 * has to be recognised rather than coerced.
 */
import { describe, expect, it, vi } from "vitest";

const visibleDocuments = vi.fn();

vi.mock("../../../services/lib/document-visibility", async importOriginal => ({
  ...(await importOriginal<
    typeof import("../../../services/lib/document-visibility")
  >()),
  visibleDocuments: (...args: unknown[]) =>
    visibleDocuments(...args) as unknown,
}));

import type { DocumentRef } from "../../../services/lib/document-visibility";
import {
  visiblePendingEdits,
  type PendingEditScope,
} from "../pending-edit-visibility";

const caller = { user: { id: "user-1", roles: ["editor"] } };
const scope = {
  kinds: new Map<string, "collection" | "single">(),
  locales: null,
  degraded: false,
} satisfies PendingEditScope;

function row(patch: { scopeKind: string; locale?: string | null }) {
  return {
    id: "v1",
    scopeKind: patch.scopeKind,
    scopeSlug: "posts",
    entryId: "e1",
    locale: patch.locale ?? null,
  } as unknown as Parameters<typeof visiblePendingEdits>[0][number];
}

/** The ref the translation produced for `input`, as the decision would see it. */
async function refFor(
  input: ReturnType<typeof row>
): Promise<DocumentRef | null> {
  visibleDocuments.mockResolvedValue([]);
  await visiblePendingEdits([input], caller, scope);
  const [, ref] = visibleDocuments.mock.calls[0] as [
    unknown,
    (item: unknown) => DocumentRef | null,
  ];
  return ref(input);
}

describe("translating a version row", () => {
  it("names the document a collection row belongs to, language included", async () => {
    expect(
      await refFor(row({ scopeKind: "collection", locale: "de" }))
    ).toEqual({
      kind: "collection",
      slug: "posts",
      entryId: "e1",
      locale: "de",
    });
  });

  it("names a single row the same way", async () => {
    expect(await refFor(row({ scopeKind: "single" }))).toEqual({
      kind: "single",
      slug: "posts",
      entryId: "e1",
      locale: null,
    });
  });

  it("refuses to name a PAGE row, which no content read path can answer for", async () => {
    // 🔴 `VersionScopeKind` also admits `page`, which the page builder captures
    // versions under. There is no collection or single read path holding that
    // document, so coercing it to either sends the row to a service that cannot
    // answer about it — and a service that answers "no such document" reads as
    // a denial, which is the inversion this pass exists to remove. `null` is
    // the honest translation, and the decision drops it.
    expect(await refFor(row({ scopeKind: "page" }))).toBeNull();
  });
});

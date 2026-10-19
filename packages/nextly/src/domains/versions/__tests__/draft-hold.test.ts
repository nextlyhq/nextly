import { describe, expect, it } from "vitest";

import { text } from "../../../config";
import { resolveDraftHold, type DraftHoldInput } from "../draft-hold";

/** An eligible, published, unlocalized document with a status-less write. */
const base = (): DraftHoldInput => ({
  collectionHasStatus: true,
  draftsVersioningEnabled: true,
  documentLocalized: false,
  fields: [text({ name: "title" })] as never,
  componentSchemas: null,
  namedStatus: undefined,
  liveStatus: "published",
});

describe("resolveDraftHold", () => {
  it("holds a status-less edit to a published document", () => {
    expect(resolveDraftHold(base())).toEqual({
      hold: true,
      draftLocale: null,
      eligible: true,
    });
  });

  it("does not hold a write that names a status", () => {
    // Naming a status IS the publish/unpublish intent; holding it would mean
    // the author asked to publish and nothing went live.
    expect(resolveDraftHold({ ...base(), namedStatus: "published" }).hold).toBe(
      false
    );
  });

  it("does not hold an edit to a document that is not published", () => {
    // Nothing is live to protect, so the edit belongs on the row.
    expect(resolveDraftHold({ ...base(), liveStatus: "draft" }).hold).toBe(
      false
    );
  });

  it("does not hold when the collection has no lifecycle or no drafts", () => {
    expect(
      resolveDraftHold({ ...base(), collectionHasStatus: false }).hold
    ).toBe(false);
    expect(
      resolveDraftHold({ ...base(), draftsVersioningEnabled: false }).hold
    ).toBe(false);
  });

  it("holds a localized edit under the language being written", () => {
    expect(
      resolveDraftHold({
        ...base(),
        documentLocalized: true,
        requestLocale: "es",
      })
    ).toEqual({ hold: true, draftLocale: "es", eligible: true });
  });

  it("refuses to hold a localized edit whose locale it cannot name", () => {
    // The case that matters: a surface with no locale concept must NOT store
    // the draft under the unlocalized slot. Nothing would read it there, and
    // the author would be told the save succeeded.
    const decision = resolveDraftHold({
      ...base(),
      documentLocalized: true,
    });
    // Eligible all the same: the document may hold drafts; this write cannot.
    expect(decision).toEqual({
      hold: false,
      draftLocale: null,
      eligible: true,
    });
  });

  it("ignores a locale on an unlocalized document", () => {
    // A localization-configured app can send a locale to a collection that is
    // not localized; keying by it would strand the draft.
    expect(resolveDraftHold({ ...base(), requestLocale: "es" })).toEqual({
      hold: true,
      draftLocale: null,
      eligible: true,
    });
  });

  it("reports a document that may not hold drafts at all", () => {
    // A publish promotes a stored draft only while this holds, so a draft left
    // from before the document became ineligible is never published unseen.
    expect(
      resolveDraftHold({ ...base(), draftsVersioningEnabled: false })
    ).toMatchObject({ hold: false, eligible: false });
    expect(
      resolveDraftHold({ ...base(), namedStatus: "published" })
    ).toMatchObject({ hold: false, eligible: true });
  });
});

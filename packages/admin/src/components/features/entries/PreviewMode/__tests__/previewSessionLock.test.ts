/**
 * Which two panes are previewing the SAME thing.
 *
 * The site keeps one preview cookie per browser, so a pane whose scope has been
 * superseded is showing content it can no longer prove. The key is what decides
 * "superseded", and it fails in both directions: too coarse and two different
 * documents look like one, so a pane goes on rendering a session that was taken
 * from it; too fine and one document looks like two, so the same entry open in
 * two tabs reports a conflict the browser does not have.
 */
import { describe, expect, it } from "vitest";

import { previewScopeKey } from "../previewSessionLock";

describe("previewScopeKey", () => {
  it("gives one document one key, whichever object literal carries it", () => {
    expect(previewScopeKey({ collection: "pages", entryId: "7" })).toBe(
      previewScopeKey({ collection: "pages", entryId: "7" })
    );
  });

  it("separates a Single from a collection entry whose parts CONCATENATE to it", () => {
    /*
     * The case the kind prefix exists for, and it has to be built deliberately.
     * The parts are joined by spaces, so a Single named `pages 7` and entry `7`
     * of collection `pages` produce the identical string once the prefix is
     * gone — and each pane then believes the other's cookie is its own, which
     * is the one failure this lock exists to detect, produced by the lock.
     *
     * A Single whose slug merely EQUALS a collection name does not collide
     * (`"home "` versus `"home home "`), so a test written that way passes
     * whether or not the prefix is there. This one was, until removing the
     * prefix changed nothing and said so.
     */
    expect(previewScopeKey({ single: "pages 7" })).not.toBe(
      previewScopeKey({ collection: "pages", entryId: "7" })
    );
  });

  it("separates two entries in one collection", () => {
    expect(previewScopeKey({ collection: "pages", entryId: "7" })).not.toBe(
      previewScopeKey({ collection: "pages", entryId: "8" })
    );
  });

  it("separates one entry id across two collections", () => {
    // Ids are not unique across collections, so the collection has to be in the
    // key or a grant would appear to travel between them.
    expect(previewScopeKey({ collection: "pages", entryId: "7" })).not.toBe(
      previewScopeKey({ collection: "posts", entryId: "7" })
    );
  });

  it("separates two languages of one document", () => {
    // A token is scoped per locale, so two languages are two sessions — and the
    // second opening would silently take the cookie from the first.
    expect(
      previewScopeKey({ collection: "pages", entryId: "7", locale: "en" })
    ).not.toBe(
      previewScopeKey({ collection: "pages", entryId: "7", locale: "fr" })
    );
    expect(previewScopeKey({ single: "home", locale: "en" })).not.toBe(
      previewScopeKey({ single: "home", locale: "fr" })
    );
  });

  it("treats an absent locale as its own scope rather than matching any", () => {
    // An unscoped token is not "the default language" — it covers every locale,
    // so it is a different session from one scoped to a language.
    expect(previewScopeKey({ single: "home" })).not.toBe(
      previewScopeKey({ single: "home", locale: "en" })
    );
  });
});

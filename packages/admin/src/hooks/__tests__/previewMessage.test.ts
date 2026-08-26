/**
 * What a refused preview tells the person whose document it is.
 *
 * The pane serves both an entry and a Single, so a message naming the wrong
 * kind sends someone to a field they cannot change. A Single is addressed by a
 * slug it always has, which makes "check the slug" the one piece of advice that
 * cannot be the problem there.
 */
import { describe, expect, it } from "vitest";

import { previewMessage } from "../useEntryPreview";

describe("previewMessage", () => {
  it("sends an ENTRY's author to the slug", () => {
    expect(previewMessage("unavailable", "entry")).toMatch(/slug/i);
  });

  it("sends a SINGLE's author to the preview URL, never the slug", () => {
    const message = previewMessage("unavailable", "single");

    expect(message).toMatch(/preview url/i);
    expect(message).not.toMatch(/slug/i);
    // Named for what it is, so the reader recognises their own document.
    expect(message).toMatch(/this single/i);
    expect(message).not.toMatch(/this entry/i);
  });

  it("names the document in the generic failure too", () => {
    expect(previewMessage("failed", "single")).toMatch(/this single/i);
    expect(previewMessage("failed", "entry")).toMatch(/this entry/i);
  });

  it("leaves the document-neutral reasons alone for both", () => {
    // The control: not every message differs, so the two above are a real
    // distinction rather than a wholesale duplication keyed on the noun.
    expect(previewMessage("noSiteUrl", "single")).toBe(
      previewMessage("noSiteUrl", "entry")
    );
    expect(previewMessage("popupBlocked", "single")).toBe(
      previewMessage("popupBlocked", "entry")
    );
  });

  it("defaults to the entry wording, which is what the tab has always shown", () => {
    expect(previewMessage("unavailable")).toBe(
      previewMessage("unavailable", "entry")
    );
  });
});

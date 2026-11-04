/**
 * What the "Publish all" dialog and its result say about each language, from
 * the server's own outcomes. The plausible broken implementations say pending
 * changes go live for a language whose outcome says otherwise, drop a language
 * from the list, or let the publish be pressed while the server would refuse
 * it.
 */
import { describe, expect, it } from "vitest";

import type { PublishAllPreview } from "@admin/services/publishAllPreview";

import {
  blockerSentence,
  outcomeSentence,
  publishAllBlocked,
  publishedSummary,
} from "../publishAllOutcomes";

const label = (code: string) =>
  ({ en: "English", de: "German", fr: "French" })[code] ?? code;

describe("what publishing every language says about each language", () => {
  it("says each outcome as the server reports it", () => {
    expect(
      outcomeSentence(
        { locale: "en", outcome: "goes-live-with-pending-change" },
        label
      )
    ).toBe("Its unpublished changes go live.");
    expect(
      outcomeSentence({ locale: "de", outcome: "stays-published" }, label)
    ).toBe("Stays as published.");
    expect(outcomeSentence({ locale: "fr", outcome: "goes-live" }, label)).toBe(
      "Goes live for the first time."
    );
    expect(
      outcomeSentence(
        { locale: "fr", outcome: "shows-fallback", fallback: "en" },
        label
      )
    ).toBe("Goes live with no content of its own, showing English.");
    expect(
      outcomeSentence(
        { locale: "fr", outcome: "shows-fallback", fallback: null },
        label
      )
    ).toBe("Goes live with no content of its own.");
  });

  it("names the out-of-date fields the caller may read and counts the rest", () => {
    expect(
      outcomeSentence(
        {
          locale: "de",
          outcome: "out-of-date",
          fields: ["tagline"],
          hiddenCount: 1,
        },
        label
      )
    ).toBe(
      'Its changes are behind the published tagline and 1 field you can\'t see. Publish German on its own and choose "Take the live values", then publish all again.'
    );
  });

  it("says why a blocker stops the publish, naming only readable fields", () => {
    expect(
      blockerSentence({
        reason: "pending-change-forbidden",
        fields: ["lockState"],
      })
    ).toBe("Unpublished changes edit lockState, which you may not publish.");
    expect(
      blockerSentence({
        reason: "pending-change-invalid",
        fields: [],
        hiddenCount: 2,
      })
    ).toBe(
      "Unpublished changes to 2 fields you can't see don't pass validation."
    );
    expect(
      blockerSentence({
        reason: "shared-edits-unmergeable",
        fields: ["banner"],
      })
    ).toBe(
      "Languages edit banner differently. Publish them one language at a time."
    );
  });

  it("is blocked by a blocker or an out-of-date language, and only then", () => {
    const clear: PublishAllPreview = {
      languages: [
        { locale: "en", outcome: "goes-live-with-pending-change" },
        { locale: "de", outcome: "stays-published" },
      ],
      blockers: [],
    };
    expect(publishAllBlocked(clear)).toBe(false);
    expect(
      publishAllBlocked({
        ...clear,
        blockers: [{ reason: "pending-change-invalid", fields: ["title"] }],
      })
    ).toBe(true);
    expect(
      publishAllBlocked({
        ...clear,
        languages: [
          ...clear.languages,
          { locale: "fr", outcome: "out-of-date", fields: ["tagline"] },
        ],
      })
    ).toBe(true);
  });

  it("reports every language's outcome once the publish has gone through", () => {
    expect(
      publishedSummary(
        [
          { locale: "en", outcome: "goes-live-with-pending-change" },
          { locale: "de", outcome: "stays-published" },
          { locale: "fr", outcome: "shows-fallback", fallback: "en" },
        ],
        label
      )
    ).toBe(
      "All languages published. English: its unpublished changes went live. German: stayed as published. French: went live with no content of its own, showing English."
    );
  });

  it("says only that every language was published where the server reports no outcomes", () => {
    expect(publishedSummary(undefined, label)).toBe("All languages published.");
  });
});

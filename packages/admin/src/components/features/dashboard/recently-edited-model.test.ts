/**
 * The Recently edited card's reading of its answer: an untitled document's
 * title, each row's link, who saved it, its status label, and what the card
 * says when the answer is empty.
 */
import type { WidgetResult } from "nextly/widget-result";
import { describe, expect, it } from "vitest";

import {
  CHANGES_NOT_PUBLISHED,
  UNTITLED,
  noEditsText,
  recentEditFromRow,
  recentEditRows,
} from "./recently-edited-model";

/** One row as `system:recent-edits` answers it. */
function row(overrides: Record<string, unknown> = {}) {
  return {
    id: "save-1",
    entryId: "doc-7f3a",
    entryTitle: "Spring launch",
    collection: "posts",
    subjectKind: "collection",
    locale: null,
    actorType: "user",
    userId: "user-1",
    userName: "Ana",
    identityErasedAt: null,
    createdAt: "2026-10-22T12:00:00.000Z",
    status: "published",
    pendingChanges: false,
    ...overrides,
  };
}

const list = (
  items: Record<string, unknown>[],
  extra: Partial<Extract<WidgetResult, { op: "list" }>> = {}
): Extract<WidgetResult, { op: "list" }> => ({ op: "list", items, ...extra });

describe("a Recently edited row", () => {
  it("is titled by the document, and an untitled one is 'Untitled', never its id", () => {
    expect(recentEditFromRow(row())).toMatchObject({
      title: "Spring launch",
      untitled: false,
    });
    for (const entryTitle of [null, "", undefined]) {
      const edit = recentEditFromRow(row({ entryTitle }));
      expect(edit).toMatchObject({ title: UNTITLED, untitled: true });
      expect(edit?.title).not.toContain("doc-7f3a");
    }
  });

  it("names its collection, and a Single none", () => {
    expect(recentEditFromRow(row())?.collection).toBe("posts");
    const single = recentEditFromRow(
      row({ subjectKind: "single", collection: "homepage", entryTitle: "Home" })
    );
    expect(single).toBeDefined();
    expect(single).not.toHaveProperty("collection");
  });

  it("links to the document's edit page, in the language it was saved in", () => {
    expect(recentEditFromRow(row())?.href).toBe(
      "/admin/collections/posts/doc-7f3a"
    );
    expect(recentEditFromRow(row({ locale: "fr" }))?.href).toBe(
      "/admin/collections/posts/doc-7f3a?locale=fr"
    );
    expect(
      recentEditFromRow(row({ subjectKind: "single", collection: "homepage" }))
        ?.href
    ).toBe("/admin/singles/homepage");
  });

  it("names who saved it as the activity feed does", () => {
    expect(recentEditFromRow(row())?.savedBy).toBe("Ana");
    expect(
      recentEditFromRow(row({ actorType: "apiKey", userId: "key-9b2c41" }))
        ?.savedBy
    ).toMatch(/^API key · /);
    expect(
      recentEditFromRow(
        row({ userName: null, identityErasedAt: "2026-10-01T00:00:00.000Z" })
      )?.savedBy
    ).toMatch(/^\[deleted user · /);
    // A live account with no name has nothing to show, so the row says nothing
    // rather than leaving a gap in its line.
    expect(recentEditFromRow(row({ userName: null }))).not.toHaveProperty(
      "savedBy"
    );
  });

  it("labels its status, with a held draft on a published document first", () => {
    expect(recentEditFromRow(row())?.status).toBe("Published");
    expect(recentEditFromRow(row({ status: "draft" }))?.status).toBe("Draft");
    expect(recentEditFromRow(row({ pendingChanges: true }))?.status).toBe(
      CHANGES_NOT_PUBLISHED
    );
    // A status this build has no label for is shown as spelled, not dropped.
    expect(recentEditFromRow(row({ status: "archived" }))?.status).toBe(
      "archived"
    );
    // A collection without a lifecycle has no status to show.
    expect(recentEditFromRow(row({ status: null }))).not.toHaveProperty(
      "status"
    );
  });

  it("is left out when it lacks what a row is drawn from", () => {
    for (const missing of [
      "id",
      "entryId",
      "collection",
      "createdAt",
      "userId",
    ]) {
      expect(
        recentEditFromRow(row({ [missing]: null })),
        missing
      ).toBeUndefined();
    }
    expect(
      recentEditRows(list([row(), row({ id: 5 }), row({ id: "save-2" })])).map(
        edit => edit.key
      )
    ).toEqual(["save-1", "save-2"]);
  });
});

describe("the card's empty text", () => {
  it("names the span the answer covered, or says none yet when it had no bound", () => {
    expect(noEditsText(list([], { window: { days: 90 } }))).toBe(
      "No edits in the last 90 days"
    );
    expect(noEditsText(list([], { window: { days: 30 } }))).toBe(
      "No edits in the last 30 days"
    );
    expect(noEditsText(list([], { window: { days: 1 } }))).toBe(
      "No edits in the last day"
    );
    expect(noEditsText(list([]))).toBe("No edits yet");
  });
});

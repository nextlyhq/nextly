/**
 * The create dialog "+ New" opens: the one the view a collection's entries
 * open in declares, read by the same rule as where an entry opens, so a
 * collection that opens as the form keeps its create form.
 */
import { describe, expect, it } from "vitest";

import type { RegisteredDocumentView } from "@admin/lib/plugins/document-view-registry";

import {
  createDialogOf,
  type OpenableCollection,
  type OpenRequest,
} from "../document-address";

const BUILDER: RegisteredDocumentView = {
  fieldType: "blocks",
  path: "builder",
  component: "@acme/builder#View",
  opensFirst: "mainField",
  createDialog: "@acme/builder#NewPage",
};

const title = { name: "title", type: "text" };
const excerpt = { name: "excerpt", type: "textarea" };
const blocks = { name: "content", type: "blocks" };

/** Pages open in the builder: the blocks field is the main field. */
const PAGES: OpenableCollection = { fields: [title, blocks] };
/** Posts open as a form: an excerpt comes first. */
const POSTS: OpenableCollection = { fields: [title, excerpt, blocks] };

const editor: OpenRequest = { canUpdate: true, defaultLocale: "en" };

function dialogFor(
  collection: OpenableCollection | undefined,
  views: readonly RegisteredDocumentView[] = [BUILDER],
  request: OpenRequest = editor
) {
  return createDialogOf(
    { kind: "collection", slug: "pages" },
    collection,
    request,
    views
  );
}

describe("createDialogOf", () => {
  it("is the dialog of the view a collection's entries open in", () => {
    expect(dialogFor(PAGES)).toBe("@acme/builder#NewPage");
  });

  it("follows a declared opensIn to the view", () => {
    expect(dialogFor({ ...POSTS, admin: { opensIn: "builder" } })).toBe(
      "@acme/builder#NewPage"
    );
  });

  it("is none where the entries open as the form, though the view applies", () => {
    expect(dialogFor(POSTS)).toBeUndefined();
    expect(dialogFor({ ...PAGES, admin: { opensIn: "form" } })).toBeUndefined();
  });

  it("is none where the view declares no dialog", () => {
    const { createDialog: _dialog, ...plain } = BUILDER;
    expect(dialogFor(PAGES, [plain])).toBeUndefined();
  });

  it("is none for a reader who may not update the entries, whose entries open as the form", () => {
    expect(
      dialogFor(PAGES, [BUILDER], { ...editor, canUpdate: false })
    ).toBeUndefined();
  });

  it("is none while the collection is not yet known, or on a Single", () => {
    expect(dialogFor(undefined)).toBeUndefined();
    expect(
      createDialogOf({ kind: "single", slug: "home" }, PAGES, editor, [BUILDER])
    ).toBeUndefined();
  });

  it("is the dialog of the collection's own view where one is declared on its slug", () => {
    const own: RegisteredDocumentView = {
      slug: "pages",
      path: "review",
      component: "@acme/review#View",
      createDialog: "@acme/review#NewDraft",
    };
    expect(dialogFor({ ...POSTS, admin: { opensIn: "review" } }, [own])).toBe(
      "@acme/review#NewDraft"
    );
  });
});

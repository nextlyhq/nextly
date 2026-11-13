/**
 * Focus after Add documents closes, through the lazy wrapper the release page
 * renders: the dialog's code is fetched when it first opens, and a stand-in
 * dialog holds focus until it arrives, so the opener has to be read on the
 * click itself for focus to come back to it.
 *
 * @module components/features/releases/__tests__/LazyAddDocumentsDialog.focus.test
 */
import userEvent from "@testing-library/user-event";
import { useState, type JSX } from "react";
import { describe, expect, it, vi } from "vitest";

import { render, screen, waitFor } from "@admin/__tests__/utils";

import type { PickerDocument } from "../add-documents";
import { LazyAddDocumentsDialog } from "../LazyAddDocumentsDialog";

const { state } = vi.hoisted(() => ({
  state: {
    granted: [] as string[],
    documents: [] as PickerDocument[],
    singlesUnfiltered: false,
  },
}));

vi.mock("@admin/hooks/useCurrentUserPermissions", () => ({
  useCurrentUserPermissions: () => ({
    can: (permission: string) => state.granted.includes(permission),
  }),
}));

vi.mock("../useAddDocumentsSources", () => ({
  useAddDocumentsSources: () => ({
    scopes: [
      { kind: "collection", slug: "posts", label: "Posts" },
      { kind: "collection", slug: "pages", label: "Pages" },
    ],
    documents: state.documents,
    truncated: [],
    singlesUnfiltered: state.singlesUnfiltered,
    isPending: false,
    isError: false,
  }),
}));

// Linked documents are named by the release page's own read; here, by id.
vi.mock("@admin/hooks/queries/useReleases", async importOriginal => ({
  ...(await importOriginal<
    typeof import("@admin/hooks/queries/useReleases")
  >()),
  useReleaseDocumentNames: () => ({
    documentOf: (link: { entryId: string }) => ({
      title: `Title of ${link.entryId}`,
      status: "draft",
      everPublished: false,
      updatedAt: null,
    }),
    scopeNamesOf: () => ({ singular: "Author", plural: "Authors" }),
    isPending: () => false,
    isError: () => false,
  }),
}));

/** The release page's opener and the dialog it opens, as the page wires them. */
function ReleasePage(): JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Add documents
      </button>
      <LazyAddDocumentsDialog
        open={open}
        onOpenChange={setOpen}
        release={{ id: "r1", title: "Autumn" }}
        inRelease={new Set()}
      />
    </>
  );
}

describe("LazyAddDocumentsDialog", () => {
  it(
    "gives focus back to Add documents on Escape, after its code has arrived",
    { timeout: 30_000 },
    async () => {
      const user = userEvent.setup();
      render(<ReleasePage />);
      const opener = screen.getByRole("button", { name: "Add documents" });
      await user.click(opener);
      // The real dialog, so the stand-in has come and gone. Its code is the
      // dialog's whole module, which a first import here takes seconds to load.
      expect(
        await screen.findByLabelText("Find a document", {}, { timeout: 15_000 })
      ).toBeVisible();

      await user.keyboard("{Escape}");
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      expect(opener).toHaveFocus();
    }
  );
});

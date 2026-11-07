/**
 * The collection delete dialog lists what plugins say the delete takes with
 * it, under each plugin's name, before the confirm.
 *
 * The request is replaced by a stand-in that records the slugs it was asked
 * about, so each case says what the dialog asked for and what it shows for
 * the answer. The dialog is the one the collections table opens.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BulkDeleteDialog } from "@admin/components/shared/bulk-action-dialogs";
import type { CollectionDeleteImpactGroup } from "@admin/services/collectionApi";

const asked: string[][] = [];
let answer: () => Promise<CollectionDeleteImpactGroup[]> = () =>
  Promise.resolve([]);

vi.mock("@admin/services/collectionApi", () => ({
  fetchCollectionDeleteImpact: (slugs: readonly string[]) => {
    asked.push([...slugs]);
    return answer();
  },
}));

import { CollectionDeleteImpact } from "../CollectionDeleteImpact";

afterEach(() => {
  cleanup();
  asked.length = 0;
  answer = () => Promise.resolve([]);
});

function inDialog(children: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <BulkDeleteDialog
        open
        onOpenChange={() => {}}
        entityType="Collection"
        entityTypePlural="Collections"
        items={[{ id: "1", name: "posts", secondary: "posts" }]}
        onConfirm={() => {}}
      >
        {children}
      </BulkDeleteDialog>
    </QueryClientProvider>
  );
}

describe("the collection delete dialog's impact", () => {
  it("lists each plugin's items under its name, before the confirm", async () => {
    answer = () =>
      Promise.resolve([
        {
          plugin: "@nextlyhq/plugin-page-builder",
          items: [
            { label: "Posts template", kind: "template" },
            { label: "Hello world", kind: "design" },
          ],
        },
      ]);
    inDialog(<CollectionDeleteImpact slugs={["posts"]} enabled />);

    const group = await screen.findByRole("list", {
      name: "Deleted by @nextlyhq/plugin-page-builder",
    });
    expect(group.textContent).toContain("Posts template");
    expect(group.textContent).toContain("(template)");
    expect(group.textContent).toContain("Hello world");
    expect(asked).toEqual([["posts"]]);
    // Before the confirm, in the document's order.
    const confirm = screen.getByRole("button", { name: /Delete 1 Collection/ });
    expect(
      group.compareDocumentPosition(confirm) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  it("asks about every collection a bulk delete removes together", async () => {
    inDialog(<CollectionDeleteImpact slugs={["posts", "news"]} enabled />);

    await waitFor(() => expect(asked).toEqual([["posts", "news"]]));
  });

  it("asks nothing while the dialog is closed", () => {
    inDialog(<CollectionDeleteImpact slugs={["posts"]} enabled={false} />);

    expect(asked).toEqual([]);
  });

  it("shows nothing when no plugin holds anything", async () => {
    inDialog(<CollectionDeleteImpact slugs={["posts"]} enabled />);

    await waitFor(() => expect(asked).toEqual([["posts"]]));
    await waitFor(() =>
      expect(screen.queryByText(/Checking what else/)).toBeNull()
    );
    expect(screen.queryByText("Also deleted with it:")).toBeNull();
    // The control: the dialog itself is there, with its own list.
    expect(screen.getByText("Collections to be deleted:")).toBeTruthy();
  });

  it("says when it could not ask, rather than showing nothing", async () => {
    answer = () => Promise.reject(new Error("down"));
    inDialog(<CollectionDeleteImpact slugs={["posts"]} enabled />);

    expect(
      await screen.findByText(/Could not check what else this deletes/)
    ).toBeTruthy();
  });
});

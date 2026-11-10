/**
 * The collection delete dialog lists what plugins say the delete takes with
 * it, under each plugin's name, before the confirm, and holds the confirm
 * until the answer for this opening has arrived.
 *
 * The request is replaced by a stand-in that records the slugs it was asked
 * about and answers what each case sets, so each case says what the dialog
 * asked for and what it shows. The dialog is wired as the collections table
 * wires it: the hook's state feeds both the list and the confirm.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
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

import {
  CollectionDeleteImpact,
  useCollectionDeleteImpact,
} from "../CollectionDeleteImpact";

afterEach(() => {
  cleanup();
  asked.length = 0;
  answer = () => Promise.resolve([]);
});

const PAGE_BUILDER = "@nextlyhq/plugin-page-builder";

/** One plugin naming `labels`, as templates. */
const naming = (...labels: string[]): CollectionDeleteImpactGroup[] => [
  {
    plugin: PAGE_BUILDER,
    items: labels.map(label => ({ label, kind: "template" })),
  },
];

/** The delete dialog for `slugs`, open or not, as the collections table builds it. */
function Dialog({ slugs, open }: { slugs: string[]; open: boolean }) {
  const impact = useCollectionDeleteImpact(slugs, open);
  return (
    <BulkDeleteDialog
      open={open}
      onOpenChange={() => {}}
      entityType="Collection"
      entityTypePlural="Collections"
      items={slugs.map(slug => ({ id: slug, name: slug, secondary: slug }))}
      onConfirm={() => {}}
      confirmDisabled={impact.resolving}
    >
      <CollectionDeleteImpact impact={impact} />
    </BulkDeleteDialog>
  );
}

function renderDialog(slugs: string[], open = true) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const view = render(
    <QueryClientProvider client={client}>
      <Dialog slugs={slugs} open={open} />
    </QueryClientProvider>
  );
  return {
    reopen: (next: boolean) =>
      view.rerender(
        <QueryClientProvider client={client}>
          <Dialog slugs={slugs} open={next} />
        </QueryClientProvider>
      ),
  };
}

const confirm = () =>
  screen.getByRole("button", { name: /Delete \d+ Collection/ });
const group = () =>
  screen.queryByRole("list", { name: `Deleted by ${PAGE_BUILDER}` });

describe("the collection delete dialog's impact", () => {
  it("lists each plugin's items under its name, before the confirm", async () => {
    answer = () => Promise.resolve(naming("Posts template"));
    renderDialog(["posts"]);

    const list = await screen.findByRole("list", {
      name: `Deleted by ${PAGE_BUILDER}`,
    });
    expect(list.textContent).toContain("Posts template");
    expect(list.textContent).toContain("(template)");
    expect(asked).toEqual([["posts"]]);
    expect(
      list.compareDocumentPosition(confirm()) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect((confirm() as HTMLButtonElement).disabled).toBe(false);
  });

  it("holds the confirm and shows no list until the answer arrives", async () => {
    let settle!: (groups: CollectionDeleteImpactGroup[]) => void;
    answer = () => new Promise(resolve => (settle = resolve));
    renderDialog(["posts"]);

    await waitFor(() => expect(asked).toEqual([["posts"]]));
    expect(screen.getByText(/Checking what else/)).toBeTruthy();
    expect((confirm() as HTMLButtonElement).disabled).toBe(true);

    await act(async () => settle(naming("Posts template")));
    expect(await screen.findByText("Posts template")).toBeTruthy();
    expect((confirm() as HTMLButtonElement).disabled).toBe(false);
  });

  it("does not show an earlier opening's answer while it asks again", async () => {
    answer = () => Promise.resolve(naming("Earlier template"));
    const { reopen } = renderDialog(["posts"]);
    expect(await screen.findByText("Earlier template")).toBeTruthy();

    reopen(false);
    let settle!: (groups: CollectionDeleteImpactGroup[]) => void;
    answer = () => new Promise(resolve => (settle = resolve));
    reopen(true);

    await waitFor(() => expect(asked).toHaveLength(2));
    expect(screen.queryByText("Earlier template")).toBeNull();
    expect(screen.getByText(/Checking what else/)).toBeTruthy();
    expect((confirm() as HTMLButtonElement).disabled).toBe(true);

    await act(async () => settle(naming("Later template")));
    expect(await screen.findByText("Later template")).toBeTruthy();
    expect(screen.queryByText("Earlier template")).toBeNull();
    expect((confirm() as HTMLButtonElement).disabled).toBe(false);
  });

  it("asks about every collection a bulk delete removes together", async () => {
    renderDialog(["posts", "news"]);

    await waitFor(() => expect(asked).toEqual([["posts", "news"]]));
  });

  it("asks nothing while the dialog is closed", () => {
    renderDialog(["posts"], false);

    expect(asked).toEqual([]);
  });

  it("shows nothing when no plugin holds anything", async () => {
    renderDialog(["posts"]);

    await waitFor(() => expect(asked).toEqual([["posts"]]));
    await waitFor(() =>
      expect(screen.queryByText(/Checking what else/)).toBeNull()
    );
    expect(group()).toBeNull();
    // The control: the dialog itself is there, with its own list.
    expect(screen.getByText("Collections to be deleted:")).toBeTruthy();
  });

  it("says when it could not ask, rather than showing nothing, and lets the delete go on", async () => {
    answer = () => Promise.reject(new Error("down"));
    renderDialog(["posts"]);

    expect(
      await screen.findByText(/Could not check what else this deletes/)
    ).toBeTruthy();
    expect((confirm() as HTMLButtonElement).disabled).toBe(false);
  });
});

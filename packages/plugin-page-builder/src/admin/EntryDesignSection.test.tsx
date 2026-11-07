// @vitest-environment jsdom

/**
 * The Design section of an entry's side panel: what it says in each state
 * the read can answer, which template action each control runs, and that it
 * draws nothing where it does not apply, so the panel leaves no heading.
 *
 * The read and the route are replaced by recorders; what the route answers
 * on a real site is the integration suite's.
 */
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  EntryDesignItem,
  EntryDesignsResponse,
} from "../templates/entry-designs-contract";

const writes: { action: Record<string, unknown> }[] = [];
let writeAnswer: () => Promise<unknown> = () =>
  Promise.resolve({ message: "", item: {} });
let read: {
  data: EntryDesignsResponse | undefined;
  error: Error | null;
} = { data: undefined, error: null };
const refetch = vi.fn();
const navigated: string[] = [];
const toasts = { success: vi.fn(), error: vi.fn() };

const asked: string[] = [];

vi.mock("@nextlyhq/plugin-sdk/admin", () => ({
  usePluginRoute: ({ path }: { path: string }) => {
    asked.push(path);
    return { ...read, pending: false, fetching: false, refetch };
  },
  writePluginRoute: (args: { body: { action: Record<string, unknown> } }) => {
    writes.push(args.body);
    return writeAnswer();
  },
  readPluginRoute: () => Promise.resolve(undefined),
  navigateTo: (to: string) => {
    navigated.push(to);
  },
  apiErrorMessage: (error: Error, fallback: string) =>
    error.message === "" ? fallback : error.message,
}));

vi.mock("@nextlyhq/ui", async importOriginal => {
  const real = await importOriginal<Record<string, unknown>>();
  return { ...real, toast: toasts };
});

const { EntryDesignSection, entryDesignStateOf } = await import(
  "./EntryDesignSection"
);

/** A read's answer for Posts, with the template and own designs given. */
function answer(
  overrides: {
    template?: EntryDesignsResponse["meta"]["template"];
    items?: EntryDesignItem[];
    templateAllowed?: boolean;
    templateReadable?: boolean;
    mayCreateTemplate?: boolean;
    mayGiveDesign?: boolean;
  } = {}
): EntryDesignsResponse {
  const items = overrides.items ?? [];
  const template =
    overrides.template === undefined
      ? ({ id: "t1", title: "Blog post", status: "published" } as const)
      : overrides.template;
  return {
    items,
    meta: {
      total: items.length,
      page: 1,
      limit: 500,
      totalPages: items.length === 0 ? 0 : 1,
      hasNext: false,
      hasPrev: false,
      template,
      templateReadable: overrides.templateReadable ?? true,
      templateAllowed: overrides.templateAllowed ?? true,
      // As the route answers them: a template to create only where there is
      // none, an own design to give only from a published one.
      mayCreateTemplate: overrides.mayCreateTemplate ?? template === null,
      mayGiveDesign:
        overrides.mayGiveDesign ?? template?.status === "published",
      entry: "p1",
      templatesCollection: "templates",
      names: { singular: "Post", plural: "Posts" },
      collection: "posts",
    },
  };
}

function design(status: "draft" | "published"): EntryDesignItem {
  return {
    id: "d1",
    entryId: "p1",
    title: "Ten years of field notes",
    status,
    updatedAt: "2026-11-07T09:12:00Z",
  };
}

function section(actionsDisabled = false) {
  return render(
    <EntryDesignSection
      collectionSlug="posts"
      entryId="p1"
      documentLock={{ readOnly: actionsDisabled, actionsDisabled }}
      mayWrite={() => !actionsDisabled}
      documentChanged={() => {}}
    />
  );
}

beforeEach(() => {
  asked.length = 0;
  writes.length = 0;
  navigated.length = 0;
  refetch.mockReset();
  toasts.success.mockReset();
  toasts.error.mockReset();
  writeAnswer = () => Promise.resolve({ message: "", item: {} });
});

afterEach(() => {
  cleanup();
  read = { data: undefined, error: null };
});

describe("the entry's Design section", () => {
  it("draws nothing until the read has answered, so no empty heading shows", () => {
    const { container } = section();
    expect(container.innerHTML).toBe("");
  });

  it("draws nothing for a collection that cannot have a template", () => {
    read = {
      data: answer({ template: null, templateAllowed: false }),
      error: null,
    };
    const { container } = section();
    expect(container.innerHTML).toBe("");
  });

  it("names the template and offers the entry its own design", async () => {
    read = { data: answer(), error: null };
    section();

    expect(
      screen.getByText(
        "This post is shown with the Blog post template, like every post without its own design."
      )
    ).toBeTruthy();
    expect(
      screen.getByText(
        "It starts as a copy of the published template. Later changes to the template won't reach it."
      )
    ).toBeTruthy();

    fireEvent.click(
      screen.getByRole("button", { name: "Give this post its own design" })
    );
    await waitFor(() => expect(refetch).toHaveBeenCalled());
    expect(writes).toEqual([
      {
        action: { kind: "give-entry-design", collection: "posts", entry: "p1" },
      },
    ]);
    expect(toasts.success).toHaveBeenCalledWith(
      "Own design created as a copy of Blog post"
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Open the Blog post template" })
    );
    expect(navigated).toEqual(["/admin/collections/templates/t1/builder"]);
  });

  it("draws nothing where the templates were withheld from the reader", () => {
    // Not "no published template": the read could not say what is stored.
    read = {
      data: answer({ template: null, templateReadable: false }),
      error: null,
    };
    const { container } = section();
    expect(container.innerHTML).toBe("");
  });

  it("asks about this entry alone, never the collection's capped list", () => {
    read = { data: answer(), error: null };
    section();
    expect([...new Set(asked)]).toEqual([
      "/templates/entry-designs?collection=posts&entry=p1",
    ]);
  });

  it("offers no own design to an author who may not give one", () => {
    read = { data: answer({ mayGiveDesign: false }), error: null };
    section();
    expect(
      screen.queryByRole("button", { name: "Give this post its own design" })
    ).toBeNull();
  });

  it("holds the offer while the document's changes are held", () => {
    read = { data: answer(), error: null };
    section(true);
    const give = screen.getByRole("button", {
      name: "Give this post its own design",
    }) as HTMLButtonElement;
    expect(give.disabled).toBe(true);
  });

  it("says a refusal in the site's own words", async () => {
    read = { data: answer(), error: null };
    writeAnswer = () =>
      Promise.reject(new Error("This entry already has its own design (d9)."));
    section();
    fireEvent.click(
      screen.getByRole("button", { name: "Give this post its own design" })
    );
    await waitFor(() =>
      expect(toasts.error).toHaveBeenCalledWith(
        "This entry already has its own design (d9)."
      )
    );
    expect(refetch).not.toHaveBeenCalled();
  });

  it("says visitors still see the template while the own design is not published", () => {
    read = { data: answer({ items: [design("draft")] }), error: null };
    section();

    // One pill, dashed, saying it is not published: never a second status.
    expect(screen.getByText("Own design · not published")).toBeTruthy();
    expect(screen.queryByText("Own design")).toBeNull();
    expect(
      screen.getByText(
        "Visitors still see the Blog post template until you publish this design."
      )
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Edit design" }));
    expect(navigated).toEqual(["/admin/collections/templates/d1/builder"]);
  });

  it("says visitors see a published own design", () => {
    read = { data: answer({ items: [design("published")] }), error: null };
    section();
    expect(screen.getByText("Own design")).toBeTruthy();
    expect(
      screen.getByText(
        "Visitors see this post's own design. Changes to the Blog post template don't reach it."
      )
    ).toBeTruthy();
    expect(
      screen.getByText("Deleting this post deletes its own design too.")
    ).toBeTruthy();
  });

  it("draws Remove own design… in the destructive text pairing that passes AA in both schemes", () => {
    read = { data: answer({ items: [design("published")] }), error: null };
    section();
    const classes = screen
      .getByRole("button", { name: "Remove own design…" })
      .className.split(/\s+/);
    // The base red alone is under 4.5:1 on the light card; light mode reads
    // the darker shade, and dark mode the base, which passes on dark.
    expect(classes).toContain("text-destructive-700");
    expect(classes).toContain("dark:text-destructive");
    expect(classes).not.toContain("text-destructive");
  });

  it("confirms before removing the own design, and keeps it on Keep it", async () => {
    read = { data: answer({ items: [design("published")] }), error: null };
    section();

    fireEvent.click(screen.getByRole("button", { name: "Remove own design…" }));
    expect(
      await screen.findByRole("alertdialog", {
        name: "Remove this post's own design?",
      })
    ).toBeTruthy();
    expect(
      screen.getByText(
        '"Ten years of field notes" will be shown with the Blog post template again. The own design and its history are deleted.'
      )
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Keep it" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(writes).toEqual([]);

    fireEvent.click(screen.getByRole("button", { name: "Remove own design…" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Remove own design" })
    );
    await waitFor(() => expect(refetch).toHaveBeenCalled());
    expect(writes).toEqual([
      {
        action: {
          kind: "remove-entry-design",
          collection: "posts",
          entry: "p1",
        },
      },
    ]);
    expect(toasts.success).toHaveBeenCalledWith(
      "Own design removed · shown with Blog post again"
    );
  });

  it("says the entry is not a page while its collection's template is not published", () => {
    read = {
      data: answer({
        template: { id: "t1", title: "Blog post", status: "draft" },
      }),
      error: null,
    };
    section();
    expect(
      screen.getByText(
        "Posts have no published template yet, so this post isn't shown as a page on the site."
      )
    ).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "Open the Blog post template" })
    );
    expect(navigated).toEqual(["/admin/collections/templates/t1/builder"]);
  });

  it("offers to create the template where there is none, and opens it", async () => {
    read = { data: answer({ template: null }), error: null };
    writeAnswer = () =>
      Promise.resolve({
        message: "",
        item: { template: { id: "t7", title: "Post template" } },
      });
    section();
    fireEvent.click(
      screen.getByRole("button", { name: "Create a template for Posts" })
    );
    await waitFor(() =>
      expect(navigated).toEqual(["/admin/collections/templates/t7/builder"])
    );
    expect(writes).toEqual([
      { action: { kind: "create-template", collection: "posts" } },
    ]);
  });

  it("says a failed read, with a way to ask again", () => {
    read = { data: undefined, error: new Error("offline") };
    section();
    expect(screen.getByRole("alert").textContent).toContain(
      "This design couldn't be loaded."
    );
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(refetch).toHaveBeenCalled();
  });
});

describe("entryDesignStateOf", () => {
  it("keeps an own design whatever its collection's template is", () => {
    expect(
      entryDesignStateOf(
        answer({ template: null, items: [design("draft")] }),
        "p1"
      ).kind
    ).toBe("own");
  });

  it("reads another entry's own design as no own design of this one", () => {
    expect(
      entryDesignStateOf(answer({ items: [design("draft")] }), "p2").kind
    ).toBe("uses-template");
  });
});

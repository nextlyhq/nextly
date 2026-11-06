/**
 * Adding several documents from inside a release: which listed documents may
 * be picked for the chosen action, the one request that adds the selection,
 * a refusal that keeps the dialog, and the linked documents offered next for
 * documents going live only.
 *
 * The documents listed are given; the add goes through the real hook and API
 * client to a stubbed `fetch`, so what is asserted is what the server would
 * receive.
 *
 * @module components/features/releases/__tests__/AddDocumentsDialog.test
 */
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { render, screen, waitFor } from "@admin/__tests__/utils";

import type { PickerDocument } from "../add-documents";
import { AddDocumentsDialog } from "../AddDocumentsDialog";

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

const doc = (scopeSlug: string, entryId: string, title: string) => ({
  scopeKind: "collection" as const,
  scopeSlug,
  entryId,
  title,
  scopeLabel: scopeSlug === "posts" ? "Posts" : "Pages",
  status: "draft" as const,
});

const fetchMock = vi.fn();

function answer(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** What the batch add answers for the given members, with their links. */
function addedAnswer(
  members: Array<{
    entryId: string;
    scopeSlug: string;
    action: "publish" | "unpublish";
    links?: Array<{ scopeSlug: string; entryId: string }>;
  }>
) {
  return {
    message: "Added to release.",
    item: {
      release: { id: "r1", title: "Autumn" },
      members: members.map(member => ({
        id: `m-${member.entryId}`,
        releaseId: "r1",
        scopeKind: "collection",
        scopeSlug: member.scopeSlug,
        entryId: member.entryId,
        locale: null,
        action: member.action,
        createdBy: "u1",
        createdAt: "2026-11-02T00:00:00.000Z",
        unpublishedLinks: {
          links: (member.links ?? []).map(link => ({
            scopeKind: "collection",
            fields: ["author"],
            ...link,
          })),
          hiddenCount: 0,
          inHiddenFields: 0,
          deletedLinks: [],
        },
      })),
    },
  };
}

/** The bodies of every request sent, by path. */
function requests(): { path: string; method: string; body: unknown }[] {
  return fetchMock.mock.calls.map(call => {
    const [url, init] = call as [string, RequestInit | undefined];
    return {
      path: new URL(String(url), "http://x").pathname,
      method: init?.method ?? "GET",
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    };
  });
}

const adds = () =>
  requests().filter(
    request => request.method === "POST" && request.path.endsWith("/batch")
  );

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  state.granted = [
    "publish-posts",
    "unpublish-posts",
    "publish-pages",
    "unpublish-pages",
  ];
  state.singlesUnfiltered = false;
  state.documents = [
    doc("posts", "p1", "First post"),
    doc("posts", "p2", "Second post"),
    doc("pages", "g1", "About"),
  ];
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function open(inRelease: string[] = []) {
  const onOpenChange = vi.fn();
  render(
    <AddDocumentsDialog
      open
      onOpenChange={onOpenChange}
      release={{ id: "r1", title: "Autumn" }}
      inRelease={new Set(inRelease)}
    />
  );
  return { onOpenChange };
}

const box = (title: string) =>
  screen.getByRole("checkbox", { name: title }) as HTMLButtonElement;

describe("which documents may be picked", () => {
  it("a reader who may publish posts but not unpublish them: posts go live, and are held from coming down", async () => {
    state.granted = ["publish-posts", "publish-pages", "unpublish-pages"];
    open();
    expect(box("First post").disabled).toBe(false);

    await userEvent.click(screen.getByRole("radio", { name: "Comes down" }));
    expect(box("First post").disabled).toBe(true);
    expect(box("First post")).toHaveAccessibleDescription(
      "You do not have permission to unpublish Posts."
    );
    // A page the reader may unpublish stays pickable.
    expect(box("About").disabled).toBe(false);
  });

  it("a reader who may unpublish posts but not publish them: the reverse", async () => {
    state.granted = ["unpublish-posts", "publish-pages", "unpublish-pages"];
    open();
    expect(box("First post").disabled).toBe(true);
    expect(box("First post")).toHaveAccessibleDescription(
      "You do not have permission to publish Posts."
    );

    await userEvent.click(screen.getByRole("radio", { name: "Comes down" }));
    expect(box("First post").disabled).toBe(false);
  });

  it("holds a document already in the release, with the reason", () => {
    open(["posts:p2"]);
    expect(box("Second post").disabled).toBe(true);
    expect(box("Second post")).toHaveAccessibleDescription(
      "Already in this release."
    );
  });

  it("drops a picked document the new action may not take", async () => {
    state.granted = ["publish-posts", "publish-pages", "unpublish-pages"];
    open();
    await userEvent.click(box("First post"));
    await userEvent.click(box("About"));
    expect(screen.getByText("2 picked")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("radio", { name: "Comes down" }));
    expect(screen.getByText("1 picked")).toBeInTheDocument();
    expect(box("First post")).not.toBeChecked();
  });
});

describe("Singles under Has unpublished changes", () => {
  it("are still listed, and the picker says the filter does not apply to them", () => {
    state.singlesUnfiltered = true;
    state.documents = [
      ...state.documents,
      {
        scopeKind: "single",
        scopeSlug: "homepage",
        entryId: "s1",
        title: "Homepage",
        scopeLabel: "Homepage",
        status: "published",
      },
    ];
    state.granted = [...state.granted, "publish-homepage"];
    open();
    expect(box("Homepage").disabled).toBe(false);
    expect(
      screen.getByText(
        "The unpublished-changes filter doesn't apply to Singles yet: they are listed whatever their changes."
      )
    ).toBeInTheDocument();
  });

  it("says nothing of it when the filter is off", () => {
    open();
    expect(
      screen.queryByText(/doesn't apply to Singles/)
    ).not.toBeInTheDocument();
  });
});

describe("the add", () => {
  it("adds documents from two collections in one request, each with the action", async () => {
    fetchMock.mockResolvedValue(
      answer(
        201,
        addedAnswer([
          { scopeSlug: "posts", entryId: "p1", action: "unpublish" },
          { scopeSlug: "pages", entryId: "g1", action: "unpublish" },
        ])
      )
    );
    const { onOpenChange } = open();
    await userEvent.click(screen.getByRole("radio", { name: "Comes down" }));
    await userEvent.click(box("First post"));
    await userEvent.click(box("About"));
    await userEvent.click(
      screen.getByRole("button", { name: "Add 2 documents" })
    );

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(adds()).toEqual([
      {
        path: expect.stringMatching(/\/releases\/r1\/members\/batch$/),
        method: "POST",
        body: {
          members: [
            {
              scopeKind: "collection",
              scopeSlug: "posts",
              entryId: "p1",
              action: "unpublish",
            },
            {
              scopeKind: "collection",
              scopeSlug: "pages",
              entryId: "g1",
              action: "unpublish",
            },
          ],
        },
      },
    ]);
  });

  it("says, when the server refuses, why and that nothing was added, and stays open", async () => {
    fetchMock.mockResolvedValue(
      answer(409, {
        error: {
          code: "CONFLICT",
          message: "Only 1 more document fits in this release.",
        },
      })
    );
    const { onOpenChange } = open();
    await userEvent.click(box("First post"));
    await userEvent.click(box("Second post"));
    await userEvent.click(
      screen.getByRole("button", { name: "Add 2 documents" })
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Only 1 more document fits in this release. Nothing was added."
    );
    expect(onOpenChange).not.toHaveBeenCalled();
  });
});

describe("the linked documents offered next", () => {
  const linking = () =>
    fetchMock.mockResolvedValueOnce(
      answer(
        201,
        addedAnswer([
          {
            scopeSlug: "posts",
            entryId: "p1",
            action: "publish",
            links: [{ scopeSlug: "authors", entryId: "a1" }],
          },
        ])
      )
    );

  it("offers the unpublished links of documents going live, and adds them to go live", async () => {
    linking();
    fetchMock.mockResolvedValueOnce(
      answer(
        201,
        addedAnswer([
          { scopeSlug: "authors", entryId: "a1", action: "publish" },
        ])
      )
    );
    const { onOpenChange } = open();
    await userEvent.click(box("First post"));
    await userEvent.click(
      screen.getByRole("button", { name: "Add 1 document" })
    );

    expect(
      await screen.findByRole("heading", {
        name: "Linked documents that won’t be live",
      })
    ).toBeInTheDocument();
    expect(screen.getByText("Title of a1")).toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalled();

    await userEvent.click(
      screen.getByRole("button", { name: "Add 1 document" })
    );
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(adds()[1]?.body).toEqual({
      members: [
        {
          scopeKind: "collection",
          scopeSlug: "authors",
          entryId: "a1",
          action: "publish",
        },
      ],
    });
  });

  it("adds nothing more on Not now", async () => {
    linking();
    const { onOpenChange } = open();
    await userEvent.click(box("First post"));
    await userEvent.click(
      screen.getByRole("button", { name: "Add 1 document" })
    );
    await userEvent.click(
      await screen.findByRole("button", { name: "Not now" })
    );

    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(adds()).toHaveLength(1);
  });

  it("offers nothing for documents added to come down", async () => {
    // Even were the answer to name links, a document coming down needs none.
    fetchMock.mockResolvedValueOnce(
      answer(
        201,
        addedAnswer([
          {
            scopeSlug: "posts",
            entryId: "p1",
            action: "unpublish",
            links: [{ scopeSlug: "authors", entryId: "a1" }],
          },
        ])
      )
    );
    const { onOpenChange } = open();
    await userEvent.click(screen.getByRole("radio", { name: "Comes down" }));
    await userEvent.click(box("First post"));
    await userEvent.click(
      screen.getByRole("button", { name: "Add 1 document" })
    );

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(
      screen.queryByRole("heading", {
        name: "Linked documents that won’t be live",
      })
    ).not.toBeInTheDocument();
  });
});

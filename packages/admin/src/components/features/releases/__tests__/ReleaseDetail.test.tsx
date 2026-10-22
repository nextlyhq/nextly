/**
 * A release's own page: its documents by title, grouped by collection, each
 * with its readiness, the reader's hidden documents as counts, its history,
 * and each action offered only to a reader the server says may take it.
 *
 * The release's `can` is the server's verdict; each permission set below is
 * one the server could send, and the page must offer exactly what it allows.
 *
 * @module components/features/releases/__tests__/ReleaseDetail.test
 */
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { render, screen, within } from "@admin/__tests__/utils";
import type {
  Release,
  ReleaseCapabilities,
  ReleaseDocumentInfo,
  ReleaseMember,
  ReleaseReadiness,
} from "@admin/types/releases";

const mocks = vi.hoisted(() => ({
  release: vi.fn(),
  members: vi.fn(),
  readiness: vi.fn(),
  history: vi.fn(),
  update: vi.fn(),
  change: vi.fn(),
  remove: vi.fn(),
  navigateTo: vi.fn(),
}));

function idle(mutate: (...args: unknown[]) => void = vi.fn()) {
  return {
    mutate,
    isPending: false,
    isError: false,
    error: null,
    reset: vi.fn(),
  };
}

/** The titles the page's document read answers with, by entry id. */
const DOCUMENTS: Record<string, ReleaseDocumentInfo> = {
  e1: {
    title: "Launch post",
    status: "published",
    everPublished: true,
    updatedAt: null,
  },
  e2: {
    title: "Old post",
    status: "draft",
    everPublished: false,
    updatedAt: null,
  },
  e3: { title: "Ada", status: "draft", everPublished: false, updatedAt: null },
};

const NAMES: Record<string, { singular: string; plural: string }> = {
  posts: { singular: "Post", plural: "Posts" },
  authors: { singular: "Author", plural: "Authors" },
};

vi.mock("@admin/hooks/queries/useReleases", () => ({
  useRelease: () => mocks.release(),
  useReleaseMembers: () => mocks.members(),
  useReleaseReadiness: () => mocks.readiness(),
  useReleaseHistory: () => mocks.history(),
  useReleaseCreation: () => ({ data: null, isPending: false }),
  useReleaseTitles: () => () => undefined,
  useReleaseDocumentNames: () => ({
    documentOf: (member: { entryId: string }) => DOCUMENTS[member.entryId],
    scopeNamesOf: (slug: string) => NAMES[slug],
    isPending: () => false,
    isError: () => false,
  }),
  useUpdateRelease: () => idle(mocks.update),
  useChangeReleaseMemberAction: () => idle(mocks.change),
  useRemoveReleaseMember: () => idle(mocks.remove),
  useScheduleRelease: () => idle(),
  useCancelRelease: () => idle(),
  useDeleteRelease: () => idle(),
  usePublishReleaseNow: () => idle(),
  useReleaseBlockers: () => ({
    data: { items: [], meta: { total: 0, hasNext: false } },
    isPending: false,
    isFetching: false,
    isError: false,
  }),
  releaseKeys: { all: () => ["releases"] },
}));
vi.mock("@admin/hooks/useDashboardUser", () => ({
  useDashboardUser: () => ({
    user: { id: "u-me", name: "Mobeen Abdullah", email: "m@example.com" },
  }),
}));
vi.mock("@admin/lib/navigation", () => ({ navigateTo: mocks.navigateTo }));
vi.mock("../release-timezone", async importOriginal => ({
  ...(await importOriginal<typeof import("../release-timezone")>()),
  readerZone: () => "America/New_York",
}));

import { ReleaseDetail } from "../ReleaseDetail";

const NOTHING: ReleaseCapabilities = {
  schedule: false,
  cancel: false,
  addMember: false,
  removeMember: false,
  publishNow: false,
  update: false,
  delete: false,
};

function release(overrides: Partial<Release> = {}): Release {
  return {
    id: "r1",
    title: "Spring launch",
    description: "Three launch posts.",
    scheduledAt: null,
    timezone: null,
    state: "draft",
    kind: "release",
    publishedAt: null,
    createdBy: "u-me",
    createdAt: "2026-10-20T09:00:00Z",
    updatedAt: "2026-10-20T09:00:00Z",
    can: NOTHING,
    ...overrides,
  };
}

function member(
  id: string,
  scopeSlug: string,
  entryId: string,
  action: ReleaseMember["action"] = "publish"
): ReleaseMember {
  return {
    id,
    releaseId: "r1",
    scopeKind: "collection",
    scopeSlug,
    entryId,
    locale: null,
    action,
    createdBy: "u-me",
    createdAt: "2026-10-20T09:00:00Z",
  };
}

const MEMBERS = [
  member("m1", "posts", "e1"),
  member("m2", "posts", "e2"),
  member("m3", "authors", "e3", "unpublish"),
];

const HIDDEN = [
  {
    scopeKind: "collection" as const,
    scopeSlug: "history-notes",
    count: 2,
    labels: { singular: "History note", plural: "History notes" },
  },
];

const ONE_HARD: ReleaseReadiness = {
  releaseId: "r1",
  hard: [
    {
      memberId: "m2",
      code: "AUTHOR_MAY_NOT_ACT",
      source: "core.permission",
      action: "publish",
      scopeKind: "collection",
      scopeSlug: "posts",
      entryId: "e2",
    },
  ],
  soft: [],
  hidden: [{ ...HIDDEN[0], hard: 0, soft: 0 }],
};

const READY: ReleaseReadiness = { ...ONE_HARD, hard: [] };

function setUp({
  can = NOTHING,
  readiness = READY,
  members = MEMBERS,
  ...overrides
}: Partial<Release> & {
  readiness?: ReleaseReadiness;
  members?: ReleaseMember[];
} = {}) {
  mocks.release.mockReturnValue({
    data: release({ can, ...overrides }),
    isPending: false,
    isError: false,
  });
  mocks.members.mockReturnValue({
    data: {
      items: members,
      meta: { total: members.length, hasNext: false, hidden: HIDDEN },
    },
    isPending: false,
    isError: false,
  });
  mocks.readiness.mockReturnValue({
    data: readiness,
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  });
}

/** A collection's group, by its heading. */
function group(name: string) {
  return within(screen.getByRole("group", { name: new RegExp(name) }));
}

/** A document's row, by its title. */
function row(title: string) {
  return within(screen.getByRole("listitem", { name: title }));
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.history.mockReturnValue({
    data: { pages: [{ items: [], meta: { total: 0, hasNext: false } }] },
    isPending: false,
    isError: false,
    hasNextPage: false,
  });
  setUp();
});

describe("a release's documents", () => {
  it("lists them by title, grouped by collection, each with its readiness", () => {
    setUp({ readiness: ONE_HARD });
    render(<ReleaseDetail id="r1" />);

    expect(group("Posts").getByText("Launch post")).toBeTruthy();
    expect(group("Posts").getByText("Old post")).toBeTruthy();
    expect(group("Authors").getByText("Ada")).toBeTruthy();
    // Named by title, never by the id the members list carries.
    expect(document.body.textContent).not.toMatch(/\be[123]\b/);

    expect(row("Launch post").getByText("Ready")).toBeTruthy();
    expect(row("Ada").getByText("Comes down")).toBeTruthy();
    expect(row("Old post").getByText("Needs a fix")).toBeTruthy();
    expect(row("Old post").getByText(/may no longer publish it/)).toBeTruthy();
  });

  it("counts the reader's hidden documents in their collection, and in the summary", () => {
    setUp({ readiness: ONE_HARD });
    render(<ReleaseDetail id="r1" />);

    expect(
      group("History notes").getByText(
        "2 documents you can't view · History notes"
      )
    ).toBeTruthy();
    // Five in all, the two hidden ones included; one needs a fix.
    expect(screen.getByText("4 of 5 ready.")).toBeTruthy();
  });

  it("does not name the documents of a release the reader cannot see into", () => {
    setUp({ members: [] });
    render(<ReleaseDetail id="r1" />);
    expect(
      screen.getByText("2 documents you can't view · History notes")
    ).toBeTruthy();
    expect(screen.queryByText(/nothing has been added/i)).toBeNull();
  });
});

describe("the actions each permission set is offered", () => {
  it("offers nothing to a reader who may only read", async () => {
    const user = userEvent.setup();
    render(<ReleaseDetail id="r1" />);
    expect(screen.queryByRole("button", { name: "Rename release" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Schedule/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Publish now/ })).toBeNull();
    expect(
      screen.queryByRole("button", { name: "More release actions" })
    ).toBeNull();
    // What a document does is said, not offered as a switch.
    expect(
      screen.queryByRole("button", { name: /change what “Launch post” does/ })
    ).toBeNull();
    await user.click(
      screen.getByRole("button", { name: "Actions for Launch post" })
    );
    expect(
      screen.getByRole("menuitem", { name: "Open document" })
    ).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: /Remove/ })).toBeNull();
  });

  it("lets a reader who may edit releases rename it in place", async () => {
    const user = userEvent.setup();
    setUp({ can: { ...NOTHING, update: true } });
    render(<ReleaseDetail id="r1" />);
    expect(screen.queryByRole("button", { name: /Schedule/ })).toBeNull();

    await user.click(screen.getByRole("button", { name: "Rename release" }));
    const name = screen.getByRole("textbox", { name: "Release name" });
    await user.clear(name);
    await user.type(name, "  Autumn launch ");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(mocks.update).toHaveBeenCalledWith(
      { title: "Autumn launch" },
      expect.anything()
    );
    expect(
      screen.getByRole("button", { name: "Edit description" })
    ).toBeTruthy();
  });

  it("offers Schedule and Publish now to a publisher, held back while a document needs a fix", () => {
    const can = { ...NOTHING, schedule: true, publishNow: true };
    setUp({ can, readiness: ONE_HARD });
    const { unmount } = render(<ReleaseDetail id="r1" />);
    const schedule = screen.getByRole("button", { name: "Schedule…" });
    expect(schedule).toHaveProperty("disabled", true);
    expect(screen.getByRole("button", { name: "Publish now…" })).toHaveProperty(
      "disabled",
      true
    );
    expect(
      screen.getByText("Fix the document marked below first.")
    ).toBeTruthy();
    unmount();

    setUp({ can, readiness: READY });
    render(<ReleaseDetail id="r1" />);
    expect(screen.getByRole("button", { name: "Schedule…" })).toHaveProperty(
      "disabled",
      false
    );
    expect(screen.getByRole("button", { name: "Publish now…" })).toHaveProperty(
      "disabled",
      false
    );
  });

  it("offers Delete for a draft that may be deleted, and Cancel for a scheduled one", async () => {
    const user = userEvent.setup();
    setUp({ can: { ...NOTHING, cancel: true, delete: true } });
    const { unmount } = render(<ReleaseDetail id="r1" />);
    await user.click(
      screen.getByRole("button", { name: "More release actions" })
    );
    expect(screen.getByRole("menuitem", { name: "Delete…" })).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: /Discard/ })).toBeNull();
    unmount();

    setUp({
      state: "scheduled",
      scheduledAt: "2026-11-01T14:00:00Z",
      timezone: "Asia/Karachi",
      can: { ...NOTHING, cancel: true },
    });
    render(<ReleaseDetail id="r1" />);
    await user.click(
      screen.getByRole("button", { name: "More release actions" })
    );
    expect(
      screen.getByRole("menuitem", { name: "Cancel release…" })
    ).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: "Delete…" })).toBeNull();
  });

  it("lets a reader who may change its documents switch and remove them", async () => {
    const user = userEvent.setup();
    setUp({ can: { ...NOTHING, removeMember: true } });
    render(<ReleaseDetail id="r1" />);

    await user.click(
      screen.getByRole("button", { name: /change what “Launch post” does/ })
    );
    await user.click(screen.getByRole("menuitemradio", { name: "Comes down" }));
    expect(mocks.change).toHaveBeenCalledWith({
      memberId: "m1",
      action: "unpublish",
    });

    await user.click(
      screen.getByRole("button", { name: "Actions for Launch post" })
    );
    await user.click(
      screen.getByRole("menuitem", { name: "Remove from release…" })
    );
    const dialog = within(screen.getByRole("alertdialog"));
    expect(dialog.queryByText(/cancels the release/)).toBeNull();
    await user.click(dialog.getByRole("button", { name: "Remove" }));
    expect(mocks.remove).toHaveBeenCalledWith("m1", expect.anything());
  });
});

describe("a single-document release", () => {
  const single = [member("m1", "posts", "e1")];

  it("says that taking its document out cancels it", async () => {
    const user = userEvent.setup();
    setUp({
      kind: "single",
      members: single,
      can: { ...NOTHING, removeMember: true, cancel: true },
    });
    render(<ReleaseDetail id="r1" />);
    await user.click(
      screen.getByRole("button", { name: "Actions for Launch post" })
    );
    await user.click(
      screen.getByRole("menuitem", { name: "Remove and cancel release…" })
    );
    const dialog = within(screen.getByRole("alertdialog"));
    expect(dialog.getByText(/This cancels the release\./)).toBeTruthy();
    await user.click(
      dialog.getByRole("button", { name: "Remove and cancel release" })
    );
    expect(mocks.remove).toHaveBeenCalledWith("m1", expect.anything());
  });

  it("holds the removal back, with the reason, from a reader who may not cancel", async () => {
    const user = userEvent.setup();
    setUp({
      kind: "single",
      members: single,
      can: { ...NOTHING, removeMember: true },
    });
    render(<ReleaseDetail id="r1" />);
    await user.click(
      screen.getByRole("button", { name: "Actions for Launch post" })
    );
    const item = screen.getByRole("menuitem", {
      name: "Remove and cancel release…",
    });
    expect(item.getAttribute("aria-disabled")).toBe("true");
    expect(screen.getByText(/cancels this release, which needs/)).toBeTruthy();
    await user.click(item);
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });
});

describe("a release's history", () => {
  it("says who did what, by document title, gathering a run of additions", async () => {
    const user = userEvent.setup();
    const event = (
      id: string,
      kind: string,
      payload: Record<string, unknown> | null = null,
      actorKind = "person"
    ) => ({
      id,
      kind,
      actorKind,
      actorId: actorKind === "person" ? "u-2" : null,
      actorName: actorKind === "person" ? "Aqib Khan" : null,
      occurredAt: "2026-10-20T09:00:00Z",
      fromState: null,
      toState: null,
      note: null,
      versionNo: null,
      payload,
      parts: [],
    });
    const added = (id: string, entryId: string) =>
      event(id, "release-document-added", {
        scopeKind: "collection",
        scopeSlug: "posts",
        entryId,
        locale: null,
        action: "publish",
      });
    mocks.history.mockReturnValue({
      data: {
        pages: [
          {
            items: [
              event("h5", "release-published", null, "system"),
              event("h4", "release-renamed", {
                from: "Spring",
                to: "Spring launch",
              }),
              added("h3", "e1"),
              added("h2", "e2"),
              event("h1", "release-created"),
            ],
            meta: { total: 5, hasNext: false },
          },
        ],
      },
      isPending: false,
      isError: false,
      hasNextPage: false,
    });
    render(<ReleaseDetail id="r1" />);
    const history = within(screen.getByRole("region", { name: "History" }));
    expect(history.getByText("Published")).toBeTruthy();
    expect(history.getByText("renamed it “Spring launch”")).toBeTruthy();
    expect(history.getByText("added 2 documents")).toBeTruthy();
    expect(history.getByText("created the release")).toBeTruthy();
    expect(history.getAllByText("Aqib Khan").length).toBe(3);

    await user.click(history.getByText("Show them"));
    expect(history.getByText("“Launch post” · goes live")).toBeTruthy();
    expect(history.getByText("“Old post” · goes live")).toBeTruthy();
  });
});

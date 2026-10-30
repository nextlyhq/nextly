/**
 * The palette's "Create <type>" commands: one per collection the reader may
 * create in, matched on the type's names, each opening a new entry and
 * recording the type for the dashboard's New button.
 */
import { Command, CommandList } from "@nextlyhq/ui";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const COLLECTIONS = [
  {
    name: "posts",
    label: "Posts",
    labels: { singular: "Post", plural: "Posts" },
  },
  { name: "faq", label: "FAQ" },
  // Kept off the admin, and one only a machine creates: never offered.
  { name: "audit", label: "Audit", admin: { hidden: true } },
  { name: "submissions", label: "Submissions", admin: { disableCreate: true } },
];

/** The collections this test's reader may create in. */
let mayCreate: string[] = [];

vi.mock("@admin/hooks/queries/useCollections", () => ({
  NAV_COLLECTIONS_PARAMS: {},
  useCollections: () => ({
    data: { items: COLLECTIONS },
    isLoading: false,
    error: null,
  }),
}));
vi.mock("@admin/hooks/useCurrentUserPermissions", () => ({
  useCurrentUserPermissions: () => ({
    canAccessCollection: (slug: string, action: string) =>
      action === "create" && mayCreate.includes(slug),
    content: { isLoading: false, error: null, hasAnswer: true },
  }),
}));
const recorded: string[] = [];
vi.mock("@admin/hooks/queries/useDashboardNewTypes", () => ({
  useRecordNewType: () => (slug: string) => recorded.push(slug),
}));
const navigateTo = vi.fn();
vi.mock("@admin/lib/navigation", () => ({
  navigateTo: (path: string) => navigateTo(path),
}));

import { ActionCommands } from "./ActionCommands";

function renderCommands() {
  return render(
    <Command>
      <CommandList>
        <ActionCommands onSelect={run => run()} />
      </CommandList>
    </Command>
  );
}

const createCommands = () =>
  screen.queryAllByTestId(/^command-create-/).map(item => item.textContent);

beforeEach(() => {
  recorded.length = 0;
  navigateTo.mockClear();
});

describe("the palette's create commands", () => {
  it("offer one command per collection each reader may create in", () => {
    mayCreate = ["posts", "faq", "audit", "submissions"];
    renderCommands();
    expect(createCommands()).toEqual(["Create Post", "Create FAQ"]);
  });

  it("offer another reader only what they may create in", () => {
    mayCreate = ["faq"];
    renderCommands();
    expect(createCommands()).toEqual(["Create FAQ"]);
    expect(screen.queryByText("Create Content")).toBeNull();
  });

  it("open a new entry of the type, and record it for New", () => {
    mayCreate = ["posts"];
    renderCommands();
    fireEvent.click(screen.getByTestId("command-create-posts"));
    expect(navigateTo).toHaveBeenCalledWith("/admin/collections/posts/create");
    expect(recorded).toEqual(["posts"]);
  });
});

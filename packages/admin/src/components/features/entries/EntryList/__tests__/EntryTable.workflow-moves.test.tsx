/**
 * The entry table's workflow moves, through the real table and bulk bar: on a collection a workflow
 * holds, a reader who may edit it selects rows and is offered Submit for review, Assign… and Send
 * back… (never Approve). Submit sends each selected document with every part as its row showed it
 * (revision and version from `_review`), and the table says how many moved and names each refusal
 * by the row's title. A reader who may only read is offered no checkbox at all.
 */
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { render, screen, within } from "@admin/__tests__/utils";

import { EntryTable } from "../EntryTable";
import type { CollectionForColumns } from "../EntryTableColumns";

const { canFor, stepMany } = vi.hoisted(() => ({
  canFor: vi.fn((_slug: string) => false),
  stepMany: vi.fn(),
}));
vi.mock("@admin/hooks/useCan", () => ({
  useCan: (slug: string) => canFor(slug),
}));
vi.mock("@admin/hooks/queries/useWaitingForMe", () => ({
  useWaitingScope: () => ({ data: { reviews: false, stages: 0 } }),
  waitingKeys: { all: () => ["workflow-waiting"] },
}));
vi.mock("@admin/services/workflowApi", () => ({
  stepManyWorkflowDocuments: stepMany,
  assignManyWorkflowParts: vi.fn(),
}));
vi.mock("@admin/hooks/useLocalization", () => ({
  useLocalization: () => ({
    enabled: false,
    locales: [],
    defaultLocale: "en",
    fallback: true,
    getLocale: () => undefined,
  }),
}));

const notes: CollectionForColumns = {
  slug: "notes",
  label: "Notes",
  status: true,
  fields: [{ type: "text", name: "title", label: "Title" } as never],
  workflow: {
    slug: "review",
    label: "Review",
    stages: [
      { name: "draft", label: "Draft" },
      { name: "review", label: "In review" },
    ],
    steps: [
      { name: "submit", label: "Submit for review", kind: "submit" },
      { name: "approve", label: "Approve", kind: "approve" },
      {
        name: "requestChanges",
        label: "Request changes",
        kind: "request-changes",
      },
    ],
  },
};

/** A row and its one part's review state, as the list read gives it. */
const row = (id: string, title: string, stage: string, revision: number) => ({
  id,
  title,
  _review: {
    parts: [
      {
        part: null,
        stage,
        stageLabel: stage,
        stageColour: null,
        publishable: false,
        enteredAt: null,
        assignee: null,
        dueAt: null,
        waitingFor: null,
        revision,
        version: `v-${id}`,
      },
    ],
  },
});

const FIRST_PAGE = [
  row("n1", "First note", "draft", 0),
  row("n2", "Second note", "review", 3),
];

function table_(entries: ReturnType<typeof row>[]) {
  return (
    <EntryTable
      collection={notes}
      entries={entries}
      pagination={{ page: 0, limit: 10, total: 2, totalPages: 1 }}
      onPageChange={vi.fn()}
      onLimitChange={vi.fn()}
      onSortChange={vi.fn()}
      onSearchChange={vi.fn()}
      onEdit={vi.fn()}
      entryHref={id => `/admin/collections/notes/${id}`}
      onDelete={vi.fn()}
      onBulkDelete={vi.fn()}
    />
  );
}

function renderTable(entries = FIRST_PAGE) {
  return render(table_(entries));
}

const table = () =>
  within(screen.getByRole("table", { name: "Entries table" }));

describe("EntryTable: the workflow's bulk moves", () => {
  beforeEach(() => {
    canFor.mockReset();
    stepMany.mockReset();
  });

  it("submits the selected documents as their rows showed them, and names each refusal", async () => {
    canFor.mockImplementation(slug => slug === "update-notes");
    stepMany.mockResolvedValue({
      items: [{ id: "n1" }],
      errors: [
        {
          id: "n2",
          code: "WORKFLOW_NOT_FROM_STAGE",
          message: "It is not in a stage this step leaves from.",
        },
      ],
    });
    const user = userEvent.setup();
    renderTable();

    await user.click(table().getByRole("checkbox", { name: "Select all" }));
    const bar = screen.getByRole("region", { name: "Bulk actions" });
    expect(
      within(bar).queryByRole("button", { name: /^Approve/ })
    ).not.toBeInTheDocument();
    expect(
      within(bar).getByRole("button", { name: "Assign…" })
    ).toBeInTheDocument();
    expect(
      within(bar).getByRole("button", { name: "Send back…" })
    ).toBeInTheDocument();
    await user.click(
      within(bar).getByRole("button", { name: "Submit for review" })
    );

    expect(stepMany).toHaveBeenCalledWith({
      step: "submit",
      documents: [
        {
          document: { collection: "notes", id: "n1" },
          parts: [null],
          seen: [{ part: null, revision: 0, version: "v-n1" }],
        },
        {
          document: { collection: "notes", id: "n2" },
          parts: [null],
          seen: [{ part: null, revision: 3, version: "v-n2" }],
        },
      ],
    });
    const result = await screen.findByRole("status", {
      name: "Bulk move result",
    });
    expect(within(result).getByText("1 moved; 1 refused.")).toBeInTheDocument();
    expect(
      within(result).getByText(
        "Second note: It is not in a stage this step leaves from."
      )
    ).toBeInTheDocument();
  });

  it("offers a reader who may only read no checkbox, and so no move", () => {
    canFor.mockImplementation(() => false);
    renderTable();
    expect(table().queryAllByRole("checkbox")).toHaveLength(0);
  });

  it("moves a selection carried from an earlier page as that page showed it", async () => {
    canFor.mockImplementation(slug => slug === "update-notes");
    stepMany.mockResolvedValue({
      items: [{ id: "n1" }, { id: "n2" }],
      errors: [],
    });
    const user = userEvent.setup();
    const view = renderTable();

    await user.click(table().getByRole("checkbox", { name: "Select all" }));
    // The next page: other rows on screen, the first page's still selected.
    view.rerender(table_([row("n3", "Third note", "draft", 1)]));
    const bar = screen.getByRole("region", { name: "Bulk actions" });
    await user.click(
      within(bar).getByRole("button", { name: "Submit for review" })
    );

    expect(stepMany).toHaveBeenCalledWith(
      expect.objectContaining({
        documents: [
          expect.objectContaining({
            document: { collection: "notes", id: "n1" },
            seen: [{ part: null, revision: 0, version: "v-n1" }],
          }),
          expect.objectContaining({
            document: { collection: "notes", id: "n2" },
            seen: [{ part: null, revision: 3, version: "v-n2" }],
          }),
        ],
      })
    );
  });

  it("holds every move back while one is on its way", async () => {
    canFor.mockImplementation(slug => slug === "update-notes");
    stepMany.mockReturnValue(new Promise(() => {}));
    const user = userEvent.setup();
    renderTable();

    await user.click(table().getByRole("checkbox", { name: "Select all" }));
    const bar = screen.getByRole("region", { name: "Bulk actions" });
    await user.click(
      within(bar).getByRole("button", { name: "Submit for review" })
    );

    expect(
      within(bar).getByRole("button", { name: "Submit for review" })
    ).toBeDisabled();
    expect(within(bar).getByRole("button", { name: "Assign…" })).toBeDisabled();
    expect(stepMany).toHaveBeenCalledTimes(1);
  });
});

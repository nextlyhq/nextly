/**
 * The bulk bar's workflow moves (R-11): on a collection a workflow holds, a reviewer or writer
 * moves several documents at once with Submit for review, Assign… and Send back…, each offered only
 * where the caller may make it. Approve is never offered in bulk: the bar says each approval is
 * given from that document's review instead.
 */
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { render, screen } from "@admin/__tests__/utils";

import { BulkActionBar } from "../BulkActionBar";
import type { CollectionForColumns } from "../EntryTableColumns";

const { canFor } = vi.hoisted(() => ({
  canFor: vi.fn((_slug: string) => true),
}));
vi.mock("@admin/hooks/useCan", () => ({
  useCan: (slug: string) => canFor(slug),
}));

beforeEach(() => {
  canFor.mockReset();
  canFor.mockImplementation(() => true);
});

const held: CollectionForColumns = {
  slug: "posts",
  status: true,
  fields: [{ type: "text", name: "title", label: "Title" } as never],
  workflow: { slug: "editorial", label: "Editorial review" },
};

const unheld: CollectionForColumns = { ...held, workflow: null };

const moves = () => ({
  submit: vi.fn(),
  assign: vi.fn(),
  sendBack: vi.fn(),
});

describe("BulkActionBar — workflow moves", () => {
  it("offers Submit for review, Assign… and Send back… on a collection a workflow holds", async () => {
    const workflowMoves = moves();
    render(
      <BulkActionBar
        selectedCount={4}
        collection={held}
        onDelete={vi.fn()}
        onClear={vi.fn()}
        workflowMoves={workflowMoves}
      />
    );

    await userEvent.click(
      screen.getByRole("button", { name: "Submit for review" })
    );
    await userEvent.click(screen.getByRole("button", { name: "Assign…" }));
    await userEvent.click(screen.getByRole("button", { name: "Send back…" }));
    expect(workflowMoves.submit).toHaveBeenCalledTimes(1);
    expect(workflowMoves.assign).toHaveBeenCalledTimes(1);
    expect(workflowMoves.sendBack).toHaveBeenCalledTimes(1);
  });

  it("never offers Approve, and says where an approval is given", () => {
    render(
      <BulkActionBar
        selectedCount={4}
        collection={held}
        onDelete={vi.fn()}
        onClear={vi.fn()}
        workflowMoves={moves()}
      />
    );

    expect(
      screen.queryByRole("button", { name: /approve/i })
    ).not.toBeInTheDocument();
    expect(
      screen.getByText("Approve from each document's review.")
    ).toBeInTheDocument();
  });

  it("offers only the moves the caller may make", () => {
    render(
      <BulkActionBar
        selectedCount={2}
        collection={held}
        onDelete={vi.fn()}
        onClear={vi.fn()}
        workflowMoves={{ submit: vi.fn() }}
      />
    );

    expect(
      screen.getByRole("button", { name: "Submit for review" })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Assign…" })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Send back…" })
    ).not.toBeInTheDocument();
  });

  it("offers no workflow move on a collection no workflow holds", () => {
    render(
      <BulkActionBar
        selectedCount={2}
        collection={unheld}
        onDelete={vi.fn()}
        onClear={vi.fn()}
        workflowMoves={moves()}
      />
    );

    expect(
      screen.queryByRole("button", { name: "Submit for review" })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("Approve from each document's review.")
    ).not.toBeInTheDocument();
  });
});

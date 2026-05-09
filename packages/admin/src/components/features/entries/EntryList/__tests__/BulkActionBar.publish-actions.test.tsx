/**
 * Pins the contract for the bulk Publish / Unpublish actions:
 *
 *  - Without `collection.status === true` the bar shows Clear + Delete only
 *    (matches the pre-existing baseline; no regression for non-status
 *    collections).
 *  - With `collection.status === true` AND both publish callbacks present,
 *    the bar adds Unpublish + Publish buttons next to Delete.
 *  - The buttons fire the matching callback; `isPublishing` disables both
 *    so users can't double-fire while the mutation is in flight.
 *  - If a status: true collection is missing one of the callbacks, the
 *    publish actions stay hidden — the bar never half-renders.
 */
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { render, screen } from "@admin/__tests__/utils";

import { BulkActionBar } from "../BulkActionBar";
import type { CollectionForColumns } from "../EntryTableColumns";

const baseCollection: CollectionForColumns = {
  slug: "posts",
  fields: [{ type: "text", name: "title", label: "Title" } as never],
};

const statusCollection: CollectionForColumns = {
  ...baseCollection,
  status: true,
};

describe("BulkActionBar — Publish / Unpublish actions", () => {
  it("hides Publish + Unpublish when collection has no status flag", () => {
    render(
      <BulkActionBar
        selectedCount={3}
        collection={baseCollection}
        onDelete={vi.fn()}
        onPublish={vi.fn()}
        onUnpublish={vi.fn()}
        onClear={vi.fn()}
      />
    );

    expect(
      screen.queryByRole("button", { name: /^publish selected$/i })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /unpublish selected/i })
    ).not.toBeInTheDocument();
    // Baseline still rendered.
    expect(
      screen.getByRole("button", { name: /clear selection/i })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /delete selected/i })
    ).toBeInTheDocument();
  });

  it("renders Publish + Unpublish when status: true and both callbacks present", () => {
    render(
      <BulkActionBar
        selectedCount={3}
        collection={statusCollection}
        onDelete={vi.fn()}
        onPublish={vi.fn()}
        onUnpublish={vi.fn()}
        onClear={vi.fn()}
      />
    );

    expect(
      screen.getByRole("button", { name: /^publish selected$/i })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /unpublish selected/i })
    ).toBeInTheDocument();
  });

  it("fires onPublish when Publish is clicked", async () => {
    const onPublish = vi.fn();
    render(
      <BulkActionBar
        selectedCount={2}
        collection={statusCollection}
        onDelete={vi.fn()}
        onPublish={onPublish}
        onUnpublish={vi.fn()}
        onClear={vi.fn()}
      />
    );

    await userEvent.click(
      screen.getByRole("button", { name: /^publish selected$/i })
    );
    expect(onPublish).toHaveBeenCalledTimes(1);
  });

  it("fires onUnpublish when Unpublish is clicked", async () => {
    const onUnpublish = vi.fn();
    render(
      <BulkActionBar
        selectedCount={2}
        collection={statusCollection}
        onDelete={vi.fn()}
        onPublish={vi.fn()}
        onUnpublish={onUnpublish}
        onClear={vi.fn()}
      />
    );

    await userEvent.click(
      screen.getByRole("button", { name: /unpublish selected/i })
    );
    expect(onUnpublish).toHaveBeenCalledTimes(1);
  });

  it("disables both buttons while isPublishing", () => {
    render(
      <BulkActionBar
        selectedCount={2}
        collection={statusCollection}
        onDelete={vi.fn()}
        onPublish={vi.fn()}
        onUnpublish={vi.fn()}
        isPublishing
        onClear={vi.fn()}
      />
    );

    expect(
      screen.getByRole("button", { name: /^publish selected$/i })
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: /unpublish selected/i })
    ).toBeDisabled();
  });

  it("hides Publish + Unpublish if either callback is missing (defensive)", () => {
    // Why: the bar treats both as a pair — exposing only one would imply a
    // half-baked admin wiring. The publish actions stay hidden until both
    // are connected.
    render(
      <BulkActionBar
        selectedCount={2}
        collection={statusCollection}
        onDelete={vi.fn()}
        onPublish={vi.fn()}
        // onUnpublish intentionally omitted
        onClear={vi.fn()}
      />
    );

    expect(
      screen.queryByRole("button", { name: /^publish selected$/i })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /unpublish selected/i })
    ).not.toBeInTheDocument();
  });
});

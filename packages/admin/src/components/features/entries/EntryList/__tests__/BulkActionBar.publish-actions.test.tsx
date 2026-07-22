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
import { describe, expect, it, vi, beforeEach } from "vitest";

import { render, screen } from "@admin/__tests__/utils";

import { BulkActionBar } from "../BulkActionBar";
import type { CollectionForColumns } from "../EntryTableColumns";

// The bulk Publish / Unpublish buttons are permission-gated. These cases pin
// the status-and-callback contract, so the caller holds both permissions by
// default; the gating cases below deny them per test.
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

  it("hides only the action whose callback is missing", () => {
    // Publish and Unpublish are now independent — a caller may hold one
    // permission without the other — so a missing callback hides its own
    // button rather than both. Here Unpublish is unwired; Publish remains.
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
      screen.getByRole("button", { name: /^publish selected$/i })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /unpublish selected/i })
    ).not.toBeInTheDocument();
  });
});

describe("BulkActionBar — publish permission gating", () => {
  it("hides Publish for a caller without publish-<slug>", () => {
    canFor.mockImplementation((slug: string) => slug !== "publish-posts");

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
      screen.queryByRole("button", { name: /^publish selected$/i })
    ).not.toBeInTheDocument();
    // Unpublish is a separate permission and is still held here.
    expect(
      screen.getByRole("button", { name: /unpublish selected/i })
    ).toBeInTheDocument();
  });

  it("hides Unpublish for a caller without unpublish-<slug>", () => {
    canFor.mockImplementation((slug: string) => slug !== "unpublish-posts");

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
      screen.queryByRole("button", { name: /unpublish selected/i })
    ).not.toBeInTheDocument();
  });

  it("hides both when the caller holds neither permission", () => {
    canFor.mockImplementation(() => false);

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
      screen.queryByRole("button", { name: /^publish selected$/i })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /unpublish selected/i })
    ).not.toBeInTheDocument();
    // Delete stays — it is a different permission surface, unchanged here.
    expect(
      screen.getByRole("button", { name: /delete selected/i })
    ).toBeInTheDocument();
  });
});

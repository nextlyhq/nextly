// @vitest-environment jsdom
/**
 * Which row actions the table offers, and to whom.
 *
 * The API-keys list is reachable by a reader holding only `read-api-keys`,
 * because the endpoint behind it accepts that grant. Editing and revoking do
 * not: each answers to its own grant or the `update-api-keys` umbrella. A row
 * menu that offers them anyway sends the reader to a route that refuses them,
 * which reads as the product being broken rather than as a permission they
 * lack.
 *
 * @module components/features/api-keys/__tests__/ApiKeyTable.actions.test
 */
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { render, screen, waitFor, within } from "@admin/__tests__/utils";
import type { ApiKeyMeta } from "@admin/services/apiKeyApi";

import { ApiKeyTable } from "../ApiKeyTable";

/** The same shape the columns suite renders, so the table draws a real row. */
const KEY: ApiKeyMeta = {
  id: "abcdefgh123456",
  name: "CI Deploy",
  description: null,
  keyPrefix: "nx_live_abcdef",
  tokenType: "read-only",
  role: null,
  expiresAt: null,
  lastUsedAt: null,
  isActive: true,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const onEditSpy = vi.fn();

function renderTable(gates: { canEdit: boolean; canRevoke: boolean }) {
  onEditSpy.mockClear();
  render(
    <ApiKeyTable
      data={[KEY]}
      onEdit={onEditSpy}
      onRevoke={vi.fn()}
      canEdit={gates.canEdit}
      canRevoke={gates.canRevoke}
    />
  );
}

/** Open the row's action menu, whatever the list view labels its trigger. */
async function openRowMenu() {
  // Radix sets pointer-events: none on the trigger under jsdom, which the
  // default pointer check refuses; the click itself is what we need.
  const user = userEvent.setup({ pointerEventsCheck: 0 });
  const triggers = screen.getAllByRole("button");
  for (const trigger of triggers) {
    await user.click(trigger);
    if (screen.queryByText("Edit") || screen.queryByText("Revoke")) return true;
  }
  return false;
}

describe("ApiKeyTable row actions", () => {
  it("offers both to a reader holding the write grants", async () => {
    renderTable({ canEdit: true, canRevoke: true });
    // The positive control: these labels DO render when permitted, so their
    // absence below is the gate and not a query that never matches.
    expect(await openRowMenu()).toBe(true);
    await waitFor(() => {
      expect(screen.getByText("Edit")).toBeInTheDocument();
      expect(screen.getByText("Revoke")).toBeInTheDocument();
    });
  });

  it("offers neither to a read-only viewer", async () => {
    renderTable({ canEdit: false, canRevoke: false });
    await openRowMenu();
    expect(screen.queryByText("Edit")).toBeNull();
    expect(screen.queryByText("Revoke")).toBeNull();
  });

  /**
   * The row itself is a second door to the edit route. Gating only the menu
   * item leaves a read-only viewer able to open the editor by clicking the
   * row, or by activating it from the keyboard, and be refused there.
   */
  it("does not make rows activate the editor for a read-only viewer", async () => {
    renderTable({ canEdit: false, canRevoke: false });
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    // Scoped to the table: this list also renders a card view, so an unscoped
    // query matches the same key twice.
    const table = screen.getByRole("table");
    await user.click(within(table).getByText("CI Deploy"));
    // The positive control below proves this query DOES reach a clickable row
    // when permitted, so a silent no-op here is the gate rather than a miss.
    expect(onEditSpy).not.toHaveBeenCalled();
  });

  it("activates the editor from the row when permitted", async () => {
    renderTable({ canEdit: true, canRevoke: true });
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const table = screen.getByRole("table");
    await user.click(within(table).getByText("CI Deploy"));
    expect(onEditSpy).toHaveBeenCalled();
  });

  /**
   * The grants are separate: `delete-api-keys` revokes without editing, so the
   * two controls cannot be gated together.
   */
  it("offers revoke alone to a reader who may only revoke", async () => {
    renderTable({ canEdit: false, canRevoke: true });
    await openRowMenu();
    await waitFor(() => expect(screen.getByText("Revoke")).toBeInTheDocument());
    expect(screen.queryByText("Edit")).toBeNull();
  });
});

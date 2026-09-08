// @vitest-environment jsdom
/**
 * The property under test: a column the reader's stored choice hides is gone
 * from the rendered table — header and cells both — while the columns kept
 * visible still render. Header queries are scoped to the table because the
 * toolbar's column menu lists every toggleable column by design.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { render, screen, within } from "@admin/__tests__/utils";
import type { WebhookEndpointSummary } from "@admin/types/webhooks";

import { WebhookTable } from "../WebhookTable";

/** The webhooks list's toggleable columns, in declaration order. */
const TOGGLEABLE = [
  "url",
  "enabled",
  "eventTypes",
  "secretPrefix",
  "createdAt",
];

const WEBHOOK: WebhookEndpointSummary = {
  id: "wh_123456",
  name: "Slack Notifications",
  url: "https://hooks.slack.com/services/xxx",
  enabled: true,
  eventTypes: ["entry.created"],
  headers: null,
  secretPrefix: "whsec_",
  secrets: [],
  createdBy: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

function seedStoredChoice(visible: string[]): void {
  localStorage.setItem(
    "nextly-column-visibility-webhooks",
    JSON.stringify({
      columns: visible,
      defaultsHash: [...TOGGLEABLE].sort().join(","),
    })
  );
}

beforeEach(() => localStorage.clear());

describe("WebhookTable columns", () => {
  it("omits the header and cells of a column the stored choice hides", () => {
    seedStoredChoice(TOGGLEABLE.filter(name => name !== "url"));
    render(
      <WebhookTable
        data={[WEBHOOK]}
        canUpdate={true}
        canDelete={true}
        canViewDeliveries={true}
        onEdit={vi.fn()}
        onToggleEnabled={vi.fn()}
        onTest={vi.fn()}
        onDelete={vi.fn()}
        onViewDeliveries={vi.fn()}
      />
    );
    const table = screen.getByRole("table");
    // The Status header is the positive control: a header this query CAN find
    // inside the table, so the Payload URL absence below is the hidden column.
    expect(within(table).getAllByText("Status").length).toBeGreaterThan(0);
    expect(within(table).queryByText("Payload URL")).toBeNull();
    expect(
      screen.queryByText("https://hooks.slack.com/services/xxx")
    ).toBeNull();
  });
});

/**
 * What Activity's template and provider filters offer: the hub's own lists
 * by name where the reader may read them, else what the loaded rows name, a
 * provider without a stored id as "not stored", and the chosen one always.
 *
 * @module components/features/email-hub/activity/__tests__/activity-choices.test
 */
import { describe, expect, it } from "vitest";

import { providerChoices, templateChoices } from "../activity-choices";
import { deliveryRow, queuedRow, type ActivityRow } from "../activity-model";

function sent(
  id: string,
  slug: string | null,
  provider: { id: string | null; type: string }
): ActivityRow {
  return deliveryRow({
    id,
    createdAt: "2026-11-16T11:00:00.000Z",
    outcome: "sent",
    templateSlug: slug,
    provider,
    recipientKind: "to",
    failureReason: null,
    namedPerson: false,
    erased: false,
  });
}

const ROWS: ActivityRow[] = [
  sent("d1", "password-reset", {
    id: "11111111-aaaa-bbbb-cccc-000000000000",
    type: "resend",
  }),
  sent("d2", "order-shipped", { id: null, type: "smtp" }),
  sent("d3", null, { id: null, type: "smtp" }),
  queuedRow({
    id: "q1",
    createdAt: "2026-11-16T10:00:00.000Z",
    updatedAt: "2026-11-16T10:00:00.000Z",
    settledAt: null,
    state: "waiting",
    attempts: 0,
    nextAttemptAt: null,
    lastFailure: null,
    messageHeld: true,
    templateSlug: "welcome",
    queuedBy: "site",
  }),
];

describe("templateChoices", () => {
  it("offers the hub's templates by name when the reader may read them", () => {
    expect(
      templateChoices(
        [
          { slug: "welcome", name: "Welcome" },
          { slug: "password-reset", name: "Password reset" },
        ],
        ROWS,
        undefined
      )
    ).toEqual([
      { slug: "password-reset", label: "Password reset" },
      { slug: "welcome", label: "Welcome" },
    ]);
  });

  it("offers the slugs the rows name to a reader who may read deliveries alone", () => {
    expect(templateChoices(undefined, ROWS, undefined)).toEqual([
      { slug: "order-shipped", label: "order-shipped" },
      { slug: "password-reset", label: "password-reset" },
      { slug: "welcome", label: "welcome" },
    ]);
  });

  it("keeps offering the chosen template when no row names it", () => {
    expect(
      templateChoices(undefined, [], "invoice").map(option => option.slug)
    ).toEqual(["invoice"]);
  });
});

describe("providerChoices", () => {
  it("offers stored providers by name, and one not stored by type, never as deleted", () => {
    expect(
      providerChoices(
        [{ id: "11111111-aaaa-bbbb-cccc-000000000000", name: "Resend (main)" }],
        ROWS,
        undefined
      )
    ).toEqual([
      {
        choice: { id: "11111111-aaaa-bbbb-cccc-000000000000" },
        label: "Resend (main)",
      },
      { choice: { type: "smtp" }, label: "smtp (not stored)" },
    ]);
  });

  it("offers the providers the rows name to a reader who may read deliveries alone", () => {
    expect(providerChoices(undefined, ROWS, undefined)).toEqual([
      {
        choice: { id: "11111111-aaaa-bbbb-cccc-000000000000" },
        label: "resend · 11111111",
      },
      { choice: { type: "smtp" }, label: "smtp (not stored)" },
    ]);
  });

  it("keeps offering the chosen provider when no row names it", () => {
    expect(providerChoices(undefined, [], { type: "postmark" })).toEqual([
      { choice: { type: "postmark" }, label: "postmark (not stored)" },
    ]);
    expect(
      providerChoices(undefined, [], { id: "p9" }).map(option => option.choice)
    ).toEqual([{ id: "p9" }]);
  });
});

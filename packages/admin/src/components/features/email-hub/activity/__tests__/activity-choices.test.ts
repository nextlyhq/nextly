/**
 * What Activity's template and provider filters offer: the hub's own lists
 * by name where the reader may read them, else what the loaded rows name,
 * providers by type, and the chosen one always.
 *
 * @module components/features/email-hub/activity/__tests__/activity-choices.test
 */
import { describe, expect, it } from "vitest";

import type { ActivityProvider } from "@admin/services/emailActivityApi";

import { providerTypeChoices, templateChoices } from "../activity-choices";
import { activityRow, type ActivityRow } from "../activity-model";

function sent(
  id: string,
  template: { slug: string } | "none",
  provider: ActivityProvider
): ActivityRow {
  return activityRow({
    kind: "delivery",
    id,
    createdAt: "2026-11-16T11:00:00.000Z",
    status: "sent",
    template,
    provider,
    recipientKinds: ["to"],
    failureReason: null,
    attempts: null,
    nextAttemptAt: null,
    erased: false,
  });
}

const ROWS: ActivityRow[] = [
  sent(
    "d1",
    { slug: "password-reset" },
    {
      id: "11111111-aaaa-bbbb-cccc-000000000000",
      type: "resend",
      origin: "stored",
    }
  ),
  sent(
    "d2",
    { slug: "order-shipped" },
    { id: null, type: "smtp", origin: "code" }
  ),
  sent("d3", "none", { id: null, type: "smtp", origin: "deleted" }),
  activityRow({
    kind: "queued",
    id: "q1",
    createdAt: "2026-11-16T10:00:00.000Z",
    status: "waiting",
    template: { slug: "welcome" },
    provider: null,
    recipientKinds: null,
    failureReason: null,
    attempts: 0,
    nextAttemptAt: null,
    erased: false,
  }),
];

describe("templateChoices", () => {
  it("offers the hub's templates by name, and a template deleted since by the slug its rows name", () => {
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
      // In no list any more: its deliveries still name it.
      { slug: "order-shipped", label: "order-shipped" },
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

  it("offers emails only, never a layout or a partial, which nothing is sent from", () => {
    expect(
      templateChoices(
        [
          { slug: "welcome", name: "Welcome", kind: "template" },
          { slug: "default-layout", name: "Default layout", kind: "layout" },
          { slug: "footer", name: "Footer", kind: "partial" },
        ],
        [],
        undefined
      )
    ).toEqual([{ slug: "welcome", label: "Welcome" }]);
  });

  it("keeps offering the chosen template when no row names it", () => {
    expect(
      templateChoices(undefined, [], "invoice").map(option => option.slug)
    ).toEqual(["invoice"]);
  });
});

describe("providerTypeChoices", () => {
  it("offers each stored provider's type and each type the rows name, once, as every provider of it", () => {
    expect(
      providerTypeChoices(
        [{ type: "sendlayer" }, { type: "resend" }],
        ROWS,
        undefined
      )
    ).toEqual([
      { type: "resend", label: "Every resend provider" },
      { type: "sendlayer", label: "Every sendlayer provider" },
      { type: "smtp", label: "Every smtp provider" },
    ]);
  });

  it("offers the types the rows name to a reader who may read deliveries alone", () => {
    expect(
      providerTypeChoices(undefined, ROWS, undefined).map(option => option.type)
    ).toEqual(["resend", "smtp"]);
  });

  it("keeps offering the chosen type when no row names it", () => {
    expect(providerTypeChoices(undefined, [], "postmark")).toEqual([
      { type: "postmark", label: "Every postmark provider" },
    ]);
  });
});

/**
 * `dismissible`: who may send a card away, and how that reaches the admin.
 *
 * The field is independent of the lifecycle beside it -- a conditional card
 * goes when the install says its condition lapsed, a dismissible one goes when
 * the reader says so -- so the cases here pin that the two travel separately.
 *
 * Read through `declaredWidgets()` rather than the private summary builder: the
 * admin receives what that returns, so this exercises the path the payload
 * actually takes.
 */
import { beforeEach, describe, expect, it } from "vitest";

import { declaredWidgets } from "../canonical";
import { CORE_WIDGETS } from "../core-widgets";
import { clearWidgets, registerWidget } from "../registry";

beforeEach(() => {
  clearWidgets();
  for (const definition of CORE_WIDGETS) registerWidget(definition);
});

const summaryFor = (id: string) => {
  const summary = declaredWidgets().find(widget => widget.id === id);
  if (!summary) throw new Error(`no widget summary for "${id}"`);
  return summary;
};

describe("what the admin is told about dismissal", () => {
  it("carries the flag for a card that declares it", () => {
    // Without this the admin cannot draw the control at all: the card would be
    // declared dismissible and no reader could dismiss it.
    expect(summaryFor("core/onboarding-checklist").dismissible).toBe(true);
  });

  it("says nothing for a card that does not", () => {
    // Absent rather than `false`, matching how every other optional field on
    // the summary travels -- a reader of the payload sees which cards made a
    // claim instead of inferring it from a default.
    expect(summaryFor("core/collections")).not.toHaveProperty("dismissible");
  });

  it("travels beside a lifecycle without being implied by it", () => {
    // 🔴 The onboarding card is BOTH. A summary carrying one and dropping the
    // other would take the card away for the wrong reason: gone when the work
    // finished but unremovable before that, or removable but permanent.
    const summary = summaryFor("core/onboarding-checklist");

    expect(summary.lifecycle).toBe("conditional");
    expect(summary.visibleWhen).toBe("onboarding:incomplete");
    expect(summary.dismissible).toBe(true);
  });
});

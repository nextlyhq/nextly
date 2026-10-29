import { describe, expect, it } from "vitest";

import { retiredWidgetReplacement } from "../retired-widget-namespaces";

const COLLECTION_SENTENCE =
  "is a retired card: core no longer makes a card per collection. Add Count, Breakdown, Over time or Recent entries and set its Collection to";

describe("what a retired card is told", () => {
  it("names the one collection that minted its id, by its label", () => {
    // The id wrote `customer_notes` as `customer-notes`: matched by the slug written that way.
    expect(
      retiredWidgetReplacement("collection/customer-notes-count", [
        { slug: "customer_notes", label: "Customer notes" },
        { slug: "orders", label: "Orders" },
      ])
    ).toBe(`${COLLECTION_SENTENCE} Customer notes.`);
  });

  it("describes the collection when none of those it may name minted the id", () => {
    // None at all (a door at startup), and none that match (one the reader may not read).
    for (const collections of [[], [{ slug: "orders", label: "Orders" }]]) {
      expect(
        retiredWidgetReplacement("collection/customer-notes-count", collections)
      ).toBe(`${COLLECTION_SENTENCE} the collection this card showed.`);
    }
  });

  it("describes the collection when several could have minted the id, and never prints the id's slug", () => {
    // `customer_notes` and `customer-notes` both mint `customer-notes`: naming either guesses.
    const told = retiredWidgetReplacement("collection/customer-notes-count", [
      { slug: "customer_notes", label: "Customer notes" },
      { slug: "customer-notes", label: "Notes from customers" },
    ]);
    expect(told).toBe(
      `${COLLECTION_SENTENCE} the collection this card showed.`
    );
    expect(told).not.toContain("customer-notes");
  });

  it("tells a Single's card where its edits show, never a collection", () => {
    expect(
      retiredWidgetReplacement("single/home-card", [
        { slug: "home", label: "Home" },
      ])
    ).toBe(
      "is a retired card: core no longer makes a card per Single. A Single's edits show in Recently edited (core/recently-edited)."
    );
  });

  it("answers nothing for an id in no retired namespace", () => {
    expect(retiredWidgetReplacement("acme/x-count")).toBeUndefined();
  });
});

import { describe, it, expect } from "vitest";

import { matchesFilter } from "../filter";
import type { FilterSpec, WebhookEvent } from "../types";

function envelope(overrides: Partial<WebhookEvent> = {}): WebhookEvent {
  return {
    id: "evt_1",
    type: "entry.updated",
    specversion: "1",
    timestamp: "2026-07-18T00:00:00.000Z",
    resource: { kind: "entry", collection: "posts", id: "p1" },
    data: { id: "p1" },
    previous: null,
    changedFields: ["status"],
    ...overrides,
  };
}

describe("matchesFilter", () => {
  it("matches everything when the filter is null or undefined", () => {
    expect(matchesFilter(null, envelope())).toBe(true);
    expect(matchesFilter(undefined, envelope())).toBe(true);
  });

  it("fails closed on an unknown filter version", () => {
    const v2 = {
      version: 2,
      type: "expression",
      expr: "true",
    } as FilterSpec;
    expect(matchesFilter(v2, envelope())).toBe(false);
  });

  describe("eventTypes (OR)", () => {
    it("matches when the envelope type is listed", () => {
      const f: FilterSpec = {
        version: 1,
        eventTypes: ["entry.created", "entry.updated"],
      };
      expect(matchesFilter(f, envelope({ type: "entry.updated" }))).toBe(true);
    });

    it("rejects when the envelope type is not listed", () => {
      const f: FilterSpec = { version: 1, eventTypes: ["entry.created"] };
      expect(matchesFilter(f, envelope({ type: "entry.updated" }))).toBe(false);
    });

    it("treats an absent or empty eventTypes as any type", () => {
      expect(matchesFilter({ version: 1 }, envelope())).toBe(true);
      expect(matchesFilter({ version: 1, eventTypes: [] }, envelope())).toBe(
        true
      );
    });
  });

  describe("collections", () => {
    it("matches all collections when null, absent, or empty", () => {
      expect(matchesFilter({ version: 1, collections: null }, envelope())).toBe(
        true
      );
      expect(matchesFilter({ version: 1 }, envelope())).toBe(true);
      // An empty array means "no collection constraint", not "match nothing".
      expect(matchesFilter({ version: 1, collections: [] }, envelope())).toBe(
        true
      );
    });

    it("matches only a listed collection", () => {
      const f: FilterSpec = { version: 1, collections: ["posts", "pages"] };
      expect(
        matchesFilter(
          f,
          envelope({ resource: { kind: "entry", collection: "posts" } })
        )
      ).toBe(true);
      expect(
        matchesFilter(
          f,
          envelope({ resource: { kind: "entry", collection: "authors" } })
        )
      ).toBe(false);
    });

    it("rejects a collection filter when the envelope has no collection", () => {
      const f: FilterSpec = { version: 1, collections: ["posts"] };
      expect(matchesFilter(f, envelope({ resource: { kind: "single" } }))).toBe(
        false
      );
    });
  });

  describe("changedFields", () => {
    it("has no effect when null, absent, or empty", () => {
      expect(
        matchesFilter({ version: 1, changedFields: null }, envelope())
      ).toBe(true);
      expect(matchesFilter({ version: 1 }, envelope())).toBe(true);
      expect(matchesFilter({ version: 1, changedFields: [] }, envelope())).toBe(
        true
      );
    });

    it("matches when any listed field changed", () => {
      const f: FilterSpec = { version: 1, changedFields: ["status", "title"] };
      expect(matchesFilter(f, envelope({ changedFields: ["status"] }))).toBe(
        true
      );
    });

    it("rejects when none of the listed fields changed", () => {
      const f: FilterSpec = { version: 1, changedFields: ["status"] };
      expect(matchesFilter(f, envelope({ changedFields: ["title"] }))).toBe(
        false
      );
    });
  });

  it("requires every present constraint to hold (conjunction)", () => {
    const f: FilterSpec = {
      version: 1,
      eventTypes: ["entry.updated"],
      collections: ["posts"],
      changedFields: ["status"],
    };
    // All three hold.
    expect(
      matchesFilter(
        f,
        envelope({
          type: "entry.updated",
          resource: { kind: "entry", collection: "posts" },
          changedFields: ["status"],
        })
      )
    ).toBe(true);
    // Right type + collection, but the changed field misses.
    expect(
      matchesFilter(
        f,
        envelope({
          type: "entry.updated",
          resource: { kind: "entry", collection: "posts" },
          changedFields: ["title"],
        })
      )
    ).toBe(false);
  });
});

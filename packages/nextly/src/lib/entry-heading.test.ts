/**
 * The shared heading walk, at the two boundaries its callers differ on.
 *
 * `services/dashboard/__tests__/recent-entries.test.ts` drives it through the
 * dashboard, where the fallback is always the entry id. The activity feed's
 * fallback may be `undefined` — a delete row can legitimately have nothing to
 * call the entry it names — and that case has no other test.
 */

import { describe, expect, it } from "vitest";

import { entryHeading } from "./entry-heading";

describe("entryHeading", () => {
  it("prefers the configured title field over `title` and `name`", () => {
    expect(
      entryHeading({ heading: "H", title: "T", name: "N" }, "heading", "id-1")
    ).toBe("H");
  });

  it("starts at `title` when no title field is configured", () => {
    expect(entryHeading({ title: "T", name: "N" }, null, "id-1")).toBe("T");
  });

  it("skips a WHITESPACE-ONLY candidate and keeps walking", () => {
    // 🔴 The value rule is shared for this reason. A blank heading is
    // indistinguishable from a row that failed to load, and the entry surfaces
    // trim before accepting -- so a `label` holding two spaces was a blank
    // heading in the activity feed and the meaningful `subject` everywhere
    // else. Same entry, two names.
    expect(
      entryHeading({ label: "   ", subject: "Re: hello" }, null, "id-1")
    ).toBe("Re: hello");
    // The nominated field gets the same treatment: nominating it does not make
    // whitespace a name.
    expect(entryHeading({ headline: "  " }, "headline", "id-1")).toBe("id-1");
    // And an accepted value comes back TRIMMED, so the two surfaces render the
    // same characters rather than differing by leading space.
    expect(entryHeading({ title: "  Ada  " }, null, "id-1")).toBe("Ada");
  });

  it("walks the SAME conventional names the field-level rule accepts", () => {
    // 🔴 One question, one answer. The rule that decides which column a list or
    // a generated card SELECTS accepts `label`, `subject` and `heading` beside
    // `title` and `name`, and this walk has to accept the same set: a
    // collection naming its entries with `subject` takes that field as its
    // title on the dashboard, and a shorter walk answers the activity feed with
    // a bare id for the same entry.
    expect(entryHeading({ subject: "Re: hello" }, null, "id-1")).toBe(
      "Re: hello"
    );
    expect(entryHeading({ heading: "Chapter 1" }, null, "id-1")).toBe(
      "Chapter 1"
    );
    expect(entryHeading({ label: "Draft" }, null, "id-1")).toBe("Draft");
    // Preference order is preserved: `title` still outranks the newcomers.
    expect(entryHeading({ subject: "S", title: "T" }, null, "id-1")).toBe("T");
  });

  it("returns `undefined` rather than a placeholder when nothing is usable", () => {
    // The activity feed's case. A heading it invents is worse than none: the
    // row would claim a name the entry never had.
    expect(entryHeading({ title: {} }, null, undefined)).toBeUndefined();
  });

  it("accepts a bigint, which `typeof` reports separately from `number`", () => {
    expect(entryHeading({ title: 9007199254740993n }, null, "id-1")).toBe(
      "9007199254740993"
    );
  });

  it("refuses `null`, a boolean and a Date without stringifying any of them", () => {
    // `String(null)` is "null", `String(false)` is "false", and a Date renders
    // its whole locale string — three headings that read as data and are not.
    expect(entryHeading({ title: null }, null, "id-1")).toBe("id-1");
    expect(entryHeading({ title: false }, null, "id-1")).toBe("id-1");
    expect(entryHeading({ title: new Date(0) }, null, "id-1")).toBe("id-1");
  });
});

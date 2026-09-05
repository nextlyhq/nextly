/**
 * A cell is PRESENTED by its declared kind, not printed.
 *
 * 🔴 The defect this covers reached a reader: `scheduledAt` and `updatedAt` are
 * declared `date` by their sources, the value crosses the wire as ISO 8601, and
 * the row drew `2026-09-01T07:00:00.000Z` — on cards whose entire subject is
 * when something happened or will happen. Selecting a different field was the
 * first thing tried and it is not a fix: it only moves which column is
 * unreadable.
 *
 * Asserted on the RENDERED row rather than on `asPresentedText` alone, because
 * the unit was never the broken part. The type existed on the source and
 * stopped at the server; what had to be proven is that it now reaches the
 * element a person looks at.
 */
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import {
  getGlobalDateTimeConfig,
  setGlobalDateTimeConfig,
} from "@admin/lib/dates/format";

import { asPresentedText } from "../cell-text";
import { listBody } from "../list";

const ISO = "2026-09-01T07:00:00.000Z";

const definition = {
  id: "core/upcoming-releases",
  title: "Upcoming releases",
  archetype: "list",
  query: { source: "system:releases", op: "list", select: ["title", "when"] },
} as unknown as Parameters<typeof listBody>[1];

function draw(fields: { name: string; type?: string }[]) {
  const outcome = listBody(
    {
      op: "list",
      items: [{ title: "Autumn launch", when: ISO }],
      fields,
    } as never,
    definition
  );
  if (!outcome.ok) throw new Error(`renderer refused: ${outcome.message}`);
  render(<>{outcome.node}</>);
}

describe("a list cell is presented by its declared kind", () => {
  it("does not print a date as its ISO string", () => {
    draw([{ name: "title" }, { name: "when", type: "date" }]);

    // The control first: the row rendered at all, so the absence below is
    // about the FORMATTING and not about an empty card.
    expect(screen.getByText("Autumn launch")).toBeInTheDocument();
    expect(screen.queryByText(ISO)).not.toBeInTheDocument();
  });

  /*
   * A column the server did not type still renders. This is the compatibility
   * direction: a source with no declaration, or a result predating types, must
   * degrade to plain text rather than to an em dash — an unpresented value is
   * still evidence, and blanking it would report a working row as missing data.
   */
  it("prints an untyped column as text", () => {
    draw([{ name: "title" }, { name: "when" }]);

    expect(screen.getByText(ISO)).toBeInTheDocument();
  });
});

describe("asPresentedText", () => {
  it("leaves a non-date alone", () => {
    expect(asPresentedText("Autumn launch", "string")).toBe("Autumn launch");
  });

  /*
   * An unparseable date falls back to the raw text. The value is still
   * something a reader can see is wrong; an em dash would claim the row has no
   * value at all, which is a different and less recoverable report.
   */
  it("falls back to the raw text on an unparseable date", () => {
    expect(asPresentedText("not-a-date", "date")).toBe("not-a-date");
  });

  it("drops what cannot be printed at all", () => {
    expect(asPresentedText({ nested: true }, "date")).toBeUndefined();
    expect(asPresentedText(null, "date")).toBeUndefined();
  });
});

/**
 * The cell honours the ADMIN's configured timezone, not the browser's.
 *
 * 🔴 General Settings carries a timezone and `GeneralSettingsSyncProvider`
 * publishes it to `formatGlobalDateTime` at the root of the admin. A cell
 * formatting with a bare `toLocaleString` reads the browser's zone instead, so
 * these cards would disagree with every other date beside them the moment an
 * administrator configured one -- silently, and only for the administrators who
 * did.
 */
describe("a date cell reads the admin's configured timezone", () => {
  const original = getGlobalDateTimeConfig();
  afterEach(() => setGlobalDateTimeConfig(original));

  it("renders the instant in the configured zone", () => {
    setGlobalDateTimeConfig({ timezone: "Asia/Karachi", locale: "en-US" });

    // 07:00Z is 12:00 in Asia/Karachi (UTC+5, no DST).
    expect(asPresentedText(ISO, "date")).toContain("12:00");
  });

  /*
   * The must-differ control, and it is the assertion that actually proves the
   * configured zone is CONSULTED. A fixed expectation alone would also pass on
   * a machine whose local zone happened to match, which is luck rather than
   * evidence -- two different zones producing the same text can only mean the
   * setting was ignored.
   */
  it("renders the same instant differently in a different zone", () => {
    setGlobalDateTimeConfig({ timezone: "Asia/Karachi", locale: "en-US" });
    const karachi = asPresentedText(ISO, "date");

    setGlobalDateTimeConfig({
      timezone: "Pacific/Kiritimati",
      locale: "en-US",
    });
    const kiritimati = asPresentedText(ISO, "date");

    expect(karachi).toBeDefined();
    expect(kiritimati).not.toBe(karachi);
  });
});

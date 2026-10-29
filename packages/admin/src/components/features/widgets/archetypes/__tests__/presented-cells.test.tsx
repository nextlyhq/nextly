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
import { presentedCell } from "../presented-cell";

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
    expect(asPresentedText("Autumn launch", { type: "string" })).toBe(
      "Autumn launch"
    );
  });

  /*
   * An unparseable date falls back to the raw text. The value is still
   * something a reader can see is wrong; an em dash would claim the row has no
   * value at all, which is a different and less recoverable report.
   */
  it("falls back to the raw text on an unparseable date", () => {
    expect(asPresentedText("not-a-date", { type: "date" })).toBe("not-a-date");
  });

  it("drops what cannot be printed at all", () => {
    expect(asPresentedText({ nested: true }, { type: "date" })).toBeUndefined();
    expect(asPresentedText(null, { type: "date" })).toBeUndefined();
  });
});

/**
 * The cell honours the ADMIN's configured timezone, not the browser's.
 *
 * 🔴 General Settings carries a timezone and `GeneralSettingsSync`
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
    expect(asPresentedText(ISO, { type: "date" })).toContain("12:00");
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
    const karachi = asPresentedText(ISO, { type: "date" });

    setGlobalDateTimeConfig({
      timezone: "Pacific/Kiritimati",
      locale: "en-US",
    });
    const kiritimati = asPresentedText(ISO, { type: "date" });

    expect(karachi).toBeDefined();
    expect(kiritimati).not.toBe(karachi);
  });
});

/**
 * A date cell reads short enough for a meta line, with the full date kept for
 * its tooltip: "Oct 24, 2026 09:40 PM" in a row of three fields crowded the
 * row, and repeated a year every date on the card shares.
 */
describe("a date cell reads short, with the full date on hover", () => {
  const original = getGlobalDateTimeConfig();
  afterEach(() => setGlobalDateTimeConfig(original));
  const NOW = Date.parse("2026-10-27T15:00:00.000Z");
  // ICU may put a narrow no-break space before AM/PM: compared as plain spaces.
  const plain = (text: string | undefined) => text?.replace(/\s/g, " ");

  it.each([
    ["2026-10-27T09:40:00.000Z", "Today, 9:40 AM"],
    ["2026-10-26T21:40:00.000Z", "Yesterday, 9:40 PM"],
    ["2026-10-24T21:40:00.000Z", "Oct 24, 9:40 PM"],
    ["2025-10-24T21:40:00.000Z", "Oct 24, 2025, 9:40 PM"],
  ])("reads %s as %s", (iso, short) => {
    setGlobalDateTimeConfig({
      timezone: "UTC",
      locale: "en-US",
      timeFormat: "12h",
    });
    expect(plain(asPresentedText(iso, { type: "date" }, NOW))).toBe(short);
  });

  it("names the day in the admin's zone, not in UTC", () => {
    // 20:00Z on the 26th is 01:00 on the 27th in Asia/Karachi (UTC+5): today
    // there, while still yesterday in UTC.
    const iso = "2026-10-26T20:00:00.000Z";
    setGlobalDateTimeConfig({
      timezone: "UTC",
      locale: "en-US",
      timeFormat: "12h",
    });
    expect(plain(asPresentedText(iso, { type: "date" }, NOW))).toBe(
      "Yesterday, 8:00 PM"
    );
    setGlobalDateTimeConfig({
      timezone: "Asia/Karachi",
      locale: "en-US",
      timeFormat: "12h",
    });
    expect(plain(asPresentedText(iso, { type: "date" }, NOW))).toBe(
      "Today, 1:00 AM"
    );
  });

  it("keeps the full date, year included, in the cell's tooltip", () => {
    setGlobalDateTimeConfig({
      timezone: "UTC",
      locale: "en-US",
      timeFormat: "12h",
    });
    const iso = "2026-10-24T21:40:00.000Z";
    render(<>{presentedCell(iso, { type: "date" }, NOW)}</>);
    const cell = screen.getByText(
      (_, node) =>
        node?.tagName === "TIME" &&
        plain(node.textContent) === "Oct 24, 9:40 PM"
    );
    expect(cell).toHaveAttribute("dateTime", iso);
    expect(cell.getAttribute("title")).toContain("2026");
  });

  it("leaves any other cell as its text", () => {
    expect(presentedCell("Autumn launch", { type: "string" }, NOW)).toBe(
      "Autumn launch"
    );
  });
});

describe("a choice column shows each value's label", () => {
  // A status stored as `published` reads "Published"; a select stored as `needs_review` reads
  // "Needs review". The labels come from the column the server described.
  const stage = {
    choices: [
      { value: "needs_review", label: "Needs review" },
      { value: "done", label: "Done" },
    ],
  };

  it("shows the label for a value the column names", () => {
    expect(asPresentedText("needs_review", stage)).toBe("Needs review");
  });

  it("names an empty stored value by its declared label, as a bar does", () => {
    // An option that stores "" under "None" is a value the column names, not a missing one.
    const priority = { choices: [{ value: "", label: "None" }] };
    expect(asPresentedText("", priority)).toBe("None");
    // With no label declared for it, an empty value is still an empty cell.
    expect(asPresentedText("", stage)).toBeUndefined();
  });

  it("keeps the stored value for one the column does not name", () => {
    // An option removed since the row was written: the stored value is still the truth.
    expect(asPresentedText("archived", stage)).toBe("archived");
  });

  it("draws the label in the rendered row, not the stored value", () => {
    const outcome = listBody(
      {
        op: "list",
        items: [{ title: "Autumn launch", when: "needs_review" }],
        fields: [{ name: "title" }, { name: "when", ...stage }],
      } as never,
      definition
    );
    if (!outcome.ok) throw new Error(`renderer refused: ${outcome.message}`);
    render(<>{outcome.node}</>);

    expect(screen.getByText("Autumn launch")).toBeInTheDocument();
    expect(screen.getByText("Needs review")).toBeInTheDocument();
    expect(screen.queryByText("needs_review")).not.toBeInTheDocument();
  });
});

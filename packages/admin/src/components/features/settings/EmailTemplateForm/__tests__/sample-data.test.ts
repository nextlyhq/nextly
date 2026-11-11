// What the test data starts from, read from a declaration's own presentation:
// its example first, else a value of its type, else today's name-based sample.
// A send renders whatever it is given, so this shapes only what the author
// sees in the preview and the completions.

import { describe, expect, it } from "vitest";

import { buildSampleData } from "../sample-data";

describe("sample data from typed declarations", () => {
  it("prefers a declared example over a value of the type", () => {
    const data = buildSampleData([
      { name: "total", presentation: { type: "money", example: 25 } },
    ]);
    expect(data.total).toBe(25);
  });

  it("starts a value of the declared type when there is no example", () => {
    const data = buildSampleData([
      { name: "total", presentation: { type: "money" } },
      { name: "count", presentation: { type: "number" } },
      { name: "since", presentation: { type: "date" } },
      { name: "read", presentation: { type: "boolean" } },
      { name: "link", presentation: { type: "link" } },
    ]);
    expect(data.total).toBe(19.99);
    expect(data.count).toBe(1);
    expect(data.read).toBe(true);
    expect(data.since).toBe(new Date().toISOString().slice(0, 10));
    expect(data.link).toBe("https://example.com");
  });

  it("uses a known URL sample for a link variable whose name maps to one", () => {
    const data = buildSampleData([
      { name: "verifyLink", presentation: { type: "link" } },
      { name: "resetLink", presentation: { type: "link" } },
    ]);
    expect(data.verifyLink).toBe(
      "https://app.northwind.io/verify?token=8f2c1a"
    );
    expect(data.resetLink).toBe("https://app.northwind.io/reset?token=8f2c1a");
  });

  it("fills a list with one row of its item fields, and an object with its fields", () => {
    const data = buildSampleData([
      {
        name: "lines",
        presentation: {
          type: "list",
          fields: [{ name: "label" }, { name: "amount", type: "money" }],
        },
      },
      {
        name: "buyer",
        presentation: {
          type: "object",
          fields: [{ name: "name" }, { name: "verified", type: "boolean" }],
        },
      },
    ]);
    expect(data.lines).toEqual([{ label: "Sample label", amount: 19.99 }]);
    // A field named `name` gets today's sample for that name, as a top-level
    // variable would.
    expect(data.buyer).toEqual({ name: "Priya Raman", verified: true });
  });

  it("falls back to a name-based string for a list with no field schema", () => {
    const data = buildSampleData([
      { name: "tags", presentation: { type: "list" } },
      { name: "flags", presentation: { type: "list", fields: [] } },
    ]);
    expect(data.tags).toEqual(["Sample tags"]);
    expect(data.flags).toEqual(["Sample flags"]);
  });

  it("produces an empty object for a typed object with no field schema", () => {
    const data = buildSampleData([
      { name: "meta", presentation: { type: "object" } },
    ]);
    expect(data.meta).toEqual({});
  });

  it("keeps today's name-based sample for a variable with no presentation", () => {
    const data = buildSampleData([{ name: "userName" }, { name: "unread" }]);
    expect(data.userName).toBe("Priya Raman");
    expect(data.unread).toBe("Sample unread");
  });
});

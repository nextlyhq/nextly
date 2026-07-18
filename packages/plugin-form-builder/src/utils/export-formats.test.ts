import { describe, expect, it } from "vitest";

import type { FormDocument, SubmissionDocument } from "../types";

import { exportToCSV, generateExportFilename } from "./export-formats";

function form(): FormDocument {
  return {
    id: "form_1",
    name: "Contact",
    slug: "contact",
    status: "published",
    fields: [
      { type: "text", name: "name", label: "Full name", required: false },
      { type: "email", name: "email", label: "Email", required: false },
    ],
    notifications: [],
    settings: {},
    createdAt: new Date("2026-07-01T00:00:00Z"),
    updatedAt: new Date("2026-07-01T00:00:00Z"),
  } as unknown as FormDocument;
}

function submission(
  overrides: Partial<SubmissionDocument> & { id: string }
): SubmissionDocument {
  return {
    form: "form_1",
    data: {},
    status: "new",
    submittedAt: new Date("2026-07-16T10:00:00Z"),
    ipAddress: null,
    userAgent: null,
    ...overrides,
  } as unknown as SubmissionDocument;
}

describe("exportToCSV", () => {
  it("derives columns from the form's field labels plus metadata", () => {
    const csv = exportToCSV(
      [
        submission({
          id: "s1",
          data: { name: "Ada", email: "ada@example.com" },
        }),
      ],
      form()
    );
    // CSV uses CRLF row separators and a UTF-8 BOM (both per convention).
    const lines = csv.replace(/^﻿/, "").split("\r\n");
    expect(lines[0]).toBe(
      "Full name,Email,ID,Status,Submitted At,IP Address,User Agent"
    );
    expect(lines[1]).toContain("Ada");
    expect(lines[1]).toContain("ada@example.com");
    expect(lines[1]).toContain("s1");
  });

  it("escapes delimiters, quotes, and newlines in values", () => {
    const csv = exportToCSV(
      [
        submission({
          id: "s2",
          data: { name: 'Ada, "the first"\nprogrammer', email: "a@b.co" },
        }),
      ],
      form()
    );
    // A value containing comma/quote/newline is quoted with doubled quotes.
    expect(csv).toContain('"Ada, ""the first""\nprogrammer"');
  });

  it("neutralizes spreadsheet formula triggers while leaving numbers alone", () => {
    const csv = exportToCSV(
      [
        submission({
          id: "s4",
          data: { name: "=cmd|' /C calc'!A0", email: "@import" },
        }),
        submission({ id: "s5", data: { name: "-42", email: "a@b.co" } }),
      ],
      form()
    );
    // Formula-trigger cells get the OWASP apostrophe prefix…
    expect(csv).toContain("'=cmd|");
    expect(csv).toContain("'@import");
    // …but plain negative numbers stay numeric data.
    expect(csv).toContain("-42");
    expect(csv).not.toContain("'-42");
  });

  it("renders missing values as empty cells instead of failing", () => {
    const csv = exportToCSV([submission({ id: "s3", data: {} })], form());
    const dataLine = csv.replace(/^﻿/, "").split("\r\n")[1];
    expect(dataLine.startsWith(",,s3")).toBe(true);
  });
});

describe("generateExportFilename", () => {
  it("names the file after the form slug, date, and format", () => {
    expect(generateExportFilename("contact", "csv")).toMatch(
      /^contact-submissions-\d{4}-\d{2}-\d{2}\.csv$/
    );
  });
});

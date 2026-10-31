/**
 * What the New form submissions card reads and how it words each row, over a
 * stand-in for the reads core binds to the reader.
 *
 * The stand-in answers only the filters these reads send, by their meaning,
 * so a read that dropped a filter would be answered rows it should not get.
 * Whether core applies the reader's rules to those reads is the integration
 * suite's question (`new-submissions.integration.test.ts`); this one is about
 * what the widget asks and what it makes of the answer.
 */
import { describe, expect, it } from "vitest";

import { formBuilder } from "../plugin";

import {
  firstLine,
  NEW_SUBMISSIONS_WIDGET_ID,
  readNewSubmissions,
  readableFormIds,
  submissionRow,
  type NewSubmissionsData,
} from "./new-submissions";

type Row = Record<string, unknown>;

interface FindOptions {
  where?: Record<string, Record<string, unknown>>;
  sort?: string;
  limit?: number;
  select?: readonly string[];
  total?: true;
}

const COLLECTIONS = { forms: "forms", submissions: "form-submissions" };

/** The widget as the plugin contributes it, with the two functions run here. */
function contributedWidget(): {
  load: (input: {
    services: ReturnType<typeof services>;
    size: { w: number; h: number; tier: "medium" };
    signal: AbortSignal;
  }) => Promise<NewSubmissionsData>;
  summary: {
    count: (input: {
      services: ReturnType<typeof services>;
      signal: AbortSignal;
    }) => Promise<number>;
  };
} {
  const widget = formBuilder().plugin.contributes?.dashboard?.widgets?.find(
    candidate => candidate.id === NEW_SUBMISSIONS_WIDGET_ID
  );
  if (widget === undefined) throw new Error("the plugin contributes no card");
  return widget as unknown as ReturnType<typeof contributedWidget>;
}

/** A read that answers by the meaning of the filters the widget sends. */
function matches(row: Row, where: FindOptions["where"]): boolean {
  return Object.entries(where ?? {}).every(([field, condition]) => {
    const value = row[field];
    if ("equals" in condition) return value === condition.equals;
    if ("in" in condition)
      return (condition.in as unknown[]).includes(value as string);
    if ("greater_than" in condition)
      return String(value) > String(condition.greater_than);
    throw new Error(
      `the stand-in does not answer ${JSON.stringify(condition)}`
    );
  });
}

function sorted(rows: Row[], sort: string | undefined): Row[] {
  if (sort === undefined) return rows;
  const field = sort.replace(/^-/, "");
  const sign = sort.startsWith("-") ? -1 : 1;
  return [...rows].sort(
    (a, b) => sign * String(a[field]).localeCompare(String(b[field]))
  );
}

/** Reads over two in-memory collections, recording every call. */
function services(data: { forms: Row[]; submissions: Row[] }) {
  const calls: { op: string; collection: string; options: FindOptions }[] = [];
  const rowsOf = (collection: string) =>
    collection === COLLECTIONS.forms ? data.forms : data.submissions;
  return {
    calls,
    async find(collection: string, options: FindOptions = {}) {
      calls.push({ op: "find", collection, options });
      const all = sorted(
        rowsOf(collection).filter(row => matches(row, options.where)),
        options.sort
      );
      const items = all
        .slice(0, options.limit ?? all.length)
        .map(row =>
          options.select === undefined
            ? row
            : Object.fromEntries(
                options.select.flatMap(key =>
                  key in row ? [[key, row[key]]] : []
                )
              )
        );
      return {
        items,
        ...(options.total === true ? { total: all.length } : {}),
      };
    },
    async count(collection: string, options: FindOptions = {}) {
      calls.push({ op: "count", collection, options });
      return rowsOf(collection).filter(row => matches(row, options.where))
        .length;
    },
  };
}

const CONTACT = {
  id: "f-contact",
  name: "Contact",
  fields: [
    { type: "text", name: "fullName", label: "Full name" },
    { type: "email", name: "email", label: "Email" },
    { type: "textarea", name: "message", label: "Message" },
  ],
};
const NEWSLETTER = {
  id: "f-newsletter",
  name: "Newsletter",
  // Stored as text, as MySQL and SQLite answer a JSON column.
  fields: JSON.stringify([{ type: "email", name: "address", label: "Email" }]),
};
const SURVEY = {
  id: "f-survey",
  name: "Survey",
  fields: [
    { type: "number", name: "score", label: "Score" },
    { type: "text", name: "comment", label: "Comment" },
  ],
};

function submission(
  id: string,
  form: string,
  data: Row | string,
  submittedAt: string,
  status = "new"
): Row {
  return { id, form, data, status, submittedAt, ipAddress: "203.0.113.9" };
}

describe("a submission's row", () => {
  const all = "/admin/collections/form-submissions";

  it("is titled by the form's name field, and opens with the first other text answer", () => {
    const row = submissionRow(
      submission(
        "s1",
        CONTACT.id,
        {
          fullName: "Ana Ruiz",
          email: "ana@example.com",
          message: "\n  Price list, please  \nThanks",
        },
        "2026-01-05T09:30:00.000Z"
      ),
      CONTACT,
      all
    );
    expect(row).toEqual({
      id: "s1",
      title: "Ana Ruiz",
      form: "Contact",
      excerpt: "Price list, please",
      at: "2026-01-05T09:30:00.000Z",
      href: `${all}/s1`,
    });
  });

  it("is titled by the email where the name was left empty", () => {
    const row = submissionRow(
      submission(
        "s2",
        CONTACT.id,
        { fullName: "  ", email: "sam@example.com", message: "Hi" },
        "2026-01-05T09:00:00.000Z"
      ),
      CONTACT,
      all
    );
    expect(row.title).toBe("sam@example.com");
    expect(row.excerpt).toBe("Hi");
  });

  it("reads a form's fields and a submission's answers stored as text", () => {
    const row = submissionRow(
      submission(
        "s3",
        NEWSLETTER.id,
        JSON.stringify({ address: "lee@example.com" }),
        "2026-01-05T08:00:00.000Z"
      ),
      NEWSLETTER,
      all
    );
    expect(row).toMatchObject({ title: "lee@example.com", form: "Newsletter" });
    expect(row).not.toHaveProperty("excerpt");
  });

  it('is "Submission" on a form with no name or email field, and the text answer still opens it', () => {
    const row = submissionRow(
      submission(
        "s4",
        SURVEY.id,
        { score: 9, comment: "Great" },
        "2026-01-05T07:00:00.000Z"
      ),
      SURVEY,
      all
    );
    expect(row).toMatchObject({
      title: "Submission",
      form: "Survey",
      excerpt: "Great",
    });
  });

  it("says only what the read answered: no answers, no form, no guess", () => {
    const row = submissionRow(
      { id: "s5", form: CONTACT.id, createdAt: "2026-01-05T06:00:00.000Z" },
      undefined,
      all
    );
    expect(row).toEqual({
      id: "s5",
      title: "Submission",
      at: "2026-01-05T06:00:00.000Z",
      href: `${all}/s5`,
    });
  });

  it("takes the first non-empty line of a text answer, and nothing from a value that is not text", () => {
    expect(firstLine("\n\n second\nthird")).toBe("second");
    expect(firstLine("   ")).toBeUndefined();
    expect(firstLine(42)).toBeUndefined();
  });

  it("carries at most 140 characters of an answer, cut with an ellipsis", () => {
    const long = `${"a".repeat(300)}xyz`;
    const row = submissionRow(
      submission(
        "s6",
        SURVEY.id,
        { comment: long },
        "2026-01-05T05:00:00.000Z"
      ),
      SURVEY,
      all
    );
    expect(row.excerpt).toBe(`${"a".repeat(140)}…`);
    // A line that fits is carried whole, with no ellipsis.
    expect(firstLine("a".repeat(140))).toBe("a".repeat(140));
    // Counted in characters: the emoji at the cut is kept whole, not halved.
    expect(firstLine(`${"a".repeat(139)}😀😀`)).toBe(`${"a".repeat(139)}😀…`);
  });

  it.each([
    ["firstName", "First"],
    ["first_name", "First"],
    ["q1", "Full name"],
    ["q2", "Your name"],
    ["q3", "Your full name"],
    ["YOUR-NAME", "Name please"],
  ])("is titled by a name field named %s, labelled %s", (fieldName, label) => {
    const form = {
      id: "f-named",
      name: "Named",
      fields: [
        { type: "email", name: "email", label: "Email" },
        { type: "text", name: fieldName, label },
        { type: "textarea", name: "message", label: "Message" },
      ],
    };
    const row = submissionRow(
      submission(
        "s7",
        form.id,
        {
          email: "kim@example.com",
          [fieldName]: "Kim Lee",
          message: "Hello",
        },
        "2026-01-05T04:00:00.000Z"
      ),
      form,
      all
    );
    expect(row).toMatchObject({ title: "Kim Lee", excerpt: "Hello" });
  });
});

describe("the card's read", () => {
  const forms = [CONTACT, NEWSLETTER, SURVEY];
  const submissions = [
    submission(
      "old",
      CONTACT.id,
      { fullName: "Old" },
      "2026-01-01T00:00:00.000Z"
    ),
    submission(
      "newest",
      SURVEY.id,
      { comment: "Hi" },
      "2026-01-03T00:00:00.000Z"
    ),
    submission(
      "middle",
      NEWSLETTER.id,
      { address: "m@example.com" },
      "2026-01-02T00:00:00.000Z"
    ),
    submission(
      "answered",
      CONTACT.id,
      { fullName: "Done" },
      "2026-01-04T00:00:00.000Z",
      "read"
    ),
    submission(
      "orphan",
      "f-unreadable",
      { fullName: "Hidden" },
      "2026-01-05T00:00:00.000Z"
    ),
  ];

  it("lists the new submissions of readable forms, newest first, as many as asked, with their total", async () => {
    const reads = services({ forms, submissions });
    const data = await readNewSubmissions(reads, COLLECTIONS, {
      limit: 2,
      submissionsPath: "leads",
    });
    expect(data.items.map(row => row.id)).toEqual(["newest", "middle"]);
    expect(data.total).toBe(3);
    expect(data.allHref).toBe("/admin/collections/leads");
    expect(data.collection).toBe("leads");
    expect(data.items[0]?.href).toBe("/admin/collections/leads/newest");
    // Only the fields a row is made from are asked for.
    const read = reads.calls.find(
      call => call.collection === COLLECTIONS.submissions
    );
    expect(read?.options.select).not.toContain("ipAddress");
    expect(read?.options.sort).toBe("-submittedAt");
  });

  it("counts for the header by the card's own read, asked for no rows", async () => {
    const widget = contributedWidget();
    const signal = new AbortController().signal;
    const reads = services({ forms, submissions });
    const data = await widget.load({
      services: reads,
      size: { w: 6, h: 8, tier: "medium" },
      signal,
    });
    const listed = reads.calls.filter(
      call => call.collection === COLLECTIONS.submissions
    );
    reads.calls.length = 0;
    const count = await widget.summary.count({ services: reads, signal });
    const counted = reads.calls.filter(
      call => call.collection === COLLECTIONS.submissions
    );
    expect(data.total).toBe(3);
    expect(count).toBe(data.total);
    // The very read the card made, filter, status and all, with no rows: a
    // count asked any other way could come to disagree with the card.
    expect(listed).toHaveLength(1);
    expect(counted).toEqual(
      listed.map(call => ({ ...call, options: { ...call.options, limit: 0 } }))
    );
  });

  it("has a total and no rows on a card too short to draw one", async () => {
    const data = await readNewSubmissions(
      services({ forms, submissions }),
      COLLECTIONS,
      { limit: 0, submissionsPath: "form-submissions" }
    );
    expect(data).toMatchObject({ items: [], total: 3 });
  });

  it("reads nothing more, and answers none, for a reader with no readable form", async () => {
    const reads = services({ forms: [], submissions });
    expect(
      await readNewSubmissions(reads, COLLECTIONS, {
        limit: 5,
        submissionsPath: "form-submissions",
      })
    ).toEqual({
      items: [],
      total: 0,
      allHref: "/admin/collections/form-submissions",
      collection: "form-submissions",
    });
    expect(
      reads.calls.filter(call => call.collection === "form-submissions")
    ).toEqual([]);
  });

  it("pages through every readable form, past one read's cap", async () => {
    const many = Array.from({ length: 120 }, (_, index) => ({
      id: `f-${String(index).padStart(3, "0")}`,
      name: `Form ${index}`,
      fields: [],
    }));
    const reads = services({ forms: many, submissions: [] });
    const ids = await readableFormIds(reads, COLLECTIONS.forms);
    expect(ids).toEqual(many.map(form => form.id));
    expect(reads.calls).toHaveLength(3);
  });
});

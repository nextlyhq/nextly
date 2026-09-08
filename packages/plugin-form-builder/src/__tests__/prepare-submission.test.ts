/**
 * A submission is brought to the form's shape at the write seam, so every
 * caller gets the same answer.
 *
 * `submitForm` transformed, validated and sanitized; `nextly.forms.submit()`
 * did none of it, so the same submission was stored two different ways
 * depending on which door it came through. These cover the shared rule and the
 * `beforeCreate` hook that applies it.
 */
import {
  createTestNextly,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  asPluginSubmission,
  prepareSubmission,
  takeSubmissionMarks,
} from "../handlers/prepare-submission";
import { formBuilder, prepareSubmissionForWrite } from "../plugin";
import type { AnyFormField } from "../types";

const fields = [
  { id: "1", name: "name", type: "text", label: "Name", required: true },
  { id: "2", name: "email", type: "email", label: "Email", required: true },
  { id: "3", name: "age", type: "number", label: "Age", required: false },
] as unknown as AnyFormField[];

describe("prepareSubmission", () => {
  it("keeps only the fields the form declares", () => {
    const { data } = prepareSubmission({
      data: { name: "Ada", email: "ada@example.com", isAdmin: true },
      fields,
      validate: true,
    });
    expect(data).toEqual({ name: "Ada", email: "ada@example.com" });
    // The control: the undeclared key really was in the input, so this is a
    // projection rather than an object that never had it.
    expect("isAdmin" in data).toBe(false);
  });

  it("strips markup from free-text fields", () => {
    const { data } = prepareSubmission({
      data: { name: "<script>alert(1)</script>Ada", email: "ada@example.com" },
      fields,
      validate: true,
    });
    expect(data.name).toBe("alert(1)Ada");
  });

  it("reports the form's own validation errors rather than storing", () => {
    const { validationErrors } = prepareSubmission({
      data: { name: "Ada", email: "not-an-email" },
      fields,
      validate: true,
    });
    expect(validationErrors).toBeDefined();
    expect(Object.keys(validationErrors ?? {})).toContain("email");
  });

  it("sanitizes without validating when the caller keeps the evidence", () => {
    // A honeypot hit is stored flagged rather than dropped, so a false positive
    // stays recoverable. Requiring it to be valid would throw away the thing
    // being reviewed; letting it keep its markup would store the one row nobody
    // validated with script tags intact.
    const { data, validationErrors } = prepareSubmission({
      data: { name: "<b>bot</b>", email: "not-an-email" },
      fields,
      validate: false,
    });
    expect(validationErrors).toBeUndefined();
    expect(data.name).toBe("bot");
    expect(data.email).toBe("not-an-email");
  });

  it("leaves a less-than sign that is not a tag alone", () => {
    // A `<` opens a tag only when what follows could name one. Treating every
    // `<` as a tag deleted from the middle of a visitor's own words, and this
    // sanitizer now runs on writes that were never sanitized before, so the
    // loss would have been silent and new.
    const { data } = prepareSubmission({
      data: {
        name: "2 < 3 and 5 > 4",
        email: "ada@example.com",
      },
      fields,
      validate: true,
    });
    expect(data.name).toBe("2 < 3 and 5 > 4");
  });

  it("still removes what a browser would read as a tag", () => {
    // The control for the test above: narrowing the pattern must not stop it
    // removing markup. Each of these is tag-open syntax, including the one
    // left unclosed at the end, which a browser completes rather than shows.
    const cases: Array<[string, string]> = [
      ["<b>bold</b>", "bold"],
      ["</p>closing", "closing"],
      ["hello <script", "hello"],
      ["<!-- comment -->text", "text"],
      ["<?php echo 1; ?>x", "x"],
      ["<IMG SRC=x onerror=alert(1)>done", "done"],
    ];
    for (const [input, expected] of cases) {
      const { data } = prepareSubmission({
        data: { name: input, email: "ada@example.com" },
        fields,
        validate: false,
      });
      expect(data.name).toBe(expected);
    }
  });

  it("judges the value it is about to store, not the one that arrived", () => {
    // `<b></b>` satisfied a required field and was then reduced to an empty
    // string, so the row stored a value the form's own schema rejects. A rule
    // that runs before sanitizing is a rule about a value nobody keeps.
    const { data, validationErrors } = prepareSubmission({
      data: { name: "<b></b>", email: "ada@example.com" },
      fields,
      validate: true,
    });
    expect(Object.keys(validationErrors ?? {})).toContain("name");
    expect(data.name).toBe("");
  });

  it("accepts a value that is only valid once the markup is gone", () => {
    // The control: the reorder must not turn sanitizing into a rejection
    // machine. Markup around real content still leaves a valid answer.
    const { data, validationErrors } = prepareSubmission({
      data: { name: "<b>Ada</b>", email: "ada@example.com" },
      fields,
      validate: true,
    });
    expect(validationErrors).toBeUndefined();
    expect(data.name).toBe("Ada");
  });

  it("is idempotent, which is what lets the hook run after the handler", () => {
    // The HTTP handler prepares, then the hook prepares again on the way to the
    // database. If that were not a no-op the two would fight, and the second
    // pass would be the one that decided what a visitor sent.
    const input = {
      name: "  <b>Ada</b>  ",
      email: "ada@example.com",
      age: "42",
      extra: "dropped",
    };
    const once = prepareSubmission({ data: input, fields, validate: true });
    const twice = prepareSubmission({
      data: once.data,
      fields,
      validate: true,
    });
    expect(twice.data).toEqual(once.data);
    expect(twice.validationErrors).toBeUndefined();
    // The control: the first pass really did change something, so equality
    // above is idempotence rather than two passes that both did nothing.
    expect(once.data).not.toEqual(input);
    expect(once.data.age).toBe(42);
  });
});

describe("the write-seam hook on submissions", () => {
  const formsSlug = "forms";

  const nextlyWith = (form: unknown) =>
    ({
      services: {
        collections: { findEntryById: vi.fn().mockResolvedValue(form) },
      },
      logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
    }) as never;

  const withForm = nextlyWith({ id: "form1", fields });

  it("prepares a submission the Direct API would have stored raw", async () => {
    const ctx = {
      data: {
        form: "form1",
        data: {
          name: "<script>x</script>Ada",
          email: "ada@example.com",
          isAdmin: true,
        },
        status: "new",
      },
      operation: "create",
    };

    const out = await prepareSubmissionForWrite(ctx, formsSlug, withForm);

    expect(out?.data).toEqual({ name: "xAda", email: "ada@example.com" });
    // The control: this is exactly what `nextly.forms.submit()` used to store,
    // and what it would still store if the hook were not registered.
    expect(ctx.data.data).not.toEqual({
      name: "<script>x</script>Ada",
      email: "ada@example.com",
      isAdmin: true,
    });
  });

  it("refuses a submission the form's own schema rejects", async () => {
    await expect(
      prepareSubmissionForWrite(
        {
          data: { form: "form1", data: { name: "Ada" }, status: "new" },
          operation: "create",
        },
        formsSlug,
        withForm
      )
    ).rejects.toThrow();
  });

  it("keeps a row the handler marked as evidence", async () => {
    // Sanitized, not rejected. A honeypot hit is stored flagged so a false
    // positive stays recoverable, and requiring it to be valid would throw away
    // the thing being reviewed.
    const ctx = {
      data: {
        form: "form1",
        data: { name: "<b>bot</b>", email: "not-an-email" },
        status: "spam",
      },
      operation: "create",
    };
    const out = await asPluginSubmission({ keepAsEvidence: true }, () =>
      prepareSubmissionForWrite(ctx, formsSlug, withForm)
    );
    expect((out?.data as Record<string, unknown>).name).toBe("bot");
    expect((out?.data as Record<string, unknown>).email).toBe("not-an-email");
  });

  it("does not let a caller switch validation off with status", async () => {
    // The submissions collection grants public create and nothing restricts
    // `status`, so reading leniency off the row let anyone post
    // `status: "spam"` and skip every required, type and enum rule on their own
    // submission. Leniency is a fact about the call now, and this call is not
    // marked.
    await expect(
      prepareSubmissionForWrite(
        {
          data: {
            form: "form1",
            data: { name: "Ada", email: "not-an-email" },
            status: "spam",
          },
          operation: "create",
        },
        formsSlug,
        withForm
      )
    ).rejects.toThrow();
  });

  it("refuses a payload that is not an object rather than storing none", async () => {
    // `data` is required on the collection, so an omitted payload is meant to
    // be refused. Substituting `{}` satisfied that check on the way past, and a
    // form whose fields are all optional then accepted it.
    for (const bad of [undefined, null, ["a"]]) {
      await expect(
        prepareSubmissionForWrite(
          {
            data: { form: "form1", data: bad, status: "new" },
            operation: "create",
          },
          formsSlug,
          withForm
        )
      ).rejects.toThrow();
    }
  });

  it("leaves an update alone, because its payload is a partial", async () => {
    // `beforeChange` runs for updates too. An admin changing a status sends no
    // payload, and preparing that would store an empty submission over a real
    // one.
    const ctx = {
      data: { form: "form1", status: "read" },
      operation: "update",
    };
    expect(await prepareSubmissionForWrite(ctx, formsSlug, withForm)).toBe(
      ctx.data
    );
  });

  it("checks an update that replaces the stored payload", async () => {
    // The create is checked and the update was not, so a caller who may edit a
    // submission could put undeclared keys, values the schema rejects and
    // markup into the row a moment after the create had refused them. The
    // patch need not repeat the relationship, so the stored row says which
    // form to check against.
    const ctx = {
      data: { data: { name: "<b>Ada</b>", email: "ada@example.com", x: 1 } },
      operation: "update",
      originalData: { id: "sub1", form: "form1" },
    };
    const out = await prepareSubmissionForWrite(ctx, formsSlug, withForm);
    expect(out?.data).toEqual({ name: "Ada", email: "ada@example.com" });
  });

  it("refuses an update whose replacement payload the schema rejects", async () => {
    await expect(
      prepareSubmissionForWrite(
        {
          data: { data: { name: "Ada", email: "not-an-email" } },
          operation: "update",
          originalData: { id: "sub1", form: "form1" },
        },
        formsSlug,
        withForm
      )
    ).rejects.toThrow();
  });

  it("uses the form the handler already read rather than reading it again", async () => {
    // Reading a form runs the forms collection's `afterRead` hooks, one of
    // which COUNTs that form's submissions, so a write was paying for a count
    // of every write before it.
    const nextly = nextlyWith({ id: "form1", fields });
    const out = await asPluginSubmission(
      { keepAsEvidence: false, form: { id: "form1", fields } },
      () =>
        prepareSubmissionForWrite(
          {
            data: {
              form: "form1",
              data: { name: "Ada", email: "ada@example.com" },
            },
            operation: "create",
          },
          formsSlug,
          nextly
        )
    );
    expect(out?.data).toEqual({ name: "Ada", email: "ada@example.com" });
    expect(
      (
        nextly as unknown as {
          services: {
            collections: { findEntryById: { mock: { calls: unknown[] } } };
          };
        }
      ).services.collections.findEntryById.mock.calls
    ).toHaveLength(0);
  });

  it("reads the form when the one handed over is a different form", async () => {
    // The control: a handed-over form is only ever used for the row that names
    // it, so a mismatch falls back to the read rather than checking a payload
    // against the wrong schema.
    const nextly = nextlyWith({ id: "form1", fields });
    await asPluginSubmission(
      { keepAsEvidence: false, form: { id: "other-form", fields: [] } },
      () =>
        prepareSubmissionForWrite(
          {
            data: {
              form: "form1",
              data: { name: "Ada", email: "ada@example.com" },
            },
            operation: "create",
          },
          formsSlug,
          nextly
        )
    );
    expect(
      (
        nextly as unknown as {
          services: {
            collections: { findEntryById: { mock: { calls: unknown[] } } };
          };
        }
      ).services.collections.findEntryById.mock.calls
    ).toHaveLength(1);
  });

  it("spends the evidence exception on the one write it was granted for", async () => {
    // `createEntry` does not resolve until its `afterCreate` hooks have run, so
    // a hook that writes a second submission runs inside the same store. The
    // second write must not inherit an exception granted to the first.
    await asPluginSubmission({ keepAsEvidence: true }, async () => {
      const kept = await prepareSubmissionForWrite(
        {
          data: {
            form: "form1",
            data: { name: "<b>bot</b>", email: "not-an-email" },
          },
          operation: "create",
        },
        formsSlug,
        withForm
      );
      expect((kept?.data as Record<string, unknown>).email).toBe(
        "not-an-email"
      );

      await expect(
        prepareSubmissionForWrite(
          {
            data: {
              form: "form1",
              data: { name: "Ada", email: "also-not-an-email" },
            },
            operation: "create",
          },
          formsSlug,
          withForm
        )
      ).rejects.toThrow();
    });
  });

  it("hands the marks to the first taker only", async () => {
    // The mechanism under the test above, stated directly.
    await asPluginSubmission({ keepAsEvidence: true }, () => {
      expect(takeSubmissionMarks()?.keepAsEvidence).toBe(true);
      expect(takeSubmissionMarks()).toBeUndefined();
    });
    // The control: outside a marked call there is nothing to take.
    expect(takeSubmissionMarks()).toBeUndefined();
  });

  it("refuses rather than emptying when the form cannot be read", async () => {
    // Transforming against no fields would project the submission down to `{}`
    // and store a row saying the visitor sent nothing.
    await expect(
      prepareSubmissionForWrite(
        {
          data: { form: "form1", data: { name: "Ada" }, status: "new" },
          operation: "create",
        },
        formsSlug,
        nextlyWith(null)
      )
    ).rejects.toThrow();
  });

  it("refuses a form whose fields are not a list", async () => {
    await expect(
      prepareSubmissionForWrite(
        {
          data: { form: "form1", data: { name: "Ada" }, status: "new" },
          operation: "create",
        },
        formsSlug,
        nextlyWith({ id: "form1", fields: undefined })
      )
    ).rejects.toThrow();
  });

  it("reads data that arrives as the JSON a dialect stores", async () => {
    const ctx = {
      data: {
        form: "form1",
        data: JSON.stringify({ name: "Ada", email: "ada@example.com" }),
        status: "new",
      },
      operation: "create",
    };
    const out = await prepareSubmissionForWrite(ctx, formsSlug, withForm);
    expect(out?.data).toEqual({ name: "Ada", email: "ada@example.com" });
  });

  it("refuses a data string that is not JSON, rather than storing nothing", async () => {
    await expect(
      prepareSubmissionForWrite(
        {
          data: { form: "form1", data: "not json", status: "new" },
          operation: "create",
        },
        formsSlug,
        withForm
      )
    ).rejects.toThrow();
  });

  it("leaves a row that names no form to the collection's own rule", async () => {
    // `form` is required on the collection, so it is refused a step later.
    // Rejecting here would answer a question this hook was not asked.
    const ctx = {
      data: { data: { name: "Ada" }, status: "new" },
      operation: "create",
    };
    const out = await prepareSubmissionForWrite(ctx, formsSlug, withForm);
    expect(out).toBe(ctx.data);
  });
});

describe("a submission written straight to the collection", () => {
  let current: TestNextly | undefined;

  afterEach(async () => {
    await current?.destroy();
    current = undefined;
  });

  // Asserting `hasHooks("beforeCreate", ...)` does NOT work here, and the
  // control is what said so: it answers true with this hook removed, because
  // `register-collection-hooks` maps a collection's declared `beforeValidate`
  // onto the `beforeCreate` phase and core registers a global sanitizer on
  // `beforeCreate` for every collection. So this boots the real thing and reads
  // the row instead.
  it("is transformed, sanitized and stored in the form's own shape", async () => {
    const { plugin } = formBuilder();
    current = await createTestNextly({ plugins: [plugin] });

    const form = await current.nextly.create({
      collection: "forms",
      data: {
        name: "Contact",
        slug: "contact",
        fields: [
          { type: "text", name: "message", label: "Message", required: true },
          { type: "number", name: "rating", label: "Rating" },
        ],
        status: "published",
      },
    });
    const formId = (form as { item: { id: string } }).item.id;

    // The write `nextly.forms.submit()` performs, with markup, an undeclared
    // key and a value needing coercion. Core's own sanitizer cannot reach any
    // of it: `data` is a `json` field and `json` is in its SKIP_FIELD_TYPES.
    const created = await current.nextly.create({
      collection: "form-submissions",
      data: {
        form: formId,
        data: {
          message: "<script>alert(1)</script>hello",
          rating: "5",
          isAdmin: true,
        },
        status: "new",
        submittedAt: new Date(),
      },
    });

    const id = (created as { item: { id: string } }).item.id;
    const stored = (await current.nextly.findByID({
      collection: "form-submissions",
      id,
    })) as { data?: unknown } | null;

    const payload =
      typeof stored?.data === "string"
        ? (JSON.parse(stored.data) as Record<string, unknown>)
        : (stored?.data as Record<string, unknown>);

    expect(payload).toEqual({ message: "alert(1)hello", rating: 5 });
  });

  it("refuses one the form's schema rejects, rather than storing it", async () => {
    const { plugin } = formBuilder();
    current = await createTestNextly({ plugins: [plugin] });

    const form = await current.nextly.create({
      collection: "forms",
      data: {
        name: "Contact",
        slug: "contact-2",
        fields: [
          { type: "email", name: "email", label: "Email", required: true },
        ],
        status: "published",
      },
    });
    const formId = (form as { item: { id: string } }).item.id;

    await expect(
      current.nextly.create({
        collection: "form-submissions",
        data: {
          form: formId,
          data: { email: "not-an-email" },
          status: "new",
          submittedAt: new Date(),
        },
      })
    ).rejects.toThrow();
  });
});

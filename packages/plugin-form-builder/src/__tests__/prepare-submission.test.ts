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

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
  submissionMarks,
} from "../handlers/prepare-submission";
import { validateSubmission } from "../handlers/submit-form";
import {
  formBuilder,
  injectSubmissionCount,
  prepareSubmissionForWrite,
} from "../plugin";
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

  it("does not build a tag out of what it removed", () => {
    // Removing the inner `<b>` puts its neighbours together: one pass over
    // `<<b>img src=x onerror=alert(1)>` returns `<img src=x onerror=alert(1)>`,
    // markup the sanitizer assembled itself. Narrowing the pattern to real tag
    // syntax is what made this reachable, so it arrived with the fix above it.
    for (const input of [
      "<<b>img src=x onerror=alert(1)>",
      "<<script>script>alert(1)</script>",
      "<<div>div onmouseover=alert(1)>hover",
    ]) {
      const { data } = prepareSubmission({
        data: { name: input, email: "ada@example.com" },
        fields,
        validate: false,
      });
      expect(data.name).not.toMatch(/<[a-zA-Z/!?]/);
    }
  });

  it("strips a hostile value in time proportional to its length", () => {
    // `<`*n + `b>` + `x>`*n exposes one tag per pass, so a rule that rescanned
    // until the text stopped changing did n passes over the whole string.
    // Measured on that rule: 15KB took 23ms, 30KB 70ms and 60KB 261ms, four
    // times the work for twice the input, while 360KB here takes about 9ms.
    // Both public write paths sanitize before any length rule applies, so the
    // difference is whose CPU an unauthenticated caller gets to spend.
    const n = 120_000;
    const hostile = "<".repeat(n) + "b>" + "x>".repeat(n);
    const { data } = prepareSubmission({
      data: { name: hostile, email: "ada@example.com" },
      fields,
      validate: false,
    });
    expect(String(data.name)).not.toMatch(/<[a-zA-Z/!?]/);
  }, 2000);

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

  const readsOf = (nextly: unknown) =>
    (
      nextly as {
        services: {
          collections: { findEntryById: { mock: { calls: unknown[] } } };
        };
      }
    ).services.collections.findEntryById.mock.calls;

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
      data: asPluginSubmission(
        {
          form: "form1",
          data: { name: "<b>bot</b>", email: "not-an-email" },
          status: "spam",
        },
        { keepAsEvidence: true }
      ),
      operation: "create",
    };
    const out = await prepareSubmissionForWrite(ctx, formsSlug, withForm);
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

  it("checks the stored payload when a submission moves to another form", async () => {
    // A patch that only changes the relationship carries no payload, so a rule
    // keyed on `data` alone let a caller move a submission onto any form and
    // leave behind a payload that form rejects.
    const otherForm = nextlyWith({
      id: "form2",
      fields: [
        { id: "9", name: "note", type: "text", label: "Note", required: true },
      ],
    });
    await expect(
      prepareSubmissionForWrite(
        {
          data: { form: "form2" },
          operation: "update",
          originalData: {
            id: "sub1",
            form: "form1",
            data: { name: "Ada", email: "ada@example.com" },
          },
        },
        formsSlug,
        otherForm
      )
    ).rejects.toThrow();
  });

  it("re-projects a moved submission onto the form it lands on", async () => {
    // The other half: the payload is brought to the new form's shape rather
    // than merely judged against it, so a key that form does not declare is
    // dropped instead of staying in a row that now belongs elsewhere.
    const otherForm = nextlyWith({
      id: "form2",
      fields: [
        { id: "9", name: "name", type: "text", label: "Name", required: true },
      ],
    });
    const out = await prepareSubmissionForWrite(
      {
        data: { form: "form2" },
        operation: "update",
        originalData: {
          id: "sub1",
          form: "form1",
          data: { name: "<b>Ada</b>", email: "ada@example.com" },
        },
      },
      formsSlug,
      otherForm
    );
    expect(out?.data).toEqual({ name: "Ada" });
  });

  it("stamps a payload the move itself changed", async () => {
    // Moving a submission re-projects its answers onto the new form's fields
    // and can drop one that form does not declare. The stamp on `beforeUpdate`
    // has already run by then and only marks a patch that arrived with `data`,
    // so the visitor's stored answers changed with nothing saying who did it.
    const otherForm = nextlyWith({
      id: "form2",
      fields: [
        { id: "9", name: "name", type: "text", label: "Name", required: true },
      ],
    });
    const out = await prepareSubmissionForWrite(
      {
        data: { form: "form2" },
        operation: "update",
        user: { id: "admin1" },
        originalData: {
          id: "sub1",
          form: "form1",
          data: { name: "Ada", email: "ada@example.com" },
        },
      },
      formsSlug,
      otherForm
    );
    expect(out?.data).toEqual({ name: "Ada" });
    expect(out?.editedBy).toBe("admin1");
    expect(out?.editedAt).toBeInstanceOf(Date);
  });

  it("does not stamp a derived payload that did not change", async () => {
    // The control: a row leaving spam whose answers already satisfy the form is
    // not an edit, and stamping it would put a name against a change nobody
    // made.
    const out = await prepareSubmissionForWrite(
      {
        data: { status: "new" },
        operation: "update",
        user: { id: "admin1" },
        originalData: {
          id: "sub1",
          form: "form1",
          status: "spam",
          data: { name: "Ada", email: "ada@example.com" },
        },
      },
      formsSlug,
      withForm
    );
    expect(out?.editedAt).toBeUndefined();
    expect(out?.editedBy).toBeUndefined();
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
    const out = await prepareSubmissionForWrite(
      {
        data: asPluginSubmission(
          { form: "form1", data: { name: "Ada", email: "ada@example.com" } },
          { keepAsEvidence: false, form: { id: "form1", fields } }
        ),
        operation: "create",
      },
      formsSlug,
      nextly
    );
    expect(out?.data).toEqual({ name: "Ada", email: "ada@example.com" });
    expect(readsOf(nextly)).toHaveLength(0);
  });

  it("reads the form when the one handed over is a different form", async () => {
    // The control: a handed-over form is only ever used for the row that names
    // it, so a mismatch falls back to the read rather than checking a payload
    // against the wrong schema.
    const nextly = nextlyWith({ id: "form1", fields });
    await prepareSubmissionForWrite(
      {
        data: asPluginSubmission(
          { form: "form1", data: { name: "Ada", email: "ada@example.com" } },
          { keepAsEvidence: false, form: { id: "other-form", fields: [] } }
        ),
        operation: "create",
      },
      formsSlug,
      nextly
    );
    expect(readsOf(nextly)).toHaveLength(1);
  });

  it("gives the exception to its own row and to no other", async () => {
    // The exception belongs to a row, not to a call. A hook registered before
    // this plugin runs ahead of its handler and a hook running after it can
    // write another submission, and both used to reach an exception granted
    // elsewhere: first by arriving first, then by carrying the same answers.
    const evidence = asPluginSubmission(
      {
        form: "form1",
        data: { name: "<b>bot</b>", email: "not-an-email" },
        status: "spam",
      },
      { keepAsEvidence: true }
    );

    // Another row written in the same call, with the same answers on the same
    // form under the same status. Everything about its content matches, and it
    // is still validated, because the mark is not on it.
    await expect(
      prepareSubmissionForWrite(
        {
          data: {
            form: "form1",
            data: { name: "<b>bot</b>", email: "not-an-email" },
            status: "spam",
          },
          operation: "create",
        },
        formsSlug,
        withForm
      )
    ).rejects.toThrow();

    // And the row the exception was granted for still has it, whichever order
    // the two are written in.
    const kept = await prepareSubmissionForWrite(
      { data: evidence, operation: "create" },
      formsSlug,
      withForm
    );
    expect((kept?.data as Record<string, unknown>).email).toBe("not-an-email");
  });

  it("survives the payload being rewritten before the seam sees it", async () => {
    // A host hook can normalise `data` in an earlier phase. Identifying the row
    // by its content meant the intended row stopped matching its own mark and
    // was refused, which for a honeypot hit is a visible failure where the
    // whole point is that the bot cannot tell.
    const row = asPluginSubmission(
      {
        form: "form1",
        data: { name: "<b>bot</b>", email: "not-an-email" },
        status: "spam",
      },
      { keepAsEvidence: true }
    );
    row.data = { name: "rewritten by a host hook", email: "still-not-email" };
    const out = await prepareSubmissionForWrite(
      { data: row, operation: "create" },
      formsSlug,
      withForm
    );
    expect((out?.data as Record<string, unknown>).email).toBe(
      "still-not-email"
    );
  });

  it("cannot be asked for from a request body", async () => {
    // The reason it is a symbol. A caller posts JSON, and `JSON.parse` never
    // produces a symbol key, so no request can carry this mark however it is
    // spelled.
    const posted = JSON.parse(
      JSON.stringify({
        form: "form1",
        data: { name: "bot", email: "not-an-email" },
        status: "spam",
        keepAsEvidence: true,
        "Symbol(nextly.plugin-form-builder.submission)": {
          keepAsEvidence: true,
        },
      })
    ) as Record<string, unknown>;
    expect(submissionMarks(posted)).toBeUndefined();
    await expect(
      prepareSubmissionForWrite(
        { data: posted, operation: "create" },
        formsSlug,
        withForm
      )
    ).rejects.toThrow();
  });

  it("checks an evidence row on its way out of spam", async () => {
    // A spam row is stored without being validated so a false positive stays
    // reviewable. "Not spam" sends only a status, and letting that through
    // unchecked turned a payload the form rejects into a counted submission.
    await expect(
      prepareSubmissionForWrite(
        {
          data: { status: "new", spamReason: null },
          operation: "update",
          originalData: {
            id: "sub1",
            form: "form1",
            status: "spam",
            data: { name: "bot", email: "not-an-email" },
          },
        },
        formsSlug,
        withForm
      )
    ).rejects.toThrow();
  });

  it("lets a valid evidence row out of spam", async () => {
    // The control: the check must not make every false positive unrecoverable.
    const out = await prepareSubmissionForWrite(
      {
        data: { status: "new" },
        operation: "update",
        originalData: {
          id: "sub1",
          form: "form1",
          status: "spam",
          data: { name: "Ada", email: "ada@example.com" },
        },
      },
      formsSlug,
      withForm
    );
    expect(out?.status).toBe("new");
    expect(out?.data).toEqual({ name: "Ada", email: "ada@example.com" });
  });

  it("leaves a status change between two non-spam values alone", async () => {
    // The second control: the check is about leaving spam, not about statuses.
    const ctx = {
      data: { status: "read" },
      operation: "update",
      originalData: {
        id: "sub1",
        form: "form1",
        status: "new",
        data: { name: "Ada", email: "ada@example.com" },
      },
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

describe("the preflight check and the write seam", () => {
  const storedForm = {
    id: "form1",
    slug: "contact",
    fields,
    status: "published",
  };
  const context = {
    pluginContext: {
      services: {
        collections: {
          listEntries: vi.fn().mockResolvedValue({ data: [storedForm] }),
        },
      },
    },
    pluginConfig: { formOverrides: { slug: "forms" } },
  } as never;

  it("agree about a value that is only markup", async () => {
    // `validateSubmission` restated transform-then-validate, so it judged the
    // unsanitized value while the write seam judges the sanitized one. A client
    // was told `<b></b>` satisfied a required field and the write then refused
    // it.
    const preflight = await validateSubmission(
      "contact",
      { name: "<b></b>", email: "ada@example.com" },
      context
    );
    const atTheSeam = prepareSubmission({
      data: { name: "<b></b>", email: "ada@example.com" },
      fields,
      validate: true,
    });
    expect(preflight.valid).toBe(false);
    expect(Object.keys(preflight.errors ?? {})).toEqual(
      Object.keys(atTheSeam.validationErrors ?? {})
    );
  });

  it("agree about a value that is valid once the markup is gone", async () => {
    // The control: the two agreeing must not be two refusals of everything.
    const preflight = await validateSubmission(
      "contact",
      { name: "<b>Ada</b>", email: "ada@example.com" },
      context
    );
    expect(preflight.valid).toBe(true);
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

  it("carries a marked row's exception through core to the seam", async () => {
    // The mark is a symbol on the row, and core rebuilds a row on its way to
    // the hook, so this is the assertion that says the symbol survives that
    // journey. Everything about the evidence path rests on it, and if core ever
    // stops carrying unknown symbol keys this fails rather than quietly
    // validating a honeypot hit and answering the bot with an error.
    const { plugin } = formBuilder();
    current = await createTestNextly({ plugins: [plugin] });

    const form = await current.nextly.create({
      collection: "forms",
      data: {
        name: "Contact",
        slug: "contact-3",
        fields: [
          { type: "email", name: "email", label: "Email", required: true },
        ],
        status: "published",
      },
    });
    const formId = (form as { item: { id: string } }).item.id;
    const row = () => ({
      form: formId,
      data: { email: "not-an-email" },
      status: "spam" as const,
      submittedAt: new Date(),
    });

    const created = await current.nextly.create({
      collection: "form-submissions",
      data: asPluginSubmission(row(), { keepAsEvidence: true }),
    });
    expect((created as { item: { id: string } }).item.id).toBeTruthy();

    // The control: the same row, unmarked, is refused. Without it the test
    // would pass on a collection that never validated anything.
    await expect(
      current.nextly.create({ collection: "form-submissions", data: row() })
    ).rejects.toThrow();
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

describe("the submission count on a form read", () => {
  const nextlyCounting = () => {
    const count = vi.fn().mockResolvedValue(7);
    return {
      count,
      nextly: { services: { collections: { count } } } as never,
    };
  };

  it("counts on an ordinary read", async () => {
    const { count, nextly } = nextlyCounting();
    const form: Record<string, unknown> = { id: "form1" };
    await injectSubmissionCount({ data: form }, "form-submissions", nextly);
    expect(form.submissionCount).toBe(7);
    expect(count).toHaveBeenCalledTimes(1);
  });

  it("skips the count when the read asked for the schema alone", async () => {
    // A submission write reads its parent form only to check the payload
    // against that form's fields. Counting there is presentation work nobody on
    // that path reads, and it grows with the form's history, so every
    // submission was paying for a count of every submission before it.
    const { count, nextly } = nextlyCounting();
    const form: Record<string, unknown> = { id: "form1" };
    await injectSubmissionCount(
      { data: form, context: { "formBuilder.schemaOnlyRead": true } },
      "form-submissions",
      nextly
    );
    expect(count).toHaveBeenCalledTimes(0);
    expect(form.submissionCount).toBeUndefined();
  });

  it("counts every form a list read returned", async () => {
    // The control for the two above: `afterRead` fires for single reads and for
    // list reads, so a rule that only handled one shape would pass the first
    // test and do nothing here.
    const { count, nextly } = nextlyCounting();
    const forms = [{ id: "a" }, { id: "b" }] as Record<string, unknown>[];
    await injectSubmissionCount({ data: forms }, "form-submissions", nextly);
    expect(count).toHaveBeenCalledTimes(2);
    expect(forms.map(f => f.submissionCount)).toEqual([7, 7]);
  });
});

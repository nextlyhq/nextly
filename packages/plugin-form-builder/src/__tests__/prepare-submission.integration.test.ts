/**
 * The submission write seam, proven against a real Nextly instance.
 *
 * Each case boots core through `createTestNextly` and reads the stored row
 * back, because the rule under test is applied by a `beforeCreate` hook that a
 * spy cannot stand in for: `register-collection-hooks` maps a collection's
 * declared `beforeValidate` onto that phase, and core registers a global
 * sanitizer on it for every collection, so asserting the hook is registered
 * answers true whether or not this plugin put it there.
 *
 * Booting an instance is also why these sit in an `.integration.test.ts` file
 * rather than beside the pure cases in `prepare-submission.test.ts`. The unit
 * config excludes that suffix and the integration config claims it, so a boot
 * runs on the lane whose budget is sized for one and whose files do not run in
 * parallel with the rest of the monorepo.
 */
import {
  createTestNextly,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { afterEach, describe, expect, it } from "vitest";

import { asPluginSubmission } from "../handlers/prepare-submission";
import { formBuilder } from "../plugin";

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

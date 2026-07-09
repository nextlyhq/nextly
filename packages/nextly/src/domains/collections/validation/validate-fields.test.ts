import { describe, it, expect } from "vitest";

import {
  validateFields,
  type ValidatableField,
  type ValidateFieldsOptions,
} from "./validate-fields";

const req = {} as ValidateFieldsOptions["req"];

function opts(
  over: Partial<ValidateFieldsOptions> = {}
): ValidateFieldsOptions {
  return {
    isCreate: true,
    localizedFieldNames: new Set<string>(),
    enforceLocalizedRequired: true,
    req,
    ...over,
  };
}

describe("validateFields — required", () => {
  const titleReq: ValidatableField[] = [
    { name: "title", type: "text", required: true },
  ];

  it("errors when a required field is missing on create", async () => {
    const errs = await validateFields(titleReq, {}, opts());
    expect(errs).toEqual([{ field: "title", message: "title is required" }]);
  });

  it("passes when the required field is present and non-blank", async () => {
    const errs = await validateFields(titleReq, { title: "Hi" }, opts());
    expect(errs).toEqual([]);
  });

  it("errors when a required field is blank (empty string)", async () => {
    const errs = await validateFields(titleReq, { title: "" }, opts());
    expect(errs).toHaveLength(1);
  });

  it("on update, an omitted required field is NOT checked (stored value stands)", async () => {
    const errs = await validateFields(
      titleReq,
      {},
      opts({ isCreate: false })
    );
    expect(errs).toEqual([]);
  });

  it("on update, explicitly blanking a required field errors", async () => {
    const errs = await validateFields(
      titleReq,
      { title: "" },
      opts({ isCreate: false })
    );
    expect(errs).toHaveLength(1);
  });

  it("uses the field label in the message when present", async () => {
    const errs = await validateFields(
      [{ name: "title", type: "text", label: "Title", required: true }],
      {},
      opts()
    );
    expect(errs[0].message).toBe("Title is required");
  });
});

describe("validateFields — language-aware required", () => {
  const localizedReq: ValidatableField[] = [
    { name: "heading", type: "text", required: true },
  ];
  const localized = new Set(["heading"]);

  it("enforces a localized required field for the default-locale row", async () => {
    const errs = await validateFields(
      localizedReq,
      {},
      opts({ localizedFieldNames: localized, enforceLocalizedRequired: true })
    );
    expect(errs).toHaveLength(1);
  });

  it("allows a blank localized required field for a NON-default locale (falls back)", async () => {
    const errs = await validateFields(
      localizedReq,
      {},
      opts({ localizedFieldNames: localized, enforceLocalizedRequired: false })
    );
    expect(errs).toEqual([]);
  });

  it("still enforces a SHARED required field even when localized-required is off", async () => {
    const errs = await validateFields(
      [{ name: "sku", type: "text", required: true }],
      {},
      opts({ localizedFieldNames: localized, enforceLocalizedRequired: false })
    );
    expect(errs).toHaveLength(1); // sku is not localized → always required
  });
});

describe("validateFields — format / range / custom", () => {
  it("errors on pattern mismatch and uses the custom message", async () => {
    const errs = await validateFields(
      [
        {
          name: "slug",
          type: "text",
          validation: { pattern: "^[a-z-]+$", message: "Lowercase only" },
        },
      ],
      { slug: "Bad Slug" },
      opts()
    );
    expect(errs).toEqual([{ field: "slug", message: "Lowercase only" }]);
  });

  it("enforces minLength / maxLength on strings", async () => {
    const short = await validateFields(
      [{ name: "t", type: "text", validation: { minLength: 3 } }],
      { t: "ab" },
      opts()
    );
    expect(short).toHaveLength(1);
    const long = await validateFields(
      [{ name: "t", type: "text", validation: { maxLength: 2 } }],
      { t: "abc" },
      opts()
    );
    expect(long).toHaveLength(1);
  });

  it("enforces min / max on numbers", async () => {
    const errs = await validateFields(
      [{ name: "n", type: "number", validation: { min: 1, max: 10 } }],
      { n: 20 },
      opts()
    );
    expect(errs).toHaveLength(1);
  });

  it("runs the custom validate function and surfaces its message", async () => {
    const errs = await validateFields(
      [
        {
          name: "x",
          type: "text",
          validate: v => (v === "ok" ? true : "must be ok"),
        },
      ],
      { x: "no" },
      opts()
    );
    expect(errs).toEqual([{ field: "x", message: "must be ok" }]);
  });

  it("skips format checks on blank optional values", async () => {
    const errs = await validateFields(
      [{ name: "t", type: "text", validation: { minLength: 3 } }],
      { t: "" },
      opts()
    );
    expect(errs).toEqual([]);
  });

  it("ignores layout-only field types", async () => {
    const errs = await validateFields(
      [{ name: "divider", type: "ui", required: true }],
      {},
      opts()
    );
    expect(errs).toEqual([]);
  });
});

/**
 * Every access rule may be a function or a boolean, and an access key the
 * config validator does not know is refused at startup, naming it.
 *
 * The rule types and the documentation have always allowed `read: true`; the
 * validator refused it, and never looked at `publish`, `unpublish` or a
 * field's rules at all, so a misspelt key (`reed`) was accepted in silence and
 * the operation it meant to govern fell back to stored permissions.
 */
import { describe, expect, expectTypeOf, it } from "vitest";

import {
  COLLECTION_ACCESS_KEYS,
  FIELD_ACCESS_KEYS,
  SINGLE_ACCESS_KEYS,
} from "../../../shared/base-validator";
import type {
  CollectionAccessControl,
  SingleAccessControl,
} from "../../../shared/types/access";
import { validateFieldGroupConfig } from "../../../field-groups/config/validate-field-group";
import { validateSingleConfig } from "../../../singles/config/validate-single";
import type { FieldAccess } from "../../fields/types/base";
import type { SingleConfig } from "../../../singles/config/types";
import { defineCollection } from "../define-collection";
import type { CollectionConfig } from "../define-collection";
import { validateCollectionConfig } from "../validate-config";

const title = { type: "text" as const, name: "title" };

function collection(
  access: unknown,
  fields: unknown[] = [title]
): CollectionConfig {
  return { slug: "posts", fields, access } as unknown as CollectionConfig;
}

function single(access: unknown): SingleConfig {
  return {
    slug: "site-settings",
    fields: [title],
    access,
  } as unknown as SingleConfig;
}

describe("the access keys the validator knows", () => {
  it("are every rule each access type declares", () => {
    // A rule added to a type and not to its list would be refused at startup
    // as unknown; these fail to compile first.
    expectTypeOf<
      Exclude<
        keyof CollectionAccessControl,
        (typeof COLLECTION_ACCESS_KEYS)[number]
      >
    >().toBeNever();
    expectTypeOf<
      Exclude<keyof SingleAccessControl, (typeof SINGLE_ACCESS_KEYS)[number]>
    >().toBeNever();
    expectTypeOf<
      Exclude<keyof FieldAccess, (typeof FIELD_ACCESS_KEYS)[number]>
    >().toBeNever();
  });
});

const codes = (result: { errors: { code: string; path: string }[] }) =>
  result.errors.map(({ code, path }) => ({ code, path }));

describe("a collection's access rules", () => {
  it("may each be true, false or a function", () => {
    const result = validateCollectionConfig(
      collection({
        create: true,
        read: false,
        update: () => true,
        delete: true,
        publish: false,
        unpublish: () => false,
      })
    );
    expect(codes(result)).toEqual([]);
  });

  it("refuses a key it does not know, naming it", () => {
    const result = validateCollectionConfig(collection({ reed: () => true }));
    expect(codes(result)).toEqual([
      { code: "ACCESS_KEY_UNKNOWN", path: "access.reed" },
    ]);
    expect(result.errors[0]!.message).toContain("'reed'");
    expect(result.errors[0]!.message).toContain("read");
  });

  it("refuses a rule that is neither a function nor a boolean", () => {
    const result = validateCollectionConfig(collection({ read: "yes" }));
    expect(codes(result)).toEqual([
      { code: "ACCESS_FUNCTION_INVALID", path: "access.read" },
    ]);
  });

  it("is refused at startup, naming the key, when one is misspelt", () => {
    expect(() =>
      defineCollection({
        slug: "posts",
        fields: [title],
        access: { reed: () => true } as never,
      })
    ).toThrow(/reed/);
  });
});

describe("a Single's access rules", () => {
  it("may each be true, false or a function", () => {
    const result = validateSingleConfig(
      single({
        read: true,
        update: false,
        publish: () => true,
        unpublish: false,
      })
    );
    expect(codes(result)).toEqual([]);
  });

  it("refuses a key a Single does not have, naming it", () => {
    const result = validateSingleConfig(single({ delete: true }));
    expect(codes(result)).toEqual([
      { code: "ACCESS_KEY_UNKNOWN", path: "access.delete" },
    ]);
    expect(result.errors[0]!.message).toContain("'delete'");
  });
});

describe("a field's access rules", () => {
  it("may each be true, false or a function", () => {
    const result = validateCollectionConfig(
      collection(undefined, [
        title,
        {
          type: "text",
          name: "secret",
          access: { create: true, read: false, update: () => true },
        },
      ])
    );
    expect(codes(result)).toEqual([]);
  });

  it("refuses a key it does not know, naming it and the field", () => {
    const result = validateCollectionConfig(
      collection(undefined, [
        title,
        { type: "text", name: "secret", access: { raed: false } },
      ])
    );
    expect(codes(result)).toEqual([
      { code: "ACCESS_KEY_UNKNOWN", path: "fields[1].access.raed" },
    ]);
    expect(result.errors[0]!.message).toContain("'raed'");
  });

  it("refuses a rule that is neither a function nor a boolean", () => {
    const result = validateCollectionConfig(
      collection(undefined, [
        title,
        { type: "text", name: "secret", access: { read: "no" } },
      ])
    );
    expect(codes(result)).toEqual([
      { code: "ACCESS_FUNCTION_INVALID", path: "fields[1].access.read" },
    ]);
  });

  it("checks a field nested in a group too", () => {
    const result = validateCollectionConfig(
      collection(undefined, [
        title,
        {
          type: "group",
          name: "meta",
          fields: [{ type: "text", name: "note", access: { reed: true } }],
        },
      ])
    );
    expect(codes(result).map(e => e.code)).toEqual(["ACCESS_KEY_UNKNOWN"]);
    expect(codes(result)[0]!.path).toContain("access.reed");
  });

  it("may each be true, false or a function on a field group's field", () => {
    const result = validateFieldGroupConfig({
      slug: "seo",
      fields: [
        {
          type: "text",
          name: "secret",
          access: { create: true, read: false, update: () => true },
        },
      ],
    } as never);
    expect(result.errors).toEqual([]);
  });

  it("checks a field group's fields as well", () => {
    const result = validateFieldGroupConfig({
      slug: "seo",
      fields: [{ type: "text", name: "secret", access: { reed: true } }],
    } as never);
    expect(result.errors.map(e => e.code)).toEqual(["ACCESS_KEY_UNKNOWN"]);
  });

  it("checks a Single's fields as well", () => {
    const result = validateSingleConfig({
      slug: "site-settings",
      fields: [{ type: "text", name: "secret", access: { reed: true } }],
    } as unknown as SingleConfig);
    expect(codes(result).map(e => e.code)).toEqual(["ACCESS_KEY_UNKNOWN"]);
  });
});

/**
 * The compile-time half of a read rule that answers a filter: the filter is
 * typed by the collection's own fields, so a misspelt field or operator, or
 * an operand of the wrong kind, fails to compile; only a collection's read
 * rule may answer one; and a collection whose field names the checker cannot
 * know, or a config written before filters were typed, compiles as it did.
 *
 * Each `@ts-expect-error` sits alone above the one line that can fail, the
 * rule it names, so it cannot be satisfied by an unrelated error.
 */
import { expectTypeOf } from "vitest";

import { defineCollection } from "../../collections/config/define-collection";
import type {
  CollectionConfig,
  CollectionConfigInput,
} from "../../collections/config/define-collection";
import {
  checkbox,
  date,
  group,
  number,
  relationship,
  richText,
  select,
  text,
} from "../../collections/fields/helpers";
import type {
  FieldAccess,
  FieldConfig,
  TextFieldConfig,
} from "../../collections/fields/types";
import { defineSingle } from "../../singles/config/define-single";

import type { AccessControlFunction, CollectionAccessControl } from "./access";
import type {
  CollectionFilterRule,
  CollectionRuleFilter,
  UntypedRuleFilter,
} from "./rule-filter";

// ---------------------------------------------------------------------------
// What compiled before compiles as it did
// ---------------------------------------------------------------------------

// A factory keeps the name as written, and its config is still the field's
// own type, so a declaration annotated with it compiles.
expectTypeOf(text({ name: "team" }).name).toEqualTypeOf<"team">();
const annotated: TextFieldConfig = text({ name: "team" });
const declared: FieldConfig[] = [annotated, number({ name: "rank" })];

// A name the checker cannot know is a string, as it was.
declare const builtAtRuntime: string;
expectTypeOf(text({ name: builtAtRuntime }).name).toEqualTypeOf<string>();

// The config defineCollection returns is the type it always returned.
expectTypeOf(
  defineCollection({ slug: "plain", fields: [text({ name: "team" })] })
).toEqualTypeOf<CollectionConfig>();

// A config annotated with the input type, its rule answering true or false,
// is taken as it was.
const legacy: CollectionConfigInput = {
  slug: "legacy",
  fields: declared,
  access: { read: ({ roles }) => roles.includes("editor"), update: false },
};
defineCollection(legacy);

// A read rule declared on its own, typed as a rule always was, is taken too.
const editorsRead = ({ roles }: { roles: string[] }): boolean =>
  roles.includes("editor");
defineCollection({
  slug: "posts",
  fields: [text({ name: "team" })],
  access: { read: editorsRead },
});

// Where the names are unknown, the filter is untyped, as general as the
// stored rule type: fields annotated as the general type, or a name built at
// runtime.
expectTypeOf<CollectionRuleFilter>().toEqualTypeOf<UntypedRuleFilter>();
expectTypeOf<
  CollectionRuleFilter<FieldConfig[]>
>().toEqualTypeOf<UntypedRuleFilter>();
expectTypeOf<
  CollectionRuleFilter<[ReturnType<typeof text<string>>]>
>().toEqualTypeOf<UntypedRuleFilter>();
defineCollection({
  slug: "general",
  fields: declared,
  access: { read: () => ({ anything: { equals: 1 } }) },
});

// The stored rule type holds a typed rule: the config defineCollection
// returns keeps the rule it was given.
expectTypeOf<
  CollectionFilterRule<[ReturnType<typeof text<"team">>]>
>().toExtend<Extract<CollectionAccessControl["read"], CollectionFilterRule>>();

// A rule of either form every operation accepts is still a create, update,
// delete and read rule: the type to use for "any rule", now that the read
// rule's own type also holds a rule answering a filter.
declare const anyRule: AccessControlFunction | boolean;
const everyOperation: CollectionAccessControl = {
  create: anyRule,
  read: anyRule,
  update: anyRule,
  delete: anyRule,
};
expectTypeOf(everyOperation).toEqualTypeOf<CollectionAccessControl>();

// ---------------------------------------------------------------------------
// The filter is typed by the collection's fields
// ---------------------------------------------------------------------------

const fields = [
  text({ name: "team" }),
  number({ name: "rank" }),
  checkbox({ name: "open" }),
  date({ name: "due" }),
  select({ name: "tier", options: [{ label: "Gold", value: "gold" }] }),
  relationship({ name: "owner", relationTo: "users" }),
  richText({ name: "body" }),
  group({ name: "seo", fields: [text({ name: "title" })] }),
];

// Each kind of field, by its own operators and operands, a shorthand value,
// the system fields, and conditions combined.
defineCollection({
  slug: "typed",
  fields,
  access: {
    read: ({ user }) =>
      user === null
        ? false
        : {
            team: { equals: "a", in: ["a", "b"], contains: "a" },
            rank: { greater_than: 2, not_in: [9] },
            open: true,
            due: { less_than: new Date(), exists: true },
            tier: "gold",
            owner: { in: [user.id, 2] },
            createdBy: { equals: String(user.id) },
            createdAt: { greater_than_equal: "2026-01-01" },
            or: [{ id: { in: [1, "2"] } }, { and: [{ slug: { like: "a%" } }] }],
          },
  },
});

// A rule that looks something up before it answers.
declare function teamOf(userId: string | number): Promise<string>;
defineCollection({
  slug: "async",
  fields,
  access: {
    read: async ({ user }) =>
      user ? { team: { equals: await teamOf(user.id) } } : false,
  },
});

defineCollection({
  slug: "wrong",
  fields,
  access: {
    // @ts-expect-error `teem` is not a field: a misspelt field alone
    read: () => ({ teem: { equals: "a" } }),
  },
});
defineCollection({
  slug: "wrong",
  fields,
  access: {
    // @ts-expect-error `teem` is not a field: misspelt beside a correct one
    read: () => ({ team: "a", teem: "b" }),
  },
});
defineCollection({
  slug: "wrong",
  fields,
  access: {
    // @ts-expect-error `teem` is not a field: misspelt in an async rule
    read: async () => ({ team: "a", teem: "b" }),
  },
});
defineCollection({
  slug: "wrong",
  fields,
  access: {
    // @ts-expect-error `teem` is not a field: misspelt inside `or`
    read: () => ({ or: [{ team: "a" }, { teem: "b" }] }),
  },
});
defineCollection({
  slug: "wrong",
  fields,
  access: {
    // @ts-expect-error `equal` is not an operator: misspelt alone
    read: () => ({ team: { equal: "a" } }),
  },
});
defineCollection({
  slug: "wrong",
  fields,
  access: {
    // @ts-expect-error `equal` is not an operator: misspelt beside `equals`
    read: () => ({ team: { equals: "a", equal: "b" } }),
  },
});
defineCollection({
  slug: "wrong",
  fields,
  access: {
    // @ts-expect-error a number field compared with a string
    read: () => ({ rank: { equals: "2" } }),
  },
});
defineCollection({
  slug: "wrong",
  fields,
  access: {
    // @ts-expect-error a checkbox has no order
    read: () => ({ open: { greater_than: true } }),
  },
});
defineCollection({
  slug: "wrong",
  fields,
  access: {
    // @ts-expect-error a number field is not matched as text
    read: () => ({ rank: { contains: "2" } }),
  },
});
defineCollection({
  slug: "wrong",
  fields,
  access: {
    // @ts-expect-error a region is refused in a rule's filter
    read: () => ({ team: { near: "1,2,3" } }),
  },
});
defineCollection({
  slug: "wrong",
  fields,
  access: {
    // @ts-expect-error rich text is not a filter key
    read: () => ({ body: { equals: "a" } }),
  },
});
defineCollection({
  slug: "wrong",
  fields,
  access: {
    // @ts-expect-error a path into a group is not typed yet
    read: () => ({ "seo.title": { equals: "a" } }),
  },
});

// ---------------------------------------------------------------------------
// Only a collection's read rule may answer a filter
// ---------------------------------------------------------------------------

defineCollection({
  slug: "wrong",
  fields,
  access: {
    // @ts-expect-error a create rule answers true or false
    create: () => ({ team: "a" }),
  },
});
defineCollection({
  slug: "wrong",
  fields,
  access: {
    // @ts-expect-error an update rule answers true or false, for now
    update: () => ({ team: "a" }),
  },
});
defineSingle({
  slug: "settings",
  fields: [text({ name: "team" })],
  access: {
    // @ts-expect-error a Single's rule answers true or false
    read: () => ({ team: "a" }),
  },
});
const fieldRead: FieldAccess = {
  // @ts-expect-error a field's rule answers true or false
  read: () => ({ team: "a" }),
};
expectTypeOf(fieldRead).toEqualTypeOf<FieldAccess>();

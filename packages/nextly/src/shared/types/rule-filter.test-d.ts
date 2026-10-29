/**
 * The compile-time half of a read rule that answers a filter: the filter is
 * typed by the collection's own fields, so a misspelt field or operator, or
 * an operand of the wrong kind, fails to compile; only a collection's read
 * rule may answer one; and a collection whose field names the checker cannot
 * know, or a config written before filters were typed, compiles as it did.
 *
 * Each refused case is asserted on the type that refuses it rather than
 * suppressed with `@ts-expect-error`, so an unrelated error cannot satisfy
 * it: the refusal a key or operator is given, by name, or a refused operand
 * beside the accepted one it differs from.
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

import type {
  AccessControlFunction,
  CollectionAccessControl,
  SingleAccessControl,
} from "./access";
import type {
  CollectionFilterRule,
  CollectionFilterRuleInput,
  CollectionRuleFilter,
  ExactAnswer,
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

// Each refused case is asserted on the type that refuses it, with no
// `@ts-expect-error`: the refusal `defineCollection` gives a key or an
// operator by name, or a refused operand beside the accepted one it differs
// from. An unrelated error cannot satisfy an assertion, and a case that
// stopped being refused fails it.
type Fields = typeof fields;
const notAField = <Key extends string>(key: Key) =>
  `${key} is not a field this filter can name` as const;
const notAnOperator = <Operator extends string>(operator: Operator) =>
  `${operator} is not an operator for this field` as const;

// defineCollection checks its read rule with these types.
expectTypeOf(defineCollection<Fields, { team: string }>)
  .parameter(0)
  .toEqualTypeOf<CollectionConfigInput<Fields, { team: string }>>();
expectTypeOf<
  NonNullable<
    NonNullable<
      CollectionConfigInput<Fields, { team: string }>["access"]
    >["read"]
  >
>().toEqualTypeOf<CollectionFilterRuleInput<Fields, { team: string }>>();

// A misspelt field: alone, beside a correct one, and inside `or`.
expectTypeOf<
  ExactAnswer<Fields, { teem: { equals: string } }>
>().toEqualTypeOf<{ teem: ReturnType<typeof notAField<"teem">> }>();
expectTypeOf<
  ExactAnswer<Fields, { team: string; teem: string }>
>().toEqualTypeOf<{
  team: string;
  teem: ReturnType<typeof notAField<"teem">>;
}>();
expectTypeOf<ExactAnswer<Fields, { or: { teem: string }[] }>>().toEqualTypeOf<{
  or: readonly { teem: ReturnType<typeof notAField<"teem">> }[];
}>();
// And in an async rule, which is held to the same answer once awaited.
expectTypeOf<() => Promise<{ team: string }>>().toExtend<
  CollectionFilterRuleInput<Fields, { team: string }>
>();
expectTypeOf<() => Promise<{ team: string; teem: string }>>().not.toExtend<
  CollectionFilterRuleInput<Fields, { team: string; teem: string }>
>();

// A misspelt operator, alone and beside `equals`; an operator the field's
// kind does not answer to; a region, which a rule's filter is refused.
expectTypeOf<ExactAnswer<Fields, { team: { equal: string } }>>().toEqualTypeOf<{
  team: { equal: ReturnType<typeof notAnOperator<"equal">> };
}>();
expectTypeOf<
  ExactAnswer<Fields, { team: { equals: string; equal: string } }>
>().toEqualTypeOf<{
  team: { equals: string; equal: ReturnType<typeof notAnOperator<"equal">> };
}>();
expectTypeOf<
  ExactAnswer<Fields, { open: { greater_than: boolean } }>
>().toEqualTypeOf<{
  open: { greater_than: ReturnType<typeof notAnOperator<"greater_than">> };
}>();
expectTypeOf<
  ExactAnswer<Fields, { rank: { contains: string } }>
>().toEqualTypeOf<{
  rank: { contains: ReturnType<typeof notAnOperator<"contains">> };
}>();
expectTypeOf<ExactAnswer<Fields, { team: { near: string } }>>().toEqualTypeOf<{
  team: { near: ReturnType<typeof notAnOperator<"near">> };
}>();

// A number field compared with a string, beside the number it takes.
expectTypeOf<{ rank: { equals: number } }>().toExtend<
  CollectionRuleFilter<Fields>
>();
expectTypeOf<{ rank: { equals: string } }>().not.toExtend<
  CollectionRuleFilter<Fields>
>();

// Rich text, and a path into a group, are not keys.
expectTypeOf<
  ExactAnswer<Fields, { body: { equals: string } }>
>().toEqualTypeOf<{
  body: ReturnType<typeof notAField<"body">>;
}>();
expectTypeOf<
  ExactAnswer<Fields, { "seo.title": { equals: string } }>
>().toEqualTypeOf<{ "seo.title": ReturnType<typeof notAField<"seo.title">> }>();

// A condition the rule's filter refuses when it runs: naming no operator, or
// giving a field or an operator no value. The filter type refuses the first
// too, for a rule typed by it rather than inferred.
expectTypeOf<ExactAnswer<Fields, { team: {} }>>().toEqualTypeOf<{
  team: "a condition names at least one operator";
}>();
expectTypeOf<{ team: { equals: string } }>().toExtend<
  CollectionRuleFilter<Fields>
>();
expectTypeOf<{ team: {} }>().not.toExtend<CollectionRuleFilter<Fields>>();
expectTypeOf<ExactAnswer<Fields, { team: undefined }>>().toEqualTypeOf<{
  team: "team is given no value";
}>();
expectTypeOf<
  ExactAnswer<Fields, { team: { equals: string | undefined } }>
>().toEqualTypeOf<{ team: { equals: "equals is given no value" } }>();

// ---------------------------------------------------------------------------
// A field stored as a JSON document, or owning no column, is no key
// ---------------------------------------------------------------------------

// A list (`hasMany`) or a reference to several collections is stored as a
// JSON document, which an operator would compare as text; the same fields
// holding one value stay keys.
const stored = [
  select({
    name: "tags",
    hasMany: true,
    options: [{ label: "A", value: "a" }],
  }),
  text({ name: "aliases", hasMany: true }),
  number({ name: "scores", hasMany: true }),
  relationship({ name: "owners", relationTo: "users", hasMany: true }),
  relationship({ name: "subject", relationTo: ["posts", "pages"] }),
  relationship({ name: "author", relationTo: "users" }),
  number({ name: "score" }),
];
type Stored = typeof stored;
// Declared inline, where the factories' results are inferred against the
// collection's fields, a field holding one value stays a key.
defineCollection({
  slug: "inline",
  fields: [
    relationship({ name: "author", relationTo: "users" }),
    number({ name: "score" }),
  ],
  access: { read: () => ({ author: "u", score: { not_equals: 5 } }) },
});
expectTypeOf<
  ExactAnswer<Stored, { author: string; score: { not_equals: number } }>
>().toEqualTypeOf<{ author: string; score: { not_equals: number } }>();
expectTypeOf<
  ExactAnswer<Stored, { tags: { not_equals: string } }>
>().toEqualTypeOf<{ tags: ReturnType<typeof notAField<"tags">> }>();
expectTypeOf<ExactAnswer<Stored, { aliases: string }>>().toEqualTypeOf<{
  aliases: ReturnType<typeof notAField<"aliases">>;
}>();
expectTypeOf<
  ExactAnswer<Stored, { scores: { not_equals: number } }>
>().toEqualTypeOf<{ scores: ReturnType<typeof notAField<"scores">> }>();
expectTypeOf<ExactAnswer<Stored, { owners: string }>>().toEqualTypeOf<{
  owners: ReturnType<typeof notAField<"owners">>;
}>();
expectTypeOf<ExactAnswer<Stored, { subject: string }>>().toEqualTypeOf<{
  subject: ReturnType<typeof notAField<"subject">>;
}>();
// A field that may hold a list, its `hasMany` known only as `boolean`, is
// taken as one.
declare const either: boolean;
const maybeMany = [number({ name: "maybeMany", hasMany: either })];
expectTypeOf<
  ExactAnswer<typeof maybeMany, { maybeMany: number }>
>().toEqualTypeOf<{ maybeMany: ReturnType<typeof notAField<"maybeMany">> }>();

// A field owning no column leaves the system field of its name in place,
// compared as that field is, and is no key itself.
const columnless = [
  number({ name: "title", virtual: true }),
  { type: "component" as const, name: "slug" as const, component: "seo" },
  number({ name: "computed", virtual: true }),
];
type Columnless = typeof columnless;
expectTypeOf<{ title: { greater_than: string } }>().toExtend<
  CollectionRuleFilter<Columnless>
>();
expectTypeOf<{ title: { greater_than: number } }>().not.toExtend<
  CollectionRuleFilter<Columnless>
>();
expectTypeOf<{ slug: { contains: string } }>().toExtend<
  CollectionRuleFilter<Columnless>
>();
expectTypeOf<ExactAnswer<Columnless, { computed: number }>>().toEqualTypeOf<{
  computed: ReturnType<typeof notAField<"computed">>;
}>();

// ---------------------------------------------------------------------------
// Only a collection's read rule may answer a filter
// ---------------------------------------------------------------------------

// Each rule beside the read rule answers true or false: a rule answering a
// filter is not one, where a rule answering a boolean is.
type CreateRule = NonNullable<CollectionAccessControl["create"]>;
type UpdateRule = NonNullable<CollectionAccessControl["update"]>;
type SingleRule = NonNullable<SingleAccessControl["read"]>;
type FieldRule = NonNullable<FieldAccess["read"]>;
expectTypeOf<() => boolean>().toExtend<CreateRule>();
expectTypeOf<() => { team: string }>().not.toExtend<CreateRule>();
// An update rule, for now.
expectTypeOf<() => boolean>().toExtend<UpdateRule>();
expectTypeOf<() => { team: string }>().not.toExtend<UpdateRule>();
expectTypeOf<() => boolean>().toExtend<SingleRule>();
expectTypeOf<() => { team: string }>().not.toExtend<SingleRule>();
expectTypeOf<() => boolean>().toExtend<FieldRule>();
expectTypeOf<() => { team: string }>().not.toExtend<FieldRule>();

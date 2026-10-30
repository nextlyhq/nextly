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
import { pluginField } from "../../collections/fields/types/plugin-field";
import type { CollectionFilterRuleInput as ConfigFilterRuleInput } from "../../config";

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
type NotAField<Key extends string> =
  `${Key} is not a field this filter can name`;
type NotAnOperator<Operator extends string> =
  `${Operator} is not an operator for this field`;
/** Whether `A` and `B` are the same type. */
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;
/**
 * The names of the cases where whether `Value` is taken by `Type` is not the
 * `true` or `false` beside them.
 */
type Disagreements<Cases extends Record<string, [unknown, unknown, boolean]>> =
  {
    [Name in keyof Cases]: (
      [Cases[Name][0]] extends [Cases[Name][1]] ? true : false
    ) extends Cases[Name][2]
      ? never
      : Name;
  }[keyof Cases];
type TypedFilter = CollectionRuleFilter<typeof fields>;
/** The names of the cases whose answer is not given the refusal beside it. */
type Mismatches<Cases extends Record<string, [unknown, unknown]>> = {
  [Name in keyof Cases]: Equal<Cases[Name][0], Cases[Name][1]> extends true
    ? never
    : Name;
}[keyof Cases];

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

// Each refused answer beside the refusal it is given, by name: a misspelt
// field, alone, beside a correct one and inside `or`; a misspelt operator,
// alone and beside `equals`; an operator the field's kind does not answer
// to; a region, which a rule's filter is refused; rich text and a path into
// a group, which are not keys; and a condition the rule's filter refuses when
// it runs, naming no operator or giving a field, an operator or a logical
// branch no value. A case listed by `Mismatches` is one whose refusal
// changed.
expectTypeOf<
  Mismatches<{
    misspeltAlone: [
      ExactAnswer<Fields, { teem: { equals: string } }>,
      { teem: NotAField<"teem"> },
    ];
    misspeltBeside: [
      ExactAnswer<Fields, { team: string; teem: string }>,
      { team: string; teem: NotAField<"teem"> },
    ];
    misspeltInOr: [
      ExactAnswer<Fields, { or: { teem: string }[] }>,
      { or: readonly { teem: NotAField<"teem"> }[] },
    ];
    operatorAlone: [
      ExactAnswer<Fields, { team: { equal: string } }>,
      { team: { equal: NotAnOperator<"equal"> } },
    ];
    operatorBeside: [
      ExactAnswer<Fields, { team: { equals: string; equal: string } }>,
      { team: { equals: string; equal: NotAnOperator<"equal"> } },
    ];
    checkboxOrder: [
      ExactAnswer<Fields, { open: { greater_than: boolean } }>,
      { open: { greater_than: NotAnOperator<"greater_than"> } },
    ];
    numberAsText: [
      ExactAnswer<Fields, { rank: { contains: string } }>,
      { rank: { contains: NotAnOperator<"contains"> } },
    ];
    region: [
      ExactAnswer<Fields, { team: { near: string } }>,
      { team: { near: NotAnOperator<"near"> } },
    ];
    richText: [
      ExactAnswer<Fields, { body: { equals: string } }>,
      { body: NotAField<"body"> },
    ];
    groupPath: [
      ExactAnswer<Fields, { "seo.title": { equals: string } }>,
      { "seo.title": NotAField<"seo.title"> },
    ];
    noOperator: [
      ExactAnswer<Fields, { team: {} }>,
      { team: "a condition names at least one operator" },
    ];
    fieldGivenUndefined: [
      ExactAnswer<Fields, { team: undefined }>,
      { team: "team is given no value" },
    ];
    operandMaybeUndefined: [
      ExactAnswer<Fields, { team: { equals: string | undefined } }>,
      { team: { equals: "equals is given no value" } },
    ];
    orGivenUndefined: [
      ExactAnswer<Fields, { or: undefined }>,
      { or: "or is given no value" },
    ];
    andMaybeUndefined: [
      ExactAnswer<Fields, { and: { team: string }[] | undefined }>,
      { and: "and is given no value" },
    ];
  }>
>().toEqualTypeOf<never>();

// Each value beside whether the type takes it: an async rule, held to the
// same answer once awaited; a number field compared with a string, beside
// the number it takes; and a condition naming no operator, beside one naming
// `equals`, refused by the filter type too, for a rule typed by it.
expectTypeOf<
  Disagreements<{
    asyncRule: [
      () => Promise<{ team: string }>,
      CollectionFilterRuleInput<Fields, { team: string }>,
      true,
    ];
    asyncMisspelt: [
      () => Promise<{ team: string; teem: string }>,
      CollectionFilterRuleInput<Fields, { team: string; teem: string }>,
      false,
    ];
    numberOperand: [{ rank: { equals: number } }, TypedFilter, true];
    stringForNumber: [{ rank: { equals: string } }, TypedFilter, false];
    withOperator: [{ team: { equals: string } }, TypedFilter, true];
    noOperator: [{ team: {} }, TypedFilter, false];
  }>
>().toEqualTypeOf<never>();

// The config entry point exports the input type defineCollection reads.
expectTypeOf<ConfigFilterRuleInput<Fields, { team: string }>>().toEqualTypeOf<
  CollectionFilterRuleInput<Fields, { team: string }>
>();

// A rule already typed with the exported types is taken as it is: the keys
// it may leave out are not read as given no value.
const typedRule: CollectionFilterRule<Fields> = () => ({ team: "a" });
defineCollection({ slug: "reused", fields, access: { read: typedRule } });
const typedFilter: CollectionRuleFilter<Fields> = { team: { equals: "a" } };
defineCollection({
  slug: "reused-filter",
  fields,
  access: { read: () => typedFilter },
});

// The first-publication date is a system field, compared as a date.
expectTypeOf<{
  firstPublishedAt: { exists: boolean; less_than: string };
}>().toExtend<CollectionRuleFilter<Fields>>();

// A field annotated with its config type has a name the checker cannot know,
// so the filter is untyped and checked when the rule runs, as for a name
// built at runtime.
const annotatedTeam: TextFieldConfig = text({ name: "team" });
expectTypeOf<
  CollectionRuleFilter<[typeof annotatedTeam]>
>().toEqualTypeOf<UntypedRuleFilter>();
defineCollection({
  slug: "annotated",
  fields: [annotatedTeam],
  access: { read: () => ({ team: "a" }) },
});

// A field no filter may name still takes its column's name: a rich text
// `title` replaces the system title, so `title` is no key.
const richTitled = [richText({ name: "title" })];

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
// A field that may hold a list, its `hasMany` known only as `boolean`, is
// taken as one.
declare const either: boolean;
const maybeMany = [number({ name: "maybeMany", hasMany: either })];

// A field a plugin contributed is no key: its storage is registered at
// runtime, and its declaration does not say whether it is a JSON document.
const contributed = [pluginField({ name: "rating", type: "star-rating" })];

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

// Each field no filter may name, beside the refusal it is given, and the
// fields holding one value, which pass as written: a list or a reference to
// several collections, one that may hold a list, a plugin's field, a virtual
// field, and a rich text `title`, which replaces the system title.
expectTypeOf<
  Mismatches<{
    oneValue: [
      ExactAnswer<Stored, { author: string; score: { not_equals: number } }>,
      { author: string; score: { not_equals: number } },
    ];
    hasManySelect: [
      ExactAnswer<Stored, { tags: { not_equals: string } }>,
      { tags: NotAField<"tags"> },
    ];
    hasManyText: [
      ExactAnswer<Stored, { aliases: string }>,
      { aliases: NotAField<"aliases"> },
    ];
    hasManyNumber: [
      ExactAnswer<Stored, { scores: { not_equals: number } }>,
      { scores: NotAField<"scores"> },
    ];
    hasManyRelationship: [
      ExactAnswer<Stored, { owners: string }>,
      { owners: NotAField<"owners"> },
    ];
    severalTargets: [
      ExactAnswer<Stored, { subject: string }>,
      { subject: NotAField<"subject"> },
    ];
    maybeMany: [
      ExactAnswer<typeof maybeMany, { maybeMany: number }>,
      { maybeMany: NotAField<"maybeMany"> },
    ];
    pluginField: [
      ExactAnswer<typeof contributed, { rating: number }>,
      { rating: NotAField<"rating"> },
    ];
    virtualField: [
      ExactAnswer<Columnless, { computed: number }>,
      { computed: NotAField<"computed"> },
    ];
    richTextTitle: [
      ExactAnswer<typeof richTitled, { title: string }>,
      { title: NotAField<"title"> },
    ];
  }>
>().toEqualTypeOf<never>();

// ---------------------------------------------------------------------------
// Only a collection's read rule may answer a filter
// ---------------------------------------------------------------------------

// Each rule beside the read rule answers true or false: a rule answering a
// filter is not one, where a rule answering a boolean is.
type AnswersBoolean = () => boolean;
type AnswersFilter = () => { team: string };
type CreateRule = NonNullable<CollectionAccessControl["create"]>;
type UpdateRule = NonNullable<CollectionAccessControl["update"]>;
type SingleRule = NonNullable<SingleAccessControl["read"]>;
type FieldRule = NonNullable<FieldAccess["read"]>;
expectTypeOf<
  Disagreements<{
    createBoolean: [AnswersBoolean, CreateRule, true];
    createFilter: [AnswersFilter, CreateRule, false];
    // An update rule, for now.
    updateBoolean: [AnswersBoolean, UpdateRule, true];
    updateFilter: [AnswersFilter, UpdateRule, false];
    singleBoolean: [AnswersBoolean, SingleRule, true];
    singleFilter: [AnswersFilter, SingleRule, false];
    fieldBoolean: [AnswersBoolean, FieldRule, true];
    fieldFilter: [AnswersFilter, FieldRule, false];
  }>
>().toEqualTypeOf<never>();

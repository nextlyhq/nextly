/**
 * The filter a collection's read rule may answer, typed by the collection's
 * own fields.
 *
 * A read rule that answers a filter allows the caller the entries the filter
 * matches, and no others. It narrows the caller's permission and never grants
 * one. Typed here so a misspelt field or operator, or an operand of the wrong
 * kind, fails to compile instead of matching nothing at runtime.
 *
 * Only top-level fields are typed keys, with the system fields every
 * collection has. A path into a group (`"seo.title"`) is not typed yet, and a
 * component field is refused in a rule's filter at runtime, so neither is a
 * key here.
 *
 * @module shared/types/rule-filter
 * @experimental
 */
import type { FieldType } from "../../collections/fields/types/base";
import type { AuthorableFieldConfig } from "../../collections/fields/types/plugin-field";
import type { FilterOperator } from "../../domains/collections/query/filter-shape";

import type { AccessControlContext } from "./access";

/**
 * The operators a rule's filter may use: every filter operator but the two
 * that compare a region, which a rule's filter is refused.
 */
type RuleFilterOperator = Exclude<FilterOperator, "near" | "within">;

/** A set of rule operators, held to the runtime's names. */
type Operators<Names extends RuleFilterOperator> = Names;

type EqualityOperators = Operators<
  "equals" | "not_equals" | "in" | "not_in" | "exists"
>;
type OrderOperators = Operators<
  "greater_than" | "greater_than_equal" | "less_than" | "less_than_equal"
>;
type TextOperators = Operators<"like" | "contains" | "search">;

/** How a field is compared: what it holds, and the operators it answers to. */
interface FilterKind<Value, Names extends RuleFilterOperator> {
  value: Value;
  operators: Names;
}

type TextKind = FilterKind<
  string,
  EqualityOperators | OrderOperators | TextOperators
>;
type OrderedKind<Value> = FilterKind<Value, EqualityOperators | OrderOperators>;
type EqualityKind<Value> = FilterKind<Value, EqualityOperators>;

/** An entry's id, as a relationship or upload field holds it. */
type EntryId = string | number;

/** A date, as an ISO 8601 string or a `Date`. */
type DateOperand = string | Date;

/**
 * How a field of each filterable built-in type is compared. A built-in type
 * missing here (rich text, JSON, password, chips, a repeater, group or
 * component) is not a key of a typed filter.
 */
interface BuiltInFilterKinds {
  text: TextKind;
  textarea: TextKind;
  email: TextKind;
  code: TextKind;
  select: TextKind;
  radio: TextKind;
  number: OrderedKind<number>;
  date: OrderedKind<DateOperand>;
  checkbox: EqualityKind<boolean>;
  relationship: EqualityKind<EntryId>;
  upload: EqualityKind<EntryId>;
}

/** A field a plugin contributed, compared by equality on what it may hold. */
type PluginKind = EqualityKind<string | number | boolean | Date>;

/**
 * The system fields a collection's filter may name, whatever it declares.
 * `status` is present when the collection has `status: true`; on one without
 * it, a rule filtering on it matches nothing.
 */
interface SystemFilterKinds {
  id: EqualityKind<EntryId>;
  title: TextKind;
  slug: TextKind;
  createdAt: OrderedKind<DateOperand>;
  updatedAt: OrderedKind<DateOperand>;
  createdBy: EqualityKind<string>;
  status: TextKind;
}

/**
 * Whether `Field` is stored as serialized JSON, as `isJsonFieldType` answers
 * when the collection is read: a text, select or number holding a list
 * (`hasMany`), or a relationship or upload holding a list or naming several
 * collections. Its column holds a document, so it is no filter key: compared
 * with one value, an operator would compare the document's text. A field the
 * checker cannot place, its `hasMany` typed `boolean` or its targets
 * `string | string[]`, is taken as one, as the read refuses it either way.
 */
type StoredAsJson<Field> = Field extends {
  type: "text" | "select" | "number" | "relationship" | "upload";
}
  ? Field extends { hasMany?: false | undefined }
    ? Field extends { type: "relationship" | "upload" }
      ? Field extends { relationTo: string }
        ? false
        : true
      : false
    : true
  : false;

/**
 * Whether `Field` is declared to own no column on the collection's row, as
 * `fieldProducesColumn` answers: a virtual field, a many-to-many
 * relationship, or a component. Only a declaration that says so as written
 * is known here.
 */
type OwnsNoColumn<Field> =
  DeclaresTrue<Field, "virtual"> extends true
    ? true
    : Field extends
          | { options: { virtual: true } }
          | { type: "relationship"; options: { relationType: "manyToMany" } }
          | { type: "component" | "fieldGroup" }
      ? true
      : false;

/**
 * Whether `Field` declares `Key` as `true`. A factory gives the flag as an
 * optional property of the value written, so `virtual?: true` declares it
 * and an absent or `boolean` one does not.
 */
type DeclaresTrue<Field, Key extends string> = Field extends {
  [Name in Key]?: infer Value;
}
  ? [Exclude<Value, undefined>] extends [true]
    ? true
    : false
  : false;

/** How `Field` is compared, or `never` where it is not a filter key. */
type KindOf<Field> = Field extends { type: infer Type }
  ? StoredAsJson<Field> extends true
    ? never
    : OwnsNoColumn<Field> extends true
      ? never
      : Type extends keyof BuiltInFilterKinds
        ? BuiltInFilterKinds[Type]
        : Type extends FieldType
          ? never
          : PluginKind
  : never;

/** The fields of `Fields` a filter may name. */
type FilterableField<Fields extends readonly AuthorableFieldConfig[]> =
  Fields[number] extends infer Field
    ? Field extends AuthorableFieldConfig
      ? [KindOf<Field>] extends [never]
        ? never
        : Field
      : never
    : never;

/** The names of the fields of `Fields` a filter may name. */
type FilterNames<Fields extends readonly AuthorableFieldConfig[]> =
  FilterableField<Fields>["name"];

/**
 * The names `Fields` declares as written, of the fields that own a column. A
 * field owning none leaves the system column of its name in place, so that
 * system field stays a key. A field whose name the checker cannot know
 * (`string`) names no field in particular, so it leaves every system field a
 * key.
 */
type DeclaredNames<Fields extends readonly AuthorableFieldConfig[]> =
  Fields[number] extends infer Field
    ? Field extends { name: infer Name extends string }
      ? OwnsNoColumn<Field> extends true
        ? never
        : string extends Name
          ? never
          : Name
      : never
    : never;

/**
 * How each key of a typed filter on `Fields` is compared. A declared field
 * takes the place of a system field of the same name.
 */
type FilterKindsOf<Fields extends readonly AuthorableFieldConfig[]> = {
  [Name in FilterNames<Fields>]: KindOf<
    Extract<FilterableField<Fields>, { name: Name }>
  >;
} & Omit<SystemFilterKinds, DeclaredNames<Fields>>;

/** What operator `Operator` compares a field holding `Value` with. */
type OperandOf<Operator extends RuleFilterOperator, Value> = Operator extends
  | "in"
  | "not_in"
  ? readonly Value[]
  : Operator extends "exists"
    ? boolean
    : Operator extends TextOperators
      ? string
      : Value;

/**
 * `Condition` with at least one of its keys given a value: a condition naming
 * no operator, or one given `undefined`, is refused when the rule runs.
 */
type AtLeastOneOf<Condition> = {
  [Key in keyof Condition]-?: Required<Pick<Condition, Key>> &
    Partial<Omit<Condition, Key>>;
}[keyof Condition];

/** A condition on one field: the operators its kind answers to. */
type KindCondition<Kind extends FilterKind<unknown, RuleFilterOperator>> =
  AtLeastOneOf<{
    [Operator in Kind["operators"]]?: OperandOf<Operator, Kind["value"]>;
  }>;

/** A filter whose keys are the kinds in `Kinds`. */
type TypedRuleFilter<Kinds> = {
  [Name in keyof Kinds]?: Kinds[Name] extends FilterKind<
    unknown,
    RuleFilterOperator
  >
    ? Kinds[Name]["value"] | KindCondition<Kinds[Name]>
    : never;
} & {
  and?: readonly TypedRuleFilter<Kinds>[];
  or?: readonly TypedRuleFilter<Kinds>[];
};

/**
 * A filter on a collection whose field names are not known to the checker:
 * fields built at runtime, or annotated as the general field type.
 *
 * @experimental
 */
export interface UntypedRuleFilter {
  and?: readonly UntypedRuleFilter[];
  or?: readonly UntypedRuleFilter[];
  [field: string]: unknown;
}

/**
 * The filter a read rule on a collection with `Fields` may answer.
 *
 * Typed by the fields where every filterable field's name is a literal, as
 * a field factory or an inline declaration gives it. Where one is not, the
 * names are unknown and the filter is {@link UntypedRuleFilter}.
 *
 * @experimental
 */
export type CollectionRuleFilter<
  Fields extends
    readonly AuthorableFieldConfig[] = readonly AuthorableFieldConfig[],
> =
  string extends FilterNames<Fields>
    ? UntypedRuleFilter
    : TypedRuleFilter<FilterKindsOf<Fields>>;

/**
 * What a collection rule that may answer a filter answers: `true` to allow,
 * `false` to refuse, or a filter to allow the entries it matches.
 *
 * @experimental
 */
export type CollectionRuleAnswer<
  Fields extends
    readonly AuthorableFieldConfig[] = readonly AuthorableFieldConfig[],
> = boolean | CollectionRuleFilter<Fields>;

/**
 * A collection rule that may answer a filter. A rule that answers only
 * `true` or `false` is one too.
 *
 * @experimental
 */
export type CollectionFilterRule<
  Fields extends
    readonly AuthorableFieldConfig[] = readonly AuthorableFieldConfig[],
> = (
  ctx: AccessControlContext
) => CollectionRuleAnswer<Fields> | Promise<CollectionRuleAnswer<Fields>>;

/**
 * What `Condition` may hold, operator by operator, for a field of `Kind`. A
 * condition naming no operator, and an operator given `undefined`, are
 * refused when the rule runs, so each becomes a type no value has.
 */
type ExactCondition<Kind, Condition> = Condition extends Date
  ? Condition
  : Condition extends readonly unknown[]
    ? Condition
    : Condition extends object
      ? [keyof Condition] extends [never]
        ? "a condition names at least one operator"
        : {
            [Operator in keyof Condition]: Kind extends FilterKind<
              unknown,
              infer Names
            >
              ? Operator extends Names
                ? undefined extends Condition[Operator]
                  ? `${Operator & string} is given no value`
                  : Condition[Operator]
                : `${Operator & string} is not an operator for this field`
              : never;
          }
      : Condition;

/** What `Filter` may hold, key by key and at every depth, on `Kinds`. */
type ExactFilter<Kinds, Filter> = {
  [Key in keyof Filter]: Key extends "and" | "or"
    ? Filter[Key] extends readonly (infer Member)[]
      ? readonly ExactFilter<Kinds, Member>[]
      : Filter[Key]
    : Key extends keyof Kinds
      ? undefined extends Filter[Key]
        ? `${Key & string} is given no value`
        : ExactCondition<Kinds[Key], Filter[Key]>
      : `${Key & string} is not a field this filter can name`;
};

/**
 * What `Answer` may be, as a rule on `Fields` answered it: itself, where
 * every key it names is one the filter may name.
 *
 * The checker does not hold an object a function returns to the properties
 * its return type names, so a misspelt key beside a correct one would pass.
 * This names each key the answer holds and turns a key it may not into a
 * type no value has.
 *
 * Exported for the type tests, which assert the refusal it gives; it is not
 * re-exported from any entry point.
 */
export type ExactAnswer<
  Fields extends readonly AuthorableFieldConfig[],
  Answer,
> = Answer extends boolean
  ? Answer
  : string extends FilterNames<Fields>
    ? Answer
    : ExactFilter<FilterKindsOf<Fields>, Answer>;

/**
 * A collection rule that may answer a filter, as `defineCollection` takes
 * it: `true`, `false`, or a rule whose answer is checked against `Fields`
 * key by key. `Answer` is inferred from the rule.
 *
 * @experimental
 */
export type CollectionFilterRuleInput<
  Fields extends readonly AuthorableFieldConfig[],
  Answer,
> =
  | boolean
  | (((ctx: AccessControlContext) => Answer | Promise<Answer>) &
      NoInfer<
        (
          ctx: AccessControlContext
        ) => ExactAnswer<Fields, Answer> | Promise<ExactAnswer<Fields, Answer>>
      > &
      CollectionFilterRule<NoInfer<Fields>>);

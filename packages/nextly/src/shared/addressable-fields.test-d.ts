import type {
  FieldConfig,
  GroupFieldConfig,
} from "../collections/fields/types";
import type {
  AuthorableFieldConfig,
  PluginDataFieldConfig,
} from "../collections/fields/types/plugin-field";

import type { AddressableField } from "./addressable-fields";
import { addressableFields } from "./addressable-fields";

// What the walk gives BACK, at the type level. The runtime tests cover which
// fields come out; these cover whose type they come out as, which is a
// different claim and the one that decides whether a plugin can use this at
// all. The first version returned `FieldConfig[]` — the closed built-in union —
// so a plugin passing a contributed field through and narrowing landed on
// `never`, and could not replace its own walk without a cast. That version was
// importable, loadable and typechecked; it just could not be CALLED usefully by
// its only consumer.
//
// In a `.test-d.ts` rather than a `.test.ts` because tsconfig excludes the
// latter: type-level assertions in a normal test file are transpiled away by
// the runner and check nothing. `pnpm check-types` compiles this one.

/** `Exact<A, B>` is `false` when the two types differ in either direction. */
type Exact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

declare function assertType<T extends true>(proof: T): void;

declare const builtIn: FieldConfig[];
declare const contributed: PluginDataFieldConfig[];
declare const mixed: AuthorableFieldConfig[];
declare const narrow: GroupFieldConfig[];
declare const unvalidated: unknown;

// Asserted through real CALLS rather than by instantiating a signature, because
// which overload a caller selects is the claim — a declared return type can be
// right while resolution picks the other one.
// Underscore-prefixed: consumed only as types, which lint calls unused.
const _fromBuiltIn = addressableFields(builtIn);
const _fromContributed = addressableFields(contributed);
const _fromMixed = addressableFields(mixed);
const _fromNarrow = addressableFields(narrow);
const _fromUnknown = addressableFields(unvalidated);

// Every caller is told the same thing: an entry that is addressable, which is
// a valid field when the caller had one and otherwise only known to be named.
// Narrower would be convenient and false — a built-in list whose group contains
// a contributed child returns that child, and an unvalidated list can carry an
// entry with no `type` at all.
assertType<Exact<typeof _fromBuiltIn, AddressableField[]>>(true);
assertType<Exact<typeof _fromContributed, AddressableField[]>>(true);
assertType<Exact<typeof _fromMixed, AddressableField[]>>(true);
assertType<Exact<typeof _fromNarrow, AddressableField[]>>(true);
assertType<Exact<typeof _fromUnknown, AddressableField[]>>(true);

// The property that matters, and the one three earlier signatures broke: a
// contributed field is RECOVERABLE from the result. `never` here is the defect
// — a plugin receiving its own field at runtime and unable to recognise it.
assertType<
  Exact<
    Extract<(typeof _fromBuiltIn)[number], PluginDataFieldConfig>,
    PluginDataFieldConfig
  >
>(true);

// And a built-in is still recoverable, so widening did not trade one erasure
// for the other.
assertType<
  Exact<Extract<(typeof _fromMixed)[number], FieldConfig>, FieldConfig>
>(true);

// An entry that is merely NAMED must not be presentable as a valid field
// config. This API runs before validation on some paths, and `{ name: "title" }`
// with no `type` reaches it — calling that an `AuthorableFieldConfig` would tell
// a caller the discriminant is there when it is not.
//
// Asserted by EVALUATING assignability rather than with `@ts-expect-error`,
// which suppresses whatever error happens to land on the next line: a typo or
// an unrelated failure would satisfy the directive and the property would go
// unchecked while reading as covered.
type AssignableTo<A, B> = [A] extends [B] ? true : false;

assertType<Exact<AssignableTo<AddressableField, AuthorableFieldConfig>, false>>(
  true
);

// The control, so "not assignable" is not satisfied by a type assignable to
// nothing: the valid arm still is.
assertType<Exact<AssignableTo<AuthorableFieldConfig, AddressableField>, true>>(
  true
);

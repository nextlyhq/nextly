import type {
  FieldConfig,
  GroupFieldConfig,
} from "../collections/fields/types";
import type {
  AuthorableFieldConfig,
  PluginDataFieldConfig,
} from "../collections/fields/types/plugin-field";

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

// Every caller is told the same thing, and it is the widest a field can be.
// Narrower would be convenient and false: a built-in list whose group contains
// a contributed child returns that child.
assertType<Exact<typeof _fromBuiltIn, AuthorableFieldConfig[]>>(true);
assertType<Exact<typeof _fromContributed, AuthorableFieldConfig[]>>(true);
assertType<Exact<typeof _fromMixed, AuthorableFieldConfig[]>>(true);
assertType<Exact<typeof _fromNarrow, AuthorableFieldConfig[]>>(true);
assertType<Exact<typeof _fromUnknown, AuthorableFieldConfig[]>>(true);

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

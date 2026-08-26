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
declare const unvalidated: unknown;

// Asserted through real CALLS rather than by instantiating a signature, because
// which overload a caller selects is the claim — a declared return type can be
// right while resolution picks the other one.
// Underscore-prefixed: consumed only as types, which lint calls unused.
const _fromBuiltIn = addressableFields(builtIn);
const _fromContributed = addressableFields(contributed);
const _fromMixed = addressableFields(mixed);
const _fromUnknown = addressableFields(unvalidated);

assertType<Exact<typeof _fromBuiltIn, FieldConfig[]>>(true);
// A plugin's own array widens to the union that CONTAINS its type, which is the
// honest answer — the flattened element may be a built-in child. What matters is
// that narrowing back to the contributed type is possible; `never` was the
// defect, not width.
assertType<Exact<typeof _fromContributed, AuthorableFieldConfig[]>>(true);
assertType<
  Exact<
    Extract<(typeof _fromContributed)[number], PluginDataFieldConfig>,
    PluginDataFieldConfig
  >
>(true);
assertType<Exact<typeof _fromMixed, AuthorableFieldConfig[]>>(true);

// A caller with no type at all is told the widest thing that is honest, rather
// than refused: this runs on author-written config, before validation on some
// paths.
assertType<Exact<typeof _fromUnknown, AuthorableFieldConfig[]>>(true);

// The case that made the previous generic unsound: a list whose inferred
// element type is NARROWER than the union. It must widen to the union that
// contains it, because the element actually returned is the group's child.
declare const narrow: GroupFieldConfig[];
const _fromNarrow = addressableFields(narrow);
assertType<Exact<typeof _fromNarrow, FieldConfig[]>>(true);

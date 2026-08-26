import type { FieldConfig } from "../collections/fields/types";
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

// A core caller keeps the narrow union it passed in. Widening the return for
// everyone would put `{} | null` on ordinary property reads throughout core —
// which is what the note on `AuthorableFieldConfig` warns against.
assertType<
  Exact<ReturnType<typeof addressableFields<FieldConfig>>, FieldConfig[]>
>(true);

// The assertion the first version failed: a contributed field survives the
// walk, so narrowing the result to a plugin's own type is not `never`.
assertType<
  Exact<
    ReturnType<typeof addressableFields<PluginDataFieldConfig>>,
    PluginDataFieldConfig[]
  >
>(true);

// A mixed list — what a plugin holds when it walks a collection whose schema it
// has extended — keeps both halves.
assertType<
  Exact<
    ReturnType<typeof addressableFields<AuthorableFieldConfig>>,
    AuthorableFieldConfig[]
  >
>(true);

// Called for real, so the overload RESOLUTION is exercised rather than only the
// signature's shape: a declared return type can be right while the overload a
// caller actually selects is the other one. Underscore-prefixed because they
// are consumed only as types, which lint would otherwise call unused.
const _fromBuiltIn = addressableFields(builtIn);
const _fromContributed = addressableFields(contributed);
const _fromMixed = addressableFields(mixed);
const _fromUnknown = addressableFields(unvalidated);

assertType<Exact<typeof _fromBuiltIn, FieldConfig[]>>(true);
assertType<Exact<typeof _fromContributed, PluginDataFieldConfig[]>>(true);
assertType<Exact<typeof _fromMixed, AuthorableFieldConfig[]>>(true);

// A caller with no type at all is told the widest thing that is honest, rather
// than refused: this runs on author-written config, before validation on some
// paths.
assertType<Exact<typeof _fromUnknown, AuthorableFieldConfig[]>>(true);

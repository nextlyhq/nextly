import type {
  DataFromFieldGroupSlug,
  DataFromFieldGroupSlugFrom,
  FieldGroupSlug,
  FieldGroupSlugFrom,
} from "./field-groups";

// Compile-time half of the generated-Config contract. These assertions live in
// a `.test-d.ts` rather than a `.test.ts` because tsconfig excludes the latter:
// type-level assertions placed in a normal test file are transpiled away by the
// runner and never checked by anything, so they would silently assert nothing.
// `pnpm check-types` compiles this file, which is what makes the assertions bite.

/** `Exact<A, B>` is `false` when the two types differ in either direction. */
type Exact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

declare function assertType<T extends true>(proof: T): void;

/** Stands in for what `generate:types` augments `GeneratedTypes` with. */
interface AugmentedTypes {
  fieldGroups: { seo: { metaTitle: string }; hero: { heading: string } };
}

// Applied through the SAME generics the exported aliases are built from, so a
// drift between the key `TypeGenerator` emits and the key these read fails to
// compile here. Re-declaring the conditional locally would assert nothing about
// the exports.
assertType<Exact<FieldGroupSlugFrom<AugmentedTypes>, "seo" | "hero">>(true);
assertType<
  Exact<
    DataFromFieldGroupSlugFrom<AugmentedTypes, "seo">,
    { metaTitle: string }
  >
>(true);

// An unrecognised slug widens to the open record rather than erroring.
assertType<
  Exact<
    DataFromFieldGroupSlugFrom<AugmentedTypes, "ghost">,
    Record<string, unknown>
  >
>(true);

// Unaugmented, the published aliases fall back — documented behaviour, distinct
// from the silent degradation the assertions above guard against.
assertType<Exact<FieldGroupSlug, string>>(true);
assertType<Exact<DataFromFieldGroupSlug<"seo">, Record<string, unknown>>>(true);

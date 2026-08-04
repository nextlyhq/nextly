import type {
  DataFromCollectionSlug,
  DataFromCollectionSlugFrom,
  DataFromSingleSlugFrom,
  InProcessRow,
  RowFromCollectionSlug,
  RowFromCollectionSlugFrom,
  RowFromSingleSlugFrom,
} from "./shared";

// Compile-time half of the generated-Config contract, in a `.test-d.ts` rather
// than a `.test.ts` because tsconfig excludes the latter: type-level assertions
// in a normal test file are transpiled away and never checked by anything.
// `pnpm check-types` compiles this file, which is what makes them bite.
//
// The runtime half — the keys `TypeGenerator` actually writes — lives in
// `__tests__/generated-config-contract.test.ts`.

/** `Exact<A, B>` is `false` when the two types differ in either direction. */
type Exact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

declare function assertType<T extends true>(proof: T): void;

/** Stands in for what `generate:types` augments `GeneratedTypes` with. */
interface AugmentedTypes {
  collections: {
    posts: {
      id: string;
      title: string;
      publishedAt?: string;
      createdAt: string;
      updatedAt: string;
    };
    // A collection whose fields are all plain: the date-field union is `never`,
    // and the row must come back equal to the wire type rather than mapped.
    tags: { id: string; label: string };
  };
  collectionDateFields: {
    posts: "createdAt" | "updatedAt" | "publishedAt";
    tags: never;
  };
  singles: { settings: { id: string; launchedAt?: string; updatedAt: string } };
  singleDateFields: { settings: "updatedAt" | "launchedAt" };
}

type Post = RowFromCollectionSlugFrom<AugmentedTypes, "posts">;

// Applied through the SAME generics the exported aliases are built from, so a
// drift between the key `TypeGenerator` emits and the key these read fails to
// compile here.
assertType<Exact<Post["createdAt"], Date>>(true);
assertType<Exact<Post["updatedAt"], Date>>(true);

// Optionality survives the mapping: an optional date stays optional instead of
// becoming a required `Date`, which would reject every document that has none.
assertType<Exact<Post["publishedAt"], Date | undefined>>(true);

// A field that is not date-backed is untouched.
assertType<Exact<Post["title"], string>>(true);

// The other direction, which is the half that makes this a fix rather than a
// swap: the wire type still describes a formatted string, because every REST
// response is formatted before it leaves.
assertType<
  Exact<
    DataFromCollectionSlugFrom<AugmentedTypes, "posts">["createdAt"],
    string
  >
>(true);
assertType<
  Exact<DataFromSingleSlugFrom<AugmentedTypes, "settings">["updatedAt"], string>
>(true);

// A collection with no date-backed field is left exactly as generated.
assertType<
  Exact<
    RowFromCollectionSlugFrom<AugmentedTypes, "tags">,
    { id: string; label: string }
  >
>(true);

// A single's own date field is mapped too, not just its `updatedAt`.
type Settings = RowFromSingleSlugFrom<AugmentedTypes, "settings">;
assertType<Exact<Settings["updatedAt"], Date>>(true);
assertType<Exact<Settings["launchedAt"], Date | undefined>>(true);

// An unrecognised slug widens to the open record rather than erroring, matching
// how the wire types behave.
assertType<
  Exact<
    RowFromCollectionSlugFrom<AugmentedTypes, "ghost">,
    Record<string, unknown>
  >
>(true);

// Types generated before `collectionDateFields` existed still get the two
// timestamps every entity has, rather than nothing at all.
interface LegacyTypes {
  collections: { posts: { id: string; createdAt: string; updatedAt: string } };
}
assertType<
  Exact<RowFromCollectionSlugFrom<LegacyTypes, "posts">["createdAt"], Date>
>(true);

// Unaugmented, the published aliases fall back to the open record — documented
// behaviour, distinct from the silent degradation above.
assertType<Exact<RowFromCollectionSlug<"posts">, Record<string, unknown>>>(
  true
);
assertType<Exact<DataFromCollectionSlug<"posts">, Record<string, unknown>>>(
  true
);

// The date methods a caller reaches for actually resolve, and the string ones
// they would have written against the wire type no longer compile.
declare const post: Post;
const millis: number = post.createdAt.getTime();
void millis;

// @ts-expect-error — an in-process timestamp is a Date, not a string.
post.createdAt.slice(0, 10);

// `InProcessRow` maps nothing when handed no date fields, so a caller composing
// it directly gets the input back rather than a widened record.
assertType<Exact<InProcessRow<{ a: number }, never>, { a: number }>>(true);

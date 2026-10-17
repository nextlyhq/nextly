import {
  defineReleaseCheckSource,
  type ReleaseCheckFinding,
  type ReleaseCheckSource,
} from "../check-sources";

// Compile-time half of the check-source contract: a source's codes are a
// closed union inferred from what it declares, and its `check` can report no
// other. In a `.test-d.ts` because `pnpm check-types` compiles these files,
// which is what makes the assertions bite. Asserted with `Exact`, which the
// checker evaluates, rather than with a directive that would also be satisfied
// by an unrelated error on the same line.

/** `Exact<A, B>` is `false` when the two types differ in either direction. */
type Exact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

declare function assertType<T extends true>(proof: T): void;

/** The codes a source declares. */
type CodesOf<S> = S extends ReleaseCheckSource<infer C> ? C : never;

/** The findings a source's `check` may return. */
type FindingsOf<S extends ReleaseCheckSource<string>> = Awaited<
  ReturnType<S["check"]>
>[number];

const missing = defineReleaseCheckSource({
  key: "core.example",
  severity: "hard",
  codes: ["FIELD_MISSING", "FIELD_INVALID"],
  check: async batch =>
    batch.map(member => ({
      memberId: member.id,
      code: "FIELD_MISSING" as const,
    })),
});

// Inferred as the declared literals, not widened to `string`.
assertType<Exact<CodesOf<typeof missing>, "FIELD_MISSING" | "FIELD_INVALID">>(
  true
);

// A finding's code is exactly the declared union: a code the source did not
// declare is not one its findings can carry.
assertType<
  Exact<FindingsOf<typeof missing>["code"], "FIELD_MISSING" | "FIELD_INVALID">
>(true);
assertType<
  Exact<
    "SOMETHING_ELSE" extends FindingsOf<typeof missing>["code"] ? true : false,
    false
  >
>(true);

// And `check` itself is typed to the codes: a function returning an
// undeclared code is not assignable to this source's `check`.
type CheckOf = ReleaseCheckSource<"FIELD_MISSING" | "FIELD_INVALID">["check"];
type ReportsUndeclared = () => Promise<ReleaseCheckFinding<"SOMETHING_ELSE">[]>;
assertType<Exact<ReportsUndeclared extends CheckOf ? true : false, false>>(
  true
);

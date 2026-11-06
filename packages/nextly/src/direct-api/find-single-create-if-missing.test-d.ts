import type { Nextly, nextly as convenience } from "./nextly";

// What `findSingle` resolves to, by what the call says about `createIfMissing`.
// `null` is possible only when the call may pass `false`, so the existing call
// shape keeps its non-null row type and a caller opting out is made to handle
// the missing document.
//
// In a `.test-d.ts` because tsconfig excludes `.test.ts`: `pnpm check-types`
// compiles this file, and the runner would transpile its types away.

/** Whether `T` is `any`, which a plain two-way assignability check lets through. */
type IsAny<T> = 0 extends 1 & T ? true : false;

/** `true` only when `A` and `B` are the same type, and neither is `any`. */
type Exact<A, B> =
  IsAny<A> extends true
    ? IsAny<B> extends true
      ? true
      : false
    : IsAny<B> extends true
      ? false
      : [A] extends [B]
        ? [B] extends [A]
          ? true
          : false
        : false;

declare function assertType<T extends true>(proof: T): void;

declare const nextly: Nextly;
declare const maybe: boolean;

type Row = Record<string, unknown>;

export async function _readSingles(): Promise<void> {
  // Underscore-prefixed: read only as types, which lint calls unused.
  const _default = await nextly.findSingle({ slug: "site-settings" });
  const _creating = await nextly.findSingle({
    slug: "site-settings",
    createIfMissing: true,
  });
  const _notCreating = await nextly.findSingle({
    slug: "site-settings",
    createIfMissing: false,
  });
  const _either = await nextly.findSingle({
    slug: "site-settings",
    createIfMissing: maybe,
  });

  assertType<Exact<typeof _default, Row>>(true);
  assertType<Exact<typeof _creating, Row>>(true);
  assertType<Exact<typeof _notCreating, Row | null>>(true);
  assertType<Exact<typeof _either, Row | null>>(true);
}

// The `nextly` convenience object delegates to the method, and must answer the
// same type for the same call: an inferred delegate once answered `never` for a
// call leaving `createIfMissing` out, which no row assertion on the class sees.
declare const convenient: typeof convenience;

export async function _readSinglesThroughTheConvenienceObject(): Promise<void> {
  const _default = await convenient.findSingle({ slug: "site-settings" });
  const _creating = await convenient.findSingle({
    slug: "site-settings",
    createIfMissing: true,
  });
  const _notCreating = await convenient.findSingle({
    slug: "site-settings",
    createIfMissing: false,
  });
  const _either = await convenient.findSingle({
    slug: "site-settings",
    createIfMissing: maybe,
  });

  assertType<Exact<typeof _default, Row>>(true);
  assertType<Exact<typeof _creating, Row>>(true);
  assertType<Exact<typeof _notCreating, Row | null>>(true);
  assertType<Exact<typeof _either, Row | null>>(true);
}

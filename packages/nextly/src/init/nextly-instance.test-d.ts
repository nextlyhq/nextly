import type { LoginResult } from "../direct-api/types/auth";

import type { Nextly } from "./nextly-instance";

// What `getNextly()` hands back is typed by the `Nextly` interface here, so its
// `login()` must be typed as what the Direct API returns: the user, the token
// and the token's expiry. Read through a real call, because that is how the
// documented `result.token` is used.
//
// In a `.test-d.ts` because tsconfig excludes `.test.ts`: `pnpm check-types`
// compiles this file, and the runner would transpile its types away.

/** `Exact<A, B>` is `false` when the two types differ in either direction. */
type Exact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

declare function assertType<T extends true>(proof: T): void;

declare const nextly: Nextly;

export async function _readLogin(): Promise<void> {
  // Underscore-prefixed: read only as a type, which lint calls unused.
  const _result = await nextly.login({
    email: "ada@example.com",
    password: "Passw0rd!",
  });

  assertType<Exact<typeof _result, LoginResult>>(true);
  assertType<Exact<typeof _result.user, Record<string, unknown>>>(true);
  assertType<Exact<typeof _result.token, string>>(true);
  assertType<Exact<typeof _result.exp, number>>(true);
}

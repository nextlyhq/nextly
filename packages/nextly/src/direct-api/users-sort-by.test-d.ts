import type { FindUsersArgs } from "./types/users";

// A users read sorts by a built-in column or by a custom user field, which
// the query service accepts by name; the argument type says so, so a caller
// needs no cast to sort by one, or to see a hidden one refused.
//
// In a `.test-d.ts` because tsconfig excludes `.test.ts`: `pnpm check-types`
// compiles this file.

const builtIn: FindUsersArgs = { sortBy: "createdAt" };
const custom: FindUsersArgs = { sortBy: "badge" };

export const sortsAccepted = [builtIn, custom];

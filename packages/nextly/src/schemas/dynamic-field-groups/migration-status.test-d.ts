/**
 * The migration-status union has ONE declaration, and these assertions are what keep it that way.
 *
 * The failure this guards is silent by construction, which is why it is asserted at the type level
 * rather than at runtime. Four places used to spell the set out independently — the schema type, the
 * runtime list, the Direct API's definition and its filter — and adding `diverged` meant editing all
 * of them. Nothing related them, so a future status could be RETURNED by `find()` while being
 * impossible to ASK for as a filter, and no test and no compiler would object.
 *
 * A runtime test cannot see any of that: every one of those unions erases to `string`, so a suite
 * exercising real values passes whether or not the relationship holds. The checker is the only
 * instrument that can, so the contract is written where it can read it.
 */
import { expectTypeOf } from "vitest";

import type {
  FindFieldGroupsArgs,
  FieldGroupDefinition,
} from "../../direct-api/types/field-groups";

import type {
  FIELD_GROUP_MIGRATION_STATUSES,
  type FieldGroupMigrationStatus,
} from "./types";

// The type IS the list's element type. Written as a mutual assignability check rather than a
// one-way `toMatchTypeOf`, because a union WIDER than the list satisfies one direction while
// carrying a status the validator would reject — the exact drift being prevented.
expectTypeOf<
  (typeof FIELD_GROUP_MIGRATION_STATUSES)[number]
>().toEqualTypeOf<FieldGroupMigrationStatus>();

// What the API RETURNS and what it can be ASKED for are the same set. Asserted in both directions:
// a filter narrower than the definition leaves a returnable status unrequestable, and one wider
// accepts a value the column can never hold.
expectTypeOf<
  FieldGroupDefinition["migrationStatus"]
>().toEqualTypeOf<FieldGroupMigrationStatus>();
expectTypeOf<
  NonNullable<FindFieldGroupsArgs["migrationStatus"]>
>().toEqualTypeOf<FieldGroupMigrationStatus>();

// A positive control on the instrument itself: the assertions above are only meaningful if this
// union is a specific set of literals rather than `string`, which would make every check above
// trivially true.
expectTypeOf<FieldGroupMigrationStatus>().not.toEqualTypeOf<string>();

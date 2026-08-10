// Imported from the package root on purpose: these are the argument and result
// types of a public namespace, so a caller must be able to name them without
// reaching into an internal path. Importing them from "../types/index" instead
// would still compile while the root export was missing, asserting nothing.
import type {
  CreateFieldGroupArgs,
  DeleteFieldGroupArgs,
  FieldGroupDefinition,
  FindFieldGroupBySlugArgs,
  FindFieldGroupsArgs,
  UpdateFieldGroupArgs,
} from "../../index";
import type { Nextly as InitNextly } from "../../init/nextly-instance";

// Compile-time contract for the public field-group surface. These assertions
// live in a `.test-d.ts` rather than a `.test.ts` because tsconfig excludes the
// latter: type-level assertions placed in a normal test file are transpiled away
// by the runner and checked by nothing.

/** `Exact<A, B>` is `false` when the two types differ in either direction. */
type Exact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

declare function assertType<T extends true>(proof: T): void;

// Each root export must resolve to a real object type. A missing re-export
// makes the import above an error; `any` would make these assertions pass
// vacuously, so each is pinned to a known member instead.
assertType<Exact<FieldGroupDefinition["slug"], string>>(true);
assertType<Exact<FindFieldGroupBySlugArgs["slug"], string>>(true);
assertType<Exact<CreateFieldGroupArgs["slug"], string>>(true);
assertType<Exact<UpdateFieldGroupArgs["slug"], string>>(true);
assertType<Exact<DeleteFieldGroupArgs["slug"], string>>(true);
assertType<Exact<FindFieldGroupsArgs["search"], string | undefined>>(true);

// The instance returned by the async `getNextly()` must expose the namespace
// too. It is a separately declared surface from the `Nextly` class, so the
// namespace being reachable on one says nothing about the other.
type InitFieldGroups = InitNextly["fieldGroups"];

assertType<
  Exact<
    Awaited<ReturnType<InitFieldGroups["findBySlug"]>>,
    FieldGroupDefinition | null
  >
>(true);
assertType<
  Exact<Parameters<InitFieldGroups["create"]>[0], CreateFieldGroupArgs>
>(true);

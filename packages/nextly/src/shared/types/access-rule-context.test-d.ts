/**
 * The compile-time half of the one rule context: a collection rule, a Single
 * rule and a field rule are typed with the same context, and it holds every
 * property each kind of rule read before they shared it. Every assertion here
 * is evaluated by the checker, so none of them can pass on an unrelated error.
 */
import { expectTypeOf } from "vitest";

import type {
  AccessFunction,
  FieldAccess,
  RequestContext,
} from "../../collections/fields/types/base";
import type { Principal } from "../../plugins/principals/types";

import type {
  AccessControlContext,
  AccessControlFunction,
  AccessRuleContext,
  CollectionAccessControl,
  MinimalUser,
  SingleAccessControl,
} from "./access";

// One context: what a collection or Single rule is handed, and what a field
// rule is handed, are the same type.
expectTypeOf<AccessControlContext>().toEqualTypeOf<AccessRuleContext>();
expectTypeOf<
  Parameters<AccessControlFunction>[0]
>().toEqualTypeOf<AccessRuleContext>();
expectTypeOf<
  Parameters<AccessFunction>[0]
>().toEqualTypeOf<AccessRuleContext>();
expectTypeOf<
  Parameters<Extract<FieldAccess["read"], AccessFunction>>[0]
>().toEqualTypeOf<AccessRuleContext>();
expectTypeOf<
  Parameters<Extract<CollectionAccessControl["read"], AccessControlFunction>>[0]
>().toEqualTypeOf<AccessRuleContext>();
expectTypeOf<
  Parameters<Extract<SingleAccessControl["update"], AccessControlFunction>>[0]
>().toEqualTypeOf<AccessRuleContext>();

// The caller, its permissions, the operation and the target.
expectTypeOf<AccessRuleContext["user"]>().toEqualTypeOf<MinimalUser | null>();
expectTypeOf<AccessRuleContext["roles"]>().toEqualTypeOf<string[]>();
expectTypeOf<AccessRuleContext["permissions"]>().toEqualTypeOf<string[]>();
expectTypeOf<
  AccessRuleContext["principal"]
>().toEqualTypeOf<Principal | null>();
expectTypeOf<AccessRuleContext["operation"]>().toEqualTypeOf<
  "create" | "read" | "update" | "delete" | "publish" | "unpublish"
>();
expectTypeOf<AccessRuleContext["target"]>().toEqualTypeOf<{
  kind: "collection" | "single" | "component";
  slug: string;
}>();

// What a collection rule read before: kept, so such a rule still compiles.
expectTypeOf<AccessRuleContext["collection"]>().toEqualTypeOf<string>();

// What a field rule read before: the request, and the entry where known.
expectTypeOf<AccessRuleContext["req"]>().toEqualTypeOf<RequestContext>();
expectTypeOf<AccessRuleContext>()
  .toHaveProperty("id")
  .toEqualTypeOf<string | undefined>();
expectTypeOf<AccessRuleContext>()
  .toHaveProperty("data")
  .toEqualTypeOf<Record<string, unknown> | undefined>();

// A rule written against either earlier shape is still a rule of each kind.
type TodaysCollectionRule = (ctx: {
  user: MinimalUser | null;
  roles: string[];
  permissions: string[];
  principal: Principal | null;
  operation: string;
  collection: string;
}) => boolean;
type TodaysFieldRule = (args: {
  req: RequestContext;
  id?: string;
  data?: Record<string, unknown>;
  permissions: string[];
  roles: string[];
  principal: Principal | null;
}) => boolean;
expectTypeOf<TodaysCollectionRule>().toExtend<AccessControlFunction>();
expectTypeOf<TodaysFieldRule>().toExtend<AccessFunction>();

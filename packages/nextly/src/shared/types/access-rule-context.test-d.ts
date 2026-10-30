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
import type { CollectionFilterRule } from "./rule-filter";

// One context: what a collection or Single rule is handed, and what a field
// rule is handed, are the same type, however each is reached. A rule may also
// be `true` or `false`, so the function form is taken out of each.
type HandedContexts = [
  AccessControlContext,
  Parameters<AccessControlFunction>[0],
  Parameters<AccessFunction>[0],
  Parameters<Extract<FieldAccess["read"], AccessFunction>>[0],
  Parameters<Extract<CollectionAccessControl["read"], CollectionFilterRule>>[0],
  Parameters<Extract<SingleAccessControl["update"], AccessControlFunction>>[0],
];
expectTypeOf<HandedContexts>().toEqualTypeOf<
  [
    AccessRuleContext,
    AccessRuleContext,
    AccessRuleContext,
    AccessRuleContext,
    AccessRuleContext,
    AccessRuleContext,
  ]
>();

// Its whole shape, so a property lost, retyped or added fails here: the
// caller, its permissions, the operation and the target; what a collection
// rule read before (`collection`); what a field rule read before (`req`, and
// the entry where known); and the language judged with every language the
// operation involves.
expectTypeOf<AccessRuleContext>().toEqualTypeOf<{
  user: MinimalUser | null;
  req: RequestContext;
  roles: string[];
  permissions: string[];
  principal: Principal | null;
  operation: "create" | "read" | "update" | "delete" | "publish" | "unpublish";
  target: { kind: "collection" | "single" | "component"; slug: string };
  collection: string;
  id?: string;
  data?: Record<string, unknown>;
  locale?: string;
  locales: string[];
}>();

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

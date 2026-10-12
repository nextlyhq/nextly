/**
 * The types a hook point carries, keyed by its name.
 *
 * A point's name is a string, so without a map from name to type every
 * handler and every call site of `ctx.filters` and `ctx.actions` saw `unknown`
 * and wrote its own types, which nothing checked against the point's owner or
 * against each other. Types only: nothing here runs.
 *
 * @module plugins/hook-point-payloads
 */
import type { Decision } from "../filters/filter-registry";
import type {
  EmailAfterSendValue,
  EmailFilterContext,
  EmailPayloadFilterValue,
  ListQueryFilterContext,
  ListQueryWhere,
  NavCollectionItem,
  NavFilterContext,
} from "../filters/seams";

/**
 * @experimental What each hook point carries, by name.
 *
 * Core's seams are listed here. A plugin that publishes a point in
 * `contributes.hookPoints` adds its own by augmenting this interface, and
 * every plugin that calls or extends the point is then checked against it:
 *
 * ```ts
 * declare module "@nextlyhq/plugin-sdk" {
 *   interface HookPointPayloads {
 *     "acme-auth.profile": {
 *       kind: "filter";
 *       value: { displayName: string };
 *       context: { userId: string };
 *     };
 *     "acme-auth.may-link": { kind: "decision"; context: { email: string } };
 *     "acme-auth.linked": { kind: "action"; payload: { userId: string } };
 *   }
 * }
 * ```
 *
 * A `filter` names the `value` it threads, an `action` the `payload` it
 * hands each handler, and a `decision` the `context` being decided — its value
 * is always a {@link Decision}. `context` is optional on all three.
 *
 * A name with no entry keeps the generic signatures, typed by the call site.
 * A named point used through the wrong registry — a `decision` through
 * `apply`, say — does not compile, as it is refused at run time.
 */
export interface HookPointPayloads {
  "email.beforeSend": {
    kind: "filter";
    value: EmailPayloadFilterValue;
    context: EmailFilterContext;
  };
  "email.afterSend": {
    kind: "action";
    payload: EmailAfterSendValue;
    context: EmailFilterContext;
  };
  "admin.nav": {
    kind: "filter";
    value: NavCollectionItem[];
    context: NavFilterContext;
  };
  "collections.listQuery": {
    kind: "filter";
    value: ListQueryWhere;
    context: ListQueryFilterContext;
  };
}

/** The entry a name has in {@link HookPointPayloads}, or `never` without one. */
type HookPointEntry<N> = N extends keyof HookPointPayloads
  ? HookPointPayloads[N]
  : never;

/**
 * `N` when it is a point of one of `K`'s kinds or has no entry, and `never`
 * when its entry declares another kind.
 *
 * @experimental
 */
export type HookPointNameOf<N extends string, K extends string> = [
  HookPointEntry<N>,
] extends [never]
  ? N
  : HookPointEntry<N> extends { kind: K }
    ? N
    : never;

/**
 * The value a filter or decision handler at `N` receives and returns: the
 * declared `value`, a {@link Decision} at a decision point, or `V` for a name
 * with no entry.
 *
 * @experimental
 */
export type HookPointValue<N, V> = [HookPointEntry<N>] extends [never]
  ? V
  : HookPointEntry<N> extends { kind: "decision" }
    ? Decision
    : HookPointEntry<N> extends { value: infer X }
      ? X
      : V;

/**
 * The payload an action at `N` hands each handler, or `P` for a name with no
 * entry.
 *
 * @experimental
 */
export type HookPointPayload<N, P> = [HookPointEntry<N>] extends [never]
  ? P
  : HookPointEntry<N> extends { payload: infer X }
    ? X
    : P;

/**
 * The context a handler at `N` receives, or `C` for a name with no entry or
 * an entry that declares none.
 *
 * @experimental
 */
export type HookPointContext<N, C> = [HookPointEntry<N>] extends [never]
  ? C
  : HookPointEntry<N> extends { context: infer X }
    ? X
    : C;

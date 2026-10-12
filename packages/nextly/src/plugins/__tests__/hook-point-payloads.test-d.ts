/**
 * A hook point's name decides the types of its handlers and its call sites.
 *
 * Checked by `tsc -p tsconfig.tests.json`. Core's seams are typed by their
 * entries, a plugin's point by the entry it adds through augmentation, and a
 * name with no entry keeps the inference and explicit type arguments it had.
 */
import { expectTypeOf } from "vitest";

import type { Decision } from "../../filters/filter-registry";
import type {
  EmailAfterSendValue,
  EmailPayloadFilterValue,
  NavCollectionItem,
} from "../../filters/seams";
import type {
  PluginActionRegistry,
  PluginFilterRegistry,
} from "../plugin-context";

declare module "../hook-point-payloads" {
  interface HookPointPayloads {
    "acme-auth.profile": {
      kind: "filter";
      value: { displayName: string };
      context: { userId: string };
    };
    "acme-auth.may-link": { kind: "decision"; context: { email: string } };
    "acme-auth.linked": { kind: "action"; payload: { userId: string } };
  }
}

declare const filters: PluginFilterRegistry;
declare const actions: PluginActionRegistry;

// Core's seams: the handler is typed by the seam's entry.
filters.add("email.beforeSend", (value, context) => {
  expectTypeOf(value).toEqualTypeOf<EmailPayloadFilterValue>();
  expectTypeOf(context.providerId).toEqualTypeOf<string | undefined>();
  return value;
});
filters.add("admin.nav", items => {
  expectTypeOf(items).toEqualTypeOf<NavCollectionItem[]>();
  return items;
});
actions.add("email.afterSend", payload => {
  expectTypeOf(payload).toEqualTypeOf<EmailAfterSendValue>();
});

// A plugin's point, declared by augmentation.
filters.add("acme-auth.profile", (value, context) => {
  expectTypeOf(value).toEqualTypeOf<{ displayName: string }>();
  expectTypeOf(context).toEqualTypeOf<{ userId: string }>();
  return value;
});
expectTypeOf(
  filters.apply("acme-auth.profile", { displayName: "A" }, { userId: "u" })
).toEqualTypeOf<Promise<{ displayName: string }>>();
// @ts-expect-error the value is the point's, not any object
void filters.apply("acme-auth.profile", { name: "A" }, { userId: "u" });
// @ts-expect-error the context is the point's too
void filters.apply("acme-auth.profile", { displayName: "A" }, { id: "u" });

// A decision's handlers see a Decision, and its context is the point's.
filters.add("acme-auth.may-link", (verdict, context) => {
  expectTypeOf(verdict).toEqualTypeOf<Decision>();
  expectTypeOf(context).toEqualTypeOf<{ email: string }>();
  return verdict;
});
void filters.decide("acme-auth.may-link", { allow: true }, { email: "a@b.c" });
// @ts-expect-error the context being decided is the point's
void filters.decide("acme-auth.may-link", { allow: true }, { mail: "a@b.c" });

// The registry must match the kind: a decision run as a filter loses its veto,
// and is refused at run time; here it does not compile.
// @ts-expect-error a decision point is not applied as a filter
void filters.apply("acme-auth.may-link", { allow: true }, { email: "a@b.c" });
// @ts-expect-error an action point is not a filter
filters.add("acme-auth.linked", value => value);

void actions.run("acme-auth.linked", { userId: "u" }, undefined);
// @ts-expect-error the payload is the point's
void actions.run("acme-auth.linked", { user: "u" }, undefined);

// A name with no entry: inference from the call, as before.
expectTypeOf(filters.apply("acme-cache.key", 5, { at: 1 })).toEqualTypeOf<
  Promise<number>
>();
filters.add("acme-cache.key", (value: string, context: { at: number }) =>
  value.slice(context.at)
);
// And explicit type arguments mean what they did.
expectTypeOf(
  filters.apply<string, number>("acme-cache.key", "k", 1)
).toEqualTypeOf<Promise<string>>();
actions.add<{ n: number }, string>("acme-cache.cleared", (payload, context) => {
  expectTypeOf(payload).toEqualTypeOf<{ n: number }>();
  expectTypeOf(context).toEqualTypeOf<string>();
});

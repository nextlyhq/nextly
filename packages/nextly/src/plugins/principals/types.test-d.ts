/**
 * The compile-time half of a kind's contract: attribute descriptors typed
 * from the values a resolver returns, and a person that holds nothing of
 * staff. Every assertion here is evaluated by the checker, so none of them
 * can pass on an unrelated error.
 */
import { expectTypeOf } from "vitest";

import { definePlugin } from "../plugin-context";
import type { PluginRouteContext } from "../routes/route-types";

import type {
  Principal,
  PrincipalAttributeDescriptors,
  PrincipalAttributesOf,
  PrincipalKindDefinition,
} from "./types";

type Member = { verified: boolean; plan: string | null; visits: number };

// Each descriptor is the one its value's type takes, `null` aside.
expectTypeOf<PrincipalAttributeDescriptors<Member>>().toEqualTypeOf<{
  readonly verified: "boolean";
  readonly plan: "string";
  readonly visits: "number";
}>();

// So a kind cannot describe an attribute as a type its values do not have:
// `verified` is a boolean, and a definition calling it a string is not one.
expectTypeOf<{
  name: string;
  attributes: { verified: "string"; plan: "string"; visits: "number" };
  resolve: (request: Request) => Promise<null>;
}>().not.toExtend<PrincipalKindDefinition<Member>>();

// The same definition with the right descriptor is one: the control for the
// refusal above.
expectTypeOf<{
  name: string;
  attributes: { verified: "boolean"; plan: "string"; visits: "number" };
  resolve: (request: Request) => Promise<null>;
}>().toExtend<PrincipalKindDefinition<Member>>();

// A person holds no role and no permission, and is never a staff user.
expectTypeOf<Principal>().not.toHaveProperty("roles");
expectTypeOf<Principal>().not.toHaveProperty("permissions");
expectTypeOf<Principal>().not.toHaveProperty("email");
expectTypeOf<Principal["type"]>().toEqualTypeOf<"principal">();

// A route handler sees the person, or nobody.
expectTypeOf<
  PluginRouteContext["principal"]
>().toEqualTypeOf<Principal | null>();

// A kind's attributes may be an interface, which has no index signature,
// and the kind registers like one typed with a type alias.
interface Account {
  verified: boolean;
  plan: string | null;
}
expectTypeOf<PrincipalAttributeDescriptors<Account>>().toEqualTypeOf<{
  readonly verified: "boolean";
  readonly plan: "string";
}>();
const account: PrincipalKindDefinition<Account> = {
  name: "account",
  attributes: { verified: "boolean", plan: "string" },
  resolve: () => Promise.resolve(null),
};

// An attribute of a type no attribute may hold is still refused.
expectTypeOf<{ joined: Date }>().not.toExtend<
  PrincipalAttributesOf<{ joined: Date }>
>();

// A typed kind registers, and a route asks for it.
const member: PrincipalKindDefinition<Member> = {
  name: "member",
  attributes: { verified: "boolean", plan: "string", visits: "number" },
  resolve: () =>
    Promise.resolve({
      id: "m1",
      attributes: { verified: true, plan: null, visits: 0 },
    }),
};
definePlugin({
  name: "@acme/members",
  version: "1.0.0",
  nextly: ">=0.0.1",
  contributes: {
    principals: [member, account],
    routes: [
      {
        method: "GET",
        path: "/me",
        principal: { kind: "acme-members:member" },
        handler: (_req, ctx) => Response.json({ id: ctx.principal?.id }),
      },
    ],
  },
});

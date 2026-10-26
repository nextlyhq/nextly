import type { PluginEmailTemplate } from "../../../plugins/contributions";
import type {
  EmailTemplateVariable,
  EmailTemplateVariableType,
} from "../../../schemas/email-templates/types";

// Typed variable declarations, for core and for plugins: today's shapes still
// compile, and the new fields take only what they should. Compiled by
// `pnpm check-types` (a `.test-d.ts`, which tsconfig doesn't exclude).

type Assignable<A, B> = [A] extends [B] ? true : false;
declare function assertType<T extends true>(proof: T): void;
declare function assertNot<T extends false>(proof: T): void;

type PluginVariable = NonNullable<PluginEmailTemplate["variables"]>[number];

// Today's declarations.
assertType<
  Assignable<
    { name: string; description: string; required: boolean },
    EmailTemplateVariable
  >
>(true);
assertType<Assignable<{ name: string }, PluginVariable>>(true);
assertType<Assignable<{ name: string; required: boolean }, PluginVariable>>(
  true
);

// A typed one, with a list's item fields, in either place.
const order = {
  name: "lines",
  description: "The order's lines",
  type: "list",
  label: "Order lines",
  example: [{ title: "Tea", price: 4 }],
  fields: [
    { name: "title", type: "text" },
    { name: "price", type: "money", label: "Price" },
  ],
} as const satisfies EmailTemplateVariable;
assertType<Assignable<typeof order, PluginVariable>>(true);

// Core's declarations still need a description; a plugin's don't.
assertNot<Assignable<{ name: string }, EmailTemplateVariable>>(false);

// Only the declared kinds.
assertNot<Assignable<"colour", EmailTemplateVariableType>>(false);
assertNot<
  Assignable<
    { name: string; description: string; type: "colour" },
    EmailTemplateVariable
  >
>(false);

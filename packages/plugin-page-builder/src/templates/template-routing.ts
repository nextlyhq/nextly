/**
 * A collection's template address set at runtime: stored on its template,
 * judged at save, and changed only by someone allowed to change routing.
 *
 * A collection defined in code declares its address in code
 * (`pageBuilder({ templates: { addresses } })`). One created in the Schema
 * Builder has no code to declare it in, so its template stores it, in the
 * `address` field, and its entries are served there with no restart. Moving
 * an address moves every entry's live address, so setting or changing one is
 * its own permission, `manage-template-routing`, apart from editing
 * templates: the field's create and update rules ask it on every write a
 * person makes, and the template action asks it first.
 *
 * A stored address is judged as a declared one is: one spelling, outside the
 * paths the runtime keeps, and held by one collection, compared with every
 * other template's stored address and every address declared in code. A
 * collection whose address is declared in code is served there whatever its
 * template stores, so a collection promoted into code keeping its own stored
 * address is no clash.
 *
 * @module templates/template-routing
 */
import { NextlyError } from "@nextlyhq/plugin-sdk";

import { templateAddressProblem } from "./template-addresses";

/** The permission that sets or changes a template address, in its parts. */
const MANAGE_TEMPLATE_ROUTING = {
  action: "manage",
  resource: "template-routing",
} as const;

/** The permission as a caller is asked it: `ctx.caller.can(action, resource)`. */
export const TEMPLATE_ROUTING_ASK: readonly [action: string, resource: string] =
  [MANAGE_TEMPLATE_ROUTING.action, MANAGE_TEMPLATE_ROUTING.resource];

/** The same permission as the role screen and a field rule spell it. */
export const MANAGE_TEMPLATE_ROUTING_PERMISSION: string = `${MANAGE_TEMPLATE_ROUTING.action}-${MANAGE_TEMPLATE_ROUTING.resource}`;

/**
 * The permission as the plugin declares it: apart from updating templates,
 * since an address change moves every entry's live address.
 */
export const MANAGE_TEMPLATE_ROUTING_DECLARATION: {
  readonly action: string;
  readonly resource: string;
  readonly label: string;
  readonly description: string;
} = {
  action: MANAGE_TEMPLATE_ROUTING.action,
  resource: MANAGE_TEMPLATE_ROUTING.resource,
  label: "Manage template routing",
  description:
    "Set or change the address a collection's entries are served at. A change moves every entry's live address.",
};

/** The template field holding a runtime collection's address. */
export const TEMPLATE_ADDRESS_FIELD = "address";

/** The parts of a field rule's context the routing rule reads. */
interface RuleCaller {
  readonly roles?: readonly string[];
  readonly permissions?: readonly string[];
}

/**
 * The address field's create and update rule: the caller holds the routing
 * permission, as the role screen grants it. A super admin holds every
 * permission, and is admitted as core's gate admits one. Anyone else's value
 * is taken out of the write, so the stored address stays as it was.
 */
export function mayManageTemplateRouting(context: RuleCaller): boolean {
  return (
    context.roles?.includes("super-admin") === true ||
    context.permissions?.includes(MANAGE_TEMPLATE_ROUTING_PERMISSION) === true
  );
}

/**
 * An address as a write gives it, with an empty value, which a cleared input
 * sends, read as none, so two templates without an address never meet at the
 * unique index. Anything else is kept for the guard to judge.
 */
export function writtenAddressOf(value: unknown): unknown {
  return value === "" ? null : value;
}

/** A stored address, or null for none. */
export function storedAddressOf(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

/** The template already serving its collection at an address. */
export interface AddressedTemplate {
  readonly id: string;
  /** The collection it serves. */
  readonly collection: string;
}

/** The template whose stored address is `address`, read as the system, or null. */
export type AddressHolderRead = (
  address: string
) => Promise<AddressedTemplate | null>;

/** What a stored address is judged against. */
export interface StoredAddressJudge {
  /** Each code-declared address, by collection slug. */
  readonly declared: ReadonlyMap<string, string>;
}

/**
 * Why `address` cannot be stored for `collection`'s template, judged without
 * reading anything: its one spelling, and that no other collection declares
 * it in code. Null when neither refuses it.
 */
export function storedAddressProblem(
  address: unknown,
  collection: unknown,
  judge: StoredAddressJudge
): string | null {
  const problem = templateAddressProblem(address);
  if (problem !== null) return problem;
  // A collection given its address in code is served there whatever its
  // template stores, so a different stored one would be shown and never
  // used, until the day the declaration goes and it silently takes over.
  const own =
    typeof collection === "string" ? judge.declared.get(collection) : undefined;
  if (own !== undefined && own !== address) {
    return `The collection "${String(collection)}" is given its address in code (${own}): change it there.`;
  }
  for (const [declaredFor, declared] of judge.declared) {
    // A collection promoted into code that keeps its own stored address is
    // served at the declared one; its stored one is no rival to it.
    if (declared === address && declaredFor !== collection) {
      return `"${String(address)}" is the address the collection "${declaredFor}" is given in code. Each collection needs an address of its own.`;
    }
  }
  return null;
}

/** The refusal of a template address, in the guard's words. */
export function addressRefusal(message: string): NextlyError {
  return NextlyError.validation({
    errors: [
      { path: TEMPLATE_ADDRESS_FIELD, code: "TEMPLATE_ADDRESS", message },
    ],
    logContext: { reason: "template-address-refused" },
  });
}

/** The refusal of an address another collection's template stores. */
export function heldAddressMessage(
  address: string,
  holder: AddressedTemplate
): string {
  return `"${address}" is already the address of the collection "${holder.collection}". Each collection needs an address of its own.`;
}

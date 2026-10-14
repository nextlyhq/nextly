/**
 * The kinds of signed-in person a plugin defines, and what core hands out for
 * one.
 *
 * Core knows staff, an API key and itself. A plugin that signs in anyone else,
 * a shop's customers or a site's members, registers its own kind: a name, the
 * attributes it exposes, and a resolver core calls to recognise such a person
 * on a request. Core calls a resolver only at an entry point that asks for
 * that kind, so no staff path ever recognises one, and a person never holds a
 * role, a permission or a staff user's id.
 *
 * @module plugins/principals/types
 */

/** @experimental The type an attribute of a kind may declare. */
export type PrincipalAttributeType = "boolean" | "string" | "number";

/** @experimental A value an attribute may hold. `null` is "not known". */
export type PrincipalAttributeValue = boolean | string | number | null;

/** @experimental A kind's attributes, by name. */
export type PrincipalAttributes = Record<string, PrincipalAttributeValue>;

/**
 * @experimental The bound on a kind's attribute shape `A`: every attribute a
 * value an attribute may hold.
 *
 * Checked key by key rather than as {@link PrincipalAttributes}, because an
 * `interface` has no index signature and is never assignable to a record:
 * `interface Account { verified: boolean }` would otherwise be refused as a
 * kind's attributes although every one of them is allowed.
 *
 * Every key is REQUIRED here (`-?`), so an optional attribute such as
 * `plan?: string` does not satisfy it: a declared attribute always has a
 * value or `null`, and an optional one would let a resolver leave it out
 * while the person's type still claimed it.
 */
export type PrincipalAttributesOf<A> = {
  [K in keyof A]-?: PrincipalAttributeValue;
};

/**
 * @experimental The descriptor a value's type takes.
 *
 * Mapped from the value rather than left open, so a kind whose attributes are
 * `{ verified: boolean }` cannot describe `verified` as `"string"`: the
 * declaration and the values the resolver returns are checked against each
 * other where the kind is written. A value whose type is wider than one
 * descriptor, as in an unparameterised kind, may take any of them.
 */
export type PrincipalAttributeTypeOf<V> = [NonNullable<V>] extends [boolean]
  ? "boolean"
  : [NonNullable<V>] extends [string]
    ? "string"
    : [NonNullable<V>] extends [number]
      ? "number"
      : PrincipalAttributeType;

/** @experimental A kind's attribute descriptors, typed from its values. */
export type PrincipalAttributeDescriptors<A extends PrincipalAttributesOf<A>> =
  {
    readonly [K in keyof A]: PrincipalAttributeTypeOf<A[K]>;
  };

/** @experimental What a resolver or a lookup answers for one person. */
export interface PrincipalRecord<
  A extends PrincipalAttributesOf<A> = PrincipalAttributes,
> {
  /**
   * Non-empty, at most 128 characters, unique within the kind, never reused
   * once the person is reported deleted. An answer outside those bounds is
   * taken for nobody.
   */
  id: string;
  /** Every declared attribute, with a value of its declared type or `null`. */
  attributes: A;
}

/**
 * @experimental A kind of signed-in person, registered in
 * `contributes.principals`.
 */
export interface PrincipalKindDefinition<
  A extends PrincipalAttributesOf<A> = PrincipalAttributes,
> {
  /**
   * `[a-z][a-z0-9-]{0,31}`. Core names the kind `<plugin>:<name>`, where
   * `<plugin>` is the plugin's slug, so the name is always the plugin's own.
   */
  name: string;
  /**
   * Every attribute the kind exposes, with its type. Nothing else a resolver
   * returns reaches an access rule.
   */
  attributes: PrincipalAttributeDescriptors<A>;
  /**
   * Who of this kind signed in on this request, from the plugin's own
   * session, or `null` for nobody. Core calls it only at an entry point that
   * asks for this kind, at most once per request. A throw counts as nobody
   * and is logged, without the request's credentials.
   */
  resolve(request: Request): Promise<PrincipalRecord<A> | null>;
  /** Optional. The person with this id, for running as them without a request. */
  lookup?(id: string): Promise<PrincipalRecord<A> | null>;
}

/**
 * @experimental Any kind, whatever its attributes: what
 * `contributes.principals` holds.
 *
 * Its own type rather than {@link PrincipalKindDefinition} at its default,
 * for the reason {@link PrincipalAttributesOf} exists: a kind typed with an
 * interface answers records whose attributes no record type accepts. Each
 * entry is checked when it is collected, and every answer as it arrives.
 */
export interface PrincipalKindContribution {
  name: string;
  attributes: { readonly [name: string]: PrincipalAttributeType };
  resolve(request: Request): Promise<PrincipalAnswer | null>;
  lookup?(id: string): Promise<PrincipalAnswer | null>;
}

/** @experimental What a kind's resolver or lookup answers, at its widest. */
export interface PrincipalAnswer {
  id: string;
  attributes: object;
}

/**
 * @experimental A signed-in person of a plugin-defined kind, as core hands
 * one out.
 *
 * Made only by core: where core accepts a person, it refuses one built by
 * hand. Holds no role and no permission, and its id is never a staff user's.
 */
export interface Principal<
  A extends PrincipalAttributesOf<A> = PrincipalAttributes,
> {
  readonly type: "principal";
  /** `<plugin>:<name>`, e.g. `"accounts:account"`. */
  readonly kind: string;
  readonly id: string;
  readonly attributes: Readonly<A>;
}

/**
 * @experimental A person named by kind and id, without their attributes:
 * how audit rows, email records and deletion name one.
 */
export interface PrincipalRef {
  readonly kind: string;
  readonly id: string;
}

/**
 * @experimental A plugin route's request for a kind.
 *
 * A route carrying it reads neither the staff session nor an API key: its
 * handler sees the person or nobody. It cannot be combined with `public` or
 * `requiredPermission`; the app refuses to start on either pair.
 */
export interface PluginRoutePrincipal {
  /** The full kind, `<plugin>:<name>`, registered by a plugin. */
  kind: string;
  /**
   * Whether the route refuses a request with no such person, as any route
   * refuses an unauthenticated one. Defaults to `true`.
   */
  required?: boolean;
}

/**
 * @experimental Recognising a person from server code: `nextly.principals`.
 */
export interface NextlyPrincipals {
  /**
   * The person of `kind` signed in on `request`, or `null`. Calls the kind's
   * resolver at most once per request, whoever asks.
   */
  fromRequest(request: Request, kind: string): Promise<Principal | null>;
  /**
   * The person of `kind` with this id, through the kind's `lookup`, for
   * running as them without a request; `null` when the plugin returns
   * nobody for the id. Throws when the kind has no lookup. The answer is
   * checked as a resolver's is.
   */
  byId(kind: string, id: string): Promise<Principal | null>;
}

/**
 * @experimental Recognising a person of the plugin's own kinds:
 * `ctx.principals`, present when the plugin registers a kind.
 */
export interface PluginPrincipalsApi {
  /**
   * The person of the plugin's kind `name` signed in on `request`, or `null`.
   * Shares the per-request answer with every other entry point asking for
   * the same kind.
   */
  fromRequest(request: Request, name: string): Promise<Principal | null>;
  /**
   * The person of the plugin's kind `name` with this id, through the kind's
   * `lookup`, or `null`. Throws when the kind has no lookup.
   */
  byId(name: string, id: string): Promise<Principal | null>;
}

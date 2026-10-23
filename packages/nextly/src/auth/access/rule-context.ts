/**
 * What an access rule is handed: the one context, built in one place.
 *
 * A collection rule, a Single rule and a field rule are written by the same
 * person and read the same names, so every way of asking a rule hands it a
 * context made here. Two builders that agree today are how a permission came
 * to be spelled one way in one rule and another way in the next, and why a
 * rule mixing them "silently answered denied".
 *
 * Permissions are spelled as the role screen and the database spell them,
 * `read-posts`. For one release the list also carries the spelling rules were
 * handed before, `posts:read`, after the others, so no existing rule changes
 * its answer however it reads the list. A rule that checks that spelling with
 * `includes`, `indexOf` or `lastIndexOf` is warned once, naming the spelling
 * to write instead.
 *
 * @module auth/access/rule-context
 */
import type { RequestContext } from "../../collections/fields/types/base";
import type { Principal } from "../../plugins/principals/types";
import { consoleLogger } from "../../shared/types";
import type {
  AccessRuleContext,
  AccessRuleOperation,
  AccessRuleTarget,
  MinimalUser,
} from "../../shared/types/access";
import type { GrantedPermission } from "../authenticated-scope";

import { currentRuleLanguage, languagesOfContent } from "./rule-language";

/**
 * One permission a caller holds: its row, or its stored slug alone where the
 * caller's scope never carried the row. A slug alone is handed as stored and
 * has no earlier spelling, since a slug cannot be split back into its action
 * and resource (a resource may itself contain a hyphen).
 */
export type HeldPermission = GrantedPermission | string;

/** Who is asking, as the rule is told. */
export interface RuleCaller {
  /** The staff user, or the user who made the key; `null` for anyone else. */
  user: MinimalUser | null;
  /**
   * The user object the request carries, when it holds more than `user`.
   * Defaults to `user` with the caller's `roles`.
   */
  requestUser?: RequestContext["user"];
  roles: readonly string[];
  permissions: readonly HeldPermission[];
  principal: Principal | null;
}

/** What the rule is asked. */
export interface RuleQuestion {
  operation: AccessRuleOperation;
  target: AccessRuleTarget;
  /** The language this answer is for, where the operation is in one. */
  locale?: string;
  /**
   * Every language the operation involves. Defaults to `locale` alone, or
   * to none.
   */
  locales?: readonly string[];
}

/**
 * The entry a rule judges, where one is known. Its property descriptors are
 * copied onto the context rather than its values, so a caller may pass
 * accessors and observe whether the rule reads the entry.
 */
export interface RuleEntry {
  readonly id?: string;
  readonly data?: Record<string, unknown>;
}

/** The earlier rule spelling: `<resource>:<action>`. */
const EARLIER_SPELLING = /^([^:\s]+):([^:\s]+)$/;

/** Rules already warned about the earlier spelling, so each is named once. */
const warnedRules = new WeakSet<object>();

/**
 * The permissions a rule is handed: each stored slug once, then, for one
 * release, each earlier spelling once. The list is a plain array, so a rule
 * may read or change it as it always could; `includes`, `indexOf` and
 * `lastIndexOf` also notice the earlier spelling and warn.
 */
function permissionList(
  held: readonly HeldPermission[],
  rule: object,
  question: RuleQuestion
): string[] {
  const slugs = new Set<string>();
  // Each earlier spelling, with the stored slug it stands for.
  const earlier = new Map<string, string>();
  for (const permission of held) {
    if (typeof permission === "string") {
      slugs.add(permission);
      continue;
    }
    slugs.add(permission.slug);
    const spelled = `${permission.resource}:${permission.action}`;
    if (!earlier.has(spelled)) earlier.set(spelled, permission.slug);
  }
  const list = [...slugs, ...earlier.keys()];

  const notice = (search: unknown): void => {
    if (typeof search !== "string" || warnedRules.has(rule)) return;
    const parts = EARLIER_SPELLING.exec(search);
    if (!parts) return;
    warnedRules.add(rule);
    // The stored slug only where the caller holds it: a slug may be custom
    // (`manage-api-keys` grants `update` on `api-keys`), and only a held row
    // says which, so an unheld permission is named by its parts instead of
    // by a slug that may not exist.
    const held = earlier.get(search);
    const instead =
      held !== undefined
        ? `check "${held}", as the role screen spells it`
        : `check the slug the role screen shows for action "${parts[2]}" on "${parts[1]}"`;
    consoleLogger.warn(
      `The ${question.operation} rule of "${question.target.slug}" checks the permission "${search}". ` +
        `That spelling is deprecated and stops being accepted in a later release: ${instead}.`
    );
  };
  // Own, non-enumerable methods over the array's own, so the list still
  // compares, spreads and serialises as the plain array it is.
  const lookups = {
    includes: (search: string, fromIndex?: number) => {
      notice(search);
      return Array.prototype.includes.call(list, search, fromIndex);
    },
    indexOf: (search: string, fromIndex?: number) => {
      notice(search);
      return Array.prototype.indexOf.call(list, search, fromIndex);
    },
    lastIndexOf: (search: string, fromIndex?: number) => {
      notice(search);
      // `lastIndexOf` reads an explicit `undefined` as index 0, so it is
      // passed only when the rule gave one.
      return fromIndex === undefined
        ? Array.prototype.lastIndexOf.call(list, search)
        : Array.prototype.lastIndexOf.call(list, search, fromIndex);
    },
  };
  for (const [name, value] of Object.entries(lookups)) {
    Object.defineProperty(list, name, {
      value,
      writable: true,
      configurable: true,
      enumerable: false,
    });
  }
  return list;
}

/**
 * The languages a question names, or, where it names none, those of the
 * operation it is asked inside (every configured language where that names
 * none either); every language where the target stores the same content in
 * each, see `languagesOfContent`. Each rule gets a list of its own, so a rule
 * that changes it changes nothing else.
 */
function languageOf(
  question: RuleQuestion
): Pick<AccessRuleContext, "locale" | "locales"> {
  const named = question.locale !== undefined || question.locales !== undefined;
  const { locale, locales } = languagesOfContent(
    question.target,
    named
      ? {
          locale: question.locale,
          locales:
            question.locales ??
            (question.locale !== undefined ? [question.locale] : []),
        }
      : currentRuleLanguage()
  );
  return {
    ...(locale !== undefined ? { locale } : {}),
    locales: [...locales],
  };
}

/**
 * The context `rule` is handed for this caller and question, with the entry
 * where one is known. `rule` identifies the rule, so an earlier spelling is
 * warned about once per rule however often it runs.
 */
export function buildRuleContext(
  rule: object,
  caller: RuleCaller,
  question: RuleQuestion,
  entry?: RuleEntry
): AccessRuleContext {
  const context: AccessRuleContext = {
    user: caller.user,
    req: {
      // Where no richer request user is at hand, the caller's id and roles,
      // the fields of a request user a rule can be told truthfully. Nothing
      // else is invented, so a predicate on a field it lacks reads absent.
      user:
        caller.requestUser ??
        (caller.user
          ? { ...caller.user, roles: [...caller.roles] }
          : undefined),
    },
    roles: [...caller.roles],
    permissions: permissionList(caller.permissions, rule, question),
    principal: caller.principal,
    operation: question.operation,
    target: { kind: question.target.kind, slug: question.target.slug },
    collection: question.target.slug,
    ...languageOf(question),
  };
  if (entry) {
    Object.defineProperties(context, Object.getOwnPropertyDescriptors(entry));
  }
  return context;
}

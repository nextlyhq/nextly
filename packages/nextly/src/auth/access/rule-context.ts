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
 * `read-posts`, and in no other way: the spelling rules were once handed,
 * `posts:read`, is not in the list, so a rule checking it does not allow.
 *
 * @module auth/access/rule-context
 */
import type { RequestContext } from "../../collections/fields/types/base";
import type { Principal } from "../../plugins/principals/types";
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
 * caller's scope never carried the row. A rule is handed the stored slug
 * either way.
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

/**
 * The permissions a rule is handed: each stored slug once, as the role screen
 * and the database spell it. The list is a plain array, so a rule may read or
 * change it as it always could.
 */
function permissionList(held: readonly HeldPermission[]): string[] {
  return [
    ...new Set(
      held.map(permission =>
        typeof permission === "string" ? permission : permission.slug
      )
    ),
  ];
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
 * The context a rule is handed for this caller and question, with the entry
 * where one is known.
 */
export function buildRuleContext(
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
    permissions: permissionList(caller.permissions),
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

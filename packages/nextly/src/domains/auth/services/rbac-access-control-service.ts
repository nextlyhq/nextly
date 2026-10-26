/**
 * RBAC Access Control Service
 *
 * Unified access control evaluation that merges code-defined access functions
 * (from `defineCollection({ access })` / `defineSingle({ access })`) with
 * database role/permission checks.
 *
 * Evaluation priority:
 * 1. **Super-admin bypass** — always returns `true`
 * 2. **Database permission** — checks RBAC tables via `hasPermission()`; a
 *    signed-in user without it is refused before any rule is asked
 * 3. **Code-defined access** — function or boolean from collection/single
 *    config, where it names the operation: it only narrows the permission,
 *    and allows only by answering `true`
 *
 * Default behavior: **deny** (fail-secure). If no code access is defined and
 * the user has no database permission for the resource+action, access is denied.
 *
 * Code-defined access configs are registered at startup via `registerCollectionAccess()`
 * and `registerSingleAccess()`. The service auto-resolves them during `checkAccess()`
 * when no explicit `codeAccess` parameter is provided.
 *
 * @module domains/auth/services/rbac-access-control-service
 * @since 1.0.0
 *
 * @example
 * ```typescript
 * const rbac = new RBACAccessControlService();
 *
 * // Register code-defined access at startup
 * rbac.registerCollectionAccess('posts', {
 *   create: ({ roles }) => roles.includes('editor'),
 *   read: true,
 * });
 *
 * // Simple check — auto-resolves registered access, then DB permissions
 * const canRead = await rbac.checkAccess({
 *   userId: 'user-123',
 *   operation: 'read',
 *   resource: 'posts',
 * });
 * ```
 */

import type { AccessTarget } from "../../../auth/access/decide";
import {
  clearDeclaredTargets,
  declareTarget,
} from "../../../auth/access/declared-rules";
import {
  noteFilterNotApplied,
  reportRuleFilterMisuse,
  ruleAnswer,
  type RuleAnswer,
} from "../../../auth/access/rule-answer";
import {
  noticePermissionNowComesFirst,
  noticeRuleNoLongerAllows,
} from "../../../auth/access/rule-answer-log";
import { buildRuleContext } from "../../../auth/access/rule-context";
import type { Principal } from "../../../plugins/principals/types";
import type { AccessOperation } from "../../../services/access/types";
import {
  hasPermission,
  isSuperAdmin,
  listEffectiveGrants,
  listRoleSlugsForUser,
} from "../../../services/lib/permissions";
import { consoleLogger } from "../../../shared/types";

import type {
  AccessControlContext,
  CheckAccessParams,
  CollectionAccessControl,
  SingleAccessControl,
} from "./access-control-types";

/**
 * Asks a rule function once, through `ask`, and reads its answer through `ruleAnswer`, for
 * the caller to judge. A rule that throws refuses, and is logged so it can be
 * found and fixed: `null`. A filter it may not answer, or one that is not
 * well formed, is reported as misused.
 */
async function askRuleFunction(
  ask: () => unknown,
  operation: AccessOperation,
  target: AccessTarget,
  decisionAllows: boolean
): Promise<{ answer: unknown; meaning: RuleAnswer } | null> {
  let answer: unknown;
  try {
    answer = await ask();
  } catch (error) {
    consoleLogger.error(
      `[rbac] Code access function for ${operation}:${target.slug} threw`,
      { error: error }
    );
    return null;
  }
  const meaning = ruleAnswer(answer);
  reportRuleFilterMisuse(target.slug, operation, target.kind, meaning);
  // Neither caller applies a read rule's filter, so each refuses it.
  await noteFilterNotApplied(target.kind, operation, meaning, decisionAllows);
  return { answer, meaning };
}

/**
 * Unified RBAC access control service.
 *
 * Orchestrates the three-tier access evaluation:
 * 1. Super-admin bypass
 * 2. Database role/permission checks, which a signed-in user must pass first
 * 3. Code-defined access functions/booleans (from in-memory registry or
 *    explicit param), which only narrow the permission
 *
 * Holds an in-memory registry of code-defined access configs registered
 * at startup from `defineCollection({ access })` and `defineSingle({ access })`.
 */
export class RBACAccessControlService {
  private readonly collectionAccessMap = new Map<
    string,
    CollectionAccessControl
  >();

  private readonly singleAccessMap = new Map<string, SingleAccessControl>();

  /**
   * Register code-defined access control for a collection.
   * Called during `syncCodeFirstCollections()` for each collection
   * that has an `access` property in its config.
   *
   * @param slug - The collection slug
   * @param access - The access control config from `defineCollection()`
   */
  registerCollectionAccess(
    slug: string,
    access: CollectionAccessControl
  ): void {
    this.collectionAccessMap.set(slug, access);
    // Kept where the decision reads it whatever this service's state.
    declareTarget({ kind: "collection", slug, access });
  }

  /**
   * Register code-defined access control for a single.
   * Called during `syncCodeFirstSingles()` for each single
   * that has an `access` property in its config.
   *
   * @param slug - The single slug
   * @param access - The access control config from `defineSingle()`
   */
  registerSingleAccess(slug: string, access: SingleAccessControl): void {
    this.singleAccessMap.set(slug, access);
    declareTarget({ kind: "single", slug, access });
  }

  /**
   * Get the registered code-defined access for a resource.
   * Checks collection map first, then single map.
   *
   * @param slug - The collection or single slug
   * @returns The registered access config, or `undefined` if none registered
   */
  getRegisteredAccess(
    slug: string
  ): CollectionAccessControl | SingleAccessControl | undefined {
    return this.getRegisteredTarget(slug)?.access;
  }

  /**
   * The collection or Single registered under `slug`, with its code-defined
   * access: what a rule is told it is judging. Checks collections first, then
   * Singles, as {@link getRegisteredAccess} does, since it is derived from
   * this.
   */
  getRegisteredTarget(slug: string): AccessTarget | undefined {
    const collection = this.collectionAccessMap.get(slug);
    if (collection) return { kind: "collection", slug, access: collection };
    const single = this.singleAccessMap.get(slug);
    if (single) return { kind: "single", slug, access: single };
    return undefined;
  }

  /**
   * The target a rule for `resource` judges: the registered one, with an
   * explicitly given access object in place of its own where one is passed.
   * A slug nothing registered is a collection, since a Single's rules are
   * always registered.
   */
  private targetFor(
    resource: string,
    codeAccess?: CollectionAccessControl | SingleAccessControl
  ): AccessTarget {
    const registered = this.getRegisteredTarget(resource);
    return {
      kind: registered?.kind ?? "collection",
      slug: resource,
      access: codeAccess ?? registered?.access,
    };
  }

  /**
   * Clear all registered access configs.
   * Useful for re-sync scenarios (e.g., watch-mode re-sync in dev).
   */
  clearRegisteredAccess(): void {
    this.collectionAccessMap.clear();
    this.singleAccessMap.clear();
    clearDeclaredTargets();
  }

  /**
   * Check if a user is allowed to perform an operation on a resource.
   *
   * If no explicit `codeAccess` is provided, auto-resolves from the
   * in-memory registry (populated at startup from `defineCollection`/`defineSingle`).
   *
   * @param params - Access check parameters
   * @returns `true` if access is allowed, `false` if denied
   *
   * @example
   * ```typescript
   * const allowed = await rbac.checkAccess({
   *   userId: 'user-123',
   *   operation: 'update',
   *   resource: 'posts',
   * });
   * ```
   */
  async checkAccess(params: CheckAccessParams): Promise<boolean> {
    const { userId, operation, resource, executor } = params;

    if (!userId) {
      return false;
    }

    if (await isSuperAdmin(userId, executor)) {
      return true;
    }

    const target = this.targetFor(resource, params.codeAccess);

    const operationAccess =
      target.access?.[
        operation as keyof (CollectionAccessControl | SingleAccessControl)
      ];

    if (operationAccess !== undefined) {
      // The permission first: a declared rule only narrows it, so a user who
      // lacks it is refused before the rule is asked.
      if (!(await hasPermission(userId, operation, resource, executor))) {
        // A rule of `false` refused this caller before too, so its refusal
        // is not named as new.
        if (operationAccess !== false) {
          noticePermissionNowComesFirst(resource, operation, "signed-in user");
        }
        return false;
      }
      if (typeof operationAccess === "boolean") {
        return operationAccess;
      }

      if (typeof operationAccess === "function") {
        const ctx = await this.buildContext(
          userId,
          operation,
          target,
          executor
        );
        return this.userRuleAllows(operationAccess, ctx, operation, target);
      }
    }

    return hasPermission(userId, operation, resource, executor);
  }

  /**
   * Whether a signed-in user's rule function allows: only by answering
   * `true`. A rule that throws refuses. A truthy answer that is not `true`
   * let the user in before, so that refusal is named once.
   */
  private async userRuleAllows(
    rule: (ctx: AccessControlContext) => unknown,
    ctx: AccessControlContext,
    operation: AccessOperation,
    target: AccessTarget
  ): Promise<boolean> {
    // Asked only of a user who holds the permission, whom the decision would
    // let read the entries a filter matches.
    const asked = await askRuleFunction(
      () => rule(ctx),
      operation,
      target,
      true
    );
    if (asked === null) return false;
    // Only `true` allows every entry.
    if (asked.meaning.kind !== "allow" && Boolean(asked.answer)) {
      noticeRuleNoLongerAllows(
        target.slug,
        operation,
        "signed-in user",
        asked.answer
      );
    }
    return asked.meaning.kind === "allow";
  }

  /**
   * A collection's code-defined rule, judged for a caller with NO session.
   *
   * `checkAccess` above cannot answer this: it returns `false` at `!userId`
   * before it reads the rule, because everything below that line resolves roles
   * and permissions from a user id. So an anonymous caller reached no rule at
   * all, and a collection declaring `create: false` or `read: ({ user }) =>
   * !!user` had its declaration accepted, recorded and never consulted.
   *
   * Answers `undefined` when no code-defined rule governs this operation, which
   * means "no opinion": a read falls to its public default, while the
   * collection gate refuses a write no rule names. A boolean is a verdict.
   *
   * The context is a real anonymous one rather than a stand-in: `user` is
   * `null`, which the type has always allowed, and both lists are empty. A rule
   * reading `roles` sees no roles, which is the truth about this caller.
   */
  async checkAnonymousCodeAccess(params: {
    operation: AccessOperation;
    resource: string;
    codeAccess?: CollectionAccessControl | SingleAccessControl;
  }): Promise<boolean | undefined> {
    return this.codeRuleVerdict(params, null);
  }

  /**
   * A collection's or Single's code-defined rule, judged for a call made as a
   * plugin-defined person.
   *
   * The rule is the whole decision. A person holds no role and no permission
   * and is never a super-admin, so nothing `checkAccess` resolves from a user
   * id applies; and where an anonymous caller's read with no rule falls
   * through to the public default, a person is refused. A collection admits a
   * person only where its author wrote a rule that does, or one set to
   * `true`, which admits everyone.
   *
   * Publishing is refused whatever the rule says, as it is for an anonymous
   * caller: it moves a document into a privileged published state, and a
   * person has no staff identity to stamp on it.
   *
   * The one decision for a person, asked by the collection gate, the Single
   * gate and relationship expansion alike.
   */
  async checkPrincipalCodeAccess(params: {
    operation: AccessOperation;
    resource: string;
    principal: Principal;
    codeAccess?: CollectionAccessControl | SingleAccessControl;
  }): Promise<boolean> {
    if (params.operation === "publish" || params.operation === "unpublish") {
      return false;
    }
    return (await this.codeRuleVerdict(params, params.principal)) === true;
  }

  /**
   * The rule's own verdict for a caller with no staff user: `undefined` when
   * no rule governs the operation, else the boolean it gives. One evaluation
   * for the anonymous caller and the person, so the two differ only in who
   * the rule is told is asking and in what each does with no rule at all.
   */
  private async codeRuleVerdict(
    params: {
      operation: AccessOperation;
      resource: string;
      codeAccess?: CollectionAccessControl | SingleAccessControl;
    },
    principal: Principal | null
  ): Promise<boolean | undefined> {
    const { operation, resource } = params;
    const target = this.targetFor(resource, params.codeAccess);
    const rule =
      target.access?.[
        operation as keyof (CollectionAccessControl | SingleAccessControl)
      ];

    if (rule === undefined) return undefined;
    if (typeof rule === "boolean") return rule;
    if (typeof rule !== "function") return undefined;

    // Fail-secure, exactly as the authenticated path does: a rule that threw
    // did not allow anything.
    const asked = await askRuleFunction(
      () =>
        rule(
          buildRuleContext(
            { user: null, roles: [], permissions: [], principal },
            { operation, target: { kind: target.kind, slug: target.slug } }
          )
        ),
      operation,
      target,
      // A plugin's person is judged by the rule alone; a visitor holds no
      // permission, so the decision refuses it whatever the rule says.
      principal !== null
    );
    if (asked === null) return false;
    // A rule allows only by answering `true`. A visitor was refused before
    // only by `false`, so any other answer that now refuses one is named
    // once; a plugin's person was already held to `true`.
    const { answer, meaning } = asked;
    if (principal === null && meaning.kind !== "allow" && answer !== false) {
      noticeRuleNoLongerAllows(resource, operation, "visitor", answer);
    }
    return meaning.kind === "allow";
  }

  /**
   * The context a staff user's rule is handed, with the user's roles and
   * permissions resolved from the database. Only called when a rule function
   * is about to run, so a boolean rule and a permission check skip the
   * lookups entirely.
   */
  async buildContext(
    userId: string,
    operation: AccessOperation,
    target: AccessTarget,
    // Optional transaction-bound executor so the role/permission reads run on the
    // caller's transaction connection instead of the pool; see `checkAccess`.
    executor?: unknown
  ): Promise<AccessControlContext> {
    const [roleSlugs, grants] = await Promise.all([
      listRoleSlugsForUser(userId, executor),
      listEffectiveGrants(userId, executor),
    ]);

    return buildRuleContext(
      {
        user: { id: userId },
        roles: roleSlugs,
        permissions: grants,
        // A staff user is never a plugin-defined person.
        principal: null,
      },
      { operation, target: { kind: target.kind, slug: target.slug } }
    );
  }
}

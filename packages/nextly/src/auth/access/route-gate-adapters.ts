/**
 * The REST route gates' answers, and the caller checks beside them, asked of
 * the one decision.
 *
 * A route gate judges the caller a request authenticated, a session or an API
 * key, against one permission (`requirePermission`, `requireCollectionAccess`,
 * a plugin route's `requiredPermission`) or any of several
 * (`requireAnyPermission`). The caller checks ask a gate's question from
 * inside the work: `ctx.caller.can` in a plugin route, a held permission for a
 * dashboard widget or a document lock, and the schema builder's collection
 * list. Each keeps the answer it has always given: where that differs from the
 * decision's, it is kept through a named deviation (`./deviations`), so no
 * answer changes and every difference that remains is one of those names.
 *
 * One permission on an access operation is the collection gate's question
 * asked of the route's caller, so it is answered by the collection gate's
 * adapter: the two have always run the same steps for a session and a key.
 * A plugin's person never reaches a route gate, so none is asked here.
 */
import { parsePermissionSlug } from "../../plugins/routes/permission-slug";
import { permissionSlug } from "../../schemas/_zod/rbac";
import {
  ACCESS_OPERATIONS,
  type AccessOperation,
} from "../../services/access/types";
import {
  hasAnyPermission,
  hasPermission,
} from "../../services/lib/permissions";
import {
  apiKeyScopeFrom,
  type AuthenticatedScope,
} from "../authenticated-scope";
import { getRBACService, type ReadAccessCaller } from "../code-access";
import type { AuthContext } from "../middleware";

import {
  holdsPermission,
  isSuperAdmin,
  manageCounts,
  type Actor,
  type KeyActor,
} from "./actor";
import { decide, decidePermission, type AccessTarget } from "./decide";
import { declaredTarget } from "./declared-rules";
import { aboutSubject, deviate } from "./deviations";
import {
  collectionGateVerdict,
  type CollectionQuestion,
  type GateVerdict,
} from "./gate-adapters";
import {
  actorForKey,
  actorForUser,
  actorForUserFailingClosed,
  userHoldsPermission,
  userIsSuperAdmin,
  withHeldPermissions,
} from "./resolve-actor";
import { allowsSome } from "./rule-answer";
import {
  askEachLanguage,
  withRuleLanguage,
  type RuleLanguage,
} from "./rule-language";

/** Where a route gate reads the rules apps declare; absent without the service. */
export type RouteRules = CollectionQuestion["rules"];

/** One permission a route accepts, as `requireAnyPermission` lists them. */
export interface RoutePermission {
  readonly action: string;
  readonly resource: string;
}

/**
 * Who a gate judges: the user the request names and, when a key made the
 * request, the key's own scope and id.
 */
export interface GateCaller {
  readonly userId: string;
  /** The key's scope; absent for a session. */
  readonly key?: AuthenticatedScope;
  readonly keyId?: string;
  /** The user's role slugs, which a key's rule falls back to without its own. */
  readonly roles?: readonly string[];
}

const ALLOWED: GateVerdict = Object.freeze({ allowed: true });
const INSUFFICIENT: GateVerdict = Object.freeze({
  allowed: false,
  refusal: "insufficient",
});

const verdictOf = (allowed: boolean): GateVerdict =>
  allowed ? ALLOWED : INSUFFICIENT;

/** Whether an action names an operation an entity's rule can declare. */
function isAccessOperation(action: string): action is AccessOperation {
  return ACCESS_OPERATIONS.some(operation => operation === action);
}

/**
 * Whether one permission is an entity's operation, asked of the target with
 * its rules, rather than a permission alone. A route naming no resource
 * (`requiredPermission: "manage"`) asks about nothing a rule or a permission
 * row can name. A system resource a `manage-` permission still counts on
 * declares no rule, so it is a permission alone, unless an entity registered
 * rules under its name: those rules are read whatever the name.
 */
function asksTheEntity(
  action: string,
  resource: string,
  target: AccessTarget | undefined
): boolean {
  return (
    isAccessOperation(action) &&
    resource !== "" &&
    (target !== undefined || !manageCounts(action, resource))
  );
}

/** The caller the route authenticated. */
function callerOf(auth: AuthContext): GateCaller {
  return auth.authMethod === "api-key"
    ? {
        userId: auth.userId,
        key: apiKeyScopeFrom(auth),
        ...(auth.apiKeyId === undefined ? {} : { keyId: auth.apiKeyId }),
      }
    : { userId: auth.userId };
}

/** The key's actor, from what authentication resolved; it makes no query. */
function keyActorOf(caller: GateCaller, key: AuthenticatedScope): KeyActor {
  return actorForKey({
    keyId: caller.keyId ?? "",
    userId: caller.userId,
    grants: key.grants ?? [],
    roles: key.roles ?? caller.roles ?? [],
  });
}

/** The caller's actor: a key's from its scope, a user's looked up. */
function actorOf(caller: GateCaller): Promise<Actor> {
  return caller.key
    ? Promise.resolve(keyActorOf(caller, caller.key))
    : actorForUser(caller.userId);
}

/**
 * The verdict for one permission, `action` on `resource`, for the caller the
 * route authenticated.
 */
export function routeGateVerdict(
  auth: AuthContext,
  action: string,
  resource: string,
  rules: RouteRules,
  /**
   * The route's handler applies a collection read rule's filter to what it
   * reads, so the filter is handed back rather than refused. Only the
   * entry list and count routes do.
   */
  appliesFilter = false
): Promise<GateVerdict> {
  return gateVerdict(
    callerOf(auth),
    action,
    resource,
    rules,
    () => hasPermission(auth.userId, action, resource),
    appliesFilter
  );
}

/**
 * The verdict for one permission by the grant alone, no rule read: what a
 * route asks of a publish or an unpublish of every language, whose rule the
 * service asks once in each language the change puts live, which the route
 * cannot know. Told every language here, a rule refusing a language that
 * does not go live would refuse what the service allows.
 */
export function routeGrantVerdict(
  auth: AuthContext,
  action: string,
  resource: string,
  rules: RouteRules
): Promise<GateVerdict> {
  return permissionVerdict(callerOf(auth), action, resource, rules);
}

/**
 * The verdict for one permission by the grant alone, no rule read: what a
 * route asks of a publish or an unpublish of every language, whose rule the
 * service asks once in each language the change puts live, which the route
 * cannot know. Told every language here, a rule refusing a language that
 * does not go live would refuse what the service allows.
 */
export function routeGrantVerdict(
  auth: AuthContext,
  action: string,
  resource: string,
  rules: RouteRules
): Promise<GateVerdict> {
  return permissionVerdict(callerOf(auth), action, resource, rules);
}

/**
 * The actions a collection's capabilities answer: every access operation, so
 * an operation the gates gain is answered here without an edit.
 */
export const COLLECTION_ACTIONS = ACCESS_OPERATIONS;

/** The operations a Single does not have: it is never created or deleted. */
const NOT_ON_A_SINGLE = ["create", "delete"] as const;

/** An action a Single's capabilities answer. */
type SingleAction = Exclude<
  (typeof ACCESS_OPERATIONS)[number],
  (typeof NOT_ON_A_SINGLE)[number]
>;

/** The actions a Single's capabilities answer: the rest of the operations. */
export const SINGLE_ACTIONS: readonly SingleAction[] = ACCESS_OPERATIONS.filter(
  (operation): operation is SingleAction =>
    !NOT_ON_A_SINGLE.some(missing => missing === operation)
);

/**
 * The requests the admin sends whose languages differ from their action's
 * own cell, each answered as a cell of its own:
 * - `readTranslations`: a read that also reads every language's translation
 *   state (a localized list or a document with `translation-status`);
 * - `readHistory`: the version history of every language, unfiltered;
 * - `publishEveryLanguage`: publishing every language at once;
 * - `createInDefaultLanguage`, `updateInDefaultLanguage`: a create or an
 *   update sent with no language, which writes the default one;
 * - `duplicate`: a copy of a published entry, written in the default
 *   language from what a read of the source shows there, its fallbacks
 *   included. The route reads a copy's source as published only, so a draft
 *   never published cannot be copied by anyone, and the cell does not answer
 *   for it: an editor offers a copy only of an entry with a published
 *   version.
 *
 * A cell answers for every document of its collection, while two of these
 * requests depend on the document: publishing every language asks the
 * publish rule only for the languages going live, and a copy of a published
 * entry is created published where the collection has a lifecycle. Both cells
 * take the strict side, so the answer
 * never offers what the route might refuse for some document:
 * `publishEveryLanguage` asks every configured language, and `duplicate` asks
 * publish as well wherever the collection has a Draft/Published lifecycle.
 */
type CollectionOperationCell =
  | "readTranslations"
  | "readHistory"
  | "publishEveryLanguage"
  | "createInDefaultLanguage"
  | "updateInDefaultLanguage"
  | "duplicate";

/** A Single is never created or copied, so it has neither cell. */
type SingleOperationCell = Exclude<
  CollectionOperationCell,
  "createInDefaultLanguage" | "duplicate"
>;

/** What the caller may do with one collection or Single. */
export type EntityCapabilities =
  | ({ readonly kind: "collection" } & Readonly<
      Record<
        (typeof COLLECTION_ACTIONS)[number] | CollectionOperationCell,
        boolean
      >
    >)
  | ({ readonly kind: "single" } & Readonly<
      Record<SingleAction | SingleOperationCell, boolean>
    >);

/**
 * What the caller may do with each collection and Single. System resources
 * are not answered here: their routes accept permissions of their own, which
 * the caller's permission list already states.
 */
export interface RouteCapabilities {
  /**
   * Whether the caller holds super-admin authority, from the same read the
   * cells were answered from. A key never does.
   */
  readonly isSuperAdmin: boolean;
  readonly entities: Readonly<Record<string, EntityCapabilities>>;
}

/**
 * The REST operation that performs each action on a collection or a Single,
 * whose languages a rule is told when that request asks the gate.
 */
const OPERATION_OF: Record<"collection" | "single", Record<string, string>> = {
  collection: {
    create: "createEntry",
    read: "getEntry",
    update: "updateEntry",
    delete: "deleteEntry",
    publish: "updateEntry",
    unpublish: "updateEntry",
  },
  single: {
    read: "getSingleDocument",
    update: "updateSingleDocument",
    publish: "updateSingleDocument",
    unpublish: "updateSingleDocument",
  },
};

/**
 * What a cell's request sends about its languages: the language the answer
 * was asked in (`as-asked`), that language with every language's translation
 * state (`with-states`), or no language at all (`none`).
 */
export type SentLanguage = "as-asked" | "with-states" | "none";

/**
 * The route parameters a request sending `sent` carries, for a caller asking
 * in `locale`, so a cell is framed by exactly what its request sends.
 */
export function sentParams(
  sent: SentLanguage,
  locale: string
): Record<string, string> {
  if (sent === "none") return {};
  if (sent === "with-states") return { locale, "translation-status": "1" };
  return { locale };
}

/** A request answered as a cell of its own, by the action its route asks. */
interface OperationCell {
  readonly action: AccessOperation;
  readonly operation: string;
  readonly sent: SentLanguage;
}

/**
 * Each request answered as a cell of its own, other than publishing every
 * language, and the REST operation and parameters it is sent with. A list
 * and a document read their translation states in the same languages, so one
 * cell answers both.
 */
const OPERATION_CELLS: {
  readonly collection: Readonly<
    Record<
      Exclude<CollectionOperationCell, "publishEveryLanguage" | "duplicate">,
      OperationCell
    >
  >;
  readonly single: Readonly<
    Record<Exclude<SingleOperationCell, "publishEveryLanguage">, OperationCell>
  >;
} = {
  collection: {
    readTranslations: {
      action: "read",
      operation: "listEntries",
      sent: "with-states",
    },
    readHistory: {
      action: "read",
      operation: "listEntryVersions",
      sent: "none",
    },
    createInDefaultLanguage: {
      action: "create",
      operation: "createEntry",
      sent: "none",
    },
    updateInDefaultLanguage: {
      action: "update",
      operation: "updateEntry",
      sent: "none",
    },
  },
  single: {
    readTranslations: {
      action: "read",
      operation: "getSingleDocument",
      sent: "with-states",
    },
    readHistory: {
      action: "read",
      operation: "listSingleVersions",
      sent: "none",
    },
    updateInDefaultLanguage: {
      action: "update",
      operation: "updateSingleDocument",
      sent: "none",
    },
  },
};

/** The REST operation that publishes every language of an entry or a Single. */
const PUBLISH_EVERY_LANGUAGE: Record<"collection" | "single", string> = {
  collection: "publishAllLocales",
  single: "publishAllSingleLocales",
};

/**
 * What `caller` may do with each of `entities`: the route gate's answer for
 * every action, as a REST request asking it would get, so the admin offers
 * what the server allows and nothing else. A publish or an unpublish is
 * answered by its own permission and rule: it is what a request changing
 * only the status needs, while one that also edits fields needs update too.
 * `languageOf` gives the languages the REST operation behind an action is
 * told when its request sends what `sent` names, so a rule hears the
 * languages that request would.
 *
 * The caller is read once for the whole answer: a key from its scope, and a
 * signed-in user's permissions held for every cell, so an added entity adds
 * no question about the caller, and the super-admin flag comes from that same
 * read. A lookup that fails throws, as it does at the route gate, rather than
 * being answered as a refusal or asked again cell by cell.
 */
export async function routeGateCapabilities(
  caller: GateCaller,
  entities: ReadonlyMap<string, "collection" | "single">,
  rules: RouteRules,
  languageOf: LanguageOf,
  /** Whether a collection has a Draft/Published lifecycle. */
  hasLifecycle: (slug: string) => boolean
): Promise<RouteCapabilities> {
  const answer = () =>
    entityCapabilities(caller, entities, rules, languageOf, hasLifecycle);
  // A key never carries super-admin authority through the gates.
  if (caller.key) return { isSuperAdmin: false, entities: await answer() };
  return withHeldPermissions(caller.userId, async held => ({
    isSuperAdmin: held.superAdmin,
    entities: await answer(),
  }));
}

/** The languages a REST operation is told when its request sends `sent`. */
export type LanguageOf = (
  operation: string,
  sent: SentLanguage
) => RuleLanguage;

async function entityCapabilities(
  caller: GateCaller,
  entities: ReadonlyMap<string, "collection" | "single">,
  rules: RouteRules,
  languageOf: LanguageOf,
  hasLifecycle: (slug: string) => boolean
): Promise<RouteCapabilities["entities"]> {
  const byEntity: Record<string, EntityCapabilities> = {};
  for (const [slug, kind] of entities) {
    const actions = kind === "single" ? SINGLE_ACTIONS : COLLECTION_ACTIONS;
    const answered: Record<string, boolean> = {};
    for (const action of actions) {
      answered[action] = await withRuleLanguage(
        languageOf(OPERATION_OF[kind][action] ?? action, "as-asked"),
        () => capability(caller, action, slug, rules)
      );
    }
    // Each request whose languages differ from its action's own cell is
    // asked by the same gate, framed by what that request sends.
    for (const [cell, asked] of Object.entries(OPERATION_CELLS[kind])) {
      answered[cell] = await withRuleLanguage(
        languageOf(asked.operation, asked.sent),
        () => capability(caller, asked.action, slug, rules)
      );
    }
    answered.publishEveryLanguage = await publishesEveryLanguage(
      caller,
      slug,
      rules,
      languageOf(PUBLISH_EVERY_LANGUAGE[kind], "none")
    );
    if (kind === "collection") {
      answered.duplicate = await duplicates(
        caller,
        slug,
        rules,
        languageOf("duplicateEntry", "none"),
        hasLifecycle(slug)
      );
    }
    byEntity[slug] = { kind, ...answered } as EntityCapabilities;
  }
  return byEntity;
}

/**
 * Whether `caller` may copy a published entry of `resource`, as that request
 * is judged: a read of the source and a create, both in the default language
 * and its fallbacks. Where the collection has a lifecycle the copy is created
 * published, so the publish check is asked too.
 */
async function duplicates(
  caller: GateCaller,
  resource: string,
  rules: RouteRules,
  language: RuleLanguage,
  hasLifecycle: boolean
): Promise<boolean> {
  return withRuleLanguage(language, async () => {
    for (const action of ["read", "create"] as const) {
      if (!(await capability(caller, action, resource, rules))) return false;
    }
    return !hasLifecycle || capability(caller, "publish", resource, rules);
  });
}

/**
 * Whether `caller` may publish every language of `resource` at once, on the
 * strict side of how that request is judged: update in every language, then
 * the publish check once for each configured language, with its rules told
 * that one and all of them. The route admits a caller holding the publish
 * grant without update, but a target with no lifecycle asks update of them,
 * and the request asks only the languages it puts live, which depend on the
 * document; asking update and every configured language never allows what
 * the request would refuse.
 */
async function publishesEveryLanguage(
  caller: GateCaller,
  resource: string,
  rules: RouteRules,
  everyLanguage: RuleLanguage
): Promise<boolean> {
  return withRuleLanguage(everyLanguage, async () => {
    if (!(await capability(caller, "update", resource, rules))) return false;
    const refused = await askEachLanguage(everyLanguage.locales, async () =>
      (await capability(caller, "publish", resource, rules))
        ? undefined
        : "refused"
    );
    return refused === undefined;
  });
}

/** The route gate's answer for one action, decided as its own subject. */
async function capability(
  caller: GateCaller,
  action: string,
  resource: string,
  rules: RouteRules
): Promise<boolean> {
  const verdict = await aboutSubject(permissionSlug(action, resource), () =>
    gateVerdict(caller, action, resource, rules, () =>
      userHoldsPermission(caller.userId, action, resource)
    )
  );
  if (!verdict.allowed && verdict.refusal === "failed") throw verdict.error;
  return verdict.allowed;
}

/**
 * The route gate's verdict for one permission. An entity's operation is the
 * collection gate's question; anything else only the permission path answers,
 * as the gate always has, a super-admin first, so the one difference the
 * decision makes there is named.
 */
function gateVerdict(
  caller: GateCaller,
  action: string,
  resource: string,
  rules: RouteRules,
  permissionWithoutService: () => Promise<boolean>,
  appliesFilter = false
): Promise<GateVerdict> {
  const registered =
    resource === "" ? undefined : rules?.getRegisteredTarget(resource);
  if (!asksTheEntity(action, resource, registered)) {
    return permissionVerdict(caller, action, resource, rules);
  }
  return collectionGateVerdict({
    slug: resource,
    action: action as AccessOperation,
    // A key's rule falls back to the user's roles without its own; a
    // session's roles are looked up, never taken as handed.
    user: caller.key
      ? {
          id: caller.userId,
          ...(caller.roles ? { roles: [...caller.roles] } : {}),
        }
      : { id: caller.userId },
    scope: caller.key,
    principal: null,
    rules,
    permissionWithoutService,
    appliesFilter,
  });
}

/**
 * The verdict for an action no rule can name. A key holds it by its stored
 * slug; a session, with the access-control service, by super-admin authority
 * and then the permission, and without it by the permission alone.
 */
async function permissionVerdict(
  caller: GateCaller,
  action: string,
  resource: string,
  rules: RouteRules
): Promise<GateVerdict> {
  if (caller.key) {
    const actor = keyActorOf(caller, caller.key);
    const today = caller.key.permissions.includes(
      permissionSlug(action, resource)
    );
    // The decision reads the grant's action and resource, which agree with
    // the stored slug unless a grant was stored under a slug of its own; and
    // on a system resource it counts the resource's `manage-` permission.
    const byGrant = holdsPermission(actor, action, resource);
    await deviate("key-slug-string-match", today, () => byGrant);
    await deviate(
      "manage-not-counted",
      byGrant,
      () => decidePermission(actor, action, resource).allowed
    );
    return verdictOf(today);
  }
  const today =
    (rules !== undefined && (await userIsSuperAdmin(caller.userId))) ||
    (await userHoldsPermission(caller.userId, action, resource));
  if (!manageCounts(action, resource)) return verdictOf(today);
  return verdictOf(
    await deviate(
      "manage-not-counted",
      today,
      async () =>
        decidePermission(await actorForUser(caller.userId), action, resource)
          .allowed
    )
  );
}

/**
 * The verdict when any one of several permissions will do. Today a key holds
 * one by its stored slug and a session by its database permissions, and no
 * rule is read for either.
 */
export async function anyPermissionVerdict(
  auth: AuthContext,
  permissions: readonly RoutePermission[],
  rules: RouteRules
): Promise<GateVerdict> {
  const caller = callerOf(auth);
  if (caller.key) {
    const actor = keyActorOf(caller, caller.key);
    const stored = caller.key.permissions;
    const today = permissions.some(({ action, resource }) =>
      stored.includes(permissionSlug(action, resource))
    );
    // Three steps from today's answer to the decision's, each named apart:
    // the grants rather than the stored slugs, then a system resource's
    // `manage-` permission counted, then the targets' rules read.
    const byGrants = permissions.some(({ action, resource }) =>
      holdsPermission(actor, action, resource)
    );
    const byPermission = permissions.some(
      ({ action, resource }) =>
        decidePermission(actor, action, resource).allowed
    );
    await deviate("key-slug-string-match", today, () => byGrants);
    await deviate("manage-not-counted", byGrants, () => byPermission);
    await deviate("any-of-skips-rules", byPermission, () =>
      anyDecided(actor, permissions, rules)
    );
    return verdictOf(today);
  }
  const today = await hasAnyPermission(auth.userId, [...permissions]);
  // The user's actor is resolved only while a test listens, and once.
  let actor: Promise<Actor> | undefined;
  const userActor = () => (actor ??= actorForUser(auth.userId));
  const byPermission = async () => {
    const resolved = await userActor();
    return permissions.some(
      ({ action, resource }) =>
        decidePermission(resolved, action, resource).allowed
    );
  };
  await deviate("manage-not-counted", today, byPermission);
  // Named only where reading the rules moves the answer past the permissions:
  // the comparison is made against today's answer, so a difference the
  // permissions alone explain is reported as "agrees" here.
  await deviate("any-of-skips-rules", today, async () => {
    const decided = await anyDecided(await userActor(), permissions, rules);
    return decided === (await byPermission()) ? today : decided;
  });
  return verdictOf(today);
}

/** Whether the decision allows any one of the permissions. */
async function anyDecided(
  actor: Actor,
  permissions: readonly RoutePermission[],
  rules: RouteRules
): Promise<boolean> {
  for (const { action, resource } of permissions) {
    if (await decidedOne(actor, action, resource, rules)) return true;
  }
  return false;
}

/**
 * The decision's answer for one permission: an entity's operation asked of
 * the target with the rules it declares, whether or not the access-control
 * service is there to read them, and anything else of the permission alone,
 * as {@link gateVerdict} routes them.
 */
async function decidedOne(
  actor: Actor,
  action: string,
  resource: string,
  rules: RouteRules
): Promise<boolean> {
  const declared =
    resource === ""
      ? undefined
      : (declaredTarget(resource) ?? rules?.getRegisteredTarget(resource));
  if (!asksTheEntity(action, resource, declared)) {
    return decidePermission(actor, action, resource).allowed;
  }
  const target: AccessTarget = declared ?? {
    kind: "collection",
    slug: resource,
  };
  return allowsSome(
    await decide(actor, action as AccessOperation, target),
    action
  );
}

/**
 * Whether this caller may perform `action` on `resource`, whichever way they
 * authenticated: a plugin route's `ctx.caller.can(action, resource)`, and the
 * dashboard's checks of a widget's reader.
 *
 * The route gate's question asked of the caller, `scope` when a key made the
 * request: a key is judged on its own scope, never its owner's grants, and a
 * super-admin does not bypass that scope. Three answers it has always given
 * apart from the gate are kept through named deviations: an empty action or
 * resource refused, a signed-in user refused without the access-control
 * service, and a rule's own answer handed back as it came.
 *
 * `action` is a plain string rather than the operation union, because a
 * permission's action is not bounded by those six: `export-submissions` and
 * `manage-settings` are both real grants.
 */
export async function callerMayPerform(
  scope: AuthenticatedScope | undefined,
  action: string,
  resource: string,
  user: { id: string; roles?: readonly string[] }
): Promise<boolean> {
  if (!user.id) return false;
  const rules = getRBACService();
  const caller: GateCaller =
    scope?.actorType === "apiKey"
      ? {
          userId: user.id,
          key: scope,
          ...(user.roles ? { roles: user.roles } : {}),
        }
      : { userId: user.id };
  if (!action || !resource) return refusedEmpty(caller, action, resource);
  if (!caller.key) return sessionAnswer(caller.userId, action, resource, rules);
  // A key is judged on its own scope, the route gate's way, with or without
  // the service.
  return (
    await gateVerdict(caller, action, resource, rules, () =>
      Promise.resolve(false)
    )
  ).allowed;
}

/**
 * Whether the caller holds the permission a slug names, as a dashboard
 * widget's `requiredPermission` and a document lock's release ask it. A key
 * holds it by the stored slug alone; a signed-in user is asked as
 * `ctx.caller.can` asks one.
 */
export function holdsPermissionAnswer(
  slug: string,
  caller: ReadAccessCaller,
  rules: RouteRules
): Promise<boolean> {
  // The slug is the subject, so a dashboard deciding many widgets at once
  // still says what deviated in deciding each.
  return aboutSubject(slug, () => heldPermission(slug, caller, rules));
}

async function heldPermission(
  slug: string,
  caller: ReadAccessCaller,
  rules: RouteRules
): Promise<boolean> {
  if (!caller.userId || !slug) return false;
  const { action, resource } = parsePermissionSlug(slug);
  if (caller.authMethod === "api-key") {
    const actor = actorForKey({
      keyId: "",
      userId: caller.userId,
      grants: caller.grants ?? [],
      roles: caller.roles,
    });
    const today = caller.permissions.includes(slug);
    // Three steps from today's answer to the decision's, each named apart:
    // the grant rather than the stored slug, then a system resource's
    // `manage-` permission counted, then the target's rules read.
    const byGrant = holdsPermission(actor, action, resource);
    const byPermission = decidePermission(actor, action, resource).allowed;
    await deviate("key-slug-string-match", today, () => byGrant);
    await deviate("manage-not-counted", byGrant, () => byPermission);
    await deviate("holds-permission-key-skips-rules", byPermission, () =>
      decidedOne(actor, action, resource, rules)
    );
    return today;
  }
  const user: GateCaller = { userId: caller.userId };
  // Refused without the service before the slug is read, as it always was.
  if (!rules) return refusedWithoutService(user, action, resource);
  if (!action || !resource) return refusedEmpty(user, action, resource);
  return sessionAnswer(caller.userId, action, resource, rules);
}

/**
 * A signed-in user's answer to a caller check: the route gate's, a yes or a
 * no, and refused without the access-control service. A lookup that failed
 * fails the check, as it always has, rather than answering no.
 */
async function sessionAnswer(
  userId: string,
  action: string,
  resource: string,
  rules: RouteRules
): Promise<boolean> {
  const caller: GateCaller = { userId };
  if (!rules) return refusedWithoutService(caller, action, resource);
  const verdict = await gateVerdict(caller, action, resource, rules, () =>
    Promise.resolve(false)
  );
  if (!verdict.allowed && verdict.refusal === "failed") throw verdict.error;
  return verdict.allowed;
}

/** An empty action or resource, refused whoever asks. */
function refusedEmpty(
  caller: GateCaller,
  action: string,
  resource: string
): Promise<boolean> {
  return deviate("can-refuses-empty-action-or-resource", false, async () =>
    decidedOne(await actorOf(caller), action, resource, undefined)
  );
}

/** A signed-in user refused for want of the access-control service. */
function refusedWithoutService(
  caller: GateCaller,
  action: string,
  resource: string
): Promise<boolean> {
  return deviate("can-no-service-refuses-people", false, async () =>
    decidedOne(await actorOf(caller), action, resource, undefined)
  );
}

/** A collection the schema list may show, by its slug. */
export interface ListedCollection {
  readonly slug: string;
}

/**
 * The collections among `collections` the schema list shows the caller the
 * route authenticated: those it may read by its permission, in the order
 * given. A key holds the permission by its stored slug and a session by its
 * permissions, a super-admin every one, and no collection's read rule is read.
 *
 * The caller is read once for the whole list, not once per collection: a
 * super-admin by the one cached check, anyone else by their roles and grants.
 */
export async function schemaListed<T extends ListedCollection>(
  auth: AuthContext,
  collections: readonly T[],
  rules: RouteRules
): Promise<T[]> {
  const caller = callerOf(auth);
  if (caller.key) {
    const key = caller.key;
    const actor = keyActorOf(caller, key);
    return keptWhere(collections, slug =>
      readByPermission(
        actor,
        slug,
        rules,
        key.permissions.includes(permissionSlug("read", slug))
      )
    );
  }
  if (await userIsSuperAdmin(caller.userId)) return [...collections];
  // A lookup that fails counts as holding nothing of its kind, so a failed
  // role read keeps the grants that were read, as each collection's own
  // permission check did when it failed closed.
  const actor = await actorForUserFailingClosed(caller.userId);
  // The super-admin authority the actor's roles carry counts too: it is what
  // each collection's permission check passed first, and it holds when the
  // cached check above failed but the roles were read.
  return keptWhere(collections, slug =>
    readByPermission(
      actor,
      slug,
      rules,
      isSuperAdmin(actor) || holdsPermission(actor, "read", slug)
    )
  );
}

async function keptWhere<T extends ListedCollection>(
  collections: readonly T[],
  shown: (slug: string) => Promise<boolean>
): Promise<T[]> {
  const kept: T[] = [];
  for (const collection of collections) {
    // Each collection's decision is its own subject, so what deviated in
    // deciding it can be told apart from the rest of the list.
    const slug = collection.slug;
    if (await aboutSubject(slug, () => shown(slug))) kept.push(collection);
  }
  return kept;
}

/**
 * Whether the list shows one collection: today's answer from the permission,
 * with each step to the decision's named apart: the grant rather than a key's
 * stored slug, then the read rule.
 */
async function readByPermission(
  actor: Actor,
  slug: string,
  rules: RouteRules,
  today: boolean
): Promise<boolean> {
  const byPermission = decidePermission(actor, "read", slug).allowed;
  if (actor.kind === "key") {
    await deviate("key-slug-string-match", today, () =>
      holdsPermission(actor, "read", slug)
    );
    await deviate(
      "manage-not-counted",
      holdsPermission(actor, "read", slug),
      () => byPermission
    );
  } else {
    await deviate("manage-not-counted", today, () => byPermission);
  }
  await deviate("schema-list-ignores-rules", byPermission, () =>
    decidedOne(actor, "read", slug, rules)
  );
  return today;
}

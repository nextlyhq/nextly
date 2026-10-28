/**
 * The Public role's read, granted at boot where code says anyone may read.
 *
 * Each collection's and Single's read rule is asked about a visitor. Where it
 * answers exactly `true`, a plain `true` or a function returning `true`,
 * Public is granted that read, as it is `read-media`; `read-users` never.
 * Each grant is made once: claimed in `nextly_meta` by permission id in the
 * transaction that makes it, so a read an owner takes away again stays away,
 * while an entity added later, or a rule changed to `true`, is granted at the
 * first boot that sees it. Rules are asked as a visitor's request is, through
 * the same evaluator, in each configured language and in all at once. A
 * permission a plugin declares for Public on one of its own collections
 * (`contributes.publicGrants`) is granted the same way, once, and lasts only
 * while an enabled plugin declares it: once none does, the plugin disabled,
 * removed or no longer declaring it, it is taken back if Public still holds
 * it, and forgotten, so declaring it again grants it again. One an owner took
 * away first stays recorded, and declaring it again never grants it back.
 *
 * Then what Public does not hold yet and visitors may be relying on is
 * listed, at every boot while Public lacks it: a read with no rule, which a
 * visitor has by default, a read whose rule answers neither `true` nor
 * `false`, a write whose rule answers `true`, and any rule that failed or
 * gave no answer when asked.
 *
 * @module domains/auth/services/public-read-grant
 */
import { visitorActor } from "../../../auth/access/actor";
import {
  askRule,
  declaresRule,
  plainRule,
  type AccessTarget,
} from "../../../auth/access/decide";
import {
  everyLanguage,
  languagesOfContent,
  registeredReadLanguagesFor,
  registeredWriteLanguagesFor,
  withRuleLanguage,
  type RuleLanguage,
} from "../../../auth/access/rule-language";
import {
  EVERY_LOCALE,
  EVERY_TRANSLATION,
} from "../../../domains/i18n/locale-selector";
import { NextlyError } from "../../../errors/nextly-error";
import { permissionSlug } from "../../../schemas/_zod/rbac";
import type { Logger } from "../../../services/shared";

/**
 * The `nextly_meta` key listing the permissions boot seeding has granted
 * Public, by permission id, with the Public role's id. A permission deleted
 * with its collection and made again for a new one has a new id, and a Public
 * role made again has a new id, so either is granted afresh.
 */
const PUBLIC_GRANTED_META_KEY = "public-role-granted";

/**
 * How long a rule may take to answer at boot before it is taken as giving
 * none. Every rule is asked at once, so this bounds the whole step.
 */
const RULE_ANSWER_TIMEOUT_MS = 2000;

type Action = "read" | "create" | "update" | "delete";

/** The writes a visitor could make by rule, per kind. */
const WRITES = {
  collection: ["create", "update", "delete"],
  single: ["update"],
} as const;

/** What a rule said about a visitor: nothing, an answer, or a failure. */
type Answer =
  | { kind: "no-rule" }
  | { kind: "answered"; value: unknown }
  | { kind: "failed" };

/** What {@link seedPublicReadGrants} needs of the role services and `nextly_meta`. */
interface PublicReadGrantSeeding {
  /** The Public role's id, or `null` where it has not been made. */
  publicRoleId: () => Promise<string | null>;
  /** Every collection and Single, with its code-defined access. */
  targets: () => Promise<AccessTarget[]>;
  /** Every permission's id, by its slug (`read-posts`). */
  permissionIds: () => Promise<Map<string, string>>;
  /** The permission slugs the role holds now. */
  publicHolds: (roleId: string) => Promise<Set<string>>;
  /**
   * The permissions enabled plugins declare for Public, each with the plugin
   * declaring it, and those refused.
   */
  declared: () => {
    grants: ReadonlyArray<PluginGrant>;
    refused: ReadonlyArray<{
      action: string;
      collection: string;
      owner: string;
    }>;
  };
  /**
   * Adds to the role the permission ids `pick` chooses, in one transaction
   * that never interleaves with an edit of the role's permissions; `pick` is
   * told the ids the role holds and handed the transaction's executor. The
   * ids added.
   */
  addOnce: (
    roleId: string,
    wanted: ReadonlyArray<{ id: string; action: string; resource: string }>,
    pick: (
      ids: readonly string[],
      executor: unknown
    ) => Promise<readonly string[]>
  ) => Promise<readonly string[]>;
  /**
   * Takes off the role the permissions `pick` chooses among `unwanted`, under
   * the same lock as `addOnce`, leaving one whose permission was edited
   * meanwhile into another; `pick` is told the ids still as named that the
   * role holds and handed the transaction's executor. The ids removed.
   */
  withdraw: (
    roleId: string,
    unwanted: ReadonlyArray<{ id: string; action: string; resource: string }>,
    pick: (
      held: readonly string[],
      executor: unknown
    ) => Promise<readonly string[]>
  ) => Promise<readonly string[]>;
  meta: {
    get<T>(key: string, executor?: unknown): Promise<T | null>;
    insertIfAbsent(
      key: string,
      value: unknown,
      executor?: unknown
    ): Promise<void>;
    compareAndSet(
      key: string,
      expected: unknown,
      next: unknown,
      executor?: unknown
    ): Promise<boolean>;
  };
  logger: Logger;
}

/**
 * Every permission's id, by its slug, orphaned ones included so a grant on
 * one is still recognised as made: read page by page, to the last.
 */
export async function permissionIdsBySlug(permissions: {
  listPermissions(options: {
    page: number;
    limit: number;
    includeOrphaned: boolean;
  }): Promise<{
    data: Array<{ id: string; action: string; resource: string }>;
    meta: { totalPages: number };
  }>;
}): Promise<Map<string, string>> {
  const ids = new Map<string, string>();
  for (let page = 1, pages = 1; page <= pages; page++) {
    const { data, meta } = await permissions.listPermissions({
      page,
      limit: 1000,
      includeOrphaned: true,
    });
    for (const { id, action, resource } of data) {
      ids.set(permissionSlug(action, resource), String(id));
    }
    pages = meta.totalPages;
  }
  return ids;
}

const NO_ANSWER = Symbol("no-answer");

/**
 * One deadline for every rule asked in a boot: a single timer, however many
 * rules and languages there are, and stopped once the asking is over.
 */
function sharedDeadline(): {
  deadline: Promise<typeof NO_ANSWER>;
  stop: () => void;
} {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<typeof NO_ANSWER>(resolve => {
    timer = setTimeout(() => resolve(NO_ANSWER), RULE_ANSWER_TIMEOUT_MS);
    timer.unref?.();
  });
  return { deadline, stop: () => clearTimeout(timer) };
}

/**
 * Asks a target's rule for `action` about a visitor, through the evaluator
 * every door uses, in `language`, until `deadline`.
 */
async function askIn(
  target: AccessTarget,
  action: Action,
  language: RuleLanguage | undefined,
  deadline: Promise<typeof NO_ANSWER>
): Promise<Answer> {
  const asking = () => askRule(visitorActor(), action, target);
  const outcome = await Promise.race([
    language ? withRuleLanguage(language, asking) : asking(),
    deadline,
  ]);
  if (outcome === NO_ANSWER) return { kind: "failed" };
  if (!outcome.declared) return { kind: "no-rule" };
  return "threw" in outcome
    ? { kind: "failed" }
    : { kind: "answered", value: outcome.value };
}

/**
 * Every set of languages a visitor's request can tell a rule of `target`, as
 * the request paths work them out: a read's, for each language, the default
 * or every translation asked for, with the configured fallback, none, or any
 * language named as the fallback, as a plain read or one that also reads each
 * language's translation state; a write's, for each language or every one;
 * and every language at once, as a delete is told. Each distinct set the rule
 * is told, once. A site without languages has one: none.
 */
function languageContexts(
  target: AccessTarget
): Array<RuleLanguage | undefined> {
  const codes = everyLanguage().locales;
  if (codes.length === 0) return [undefined];
  // Read and write languages for every action: an operation is not told its
  // own kind alone (duplicating an entry asks `create` in a read's
  // languages), so each action is asked in all of them.
  const contexts = [
    ...[undefined, ...codes, EVERY_TRANSLATION].flatMap(requested =>
      [undefined, false as const, ...codes].flatMap(fallback =>
        [{}, { translationStatus: true }].map(asked =>
          registeredReadLanguagesFor(requested, fallback, asked)
        )
      )
    ),
    ...[...codes, EVERY_LOCALE].map(requested =>
      registeredWriteLanguagesFor(requested)
    ),
  ];
  const distinct = new Map<string, RuleLanguage>();
  for (const asked of [...contexts, everyLanguage()]) {
    // As the rule is told it: content the same in every language is told
    // every language whatever the request named, so those collapse to one.
    const language = languagesOfContent(target, asked);
    distinct.set(
      JSON.stringify([language.locale ?? null, language.locales]),
      language
    );
  }
  return [...distinct.values()];
}

/**
 * Asks a target's rule for `action` about a visitor in every set of languages
 * a request can tell it, and keeps the answer that lets the most through:
 * `true` in any, as Public needs the permission for those visitors; else a
 * failure, as the rule could not be told apart from one that lets them
 * through.
 */
async function ask(
  target: AccessTarget,
  action: Action,
  contexts: () => Array<RuleLanguage | undefined>,
  deadline: Promise<typeof NO_ANSWER>
): Promise<Answer> {
  // A rule that is not there, or is a plain yes or no, reads nothing of the
  // caller or the language: its answer is the same in every context.
  if (!declaresRule(target, action)) return { kind: "no-rule" };
  const plain = plainRule(target, action);
  if (plain !== undefined) return { kind: "answered", value: plain };
  const answers = await Promise.all(
    contexts().map(language => askIn(target, action, language, deadline))
  );
  const allows = (answer: Answer) =>
    answer.kind === "answered" && answer.value === true;
  return (
    answers.find(allows) ??
    answers.find(answer => answer.kind === "failed") ??
    answers.find(
      answer =>
        answer.kind === "answered" &&
        answer.value !== true &&
        answer.value !== false
    ) ??
    answers[0]
  );
}

/** A permission a plugin declares for Public, and the plugin declaring it. */
interface PluginGrant {
  action: string;
  resource: string;
  owner: string;
}

/**
 * The recorded grants: the Public role they were made to, their ids, and, for
 * each a plugin declared, the plugin and the permission it names, so one no
 * enabled plugin declares any longer is known and taken back.
 */
interface Recorded {
  role: string;
  granted: string[];
  // Missing from a record written before plugins could declare grants. No
  // released version made a plugin grant, so it is read as none recorded.
  declared?: Record<string, PluginGrant>;
}

/**
 * Claims `ids` in the recorded grants, on `executor`, the transaction they are
 * made in, keeping only ids of permissions that still exist, and records the
 * plugin of each claimed id in `declaring`. Grants recorded for another role,
 * a Public role since removed and made again, count for nothing: the new role
 * is granted afresh. Returns the ids this boot claimed: those no other boot
 * recorded first.
 */
async function claimGrants(
  meta: PublicReadGrantSeeding["meta"],
  roleId: string,
  ids: readonly string[],
  declaring: ReadonlyMap<string, PluginGrant>,
  existing: ReadonlySet<string>,
  executor: unknown
): Promise<string[]> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const recorded = await meta.get<Recorded>(
      PUBLIC_GRANTED_META_KEY,
      executor
    );
    if (recorded === null) {
      const empty: Recorded = { role: roleId, granted: [], declared: {} };
      await meta.insertIfAbsent(PUBLIC_GRANTED_META_KEY, empty, executor);
      continue;
    }
    const ours = recorded.role === roleId;
    const granted = ours ? recorded.granted : [];
    const claimed = ids.filter(id => !granted.includes(id));
    if (claimed.length === 0) return [];
    const next: Recorded = {
      role: roleId,
      granted: Array.from(
        new Set([...granted.filter(id => existing.has(id)), ...claimed])
      ).sort(),
      declared: Object.fromEntries([
        ...Object.entries(ours ? (recorded.declared ?? {}) : {}).filter(
          ([id]) => existing.has(id)
        ),
        ...claimed.flatMap(id => {
          const grant = declaring.get(id);
          return grant === undefined ? [] : [[id, grant] as const];
        }),
      ]),
    };
    if (
      await meta.compareAndSet(
        PUBLIC_GRANTED_META_KEY,
        recorded,
        next,
        executor
      )
    ) {
      return claimed;
    }
  }
  throw NextlyError.internal({
    logContext: { reason: "public-read-grants-not-recorded" },
  });
}

/**
 * Drops `held` from the recorded grants, on `executor`, the transaction they
 * are taken back in, keeping only those recorded for this role as a plugin's.
 * Returns the ids dropped: a held id no boot recorded was given by an owner,
 * not by boot seeding, and is not taken back.
 */
async function releaseGrants(
  meta: PublicReadGrantSeeding["meta"],
  roleId: string,
  held: readonly string[],
  executor: unknown
): Promise<string[]> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const recorded = await meta.get<Recorded>(
      PUBLIC_GRANTED_META_KEY,
      executor
    );
    if (recorded === null || recorded.role !== roleId) return [];
    const declared = recorded.declared ?? {};
    const released = held.filter(
      id => Object.hasOwn(declared, id) && recorded.granted.includes(id)
    );
    if (released.length === 0) return [];
    const next: Recorded = {
      role: roleId,
      granted: recorded.granted.filter(id => !released.includes(id)),
      declared: Object.fromEntries(
        Object.entries(declared).filter(([id]) => !released.includes(id))
      ),
    };
    if (
      await meta.compareAndSet(
        PUBLIC_GRANTED_META_KEY,
        recorded,
        next,
        executor
      )
    ) {
      return released;
    }
  }
  throw NextlyError.internal({
    logContext: { reason: "public-grants-not-released" },
  });
}

/**
 * Takes back each recorded plugin grant no enabled plugin declares any longer,
 * where Public still holds it, and forgets it, so declaring it again grants it
 * again. One Public no longer holds was taken away by an owner and stays
 * recorded, so declaring it again never grants it back. One in `kept`, which
 * this boot grants, is left alone. Each removal is logged, once: it is no
 * longer recorded, so no later boot takes it back.
 */
async function withdrawUndeclared(
  roleId: string,
  kept: ReadonlySet<string>,
  {
    withdraw,
    meta,
    logger,
  }: Pick<PublicReadGrantSeeding, "withdraw" | "meta" | "logger">
): Promise<void> {
  const recorded = await meta.get<Recorded>(PUBLIC_GRANTED_META_KEY);
  if (recorded === null || recorded.role !== roleId) return;
  const leftover = new Map(
    Object.entries(recorded.declared ?? {}).filter(([id]) => !kept.has(id))
  );
  if (leftover.size === 0) return;
  const removed = await withdraw(
    roleId,
    [...leftover].map(([id, { action, resource }]) => ({
      id,
      action,
      resource,
    })),
    (held, executor) => releaseGrants(meta, roleId, held, executor)
  );
  for (const id of removed) {
    const { action, resource, owner } = leftover.get(id)!;
    logger.warn(
      `[Nextly] Removed "${permissionSlug(action, resource)}" from the Public role: the plugin "${owner}" that declared it no longer does, or is disabled or removed.`
    );
  }
}

/** A target, with what its rules said about a visitor. */
interface Asked {
  target: AccessTarget;
  read: Answer;
  writes: Array<{ action: Action; answer: Answer }>;
}

/** The groups the startup listing names, each with how it is introduced. */
const LISTED = {
  "no-rule": "Read with no read rule, which visitors have by default",
  "not-true": "Read whose rule answers neither true nor false",
  write: "Write whose rule answers true for anyone",
  failed:
    "Rules that failed or gave no answer when asked about a visitor at startup",
} as const;

type Listed = keyof typeof LISTED;

/** Where a read Public lacks is listed, if at all. */
function listedRead(read: Answer): Listed | null {
  if (read.kind === "no-rule") return "no-rule";
  if (read.kind === "failed") return "failed";
  return read.value === true || read.value === false ? null : "not-true";
}

/** Where a write Public lacks is listed, if at all. */
function listedWrite(answer: Answer): Listed | null {
  if (answer.kind === "failed") return "failed";
  return answer.kind === "answered" && answer.value === true ? "write" : null;
}

/** The startup listing of what Public lacks, or `null` where it lacks none. */
function listing(asked: readonly Asked[], held: Set<string>): string | null {
  const named = new Map<Listed, string[]>();
  const name = (group: Listed | null, action: Action, slug: string) => {
    const permission = permissionSlug(action, slug);
    if (group === null || held.has(permission)) return;
    named.set(group, [...(named.get(group) ?? []), permission]);
  };
  for (const { target, read, writes } of asked) {
    name(listedRead(read), "read", target.slug);
    for (const { action, answer } of writes) {
      name(listedWrite(answer), action, target.slug);
    }
  }
  if (named.size === 0) return null;
  const lines = (Object.keys(LISTED) as Listed[])
    .filter(group => named.has(group))
    .map(group => `  - ${LISTED[group]}: ${named.get(group)!.join(", ")}.`);
  return [
    "[Nextly] In an upcoming release, what visitors may do is what the Public role holds, and it does not hold these yet:",
    ...lines,
    "Grant the Public role each permission visitors should keep, under Roles. This is repeated at each start while the Public role lacks any of them.",
  ].join("\n");
}

/** What a boot grants Public and takes back from it, with its rules' answers. */
interface Decided {
  roleId: string;
  ids: Map<string, string>;
  asked: Asked[];
  wanted: Array<{ id: string; action: string; resource: string }>;
  /** Of `wanted`, those an enabled plugin declares, with the plugin. */
  declaring: Map<string, PluginGrant>;
}

/**
 * Asks every rule about a visitor, works out what Public is to be granted,
 * and takes back each plugin grant no enabled plugin declares any longer,
 * except one this boot grants for another reason, such as a read whose rule
 * answers `true`. Taking back needs no permission made, so it is done here,
 * before anything is granted. `null` where the Public role is not made.
 */
async function decide({
  publicRoleId,
  targets,
  permissionIds,
  declared,
  withdraw,
  meta,
  logger,
}: PublicReadGrantSeeding): Promise<Decided | null> {
  const roleId = await publicRoleId();
  if (roleId === null) return null;
  // Every rule of every target is asked at once, so one deadline bounds them.
  // Started once the targets are known, so the time their lookup takes is
  // not taken from the rules.
  const found = await targets();
  const { deadline, stop } = sharedDeadline();
  let asked: Asked[];
  try {
    asked = await Promise.all(
      found.map(async target => {
        // Worked out once per target, and only where a rule reads them.
        let contexts: Array<RuleLanguage | undefined> | undefined;
        const once = () => (contexts ??= languageContexts(target));
        const [read, ...writes] = await Promise.all([
          ask(target, "read", once, deadline),
          ...WRITES[target.kind].map(action =>
            ask(target, action, once, deadline)
          ),
        ]);
        return {
          target,
          read,
          writes: WRITES[target.kind].map((action, i) => ({
            action,
            answer: writes[i],
          })),
        };
      })
    );
  } finally {
    stop();
  }

  const ids = await permissionIds();
  const { grants: pluginGrants, refused } = declared();
  for (const { action, collection, owner } of refused) {
    logger.error(
      `[Nextly] The plugin "${owner}" declares that the Public role may ${action} "${collection}", which is not a collection it contributes, or not an action a plugin may grant (read or create). Nothing was granted for it.`
    );
  }
  const wanted = [
    { action: "read", resource: "media" },
    ...asked
      .filter(({ read }) => read.kind === "answered" && read.value === true)
      .map(({ target }) => ({ action: "read", resource: target.slug })),
    ...pluginGrants,
  ].flatMap(({ action, resource }) => {
    const id = ids.get(permissionSlug(action, resource));
    return id === undefined ? [] : [{ id, action, resource }];
  });
  const declaring = new Map(
    pluginGrants.flatMap(grant => {
      const id = ids.get(permissionSlug(grant.action, grant.resource));
      return id === undefined ? [] : [[id, grant] as const];
    })
  );
  await withdrawUndeclared(roleId, new Set(wanted.map(({ id }) => id)), {
    withdraw,
    meta,
    logger,
  });
  return { roleId, ids, asked, wanted, declaring };
}

/**
 * Takes back the plugin grants no enabled plugin declares any longer, alone,
 * for a boot that cannot grant: one where some permission failed to seed. The
 * rules are asked as a whole boot asks them, so a read one opens is not taken
 * back.
 */
export async function withdrawUndeclaredPluginGrants(
  deps: PublicReadGrantSeeding
): Promise<void> {
  await decide(deps);
}

/**
 * Grants Public each read code opens to anyone and each permission plugins
 * declare for it, once, takes back each plugin grant no enabled plugin
 * declares any longer, then lists what Public still lacks that visitors may be relying on.
 */
export async function seedPublicReadGrants(
  deps: PublicReadGrantSeeding
): Promise<void> {
  const decided = await decide(deps);
  if (decided === null) return;
  const { roleId, ids, asked, wanted, declaring } = decided;
  const { addOnce, publicHolds, meta, logger } = deps;

  // Claimed and made in one transaction, under the lock an edit of the
  // role's permissions takes, so a grant is made once: not by two boots at
  // once, not again after an owner has taken it away, and not over an owner's
  // edit made meanwhile. The claim and the grant commit or roll back
  // together. One the role holds already is claimed and left as it is, and
  // one whose permission was edited meanwhile into another is left out.
  await addOnce(roleId, wanted, (asWanted, executor) =>
    claimGrants(
      meta,
      roleId,
      asWanted,
      declaring,
      new Set(ids.values()),
      executor
    )
  );

  const said = listing(asked, await publicHolds(roleId));
  if (said !== null) logger.warn(said);
}

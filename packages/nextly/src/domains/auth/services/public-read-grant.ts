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
 * (`contributes.publicGrants`) is granted the same way, once. While that
 * plugin is disabled, a grant it made is taken back if Public still holds it,
 * and forgotten, so enabling the plugin again grants it again; one an owner
 * took away first stays recorded, and enabling never grants it back.
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
   * The permissions plugins declare for Public, those of disabled plugins
   * (withheld), and those refused.
   */
  declared: () => {
    grants: ReadonlyArray<{ action: string; resource: string }>;
    withheld: ReadonlyArray<{
      action: string;
      resource: string;
      owner: string;
    }>;
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

/** The recorded grants: the Public role they were made to, and their ids. */
interface Recorded {
  role: string;
  granted: string[];
}

/**
 * Claims `ids` in the recorded grants, on `executor`, the transaction they are
 * made in, keeping only ids of permissions that still exist. Grants recorded
 * for another role, a Public role since removed and made again, count for
 * nothing: the new role is granted afresh. Returns the ids this boot claimed:
 * those no other boot recorded first.
 */
async function claimGrants(
  meta: PublicReadGrantSeeding["meta"],
  roleId: string,
  ids: readonly string[],
  existing: ReadonlySet<string>,
  executor: unknown
): Promise<string[]> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const recorded = await meta.get<Recorded>(
      PUBLIC_GRANTED_META_KEY,
      executor
    );
    if (recorded === null) {
      const empty: Recorded = { role: roleId, granted: [] };
      await meta.insertIfAbsent(PUBLIC_GRANTED_META_KEY, empty, executor);
      continue;
    }
    const granted = recorded.role === roleId ? recorded.granted : [];
    const claimed = ids.filter(id => !granted.includes(id));
    if (claimed.length === 0) return [];
    const next: Recorded = {
      role: roleId,
      granted: Array.from(
        new Set([...granted.filter(id => existing.has(id)), ...claimed])
      ).sort(),
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
 * are taken back in, keeping only those recorded for this role. Returns the
 * ids dropped: a held id no boot recorded was given by an owner, not by boot
 * seeding, and is not taken back.
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
    const released = held.filter(id => recorded.granted.includes(id));
    if (released.length === 0) return [];
    const next: Recorded = {
      role: roleId,
      granted: recorded.granted.filter(id => !released.includes(id)),
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
 * Takes back each grant a disabled plugin declared where boot seeding recorded
 * it and Public still holds it, and forgets it, so enabling the plugin again
 * grants it again. One Public no longer holds was taken away by an owner and
 * stays recorded, so enabling never grants it back. One in `kept` is left
 * alone. Each removal is logged, once: it is no longer recorded, so no later
 * boot takes it back.
 */
async function withdrawGrants(
  roleId: string,
  ids: ReadonlyMap<string, string>,
  withheld: ReturnType<PublicReadGrantSeeding["declared"]>["withheld"],
  kept: ReadonlySet<string>,
  {
    withdraw,
    meta,
    logger,
  }: Pick<PublicReadGrantSeeding, "withdraw" | "meta" | "logger">
): Promise<void> {
  const withdrawing = new Map(
    withheld.flatMap(({ action, resource, owner }) => {
      const slug = permissionSlug(action, resource);
      const id = ids.get(slug);
      return id === undefined || kept.has(id)
        ? []
        : [[id, { slug, owner, action, resource }] as const];
    })
  );
  if (withdrawing.size === 0) return;
  const removed = await withdraw(
    roleId,
    [...withdrawing].map(([id, { action, resource }]) => ({
      id,
      action,
      resource,
    })),
    (held, executor) => releaseGrants(meta, roleId, held, executor)
  );
  for (const id of removed) {
    const { slug, owner } = withdrawing.get(id)!;
    logger.warn(
      `[Nextly] Removed "${slug}" from the Public role: the plugin "${owner}" that declared it is disabled.`
    );
  }
}

/**
 * Takes back what disabled plugins had Public granted, alone, for a boot that
 * cannot grant: one where some permission failed to seed. Taking back needs
 * no permission made. A plugin still enabled keeps what it declares; a read
 * a rule opens is not asked here, so one a disabled plugin also declares is
 * taken back and granted again by the next whole boot.
 */
export async function withdrawDisabledPluginGrants(
  deps: Pick<
    PublicReadGrantSeeding,
    | "publicRoleId"
    | "permissionIds"
    | "declared"
    | "withdraw"
    | "meta"
    | "logger"
  >
): Promise<void> {
  const roleId = await deps.publicRoleId();
  if (roleId === null) return;
  const ids = await deps.permissionIds();
  const { grants, withheld } = deps.declared();
  const kept = new Set(
    grants.flatMap(({ action, resource }) => {
      const id = ids.get(permissionSlug(action, resource));
      return id === undefined ? [] : [id];
    })
  );
  await withdrawGrants(roleId, ids, withheld, kept, deps);
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

/**
 * Grants Public each read code opens to anyone and each permission plugins
 * declare for it, once, takes back what a disabled plugin had it granted,
 * then lists what Public still lacks that visitors may be relying on.
 */
export async function seedPublicReadGrants({
  publicRoleId,
  targets,
  permissionIds,
  publicHolds,
  declared,
  addOnce,
  withdraw,
  meta,
  logger,
}: PublicReadGrantSeeding): Promise<void> {
  const roleId = await publicRoleId();
  if (roleId === null) return;
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
  const { grants: pluginGrants, withheld, refused } = declared();
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
  // One this boot also grants, such as a read whose rule answers `true`, is
  // not taken back.
  await withdrawGrants(
    roleId,
    ids,
    withheld,
    new Set(wanted.map(({ id }) => id)),
    { withdraw, meta, logger }
  );

  // Claimed and made in one transaction, under the lock an edit of the
  // role's permissions takes, so a grant is made once: not by two boots at
  // once, not again after an owner has taken it away, and not over an owner's
  // edit made meanwhile. The claim and the grant commit or roll back
  // together. One the role holds already is claimed and left as it is, and
  // one whose permission was edited meanwhile into another is left out.
  await addOnce(roleId, wanted, (asWanted, executor) =>
    claimGrants(meta, roleId, asWanted, new Set(ids.values()), executor)
  );

  const said = listing(asked, await publicHolds(roleId));
  if (said !== null) logger.warn(said);
}

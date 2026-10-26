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
 * the same evaluator, in each configured language and in all at once.
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
import { askRule, type AccessTarget } from "../../../auth/access/decide";
import {
  everyLanguage,
  registeredReadLanguagesFor,
  registeredWriteLanguagesFor,
  withRuleLanguage,
  type RuleLanguage,
} from "../../../auth/access/rule-language";
import { NextlyError } from "../../../errors/nextly-error";
import { permissionSlug } from "../../../schemas/_zod/rbac";
import type { Logger } from "../../../services/shared";

/**
 * The `nextly_meta` key listing the permissions boot seeding has granted
 * Public, by permission id. A permission deleted with its collection and made
 * again for a new one has a new id, so the new collection is granted afresh.
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
   * Adds to the role the permission ids `pick` chooses, in one transaction
   * that never interleaves with an edit of the role's permissions; `pick` is
   * told the ids the role holds and handed the transaction's executor. The
   * ids added.
   */
  addOnce: (
    roleId: string,
    pick: (
      held: ReadonlySet<string>,
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
 * Asks a target's rule for `action` about a visitor, through the evaluator
 * every door uses, in `language`, bounded in time.
 */
async function askIn(
  target: AccessTarget,
  action: Action,
  language: RuleLanguage | undefined
): Promise<Answer> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<typeof NO_ANSWER>(resolve => {
    timer = setTimeout(() => resolve(NO_ANSWER), RULE_ANSWER_TIMEOUT_MS);
    timer.unref?.();
  });
  const asking = () => askRule(visitorActor(), action, target);
  try {
    const outcome = await Promise.race([
      language ? withRuleLanguage(language, asking) : asking(),
      deadline,
    ]);
    if (outcome === NO_ANSWER) return { kind: "failed" };
    if (!outcome.declared) return { kind: "no-rule" };
    return "threw" in outcome
      ? { kind: "failed" }
      : { kind: "answered", value: outcome.value };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Asks a target's rule for `action` about a visitor in each configured
 * language, as a visitor's request in that language is asked, and in every
 * language at once, as a request naming none is asked, and keeps the
 * answer that lets the most through: `true` in any language, as Public needs
 * the permission for that language's visitors; else a failure, as the rule
 * could not be told apart from one that lets them through.
 */
async function ask(target: AccessTarget, action: Action): Promise<Answer> {
  const codes = everyLanguage().locales;
  const languageFor =
    action === "read"
      ? registeredReadLanguagesFor
      : registeredWriteLanguagesFor;
  // Each language a visitor may ask in; for a read, each one again as a
  // translation overview or a language filter asks it, told every language
  // as well; and every language at once, as a read of every translation, a
  // write to every language or a delete is asked.
  const contexts =
    codes.length === 0
      ? [undefined]
      : [
          ...codes.map(code => languageFor(code)),
          ...(action === "read"
            ? codes.map(code =>
                registeredReadLanguagesFor(code, undefined, {
                  translationStatus: true,
                })
              )
            : []),
          everyLanguage(),
        ];
  const answers = await Promise.all(
    contexts.map(language => askIn(target, action, language))
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

/**
 * Claims `ids` in the recorded grants, on `executor`, the transaction they are
 * made in, keeping only ids of permissions that still exist. Returns the ids
 * this boot claimed: those no other boot recorded first.
 */
async function claimGrants(
  meta: PublicReadGrantSeeding["meta"],
  ids: readonly string[],
  existing: ReadonlySet<string>,
  executor: unknown
): Promise<string[]> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const recorded = await meta.get<string[]>(
      PUBLIC_GRANTED_META_KEY,
      executor
    );
    if (recorded === null) {
      await meta.insertIfAbsent(PUBLIC_GRANTED_META_KEY, [], executor);
      continue;
    }
    const claimed = ids.filter(id => !recorded.includes(id));
    if (claimed.length === 0) return [];
    const next = Array.from(
      new Set([...recorded.filter(id => existing.has(id)), ...claimed])
    ).sort();
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
 * Grants Public each read code opens to anyone, once, then lists what Public
 * still lacks that visitors may be relying on.
 */
export async function seedPublicReadGrants({
  publicRoleId,
  targets,
  permissionIds,
  publicHolds,
  addOnce,
  meta,
  logger,
}: PublicReadGrantSeeding): Promise<void> {
  const roleId = await publicRoleId();
  if (roleId === null) return;
  // Every rule of every target is asked at once, so one deadline bounds them.
  const asked: Asked[] = await Promise.all(
    (await targets()).map(async target => {
      const [read, ...writes] = await Promise.all([
        ask(target, "read"),
        ...WRITES[target.kind].map(action => ask(target, action)),
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

  const ids = await permissionIds();
  const wanted = [
    "media",
    ...asked
      .filter(({ read }) => read.kind === "answered" && read.value === true)
      .map(({ target }) => target.slug),
  ].flatMap(resource => ids.get(permissionSlug("read", resource)) ?? []);
  // Claimed and made in one transaction, under the lock an edit of the
  // role's permissions takes, so a grant is made once: not by two boots at
  // once, not again after an owner has taken it away, and not over an owner's
  // edit made meanwhile. The claim and the grant commit or roll back
  // together. One the role holds already is claimed and left as it is.
  await addOnce(roleId, (_held, executor) =>
    claimGrants(meta, wanted, new Set(ids.values()), executor)
  );

  const said = listing(asked, await publicHolds(roleId));
  if (said !== null) logger.warn(said);
}

/**
 * The Public role's read, granted at boot where code says anyone may read.
 *
 * Each collection's and Single's read rule is asked about a visitor. Where it
 * answers exactly `true`, a plain `true` or a function returning `true`,
 * Public is granted that read, as it is `read-media`; `read-users` never.
 * Each grant is made once: claimed in `nextly_meta` by permission id before
 * it is made, so a read an owner takes away again stays away, while an entity
 * added later, or a rule changed to `true`, is granted at the first boot that
 * sees it. Rules are asked as a visitor's request is, through the same
 * evaluator and in each configured language.
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
  /** Grants the role the read of `resource`. */
  grantRead: (roleId: string, resource: string) => Promise<void>;
  meta: {
    get<T>(key: string): Promise<T | null>;
    insertIfAbsent(key: string, value: unknown): Promise<void>;
    compareAndSet(
      key: string,
      expected: unknown,
      next: unknown
    ): Promise<boolean>;
  };
  logger: Logger;
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
 * language, as a visitor's request in that language is asked, and keeps the
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
  const answers = await Promise.all(
    codes.length === 0
      ? [askIn(target, action, undefined)]
      : codes.map(code => askIn(target, action, languageFor(code)))
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
 * Claims `ids` in the recorded grants before they are made, against any other
 * boot doing the same, keeping only ids of permissions that still exist.
 * Returns the ids this boot claimed: those no other boot recorded first.
 */
async function claimGrants(
  meta: PublicReadGrantSeeding["meta"],
  ids: readonly string[],
  existing: ReadonlySet<string>
): Promise<string[]> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const recorded = await meta.get<string[]>(PUBLIC_GRANTED_META_KEY);
    if (recorded === null) {
      await meta.insertIfAbsent(PUBLIC_GRANTED_META_KEY, []);
      continue;
    }
    const claimed = ids.filter(id => !recorded.includes(id));
    if (claimed.length === 0) return [];
    const next = Array.from(
      new Set([...recorded.filter(id => existing.has(id)), ...claimed])
    ).sort();
    if (await meta.compareAndSet(PUBLIC_GRANTED_META_KEY, recorded, next)) {
      return claimed;
    }
  }
  throw NextlyError.internal({
    logContext: { reason: "public-read-grants-not-recorded" },
  });
}

/**
 * Takes `ids` back out of the recorded grants, for grants claimed and then
 * not made, so the next boot makes them. Best effort: the failure that made
 * them unmade is the one reported.
 */
async function releaseClaims(
  meta: PublicReadGrantSeeding["meta"],
  ids: readonly string[]
): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const recorded = await meta.get<string[]>(PUBLIC_GRANTED_META_KEY);
    if (recorded === null) return;
    const next = recorded.filter(id => !ids.includes(id));
    if (await meta.compareAndSet(PUBLIC_GRANTED_META_KEY, recorded, next)) {
      return;
    }
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

/**
 * Grants Public each read code opens to anyone, once, then lists what Public
 * still lacks that visitors may be relying on.
 */
export async function seedPublicReadGrants({
  publicRoleId,
  targets,
  permissionIds,
  publicHolds,
  grantRead,
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
  const wanted = new Map<string, string>();
  for (const resource of [
    "media",
    ...asked
      .filter(({ read }) => read.kind === "answered" && read.value === true)
      .map(({ target }) => target.slug),
  ]) {
    const id = ids.get(permissionSlug("read", resource));
    if (id !== undefined) wanted.set(id, resource);
  }
  // Claimed before it is made, so a grant is never made twice: not by two
  // boots at once, and not again after an owner has taken it away. A boot
  // that stops between the two leaves the grant unmade rather than repeated.
  const claimed = await claimGrants(
    meta,
    [...wanted.keys()],
    new Set(ids.values())
  );
  for (const [i, id] of claimed.entries()) {
    try {
      await grantRead(roleId, wanted.get(id)!);
    } catch (error) {
      await releaseClaims(meta, claimed.slice(i)).catch(() => undefined);
      throw error;
    }
  }

  const said = listing(asked, await publicHolds(roleId));
  if (said !== null) logger.warn(said);
}

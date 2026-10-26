/**
 * The Public role's read, granted at boot where code says anyone may read.
 *
 * Each collection's and Single's read rule is asked about a visitor. Where it
 * answers exactly `true`, a plain `true` or a function returning `true`,
 * Public is granted that read, as it is `read-media`; `read-users` never.
 * Each grant is made once and recorded in `nextly_meta`, so a read an owner
 * takes away again stays away, and an entity added later, or a rule changed
 * to `true`, is granted at the first boot that sees it.
 *
 * Then what Public does not hold yet and visitors may be relying on is
 * listed, at every boot while Public lacks it: a read with no rule, which a
 * visitor has by default, a read whose rule answers neither `true` nor
 * `false`, a write whose rule answers `true`, and any rule that failed or
 * gave no answer when asked.
 *
 * @module domains/auth/services/public-read-grant
 */
import { ruleContext, visitorActor } from "../../../auth/access/actor";
import { NextlyError } from "../../../errors/nextly-error";
import { permissionSlug } from "../../../schemas/_zod/rbac";
import type { Logger } from "../../../services/shared";
import type { AccessControlFunction } from "../../../shared/types/access";

/** The `nextly_meta` key listing the reads boot seeding has granted Public. */
const PUBLIC_READ_GRANTED_META_KEY = "public-read-granted";

/**
 * How long a rule may take to answer at boot before it is taken as giving
 * none. Every rule is asked at once, so this bounds the whole step.
 */
const RULE_ANSWER_TIMEOUT_MS = 2000;

type Action = "read" | "create" | "update" | "delete";

/** A collection or Single, with its code-defined access where it has one. */
interface PublicReadTarget {
  kind: "collection" | "single";
  slug: string;
  /**
   * Its rules by action. A Single's access has no `create` or `delete`, which
   * read as absent here, so both kinds are asked one way.
   */
  access?: Partial<Record<Action, AccessControlFunction | boolean>>;
}

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
  targets: () => Promise<PublicReadTarget[]>;
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

/** Asks a target's rule for `action` about a visitor, bounded in time. */
async function ask(target: PublicReadTarget, action: Action): Promise<Answer> {
  const rule = target.access?.[action];
  if (rule === undefined) return { kind: "no-rule" };
  if (typeof rule === "boolean") return { kind: "answered", value: rule };
  if (typeof rule !== "function") return { kind: "no-rule" };

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const deadline = new Promise<typeof NO_ANSWER>(resolve => {
      timer = setTimeout(() => resolve(NO_ANSWER), RULE_ANSWER_TIMEOUT_MS);
      timer.unref?.();
    });
    const value = await Promise.race([
      // Called inside the chain, so a rule that throws as it is called
      // rejects here rather than escaping the race.
      Promise.resolve().then(() =>
        rule(ruleContext(visitorActor(), action, target))
      ),
      deadline,
    ]);
    return value === NO_ANSWER
      ? { kind: "failed" }
      : { kind: "answered", value };
  } catch {
    return { kind: "failed" };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Adds `slugs` to the recorded grants, against any other boot doing the same. */
async function recordGranted(
  meta: PublicReadGrantSeeding["meta"],
  slugs: readonly string[]
): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const recorded = await meta.get<string[]>(PUBLIC_READ_GRANTED_META_KEY);
    if (recorded === null) {
      await meta.insertIfAbsent(PUBLIC_READ_GRANTED_META_KEY, []);
      continue;
    }
    const next = Array.from(new Set([...recorded, ...slugs])).sort();
    if (
      await meta.compareAndSet(PUBLIC_READ_GRANTED_META_KEY, recorded, next)
    ) {
      return;
    }
  }
  throw NextlyError.internal({
    logContext: { reason: "public-read-grants-not-recorded" },
  });
}

/** A target, with what its rules said about a visitor. */
interface Asked {
  target: PublicReadTarget;
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
  publicHolds,
  grantRead,
  meta,
  logger,
}: PublicReadGrantSeeding): Promise<void> {
  const roleId = await publicRoleId();
  if (roleId === null) return;
  const asked: Asked[] = await Promise.all(
    (await targets()).map(async target => ({
      target,
      read: await ask(target, "read"),
      writes: await Promise.all(
        WRITES[target.kind].map(async action => ({
          action,
          answer: await ask(target, action),
        }))
      ),
    }))
  );

  const recorded = new Set(
    (await meta.get<string[]>(PUBLIC_READ_GRANTED_META_KEY)) ?? []
  );
  const toGrant = [
    "media",
    ...asked
      .filter(({ read }) => read.kind === "answered" && read.value === true)
      .map(({ target }) => target.slug),
  ].filter(slug => !recorded.has(slug));
  for (const slug of toGrant) await grantRead(roleId, slug);
  if (toGrant.length > 0) await recordGranted(meta, toGrant);

  const said = listing(asked, await publicHolds(roleId));
  if (said !== null) logger.warn(said);
}

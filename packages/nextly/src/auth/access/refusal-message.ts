/**
 * What a refusal tells its caller about what was refused.
 *
 * In the site's own words: the action as a verb a person would use, and the
 * thing as the site names it (a collection's label, one entry of it, a
 * Single's label, or a system resource in words). Never a slug or a
 * permission as stored, and never a slug the site does not know, so a caller
 * cannot make a refusal repeat a URL back. Which check refused, and on what
 * grant, is for the server's log, never this message.
 *
 * @module auth/access/refusal-message
 */
import { servingRequestId } from "../../api/serving-request";
import { container } from "../../di/container";
import { SYSTEM_RESOURCES, type SystemResource } from "../../schemas/_zod/rbac";
import type { Logger } from "../../shared/types";

/** Whether a refusal is about one entry, or about the collection as a whole. */
export type RefusalScope = "one" | "all";

/** The verb a person would use for each action. */
const VERBS: Readonly<Record<string, string>> = {
  read: "see",
  create: "create",
  update: "edit",
  delete: "delete",
  publish: "publish",
  unpublish: "unpublish",
  manage: "manage",
  export: "export",
};

/**
 * Each system resource in words. Typed by the resource list, so a system
 * resource added there is not refused until it is given a name here.
 */
const SYSTEM_NAMES: Readonly<Record<SystemResource, string>> = {
  users: "users",
  roles: "roles",
  permissions: "permissions",
  media: "media",
  settings: "settings",
  "email-providers": "email providers",
  "email-templates": "email templates",
  "api-keys": "API keys",
  webhooks: "webhooks",
  "content-releases": "content releases",
  "background-jobs": "background jobs",
};

const NOTHING_NAMED = "You can't do that.";

/** A collection's labels, as the configuration and the registry hold them. */
interface CollectionLabels {
  singular?: string;
  plural?: string;
}

/** The parts of the registered configuration a thing's name is read from. */
interface NamedContent {
  collections?: readonly { slug: string; labels?: CollectionLabels }[];
  singles?: readonly { slug: string; label?: { singular?: string } }[];
}

interface CollectionRegistry {
  getCollectionBySlug(
    slug: string,
    executor?: unknown
  ): Promise<{ labels?: CollectionLabels } | null>;
}

interface SingleRegistry {
  getSingleBySlug(
    slug: string,
    executor?: unknown
  ): Promise<{ label?: string } | null>;
}

/** A service the container holds, or nothing where it holds none. */
function registered<T>(name: string): T | undefined {
  try {
    if (container.has(name)) return container.get<T>(name);
  } catch {
    // The container is not initialized; nothing is named yet.
  }
  return undefined;
}

/**
 * A label as it reads in a sentence: each ordinary word in lower case, and a
 * word written with capitals of its own (`FAQs`, `API`) as written.
 */
function inSentence(label: string): string {
  return label
    .split(/\s+/)
    .map(word => (/^[A-Z]?[a-z]*$/.test(word) ? word.toLowerCase() : word))
    .join(" ");
}

/** A slug's words, for a thing the site registered without a label. */
function wordsOf(slug: string): string {
  return slug.split(/[-_]+/).join(" ");
}

/** A collection named by its labels: one entry of it, or all of it. */
function collectionThing(
  resource: string,
  labels: CollectionLabels | undefined,
  scope: RefusalScope
): string {
  if (scope === "one") {
    return labels?.singular
      ? `this ${inSentence(labels.singular)}`
      : "this entry";
  }
  return labels?.plural ? inSentence(labels.plural) : wordsOf(resource);
}

/** The thing as the system resources or the configuration name it. */
function heldThing(resource: string, scope: RefusalScope): string | null {
  if ((SYSTEM_RESOURCES as readonly string[]).includes(resource)) {
    return SYSTEM_NAMES[resource as SystemResource];
  }
  const content = registered<NamedContent>("config");
  const collection = content?.collections?.find(c => c.slug === resource);
  if (collection) return collectionThing(resource, collection.labels, scope);
  const single = content?.singles?.find(s => s.slug === resource);
  if (single) return single.label?.singular ?? wordsOf(resource);
  return null;
}

/**
 * The thing as the collection and Single registries name it, which includes
 * what the Schema Builder made. Read on `executor` where one is passed, so a
 * gate inside a transaction does not take a second connection.
 */
async function registeredThing(
  resource: string,
  scope: RefusalScope,
  executor: unknown
): Promise<string | null> {
  try {
    const collection = await registered<CollectionRegistry>(
      "collectionRegistryService"
    )?.getCollectionBySlug(resource, executor);
    if (collection) return collectionThing(resource, collection.labels, scope);
    const single = await registered<SingleRegistry>(
      "singleRegistryService"
    )?.getSingleBySlug(resource, executor);
    if (single) return single.label || wordsOf(resource);
  } catch {
    // A lookup that fails names nothing, rather than failing the refusal.
  }
  return null;
}

/** The sentence a refusal of `action` on `thing` reads as. */
function sentence(action: string, thing: string): string {
  return `You can't ${VERBS[action] ?? action} ${thing}.`;
}

/** How a refusal may name what it refused. */
export interface RefusalNaming {
  /**
   * The thing was named by server code (the Direct API, a plugin service),
   * not by a request, so its slug is the site's own and may be said in words
   * where no label is held. A request's slug never is.
   */
  named?: boolean;
  /** The transaction the refusing gate runs in, for the registries' reads. */
  executor?: unknown;
}

/**
 * The message a refusal of `action` on `resource` is answered with: named
 * from the system resources and the registered configuration first, then
 * from the collection and Single registries. A slug none of them knows is
 * never named unless server code named it, so a request cannot make its
 * refusal repeat it.
 */
export async function refusalMessageFor(
  action: string,
  resource: string,
  scope: RefusalScope = "all",
  naming: RefusalNaming = {}
): Promise<string> {
  if (resource === "") return NOTHING_NAMED;
  const thing =
    heldThing(resource, scope) ??
    (await registeredThing(resource, scope, naming.executor));
  if (thing !== null) return sentence(action, thing);
  if (naming.named) {
    return sentence(action, scope === "one" ? "this entry" : wordsOf(resource));
  }
  return NOTHING_NAMED;
}

/** What the server logs about one refusal; none of it is sent. */
export interface RefusalLog {
  status: number;
  code?: string;
  /** Which check refused, and on what grant. */
  reason: string;
  /**
   * The id the refused caller was answered with. Without one, the id of the
   * request being served, where the refusal is made while serving one.
   */
  requestId?: string;
}

/**
 * Records a refusal's reason on the server. A logger that fails is ignored:
 * the refusal is still answered.
 */
export function logRefusal(logger: Logger, refusal: RefusalLog): void {
  try {
    const requestId = refusal.requestId ?? servingRequestId();
    logger.info("[nextly] Refused a request", {
      ...refusal,
      ...(requestId === undefined ? {} : { requestId }),
    });
  } catch {
    // Logging is never why a refusal goes unanswered.
  }
}

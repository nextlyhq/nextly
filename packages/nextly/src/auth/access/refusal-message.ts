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
import { container } from "../../di/container";
import { SYSTEM_RESOURCES, type SystemResource } from "../../schemas/_zod/rbac";

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

/** The parts of the registered configuration a thing's name is read from. */
interface NamedContent {
  collections?: readonly {
    slug: string;
    labels?: { singular?: string; plural?: string };
  }[];
  singles?: readonly { slug: string; label?: { singular?: string } }[];
}

function registeredContent(): NamedContent | undefined {
  try {
    if (container.has("config")) return container.get<NamedContent>("config");
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

/** The thing a refusal names, or nothing where the site does not know it. */
function thingNamed(resource: string, scope: RefusalScope): string | null {
  if ((SYSTEM_RESOURCES as readonly string[]).includes(resource)) {
    return SYSTEM_NAMES[resource as SystemResource];
  }
  const content = registeredContent();
  const collection = content?.collections?.find(c => c.slug === resource);
  if (collection) {
    if (scope === "one") {
      const singular = collection.labels?.singular;
      return singular ? `this ${inSentence(singular)}` : "this entry";
    }
    const plural = collection.labels?.plural;
    return plural ? inSentence(plural) : wordsOf(resource);
  }
  const single = content?.singles?.find(s => s.slug === resource);
  if (single) return single.label?.singular ?? wordsOf(resource);
  return null;
}

/** The sentence a refusal of `action` on `thing` reads as. */
function sentence(action: string, thing: string): string {
  return `You can't ${VERBS[action] ?? action} ${thing}.`;
}

/** How a refusal may name a thing it cannot find a label for. */
export interface RefusalNaming {
  /**
   * The thing was named by server code (the Direct API, a plugin service),
   * not by a request, so its slug is the site's own and may be said in words
   * where no label is held. A request's slug never is.
   */
  named?: boolean;
}

/**
 * The message a refusal of `action` on `resource` is answered with, from what
 * is held without asking the database: the registered configuration and the
 * system resources' names.
 */
export function refusalMessage(
  action: string,
  resource: string,
  scope: RefusalScope = "all",
  naming: RefusalNaming = {}
): string {
  if (resource === "") return NOTHING_NAMED;
  const thing = thingNamed(resource, scope);
  if (thing !== null) return sentence(action, thing);
  if (naming.named) {
    return sentence(action, scope === "one" ? "this entry" : wordsOf(resource));
  }
  return NOTHING_NAMED;
}

/** A collection's or Single's name as the registries hold it, or nothing. */
async function registeredThing(
  resource: string,
  scope: RefusalScope
): Promise<string | null> {
  try {
    if (container.has("collectionRegistryService")) {
      const collection = await container
        .get<{
          getCollectionBySlug(slug: string): Promise<{
            labels?: { singular?: string; plural?: string };
          } | null>;
        }>("collectionRegistryService")
        .getCollectionBySlug(resource);
      if (collection) {
        const label =
          scope === "one"
            ? collection.labels?.singular
            : collection.labels?.plural;
        if (label)
          return scope === "one"
            ? `this ${inSentence(label)}`
            : inSentence(label);
        return scope === "one" ? "this entry" : wordsOf(resource);
      }
    }
    if (container.has("singleRegistryService")) {
      const single = await container
        .get<{
          getSingleBySlug(slug: string): Promise<{ label?: string } | null>;
        }>("singleRegistryService")
        .getSingleBySlug(resource);
      if (single) return single.label || wordsOf(resource);
    }
  } catch {
    // A lookup that fails names nothing, rather than failing the refusal.
  }
  return null;
}

/**
 * {@link refusalMessage}, for a thing a request names: what is held without
 * the database first, then what the collection and Single registries hold,
 * which includes what the Schema Builder made. A slug neither knows is never
 * named, so a request cannot make its refusal repeat it.
 */
export async function refusalMessageFor(
  action: string,
  resource: string,
  scope: RefusalScope = "all"
): Promise<string> {
  const held = refusalMessage(action, resource, scope);
  if (held !== NOTHING_NAMED || resource === "") return held;
  const thing = await registeredThing(resource, scope);
  return thing === null ? NOTHING_NAMED : sentence(action, thing);
}

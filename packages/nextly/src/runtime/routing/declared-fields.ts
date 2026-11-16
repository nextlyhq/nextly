/**
 * A collection's or a Single's declared fields, from the registry, and the
 * fields among them a public read must never return.
 *
 * A field declared hidden (`hidden` or `admin.hidden`) is kept out of every
 * webhook payload by core's sanitizer, but the read pipeline returns it to any
 * caller its field rules allow, the anonymous visitor included. A published
 * page is that visitor, so the public reads use the sanitizer's own pipeline:
 * component references expanded (`expandComponentFields`, with a dynamic
 * zone's members kept apart by type), the hidden paths read off the expanded
 * tree (`sensitiveFieldPaths`), and the values stripped by the strip a webhook
 * payload gets. One pipeline, so the reader and the webhooks cannot disagree
 * about which fields are hidden, inside a component or out.
 *
 * Only the service lookups are imported, so the public reader can load this
 * inside its reads without loading the registry's own graph.
 *
 * @module runtime/routing/declared-fields
 */
import { getService, isServicesRegistered } from "../../di/service-access";
import { withSystemTextFields } from "../../domains/collections/system-text-fields";
import { buildEnvelope } from "../../domains/webhooks/envelope";
import { expandComponentFields } from "../../domains/webhooks/expand-component-fields";
import {
  sensitiveFieldPaths,
  type SensitiveFieldSource,
} from "../../domains/webhooks/sensitive-fields";
import { NextlyError } from "../../errors/nextly-error";

/** A collection or a Single, by its slug. */
export interface SourceEntity {
  kind: "collection" | "single";
  slug: string;
}

/** What the registry holds for a source that a read of it is shaped by. */
interface Declaration {
  readonly fields: readonly SensitiveFieldSource[];
  /**
   * The timestamps a read of it returns: a collection's entries carry
   * `createdAt` and `updatedAt` unless it turns timestamps off, as its type
   * and schema are generated; a Single's document carries `updatedAt` alone.
   */
  readonly timestamps: readonly ("createdAt" | "updatedAt")[];
}

/** What the registry holds for the source, or `undefined` when it has no such source. */
async function declarationOf(
  source: SourceEntity
): Promise<Declaration | undefined> {
  if (source.kind === "collection") {
    const record = await getService(
      "collectionRegistryService"
    ).getCollectionBySlug(source.slug);
    if (record === null) return undefined;
    return {
      // A collection's own `title` and `slug` are read with every entry. A
      // plugin's collection holds only the fields it declares, as its writes
      // treat it, so nothing is added for one.
      fields:
        record.admin?.isPlugin === true
          ? record.fields
          : withSystemTextFields(record.fields),
      timestamps: record.timestamps === false ? [] : ["createdAt", "updatedAt"],
    };
  }
  const record = await getService("singleRegistryService").getSingleBySlug(
    source.slug
  );
  return record === null
    ? undefined
    : { fields: record.fields, timestamps: ["updatedAt"] };
}

/**
 * The source's fields with every component reference grafted on, as the
 * webhook sanitizer expands them: a component's own fields under the field
 * that holds it, and a dynamic zone's members each under its type's segment.
 * `undefined` when the registry has no such source.
 */
export async function expandedFields(
  source: SourceEntity
): Promise<readonly SensitiveFieldSource[] | undefined> {
  return (await expandedDeclaration(source))?.fields;
}

/**
 * The source's expanded fields ({@link expandedFields}), and whether its
 * entries carry timestamps, from one registry read.
 */
export async function expandedDeclaration(source: SourceEntity): Promise<
  | {
      readonly fields: readonly SensitiveFieldSource[];
      readonly timestamps: readonly ("createdAt" | "updatedAt")[];
    }
  | undefined
> {
  const declaration = await declarationOf(source);
  if (declaration === undefined) return undefined;
  const fieldGroups = getService("fieldGroupDataService");
  return {
    fields: await expandComponentFields(declaration.fields, slug =>
      fieldGroups.getComponentFields(slug)
    ),
    timestamps: declaration.timestamps,
  };
}

const NONE: ReadonlySet<string> = new Set();

/**
 * The dotted paths of the hidden and password fields among a source's
 * expanded fields (`expandedFields`), by core's sensitive-field rule; none for
 * a source the registry does not hold. The one derivation of hidden paths from
 * declarations, so a reader that already holds the expanded fields derives
 * them without a second registry read.
 */
export function hiddenPathsOf(
  fields: readonly SensitiveFieldSource[] | undefined
): ReadonlySet<string> {
  return fields === undefined ? NONE : new Set(sensitiveFieldPaths(fields));
}

/**
 * The dotted paths of the source's hidden and password fields, inside its
 * components and dynamic zones too, by core's sensitive-field rule. None for
 * a source the registry does not hold: the read itself answers for that.
 *
 * Refused when no services are registered, because then which fields are
 * hidden cannot be known, and a read must not answer as if none were. A
 * reader over something other than this process's Nextly supplies the
 * declarations itself.
 */
export async function hiddenFieldPaths(
  source: SourceEntity
): Promise<ReadonlySet<string>> {
  if (!isServicesRegistered()) {
    throw NextlyError.configuration({
      logMessage:
        "A public read cannot tell which fields are hidden: no Nextly services are registered in this process, so its schema cannot be read. Give the reader its declarations if it reads elsewhere.",
      logContext: { reason: "public-read-schema-unavailable" },
    });
  }
  return hiddenPathsOf(await expandedFields(source));
}

/**
 * The document without its hidden fields; the same object when there are none.
 *
 * Stripped by the webhook sanitizer's own strip, the only one that reads a
 * dynamic-zone instance's component type, which is what a zone member's hidden
 * path names. Its envelope is built around the document and only its `data`
 * is kept; the identity and time it is given are placeholders nothing reads.
 */
export function withoutHidden(
  document: Record<string, unknown>,
  hidden: ReadonlySet<string>
): Record<string, unknown> {
  if (hidden.size === 0) return document;
  return buildEnvelope({
    id: "public-read",
    type: "entry.updated",
    timestamp: new Date(0),
    resource: { kind: "entry", collection: "public-read" },
    data: document,
    sensitiveFields: [...hidden],
  }).data;
}

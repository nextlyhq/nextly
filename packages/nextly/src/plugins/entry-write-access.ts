/**
 * A plugin's question "may this person write this document as I am about
 * to", answered without writing it.
 *
 * A plugin that rewrites content site-wide on a person's behalf (converting a
 * component's copies into plain blocks before the component goes, say) must
 * know before it changes anything that every write it will make would be
 * allowed, or it changes some documents and is refused on the next, leaving
 * the site half-done. `ctx.caller.can(..., { anyEntry: true })` answers yes
 * for a rule that lets the person change only some entries, and says nothing
 * of the publish gate or of field rules, so it cannot be that check.
 *
 * {@link mayWriteEntry} asks the gates the update itself asks, for this one
 * document, in the language it would be written in:
 *
 * - the update gate: the person's grant, and a rule's row filter matched
 *   against this entry (`canUpdateEntry`, the update's own check; for a
 *   Single, its update gate on the stored row);
 * - where the status the write names moves the document into or out of
 *   published, the publish or unpublish gate the same way, and only then:
 *   core's update asks it on that condition alone, as
 *   `resolvePublishTransition` classifies the stored status against the named
 *   one (`canMoveEntryStatus`; for a Single, its own lifecycle gate). A write
 *   keeping the document's status asks nothing more, as the update does;
 * - for each field named, the field's own update rule, which an update
 *   applies by leaving out a field the person may not set: a field it would
 *   leave out answers no. The rules are run over the body the write would
 *   send, as the update runs them over its own: the values `data` gives, the
 *   status the check names, and `null` for a field named only in `fields`.
 *   A rule reading `data` therefore judges what it will judge on the write
 *   when the check gives the write's values.
 *
 * No hook runs, nothing is written, and a document that does not exist
 * answers `false`, as one the person may not write. A `beforeChange` hook
 * that changes the body runs only on the write, so a rule is judged on the
 * body as the plugin sends it.
 *
 * @module plugins/entry-write-access
 * @experimental
 */
import { z } from "zod";

import {
  registeredWriteLanguagesFor,
  withRuleLanguage,
} from "../auth/access/rule-language";
import { getService } from "../di";
import {
  singleDocumentEditable,
  singleDocumentStatusMoveAllowed,
} from "../domains/singles/services/single-document-access";
import { NextlyError } from "../errors";
import type { CollectionsHandler } from "../services/collections-handler";
import { applyFieldWriteAccess } from "../shared/lib/field-level-registry";

import type { PluginRouteIdentity } from "./routes/route-types";

/** @experimental The document a write check names, and the write it asks about. */
export type PluginWriteCheck = (
  | {
      readonly collection: string;
      readonly id: string;
      readonly single?: never;
    }
  | {
      readonly single: string;
      readonly collection?: never;
      readonly id?: never;
    }
) & {
  /**
   * The status the write names, if it names one: its lifecycle gate is asked
   * only where it moves the document into or out of published.
   */
  readonly status?: string;
  /** The top-level fields the write sets, each judged by its update rule. */
  readonly fields?: readonly string[];
  /**
   * The body the write sends, by top-level field: each field it names is
   * judged as `fields` are, and every rule is run over this body, with
   * `status` the one the check names.
   */
  readonly data?: Readonly<Record<string, unknown>>;
  /** The language the write is made in. */
  readonly locale?: string;
};

/** A person, as `ctx.caller.identity()` resolved them, and nothing else. */
const PERSON = z.looseObject({
  user: z.looseObject({ id: z.string().min(1) }),
  overrideAccess: z.undefined().optional(),
});

const NAME = z.string().min(1).max(255);
const PARTS = {
  status: NAME.optional(),
  fields: z.array(NAME).max(64).optional(),
  data: z
    .record(NAME, z.unknown())
    .refine(body => Object.keys(body).length <= 64)
    .optional(),
  locale: NAME.optional(),
};

/** One document, an entry or a Single, never both. */
const CHECK = z.union([
  z.strictObject({ collection: NAME, id: NAME, ...PARTS }),
  z.strictObject({ single: NAME, ...PARTS }),
]);

/**
 * @experimental Whether `identity` may make this write of this document,
 * judged by the gates the write asks, as the module docblock lists them, with
 * no hook run and nothing written. `false` for a document that does not
 * exist. Refused for anything but a route's caller as
 * `ctx.caller.identity()` resolved them.
 */
export async function mayWriteEntry(
  identity: PluginRouteIdentity,
  check: PluginWriteCheck
): Promise<boolean> {
  if (!PERSON.safeParse(identity).success) {
    throw NextlyError.invalidInput({ message: IDENTITY_REFUSAL });
  }
  const named = CHECK.safeParse(check);
  if (!named.success) {
    throw NextlyError.invalidInput({ message: CHECK_REFUSAL });
  }
  const asked = named.data;
  const locale = asked.locale;
  return withRuleLanguage(registeredWriteLanguagesFor(locale), async () => {
    const gates =
      "single" in asked && asked.single !== undefined
        ? await singleGates(identity, asked.single, asked.status, locale)
        : await entryGates(
            identity,
            asked as { collection: string; id: string },
            asked.status,
            locale
          );
    if (!gates) return false;
    return fieldsKept(identity, asked, {
      fields: asked.fields ?? [],
      ...(asked.data === undefined ? {} : { data: asked.data }),
      ...(asked.status === undefined ? {} : { status: asked.status }),
    });
  });
}

/** An entry's update gate, and its lifecycle gate where the status moves. */
async function entryGates(
  identity: PluginRouteIdentity,
  entry: { readonly collection: string; readonly id: string },
  status: string | undefined,
  locale: string | undefined
): Promise<boolean> {
  const handler: CollectionsHandler = getService("collectionsHandler");
  const asked = {
    collectionName: entry.collection,
    entryId: entry.id,
    user: identity.user,
    ...(identity.authenticatedScope === undefined
      ? {}
      : { authenticatedScope: identity.authenticatedScope }),
    ...(locale === undefined ? {} : { locale }),
  };
  if (!(await handler.canUpdateEntry(asked))) return false;
  return (
    status === undefined ||
    handler.canMoveEntryStatus({ ...asked, nextStatus: status })
  );
}

/** A Single's update gate, and its lifecycle gate where the status moves. */
async function singleGates(
  identity: PluginRouteIdentity,
  slug: string,
  status: string | undefined,
  locale: string | undefined
): Promise<boolean> {
  const subject = {
    user: identity.user,
    routeAuthorized: false,
    ...(identity.authenticatedScope === undefined
      ? {}
      : { actor: identity.authenticatedScope }),
    ...(locale === undefined ? {} : { locale }),
  };
  if (!(await singleDocumentEditable(slug, subject))) return false;
  return (
    status === undefined ||
    singleDocumentStatusMoveAllowed(slug, status, subject)
  );
}

/**
 * Whether every field named survives the field update rules an update
 * applies: the same pass the write runs, as the person, over the body the
 * write would send (see the module docblock). The body is copied first, since
 * the pass removes what it refuses from the object it is handed.
 */
async function fieldsKept(
  identity: PluginRouteIdentity,
  asked: {
    readonly single?: string;
    readonly collection?: string;
    readonly id?: string;
  },
  write: {
    readonly fields: readonly string[];
    readonly data?: Readonly<Record<string, unknown>>;
    readonly status?: string;
  }
): Promise<boolean> {
  const sent = write.data ?? {};
  const fields = [...new Set([...write.fields, ...Object.keys(sent)])];
  if (fields.length === 0) return true;
  const data: Record<string, unknown> = {
    ...Object.fromEntries(fields.map(field => [field, null])),
    ...structuredClone(sent),
    ...(write.status === undefined ? {} : { status: write.status }),
  };
  await applyFieldWriteAccess({
    kind: asked.single !== undefined ? "single" : "collection",
    slug: asked.single ?? asked.collection ?? "",
    data,
    operation: "update",
    user: identity.user,
    ...(identity.authenticatedScope === undefined
      ? {}
      : { authenticatedScope: identity.authenticatedScope }),
    ...(asked.id === undefined ? {} : { id: asked.id }),
  });
  return fields.every(field => Object.hasOwn(data, field));
}

const IDENTITY_REFUSAL =
  "A write check is made as a route's caller, as `ctx.caller.identity()` resolved them.";

const CHECK_REFUSAL =
  "A write check names one document (a collection and an entry id, or a Single, and not both), and may name the status the write names, the fields it sets, the body it sends, and its language.";

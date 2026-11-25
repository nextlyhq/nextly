/**
 * What a caller may read and change of a document in one language, for the operations that work
 * on its translations beside its content: reading what a source said, marking a translation
 * reviewed.
 *
 * None of these is a save, so none passes a save's gates on its way. They ask here, and every
 * answer is the one an ordinary read or save of the same document in the same language gives: the
 * read itself, as the caller; the update gate; the field update rules over the body a save would
 * send. Two differences from a save are deliberate. A document the caller may not read or change
 * answers not found, so asking never tells one that is there from one that is not. And a field the
 * caller may not change is refused, where a save leaves it out and succeeds: an operation on one
 * field that left it out would report success and have done nothing.
 *
 * @experimental
 *
 * @module domains/i18n/pipeline/document-access
 */
import {
  registeredReadLanguagesFor,
  registeredWriteLanguagesFor,
  withRuleLanguage,
} from "../../../auth/access/rule-language";
import type { AuthenticatedScope } from "../../../auth/authenticated-scope";
import { currentPrincipal } from "../../../auth/principal-scope";
import { getService } from "../../../di";
import { NextlyError } from "../../../errors";
import { errorFromServiceEnvelope } from "../../../errors/from-service-envelope";
import { applyFieldWriteAccess } from "../../../shared/lib/field-level-registry";
import type { UserContext } from "../../collections/services/collection-types";
import {
  resolveSingleDocumentId,
  singleDocumentEditable,
} from "../../singles/services/single-document-access";
import { rowKeys } from "../shared-structure";

/** An entry of a collection, or a Single's one document. */
export type TranslatedDocument =
  | { readonly kind: "collection"; readonly slug: string; readonly id: string }
  | { readonly kind: "single"; readonly slug: string };

/** Who is asking, as a route or a Direct API call resolved them. */
export interface DocumentCaller {
  user?: UserContext;
  /** An API key's own scope: the key is judged on its own grants, never its maker's. */
  authenticatedScope?: AuthenticatedScope;
  /** Trusted server code, which no rule is asked of. */
  overrideAccess?: boolean;
  request?: Request;
  context?: Record<string, unknown>;
}

/**
 * One value inside a body: a field by its name, and the row of a repeater by its id, from the
 * top-level field in. `[{ field: "title" }]`, or
 * `[{ field: "sections" }, { row: "r1" }, { field: "heading" }]`.
 */
export type FieldPath = ReadonlyArray<
  { readonly field: string } | { readonly row: string }
>;

/** A service's answer, as far as it is read here. */
interface ServiceAnswer {
  success: boolean;
  statusCode: number;
  data?: unknown;
  code?: string;
  message?: string;
  messageKey?: string;
  publicData?: unknown;
}

/**
 * A read's document, or null for one that is not there or may not be read. A read that failed is
 * neither: it is thrown, so an outage never reads as a document that is not there.
 */
function documentOf(answer: ServiceAnswer): Record<string, unknown> | null {
  if (answer.success) {
    return typeof answer.data === "object" && answer.data !== null
      ? (answer.data as Record<string, unknown>)
      : null;
  }
  if (answer.statusCode === 403 || answer.statusCode === 404) return null;
  throw errorFromServiceEnvelope(
    { ...answer, message: answer.message ?? "The document could not be read" },
    { reason: "translation-document-read-failed" }
  );
}

/** What {@link readDocumentIn} also reads. */
export interface DocumentReadOptions {
  /** The language's held draft in place of its live values, where the caller may see it. */
  draft?: boolean;
  /**
   * Every language's own values (`_allLocales`), each judged in its own language, and each
   * language's status and fields' origins (`_translations`).
   */
  everyLanguage?: boolean;
}

/**
 * The document as the caller reads it in `locale`: that language's own values with none filled
 * from another, whatever its status, each field the caller may not read left out. Null for a
 * document that is not there or may not be read; a Single with no document yet is one, and is
 * never given one by asking.
 */
export async function readDocumentIn(
  document: TranslatedDocument,
  caller: DocumentCaller,
  locale: string,
  options: DocumentReadOptions = {}
): Promise<Record<string, unknown> | null> {
  const asked = {
    user: caller.user,
    authenticatedScope: caller.authenticatedScope,
    request: caller.request,
    context: caller.context,
    overrideAccess: caller.overrideAccess === true,
    locale,
    fallbackLocale: false as const,
    status: "all" as const,
    includeWorkingDraft: options.draft === true,
    ...(options.everyLanguage === true
      ? { translations: "all" as const, translationStatus: true }
      : {}),
    // Relations stay ids: a value is compared and shown as it is stored.
    depth: 0,
  };
  return withRuleLanguage(
    registeredReadLanguagesFor(locale, false),
    async () => {
      if (document.kind === "collection") {
        return documentOf(
          await getService("collectionsHandler").getEntry({
            collectionName: document.slug,
            entryId: document.id,
            ...asked,
          })
        );
      }
      // Asked of the stored row first: a Single's read gives it a document.
      if ((await resolveSingleDocumentId(document.slug)) === null) return null;
      return documentOf(
        await getService("singleEntryService").get(document.slug, {
          ...asked,
          createIfMissing: false,
        })
      );
    }
  );
}

/** The document's id, or null for a Single with none yet. */
export function documentIdOf(
  document: TranslatedDocument
): Promise<string | null> {
  return document.kind === "collection"
    ? Promise.resolve(document.id)
    : resolveSingleDocumentId(document.slug);
}

/** Whether the caller may update the document in `locale`, by the gate its update asks. */
async function documentEditable(
  document: TranslatedDocument,
  caller: DocumentCaller,
  locale: string
): Promise<boolean> {
  if (caller.overrideAccess === true) {
    return (await readDocumentIn(document, caller, locale)) !== null;
  }
  // Nobody to judge: an update is no visitor's.
  if (caller.user === undefined) return false;
  if (document.kind === "single") {
    // Sets its own rule language, as the Single's update does.
    return singleDocumentEditable(document.slug, {
      user: caller.user,
      routeAuthorized: false,
      locale,
      actor: caller.authenticatedScope,
      request: caller.request,
      context: caller.context,
    });
  }
  const { user, authenticatedScope } = caller;
  return withRuleLanguage(registeredWriteLanguagesFor(locale), () =>
    getService("collectionsHandler").canUpdateEntry({
      collectionName: document.slug,
      entryId: document.id,
      user,
      locale,
      authenticatedScope,
    })
  );
}

/** Refuses, as not found, a document the caller may not update in `locale`. */
async function assertDocumentEditable(
  document: TranslatedDocument,
  caller: DocumentCaller,
  locale: string
): Promise<void> {
  if (!(await documentEditable(document, caller, locale))) {
    throw NextlyError.notFound({
      logContext: {
        reason: "translation-document-not-editable",
        kind: document.kind,
        slug: document.slug,
        locale,
      },
    });
  }
}

/**
 * The paths of `paths` the caller may change in `locale`, by the field update rules run over
 * `body`, the body a save would send. None where the document itself may not be updated.
 *
 * `body` holds containers as values, as a read gives them, since the rules see no field inside
 * JSON text; it is copied, as they take what they refuse out of what they are handed. A field of a
 * component held inside a row is judged by the component's own rules, which this does not run.
 */
async function editablePaths(
  document: TranslatedDocument,
  caller: DocumentCaller,
  locale: string,
  body: Readonly<Record<string, unknown>>,
  paths: readonly FieldPath[]
): Promise<FieldPath[]> {
  if (!(await documentEditable(document, caller, locale))) return [];
  if (caller.overrideAccess === true) return [...paths];
  const data: Record<string, unknown> = structuredClone({ ...body });
  const id = await documentIdOf(document);
  await withRuleLanguage(registeredWriteLanguagesFor(locale), () =>
    applyFieldWriteAccess({
      kind: document.kind,
      slug: document.slug,
      data,
      operation: "update",
      user: caller.user,
      authenticatedScope: caller.authenticatedScope,
      ...(id === null ? {} : { id }),
    })
  );
  return paths.filter(path => holdsPath(data, path));
}

/** Refuses a change of any of `paths` the caller may not make; see {@link editablePaths}. */
export async function assertFieldsEditable(
  document: TranslatedDocument,
  caller: DocumentCaller,
  locale: string,
  body: Readonly<Record<string, unknown>>,
  paths: readonly FieldPath[]
): Promise<void> {
  await assertDocumentEditable(document, caller, locale);
  const editable = await editablePaths(document, caller, locale, body, paths);
  if (editable.length === paths.length) return;
  throw NextlyError.forbidden({
    logContext: {
      reason: "translation-field-not-editable",
      kind: document.kind,
      slug: document.slug,
      locale,
      denied: paths.filter(path => !editable.includes(path)),
    },
  });
}

/**
 * Refuses a caller that is no signed-in person: an API key, a plugin-defined person, a visitor, or
 * trusted code acting as the system. Server code acting for a user it names is that person, unless
 * it acts under a key: what a call records as its author does not tell the two apart, so the
 * caller's own scope is asked. `doing` completes "Only a signed-in person can".
 */
export function assertSignedInPerson(
  caller: DocumentCaller,
  doing: string
): void {
  const signedIn =
    caller.user !== undefined &&
    caller.overrideAccess !== true &&
    currentPrincipal() === null &&
    (caller.authenticatedScope === undefined ||
      caller.authenticatedScope.actorType === "user");
  if (signedIn) return;
  throw NextlyError.personOnly({
    doing,
    logContext: {
      reason: "not-a-signed-in-person",
      actorType: caller.authenticatedScope?.actorType,
      overrideAccess: caller.overrideAccess === true,
    },
  });
}

/** Whether `data` still holds a value at `path`: its own key at every field, its row by its key. */
function holdsPath(data: unknown, path: FieldPath): boolean {
  let at: unknown = data;
  for (const segment of path) {
    if (typeof at !== "object" || at === null) return false;
    if ("field" in segment) {
      if (!Object.hasOwn(at, segment.field)) return false;
      at = (at as Record<string, unknown>)[segment.field];
      continue;
    }
    if (!Array.isArray(at)) return false;
    const index = rowKeys(at).indexOf(segment.row);
    if (index === -1) return false;
    at = (at as unknown[])[index];
  }
  return true;
}

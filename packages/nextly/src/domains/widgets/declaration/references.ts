/**
 * Whether each declared widget's query, as its starting settings build it,
 * names what the site actually has: a source, a collection or Single, and
 * their fields.
 *
 * Run once boot has synced the site's content, which is when the answer
 * exists. Before then the collection registry is empty and every query would
 * look wrong.
 *
 * 🔴 Startup is refused only over what deployed code fixes: a collection or
 * Single defined in code or config, and its fields. A collection made in the
 * Schema Builder lives in the database, and an editor may rename or delete it
 * from the admin; refusing startup over that would let one edit take the site
 * down at its next restart, naming a plugin the editor never touched. A query
 * over such a collection that no longer fits is logged as a warning, and the
 * card shows its own error when it runs.
 *
 * A query whose starting settings name no collection (the Collection setting
 * is filled when a card is placed) has nothing to check here; it is checked
 * when it runs.
 *
 * @module domains/widgets/declaration/references
 */

import { NextlyError } from "../../../errors/nextly-error";
import { getNextlyLogger } from "../../../observability/logger";
import { refreshContentSources } from "../collection-widgets";
import { validateWidgetQuery, type WidgetQuery } from "../query";
import { getSource } from "../sources";

import { buildCardQuery } from "./card-query";
import { type DeclaredWidget, listDeclaredWidgets } from "./declared-widgets";
import { declaredQueryProblem } from "./displays";
import {
  widgetDeclarationsRefused,
  type WidgetDeclarationFault,
} from "./validate";

/** The collections and Singles the site's deployed code defines. */
export interface CodeDefinedContent {
  readonly collections: ReadonlySet<string>;
  readonly singles: ReadonlySet<string>;
  /**
   * Whether boot found the content registries not yet created: a fresh
   * database, before migrations and `/setup`. Only then is a registry that
   * cannot be read no reason to stop.
   */
  readonly databaseNotSetUp: boolean;
}

const COLLECTION_SOURCE = "collection:";
const SINGLE_SOURCE = "single:";

/**
 * Whether a source's existence and fields are fixed by deployed code: core's
 * and plugins' own sources are, and so is a collection or Single the code
 * defines. Any other collection or Single is the database's.
 */
function fixedByCode(source: string, content: CodeDefinedContent): boolean {
  if (source.startsWith(COLLECTION_SOURCE)) {
    return content.collections.has(source.slice(COLLECTION_SOURCE.length));
  }
  if (source.startsWith(SINGLE_SOURCE)) {
    return content.singles.has(source.slice(SINGLE_SOURCE.length));
  }
  return true;
}

/** Why a query cannot run as written, or `undefined` when it can. */
function queryProblem(query: unknown): string | undefined {
  try {
    validateWidgetQuery(query);
    return undefined;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

/**
 * A declared widget's query as its starting settings build it, or why its
 * query function could not build one.
 *
 * Caught here, per widget, because a query function is the plugin's own code:
 * one that throws, or answers something that is not a query, is a fault in
 * that declaration, reported with every other, not a crash of startup.
 */
function startingQuery({ declaration, collections }: DeclaredWidget): {
  query?: WidgetQuery;
  failure?: string;
} {
  try {
    return { query: buildCardQuery(declaration, undefined, collections) };
  } catch (error) {
    const reason =
      error instanceof NextlyError && error.logMessage !== undefined
        ? error.logMessage
        : error instanceof Error
          ? error.message
          : String(error);
    return { failure: reason };
  }
}

/**
 * What is wrong with one declared widget's starting query, as a fault, or
 * `undefined`. A query over the database's content that cannot run is warned
 * about here instead, and is no fault.
 */
function startingQueryFault(
  declared: DeclaredWidget,
  content: CodeDefinedContent
): string | undefined {
  const { query, failure } = startingQuery(declared);
  if (failure !== undefined) {
    return `its query function, run with its starting settings, failed: ${failure}`;
  }
  if (query === undefined) return undefined;
  // What a core display draws is fixed by the code, whatever the database
  // holds: the types refuse the pairing, and plain JavaScript is refused here.
  const mismatch = declaredQueryProblem(declared.display, query);
  if (mismatch !== undefined) return mismatch;
  return contentFault(declared, query, content);
}

/**
 * Whether a starting query can run against the synced content: a fault when
 * what it names is fixed by the code, a warning when it is the database's.
 *
 * 🔴 A collection or Single the code defines that has no source yet has not
 * reached the database: on a fresh install its table and registry row exist
 * only once setup runs, and boot tolerates that so `/setup` can be served.
 * Refusing here would stop the very start setup needs, so the query waits for
 * a start where the content exists. A misspelt name is not one the code
 * defines, so it is still judged, as the database's.
 */
function contentFault(
  declared: DeclaredWidget,
  query: WidgetQuery,
  content: CodeDefinedContent
): string | undefined {
  const codeDefined = fixedByCode(query.source, content);
  if (
    codeDefined &&
    isContentSource(query.source) &&
    !getSource(query.source)
  ) {
    return undefined;
  }
  const problem = queryProblem(query);
  if (problem === undefined) return undefined;
  if (codeDefined) {
    return `its query, built from its starting settings, cannot run: ${problem}`;
  }
  warnMissingContent(declared, query.source, problem);
  return undefined;
}

/**
 * Startup refused because the content registries could not be read, so no
 * declared widget's starting query could be checked. A failure to read, not a
 * fault in any declaration: the remedy is to start again once the database
 * answers.
 */
const registriesUnreadable = (): NextlyError =>
  NextlyError.serviceUnavailable({
    logMessage:
      "Declared dashboard widgets could not be checked: the collections or " +
      "Singles registry could not be read. Startup stops rather than admit " +
      "widgets it has not checked; start again once the database answers.",
  });

/**
 * Whether the code defines any collection or Single.
 *
 * Only then can a registry that was not read let a widget pass unchecked: the
 * check refuses over code-defined content alone. And only then can boot tell
 * a fresh database apart, since its syncs find the registries missing by
 * writing to them; with nothing to write they report nothing.
 */
const definesContent = (content: CodeDefinedContent): boolean =>
  content.collections.size > 0 || content.singles.size > 0;

/** Whether a source is a collection or a Single, which boot syncs. */
const isContentSource = (source: string): boolean =>
  source.startsWith(COLLECTION_SOURCE) || source.startsWith(SINGLE_SOURCE);

/** The warning for a query over the database's content that cannot run. */
function warnMissingContent(
  { owner, declaration }: DeclaredWidget,
  source: string,
  problem: string
): void {
  getNextlyLogger().warn({
    kind: "widget-query-names-missing-content",
    owner,
    widget: declaration.id,
    source,
    message:
      `${owner}, widget "${declaration.id}": its query, built from its ` +
      `starting settings, cannot run (${problem}). The content it names ` +
      "is the database's, not the code's, so startup goes on; its cards " +
      "will show an error until the content or the widget is changed.",
  });
}

/**
 * Checks every declared widget's starting query against the synced content:
 * refuses startup, with every fault in one message, over what deployed code
 * fixes, and warns about the rest.
 */
export async function checkDeclaredWidgetReferences(
  content: CodeDefinedContent
): Promise<void> {
  const declared = listDeclaredWidgets();
  // Nothing to check, so nothing to read: boot reads the content registries
  // for nothing else, and on a database not yet set up the read fails.
  if (declared.length === 0) return;
  // The sources a query names are derived from the registries, which hold the
  // synced content only now.
  const read = await refreshContentSources();
  // 🔴 A registry that could not be read on a database that is set up leaves
  // the sources as they stood, and every code-defined collection would look
  // as if its table had not been made yet, so each widget over one would pass
  // unchecked. Startup stops instead, and is tried again. On a fresh database
  // the read fails for the reason boot already tolerates, and the content
  // queries wait for a start where the content exists. With no code-defined
  // content there is nothing to pass unchecked, and nothing for boot to have
  // found missing, so it starts.
  if (!read && !content.databaseNotSetUp && definesContent(content)) {
    throw registriesUnreadable();
  }

  const faults: WidgetDeclarationFault[] = declared.flatMap(declared => {
    const problem = startingQueryFault(declared, content);
    return problem === undefined
      ? []
      : [{ owner: declared.owner, widget: declared.declaration.id, problem }];
  });
  if (faults.length > 0) throw widgetDeclarationsRefused(faults);
}

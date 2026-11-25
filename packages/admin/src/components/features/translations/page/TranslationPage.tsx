"use client";

/**
 * One document in one language: every translatable field the reader may read,
 * beside the text it is translated from, with that language's own save.
 *
 * Offered only where there is something to translate: on a site with more than
 * one language, for a document that keeps its text per language, in a language
 * the site has other than its default. Anywhere else the address goes to the
 * document's editor, which is where that text is written.
 *
 * @module components/features/translations/page/TranslationPage
 */

import { useEffect, useMemo, useState, type JSX, type ReactNode } from "react";
import { FormProvider } from "react-hook-form";

import { sourceValueAt } from "@admin/components/features/entries/container-text";
import { entryTitleValue } from "@admin/components/features/entries/entry-title";
import { HISTORY_REASON } from "@admin/components/features/entries/EntryForm/document-actions";
import { DocumentLockBanner } from "@admin/components/features/entries/EntryForm/DocumentLockBanner";
import { UnsavedChangesGuard } from "@admin/components/features/entries/EntryForm/UnsavedChangesGuard";
import { VersionConflictDialog } from "@admin/components/features/entries/EntryForm/VersionConflictDialog";
import { EntryLocaleProvider } from "@admin/components/features/entries/EntryLocaleContext";
import {
  OPEN_GATE,
  type FieldGate,
} from "@admin/components/features/entries/fields/field-admin-gates";
import { isRemovedFromCode } from "@admin/components/features/entries/removed-from-code-notice";
import { RemovedFromCodeNotice } from "@admin/components/features/entries/RemovedFromCodeNotice";
import { storedStampOf } from "@admin/components/features/entries/review/review-words";
import { CONTENT_PAGE_MEASURE } from "@admin/components/layout/content-measure";
import { PageContainer } from "@admin/components/layout/page-container";
import { Breadcrumbs } from "@admin/components/shared";
import {
  Alert,
  AlertDescription,
  Button,
  buttonVariants,
  Skeleton,
} from "@admin/components/ui";
import { Link } from "@admin/components/ui/link";
import { buildRoute, ROUTES } from "@admin/constants/routes";
import { LOCALE_PARAM, SOURCE_PARAM } from "@admin/constants/search-params";
import { useBrandingStatus } from "@admin/context/providers/BrandingProvider";
import { useDocumentTitle } from "@admin/hooks/useDocumentTitle";
import { useLocaleParam } from "@admin/hooks/useLocaleParam";
import { useLocalization } from "@admin/hooks/useLocalization";
import { useSearchParams } from "@admin/hooks/useSearchParams";
import { editsOffered, useUpdateAnswer } from "@admin/hooks/useUpdateAnswer";
import { apiErrorMessage } from "@admin/lib/api/parseApiError";
import { navigateWithinAdmin } from "@admin/lib/navigation";
import {
  sourceFromAddress,
  type TranslatedDocument,
} from "@admin/lib/navigation/translation-address";
import { getSearchParam } from "@admin/lib/search-params";
import type { ReleaseDocumentRef } from "@admin/types/releases";

import {
  TranslationHistoryBody,
  TranslationHistoryControls,
  TranslationHistoryProvider,
} from "../history/TranslationHistory";
import { useTranslationHistory } from "../history/useTranslationHistory";
import { useTranslationReview } from "../workflow/useTranslationReview";

import { languagesGoingLiveToo, languageStanding } from "./language-standing";
import {
  heldValue,
  textLevel,
  textPerLanguage,
  textsIn,
  type NestedText,
  type TextLevel,
} from "./nested-text";
import { NestedTextLevel } from "./NestedTextLevel";
import { emptyFields } from "./reader-preview";
import {
  eligibleSources,
  shownSource,
  type SourceFacts,
} from "./source-eligibility";
import {
  translationFields,
  valuesPerLanguage,
  type TranslationField,
  type TranslationFieldSet,
  type ValuesPerLanguage,
} from "./translation-fields";
import { scopeOf, TranslationActions } from "./TranslationActions";
import { TranslationCards } from "./TranslationCards";
import {
  TranslationFieldRow,
  type TranslationLanguage,
} from "./TranslationFieldRow";
import { PanelRow, statusWords, TranslationPanel } from "./TranslationPanel";
import { TranslationStrip } from "./TranslationStrip";
import { useClaimNotice } from "./useClaimNotice";
import {
  useTranslationDocument,
  type DocumentRow,
  type TranslationDocument,
  type TranslationSchema,
} from "./useTranslationDocument";
import {
  useTranslationForm,
  type TranslationForm as TranslationFormState,
} from "./useTranslationForm";

/** What a reader who may look and not write is told, as the editor tells them. */
const READ_ONLY_FOR_READER =
  "Your access lets you view this, but not change it. If you need to change it, ask an admin.";

/** Why a step waits while the page stores the language. */
const SAVING_REASON = "Saving…";

/** The banner's own choices, which the page's notice offers none of. */
function offersNothing(): void {}

/** The document's editor, in the default language. */
function editorAddress(document: TranslatedDocument): string {
  return document.kind === "collection"
    ? buildRoute(ROUTES.COLLECTION_ENTRY_EDIT, {
        slug: document.slug,
        id: document.id,
      })
    : buildRoute(ROUTES.SINGLE_EDIT, { slug: document.slug });
}

function TranslationOutline(): JSX.Element {
  return (
    <PageContainer width={CONTENT_PAGE_MEASURE}>
      <div
        className="space-y-6"
        role="status"
        aria-label="Loading the translation"
      >
        <Skeleton className="h-8 w-64 max-w-full" />
        {[0, 1, 2].map(row => (
          <div key={row} className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Skeleton className="h-20" />
            <Skeleton className="h-20" />
          </div>
        ))}
      </div>
    </PageContainer>
  );
}

/** Something that keeps the page from being drawn, and the way on. */
function TranslationProblem({
  message,
  children,
}: {
  message: string;
  children: ReactNode;
}): JSX.Element {
  return (
    <PageContainer width={CONTENT_PAGE_MEASURE}>
      <Alert variant="destructive">
        <AlertDescription>{message}</AlertDescription>
      </Alert>
      <div className="mt-6">{children}</div>
    </PageContainer>
  );
}

function OpenInEditor({
  document,
}: {
  document: TranslatedDocument;
}): JSX.Element {
  return (
    <Link
      href={editorAddress(document)}
      className={buttonVariants({ variant: "outline" })}
    >
      Open in editor
    </Link>
  );
}

/** Send a reader to the editor in place of this address. */
function useSentToEditor(document: TranslatedDocument, sent: boolean): void {
  const href = editorAddress(document);
  useEffect(() => {
    if (sent) navigateWithinAdmin(href, { replace: true });
  }, [href, sent]);
}

/** The page at a document's translation address. */
export function TranslationPage({
  document,
}: {
  document: TranslatedDocument;
}): JSX.Element {
  const { isPending, isUnavailable, retry } = useBrandingStatus();
  const { enabled, defaultLocale, getLocale, locales } = useLocalization();
  const params = useSearchParams();
  const code = useLocaleParam(LOCALE_PARAM);
  const target = getLocale(code);
  const offered =
    enabled && target !== undefined && target.code !== defaultLocale;
  // The languages arrive with the admin's startup answer; until then nothing
  // says whether there is a page here.
  const known = !isPending && !isUnavailable;
  useSentToEditor(document, known && !offered);

  if (isUnavailable && !offered) {
    return (
      <TranslationProblem message="The site's languages couldn't be loaded.">
        <Button variant="outline" onClick={retry}>
          Try again
        </Button>
      </TranslationProblem>
    );
  }
  if (!offered || target === undefined) return <TranslationOutline />;
  return (
    <LanguagePage
      // Another document or language is another form.
      key={JSON.stringify([document, target.code])}
      document={document}
      target={target}
      source={sourceFromAddress(
        getSearchParam(params, SOURCE_PARAM),
        target.code,
        { locales, defaultLocale }
      )}
    />
  );
}

interface LanguagePageProps {
  document: TranslatedDocument;
  target: TranslationLanguage;
  /** The source the address asks for, other than the default language. */
  source: string | undefined;
}

/** The page once its languages are known: loading, refused, or the form. */
function LanguagePage({
  document,
  target,
  source,
}: LanguagePageProps): JSX.Element {
  const read = useTranslationDocument(document, target.code);
  const { schema, live, target: written } = read;
  useSentToEditor(document, schema !== undefined && !schema.localized);

  if (read.error !== null) {
    return (
      <TranslationProblem
        message={apiErrorMessage(
          read.error,
          "The translation couldn't be loaded."
        )}
      >
        <OpenInEditor document={document} />
      </TranslationProblem>
    );
  }
  if (
    read.isLoading ||
    schema === undefined ||
    live === undefined ||
    written === undefined
  ) {
    return <TranslationOutline />;
  }
  return (
    <TranslationForm
      document={document}
      target={target}
      source={source}
      schema={schema}
      live={live}
      written={written}
      translations={read.translations}
      reload={read.reload}
    />
  );
}

/**
 * What the document is called: an entry by its title in the default language,
 * the one every reader of the admin shares, and a Single by its own name.
 */
function titleOf(
  document: TranslatedDocument,
  schema: TranslationSchema,
  live: DocumentRow,
  defaultLocale: string
): string {
  if (document.kind === "single") return schema.label;
  const inDefault = Object.fromEntries(
    Object.entries(valuesPerLanguage(live)).map(([name, values]) => [
      name,
      values[defaultLocale],
    ])
  );
  return (
    entryTitleValue({ ...live, ...inDefault }, schema.useAsTitle) ??
    `Entry ${document.id.substring(0, 8)}...`
  );
}

/** The document, as its review is kept for; a Single is named by its slug. */
function reviewedDocument(document: TranslatedDocument): ReleaseDocumentRef {
  return {
    scopeKind: document.kind,
    scopeSlug: document.slug,
    entryId: document.kind === "collection" ? document.id : "",
  };
}

/** The stage the language stands in, and who it waits for, in words. */
function stageWords(
  stage: string | null,
  waitingFor: string | null
): string | undefined {
  if (stage === null || stage.trim() === "") return undefined;
  return waitingFor === null ? stage : `${stage}, waiting for ${waitingFor}`;
}

/** The document's id, as its read answers it. */
function idOf(document: DocumentRow): string {
  return typeof document.id === "string" ? document.id : "";
}

interface TranslationFormProps
  extends LanguagePageProps,
    Pick<TranslationDocument, "translations" | "reload"> {
  schema: TranslationSchema;
  live: DocumentRow;
  written: DocumentRow;
}

/** The sources of each field, and of each text inside a container, by path. */
interface Sources {
  /** Each language's value at a path. */
  valuesAt: (path: string) => Readonly<Record<string, unknown>>;
  eligibleFor: (path: string) => string[];
  sourceOf: (path: string) => string | undefined;
  choose: (path: string, code: string) => void;
}

/**
 * Each field's sources and the one shown, from the languages' standing, the
 * page's source and the translator's own choice for the field. A text inside a
 * container is a field of its own, from the same row of the other language;
 * what is recorded of where it came from is the container's.
 */
function useFieldSources(
  facts: SourceFacts,
  pageSource: string | undefined,
  nested: readonly TranslationField[],
  /** Reads the form's rows, which a text's own row is known by. */
  readRows: () => Readonly<Record<string, unknown>>
): Sources {
  const [chosen, setChosen] = useState<Readonly<Record<string, string>>>({});
  const containerAt = (path: string) =>
    nested.find(({ name }) => path.startsWith(`${name}.`));
  const valuesAt: Sources["valuesAt"] = path => {
    const container = containerAt(path);
    return container === undefined
      ? (facts.values[path] ?? {})
      : textPerLanguage(
          container,
          path,
          facts.values[container.name] ?? {},
          readRows()
        );
  };
  const eligibleFor: Sources["eligibleFor"] = path => {
    const container = containerAt(path);
    return container === undefined
      ? eligibleSources(path, facts)
      : eligibleSources(container.name, {
          ...facts,
          values: { [container.name]: valuesAt(path) },
        });
  };
  return {
    valuesAt,
    eligibleFor,
    sourceOf: path =>
      shownSource(
        eligibleFor(path),
        chosen[path] ?? pageSource,
        facts.defaultLocale
      ),
    choose: (path, code) => setChosen(was => ({ ...was, [path]: code })),
  };
}

/** The containers that hold something, with the text inside each. */
function textLevels(
  nested: readonly TranslationField[],
  written: DocumentRow,
  form: TranslationFormState["form"]
): ReadonlyMap<string, TextLevel> {
  // The rows as the form has them, which only a read of the document changes.
  const shown = form.getValues();
  return new Map(
    nested.flatMap(container => {
      // Nothing in every language: an empty group is drawn for nothing.
      if (heldValue(container.field, written[container.name]) === null) {
        return [];
      }
      const level = textLevel(container, shown[container.name]);
      return level === undefined ? [] : [[container.name, level] as const];
    })
  );
}

/** What publishing says of the fields, and the texts inside, left empty. */
function emptyOnPublish(args: {
  set: TranslationFieldSet;
  levels: ReadonlyMap<string, TextLevel>;
  shown: Readonly<Record<string, unknown>>;
  written: DocumentRow;
  valuesAt: Sources["valuesAt"];
  values: ValuesPerLanguage;
  rest: Pick<
    Parameters<typeof emptyFields>[0],
    "translations" | "target" | "rules"
  >;
}): ReturnType<typeof emptyFields> {
  const { set, levels, shown, written, valuesAt, values, rest } = args;
  const rows: TranslationField[] = [];
  const inside: Record<string, unknown> = {};
  const stored: Record<string, unknown> = { ...written };
  const perLanguage: Record<string, Readonly<Record<string, unknown>>> = {
    ...values,
  };
  for (const row of set.written) {
    const level = levels.get(row.name);
    if (!set.nested.includes(row)) rows.push(row);
    const held = { [row.name]: heldValue(row.field, written[row.name]) };
    for (const text of textsIn(level)) {
      rows.push({
        // Only a field of its own is never filled from another language.
        field: { ...text.field, unique: false },
        name: text.path,
        label: text.label,
      });
      inside[text.path] = sourceValueAt(shown, shown, text.path);
      stored[text.path] = sourceValueAt(held, shown, text.path);
      perLanguage[text.path] = valuesAt(text.path);
    }
  }
  return emptyFields({
    rows,
    shown: { ...shown, ...inside },
    stored,
    values: perLanguage,
    ...rest,
  });
}

/** The document's own id: a Single's address doesn't carry it, its document does. */
function documentIdOf(document: TranslatedDocument, live: DocumentRow): string {
  return document.kind === "collection" ? document.id : idOf(live);
}

/** What the languages' standing is judged by, for the sources of every field. */
function sourceFacts(
  { schema, live, target, translations }: TranslationFormProps,
  site: Pick<ReturnType<typeof useLocalization>, "locales" | "defaultLocale">
): SourceFacts {
  return {
    locales: site.locales,
    defaultLocale: site.defaultLocale,
    target: target.code,
    values: valuesPerLanguage(live),
    translations,
    hasStatus: schema.hasStatus,
    status: typeof live.status === "string" ? live.status : undefined,
  };
}

/** Whether anything has a source: with none, there is nothing to set beside. */
function hasAnySource(
  set: TranslationFieldSet,
  levels: ReadonlyMap<string, TextLevel>,
  sourceOf: Sources["sourceOf"]
): boolean {
  const paths = [
    ...set.rows.map(row => row.name),
    ...[...levels.values()].flatMap(textsIn).map(text => text.path),
  ];
  return paths.some(path => sourceOf(path) !== undefined);
}

/** What of the document may be written here, and by whom. */
function useWriteRights({ document, schema }: TranslationFormProps): {
  removed: boolean;
  offersEdits: boolean;
  readOnly: boolean;
} {
  const removed = isRemovedFromCode(schema.removed);
  const offersEdits = editsOffered(useUpdateAnswer(document.slug));
  return { removed, offersEdits, readOnly: removed || !offersEdits };
}

/** The language's history: what is on screen, and what a restore may put back. */
function usePageHistory(
  { document, target, schema }: TranslationFormProps,
  documentId: string,
  set: TranslationFieldSet,
  editing: TranslationFormState,
  writesHeld: boolean
) {
  const scope = useMemo(
    () => scopeOf(document, documentId),
    [document, documentId]
  );
  return useTranslationHistory({
    scope,
    target,
    form: editing.form,
    restore: editing.restore,
    fields: editing.fields,
    rows: set.rows,
    readOnly: writesHeld,
    historyEnabled: schema.historyEnabled,
  });
}

/** Where the language stands in the workflow, and its stage in words. */
function usePageReview(
  { document, target, schema, written }: TranslationFormProps,
  { isDirty, isSaving }: TranslationFormState,
  readingHistory: boolean
) {
  const reviewed = useMemo(
    () => (schema.hasStatus ? reviewedDocument(document) : undefined),
    [schema.hasStatus, document]
  );
  const saving = isSaving ? SAVING_REASON : undefined;
  const review = useTranslationReview({
    document: reviewed,
    language: target.code,
    isDirty,
    storedStamp: storedStampOf(written),
    held: readingHistory ? HISTORY_REASON : saving,
    ...(schema.workflowExpected === undefined
      ? {}
      : { workflowExpected: schema.workflowExpected }),
  });
  const { part, binding } = review;
  const stage =
    part &&
    stageWords(
      part.stageLabel ?? part.stage,
      binding?.state.waitingFor ?? null
    );
  return { review, stage };
}

/** Everything the page draws of one document in one language. */
function useTranslationView(props: TranslationFormProps) {
  const { document, target, source, schema, live, written, translations } =
    props;
  const site = useLocalization();
  // Held by the form's validation, so not made anew at each render.
  const { fields } = schema;
  const set = useMemo(() => translationFields(fields, live), [fields, live]);
  const rights = useWriteRights(props);
  const editing = useTranslationForm({
    document,
    target,
    fields,
    rows: set.rows,
    nested: set.nested,
    written,
    // Asked as a save is made, when what reads the form's rows is there too.
    sourceOf: path => sources.sourceOf(path),
    reload: props.reload,
  });
  const { form } = editing;
  const sources = useFieldSources(
    sourceFacts(props, site),
    source,
    set.nested,
    form.getValues
  );
  const levels = textLevels(set.nested, written, form);
  const languageOf = (code: string): TranslationLanguage =>
    site.getLocale(code) ?? { code, label: code, rtl: false };
  const recorded = translations?.[target.code]?.fields;
  const isOutOfDate = (name: string) => recorded?.[name]?.outOfDate === true;
  const documentId = documentIdOf(document, live);
  // Nothing may be put into the page, or moved on it, while this stands.
  const writesHeld = rights.readOnly || editing.isSaving;
  const history = usePageHistory(props, documentId, set, editing, writesHeld);
  const readingHistory = history.host.viewingVersion !== null;
  return {
    ...rights,
    ...usePageReview(props, editing, readingHistory),
    writesHeld,
    history,
    readingHistory,
    site,
    set,
    title: titleOf(document, schema, live, site.defaultLocale),
    editing,
    sources,
    levels,
    languageOf,
    labelOf: (code: string) => languageOf(code).label,
    isOutOfDate,
    behind: set.written.filter(({ name }) => isOutOfDate(name)).length,
    standing: languageStanding(
      translations,
      target.code,
      schema.hasStatus ? live.status : undefined
    ),
    pageSource: source ?? site.defaultLocale,
    paired: hasAnySource(set, levels, sources.sourceOf),
    documentId,
  };
}

/** A page's parts read it all from here. */
interface PartProps {
  props: TranslationFormProps;
  view: ReturnType<typeof useTranslationView>;
}

/** One field's row, or one text's inside a container, by its path. */
function RowAt({
  props,
  view,
  translated,
  outOfDate = false,
  ...inside
}: PartProps & {
  translated: TranslationField;
  outOfDate?: boolean;
  basePath?: string;
  inherited?: FieldGate;
}): JSX.Element {
  const { sources, languageOf, labelOf, readOnly } = view;
  const path = translated.name;
  const from = sources.sourceOf(path);
  return (
    <TranslationFieldRow
      translated={translated}
      target={props.target}
      source={
        from === undefined
          ? undefined
          : {
              language: languageOf(from),
              value: sources.valuesAt(path)[from],
              eligible: sources.eligibleFor(path),
            }
      }
      labelOf={labelOf}
      onSourceChange={code => sources.choose(path, code)}
      outOfDate={outOfDate}
      readOnly={readOnly}
      {...inside}
    />
  );
}

/** One field, or one container with the texts inside it. */
function FieldAt({
  row,
  ...part
}: PartProps & { row: TranslationField }): JSX.Element | null {
  const { levels, set, isOutOfDate } = part.view;
  const outOfDate = isOutOfDate(row.name);
  const level = levels.get(row.name);
  if (level !== undefined) {
    return (
      <NestedTextLevel
        level={level}
        inherited={OPEN_GATE}
        outOfDate={outOfDate}
        drawText={(text: NestedText, gate: FieldGate) => (
          <RowAt
            key={text.path}
            {...part}
            translated={{
              field: text.field,
              name: text.path,
              label: text.label,
            }}
            basePath={text.basePath}
            inherited={gate}
          />
        )}
      />
    );
  }
  // A container that holds nothing to write.
  if (set.nested.includes(row)) return null;
  return <RowAt {...part} translated={row} outOfDate={outOfDate} />;
}

/** The fields in their two cards. */
function Fields({ props, view }: PartProps): JSX.Element {
  const { set, levels, paired, pageSource, labelOf } = view;
  if (set.rows.length === 0 && levels.size === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        There is no text here to translate.
      </p>
    );
  }
  return (
    <TranslationCards
      paired={paired}
      source={pageSource}
      sourceLabel={labelOf(pageSource)}
      targetLabel={props.target.label}
    >
      {set.written.map(row => (
        <FieldAt key={row.name} props={props} view={view} row={row} />
      ))}
    </TranslationCards>
  );
}

/** The form the fields are in. */
function FormBody({ props, view }: PartProps): JSX.Element {
  const { target } = props;
  const { form, isSaving, save } = view.editing;
  return (
    <TranslationHistoryBody
      history={view.history}
      actionsDisabled={view.writesHeld}
    >
      <FormProvider {...form}>
        <form
          aria-label={`${view.title}, ${target.label} translation`}
          onSubmit={event => {
            event.preventDefault();
            if (!view.readOnly && !isSaving) void save();
          }}
        >
          <Fields props={props} view={view} />
        </form>
      </FormProvider>
    </TranslationHistoryBody>
  );
}

/** Why the page can't be written in, and who else has the document. */
function Notices({ props, view }: PartProps): JSX.Element {
  const { document, schema } = props;
  const { removed, offersEdits, documentId } = view;
  const claimNotice = useClaimNotice(document, documentId);
  return (
    <>
      {removed ? (
        <div className="mb-6">
          <RemovedFromCodeNotice
            entity={{
              kind: document.kind,
              label: schema.label,
              slug: document.slug,
            }}
            state={schema.removed.removedFromCodeState}
          />
        </div>
      ) : null}
      {!removed && !offersEdits ? (
        <Alert className="mb-6">
          <AlertDescription>{READ_ONLY_FOR_READER}</AlertDescription>
        </Alert>
      ) : null}
      <DocumentLockBanner
        notice={claimNotice}
        onTakeOver={offersNothing}
        onRequestAccess={offersNothing}
        className="mb-6"
      />
    </>
  );
}

/** What is translated and what can be done with it. */
function Head({ props, view }: PartProps): JSX.Element {
  const { document, target, schema, live, written, translations } = props;
  const { title, paired, pageSource, labelOf, site, editing } = view;
  return (
    <>
      <Breadcrumbs
        items={[
          { label: "Dashboard", href: ROUTES.DASHBOARD, isDashboard: true },
          { label: "Translations", href: ROUTES.TRANSLATIONS },
          {
            label: target.label,
            href: `${ROUTES.TRANSLATIONS}?${LOCALE_PARAM}=${encodeURIComponent(target.code)}`,
          },
          { label: title },
        ]}
      />
      {/* The trail shows it; a heading says it. */}
      <h1 className="sr-only">{title}</h1>
      <TranslationStrip
        sourceLabel={paired ? labelOf(pageSource) : undefined}
        targetLabel={target.label}
        outOfDate={view.behind}
      />
      <TranslationActions
        document={document}
        documentId={view.documentId}
        language={target}
        defaultLocale={site.defaultLocale}
        labelOf={labelOf}
        rules={schema}
        standing={view.standing}
        goingLiveToo={languagesGoingLiveToo({
          translations,
          codes: site.locales.map(locale => locale.code),
          target: target.code,
          documentStatus: live.status,
        })}
        readOnly={view.readOnly}
        removed={view.removed}
        editing={editing}
        emptyFields={() =>
          emptyOnPublish({
            set: view.set,
            levels: view.levels,
            shown: editing.form.getValues(),
            written,
            valuesAt: view.sources.valuesAt,
            values: valuesPerLanguage(live),
            rest: { translations, target: target.code, rules: site },
          })
        }
        reload={props.reload}
        editorHref={editorAddress(document)}
        review={view.review}
        readingHistory={view.readingHistory}
        around={actions => (
          <TranslationHistoryControls
            history={view.history}
            actionsDisabled={view.writesHeld}
          >
            {actions}
          </TranslationHistoryControls>
        )}
      />
    </>
  );
}

/**
 * What the page is drawn within: the language being written, and its history.
 * Around the header too, where a version's own actions read both.
 */
function PageFrame({
  props,
  view,
  children,
}: PartProps & { children: ReactNode }): JSX.Element {
  const { target, schema } = props;
  return (
    <EntryLocaleProvider
      // The value's direction is set on its control, so the field around it
      // keeps the page's own.
      value={{
        locale: target.code,
        rtl: false,
        collectionLocalized: true,
        isNonDefaultLocale: true,
      }}
    >
      <TranslationHistoryProvider
        history={view.history}
        language={target.code}
        canRestore={!view.readOnly}
        writesRefused={view.removed}
        isSaving={view.editing.isSaving}
        lifecycle={schema.hasStatus}
        {...(schema.retention === undefined
          ? {}
          : { retention: schema.retention })}
      >
        {children}
      </TranslationHistoryProvider>
    </EntryLocaleProvider>
  );
}

function TranslationForm(props: TranslationFormProps): JSX.Element {
  const { document, target, schema, translations } = props;
  const view = useTranslationView(props);
  const { editing, standing, behind, set } = view;
  useDocumentTitle(view.title);
  return (
    <PageFrame props={props} view={view}>
      <UnsavedChangesGuard
        isDirty={editing.isDirty}
        busy={editing.isSaving}
        language={target.label}
      >
        <PageContainer width={CONTENT_PAGE_MEASURE}>
          <Head props={props} view={view} />
          <Notices props={props} view={view} />
          <div className="@container/translation">
            <div className="flex flex-col gap-6 @5xl/translation:flex-row">
              <div className="min-w-0 flex-1">
                <FormBody props={props} view={view} />
              </div>
              <TranslationPanel
                title={target.label}
                status={
                  schema.hasStatus
                    ? statusWords(standing, translations?.[target.code], behind)
                    : undefined
                }
                editorHref={editorAddress(document)}
                shared={set.shared}
                elsewhere={set.elsewhere}
              >
                {view.stage === undefined ? null : (
                  <PanelRow name="Stage">{view.stage}</PanelRow>
                )}
              </TranslationPanel>
            </div>
          </div>
          <VersionConflictDialog
            conflict={editing.conflict}
            keepsRecoveryPoints={false}
            compareHref={null}
            onLoadCurrent={editing.loadCurrent}
            onSaveAnyway={editing.saveAnyway}
          />
        </PageContainer>
      </UnsavedChangesGuard>
    </PageFrame>
  );
}

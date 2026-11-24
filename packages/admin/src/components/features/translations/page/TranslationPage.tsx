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

import { PageHeader } from "@nextlyhq/ui";
import {
  useEffect,
  useId,
  useMemo,
  useState,
  type JSX,
  type ReactNode,
} from "react";
import { FormProvider } from "react-hook-form";

import { entryTitleValue } from "@admin/components/features/entries/entry-title";
import { DocumentLockBanner } from "@admin/components/features/entries/EntryForm/DocumentLockBanner";
import { UnsavedChangesGuard } from "@admin/components/features/entries/EntryForm/UnsavedChangesGuard";
import { VersionConflictDialog } from "@admin/components/features/entries/EntryForm/VersionConflictDialog";
import { EntryLocaleProvider } from "@admin/components/features/entries/EntryLocaleContext";
import { isRemovedFromCode } from "@admin/components/features/entries/removed-from-code-notice";
import { RemovedFromCodeNotice } from "@admin/components/features/entries/RemovedFromCodeNotice";
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

import { languagesGoingLiveToo, languageStanding } from "./language-standing";
import { emptyFields } from "./reader-preview";
import {
  eligibleSources,
  shownSource,
  type SourceFacts,
} from "./source-eligibility";
import {
  translationFields,
  valuesPerLanguage,
  type TranslationFieldSet,
} from "./translation-fields";
import { TranslationActions } from "./TranslationActions";
import {
  TranslationFieldRow,
  type TranslationLanguage,
} from "./TranslationFieldRow";
import { useClaimNotice } from "./useClaimNotice";
import {
  useTranslationDocument,
  type DocumentRow,
  type TranslationDocument,
  type TranslationSchema,
} from "./useTranslationDocument";
import { useTranslationForm } from "./useTranslationForm";

/** What a reader who may look and not write is told, as the editor tells them. */
const READ_ONLY_FOR_READER =
  "Your access lets you view this, but not change it. If you need to change it, ask an admin.";

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

/**
 * Each field's sources and the one shown, from the languages' standing, the
 * page's source and the translator's own choice for the field.
 */
function useFieldSources(
  facts: SourceFacts,
  pageSource: string | undefined
): {
  eligibleFor: (name: string) => string[];
  sourceOf: (name: string) => string | undefined;
  choose: (name: string, code: string) => void;
} {
  const [chosen, setChosen] = useState<Readonly<Record<string, string>>>({});
  const eligibleFor = (name: string) => eligibleSources(name, facts);
  return {
    eligibleFor,
    sourceOf: name =>
      shownSource(
        eligibleFor(name),
        chosen[name] ?? pageSource,
        facts.defaultLocale
      ),
    choose: (name, code) => setChosen(was => ({ ...was, [name]: code })),
  };
}

function TranslationForm({
  document,
  target,
  source,
  schema,
  live,
  written,
  translations,
  reload,
}: TranslationFormProps): JSX.Element {
  const { defaultLocale, fallback, getLocale, locales } = useLocalization();
  // Held by the form's validation, so not made anew at each render.
  const { fields } = schema;
  const set = useMemo(() => translationFields(fields, live), [fields, live]);
  const title = titleOf(document, schema, live, defaultLocale);
  useDocumentTitle(title);

  const removed = isRemovedFromCode(schema.removed);
  const offersEdits = editsOffered(useUpdateAnswer(document.slug));
  const readOnly = removed || !offersEdits;

  const values = valuesPerLanguage(live);
  const { eligibleFor, sourceOf, choose } = useFieldSources(
    {
      locales,
      defaultLocale,
      target: target.code,
      values,
      translations,
      hasStatus: schema.hasStatus,
      status: typeof live.status === "string" ? live.status : undefined,
    },
    source
  );
  const editing = useTranslationForm({
    document,
    target,
    fields,
    rows: set.rows,
    written,
    sourceOf,
    reload,
  });
  const { form, isDirty, isSaving, save, conflict, loadCurrent, saveAnyway } =
    editing;
  // A Single's address doesn't carry its id; its document does.
  const documentId = document.kind === "collection" ? document.id : idOf(live);
  const claimNotice = useClaimNotice(document, documentId);

  const languageOf = (code: string): TranslationLanguage =>
    getLocale(code) ?? { code, label: code, rtl: false };
  const labelOf = (code: string) => languageOf(code).label;
  const recorded = translations?.[target.code]?.fields;

  return (
    <UnsavedChangesGuard
      isDirty={isDirty}
      busy={isSaving}
      language={target.label}
    >
      <PageContainer width={CONTENT_PAGE_MEASURE}>
        <PageHeader
          title={title}
          description={`${target.label} translation`}
          breadcrumbs={
            <Breadcrumbs
              items={[
                {
                  label: "Dashboard",
                  href: ROUTES.DASHBOARD,
                  isDashboard: true,
                },
                { label: "Translations", href: ROUTES.TRANSLATIONS },
                { label: `${title}, ${target.label}` },
              ]}
            />
          }
          actions={
            <div className="flex flex-wrap items-start gap-2">
              <OpenInEditor document={document} />
              <TranslationActions
                document={document}
                documentId={documentId}
                language={target}
                defaultLocale={defaultLocale}
                labelOf={labelOf}
                rules={schema}
                standing={languageStanding(
                  translations,
                  target.code,
                  schema.hasStatus ? live.status : undefined
                )}
                goingLiveToo={languagesGoingLiveToo({
                  translations,
                  codes: locales.map(locale => locale.code),
                  target: target.code,
                  documentStatus: live.status,
                })}
                readOnly={readOnly}
                removed={removed}
                editing={editing}
                emptyFields={() =>
                  emptyFields({
                    rows: set.rows,
                    nested: set.nested,
                    shown: form.getValues(),
                    stored: written,
                    values,
                    translations,
                    target: target.code,
                    rules: { locales, defaultLocale, fallback },
                  })
                }
                reload={reload}
              />
            </div>
          }
        />
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
          <FormProvider {...form}>
            <form
              aria-label={`${title}, ${target.label} translation`}
              onSubmit={event => {
                event.preventDefault();
                if (!readOnly && !isSaving) void save();
              }}
            >
              {set.rows.length === 0 && set.nested.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  There is no text here to translate.
                </p>
              ) : (
                set.rows.map(row => {
                  const from = sourceOf(row.name);
                  return (
                    <TranslationFieldRow
                      key={row.name}
                      translated={row}
                      target={target}
                      source={
                        from === undefined
                          ? undefined
                          : {
                              language: languageOf(from),
                              value: values[row.name]?.[from],
                              eligible: eligibleFor(row.name),
                            }
                      }
                      labelOf={labelOf}
                      onSourceChange={code => choose(row.name, code)}
                      outOfDate={recorded?.[row.name]?.outOfDate === true}
                      readOnly={readOnly}
                    />
                  );
                })
              )}
            </form>
          </FormProvider>
        </EntryLocaleProvider>
        <SharedFields document={document} shared={set.shared} />
        <VersionConflictDialog
          conflict={conflict}
          keepsRecoveryPoints={false}
          compareHref={null}
          onLoadCurrent={loadCurrent}
          onSaveAnyway={saveAnyway}
        />
      </PageContainer>
    </UnsavedChangesGuard>
  );
}

/** The fields every language shares, named so nobody looks for them above. */
function SharedFields({
  document,
  shared,
}: {
  document: TranslatedDocument;
  shared: TranslationFieldSet["shared"];
}): JSX.Element | null {
  const headingId = useId();
  if (shared.length === 0) return null;
  return (
    <section aria-labelledby={headingId} className="mt-8">
      <h2 id={headingId} className="text-sm font-semibold">
        Shared fields
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        These are the same in every language. Change them in{" "}
        <Link
          href={editorAddress(document)}
          className="underline underline-offset-4"
        >
          the editor
        </Link>
        .
      </p>
      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm">
        {shared.map(field => (
          <li key={field.name}>{field.label}</li>
        ))}
      </ul>
    </section>
  );
}

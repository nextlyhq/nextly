/**
 * The SEO tab on an entry's or a Single's edit page, while creating one too.
 *
 * It edits the document's `seo` group through the document's own form, so
 * Save and Publish store what it sets with everything else: as a draft where
 * the type has drafts, live once published. It reads the page's other levels
 * from the plugin's route as the author types, works out the answer with the
 * order the page's head uses, and shows the page's problems as the count
 * beside its label.
 *
 * @module admin/SeoTab
 */
import {
  MediaPickerDialog,
  navigateTo,
  useDocumentField,
  type DocumentTabProps,
} from "@nextlyhq/plugin-sdk/admin";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useFormState, useWatch } from "react-hook-form";

import { receivedHrefFor } from "../received/contract";
import type { SeoTabContext } from "../tab/contract";
import { problemsBadge, seoProblems, type SeoProblem } from "../tab/problems";
import { SEO_GROUP } from "../tab/typed";

import { SeoPanel } from "./SeoPanel";
import { useShareImages } from "./share-images";
import { publishSeoStatus, statusKeyOf } from "./status";
import { useTabDocument } from "./tab-document";
import { useSeoTabContext } from "./use-seo-tab-context";
import {
  panelAnswers,
  type PanelAnswers,
  type SeoPanelField,
  type SeoPanelValues,
} from "./values";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Opens the page's own content, where a field the page lacks is filled in. */
function goToContent(): void {
  const url = new URL(window.location.href);
  url.searchParams.delete("tab");
  navigateTo(`${url.pathname}${url.search}${url.hash}`);
}

/**
 * The page's problems, shown as the count beside the tab's label, kept while
 * another tab is open; none is shown until the page's levels have been read.
 */
function useProblemsBadge(
  answers: PanelAnswers | undefined,
  levels: SeoTabContext | undefined,
  setBadge: DocumentTabProps["setBadge"]
): SeoProblem[] {
  const problems = useMemo(
    () =>
      answers === undefined
        ? []
        : seoProblems(answers.answer, {
            structuredData: levels?.structuredData,
            shareImage: levels?.shareImage,
          }),
    [answers, levels]
  );
  const badge = useMemo(() => problemsBadge(problems), [problems]);
  useEffect(() => {
    if (answers !== undefined) setBadge(badge);
  }, [answers, badge, setBadge]);
  return problems;
}

/**
 * Tells the side panel's SEO line what the tab found, and takes it back as
 * the tab goes, so the line never shows another page's answer.
 */
function useStatusLine(
  context: DocumentTabProps["context"],
  answers: PanelAnswers | undefined,
  count: number,
  typeLabel: string | undefined
): void {
  const key = statusKeyOf(context);
  const from = answers?.answer.robots.from;
  useEffect(() => {
    if (from === undefined || typeLabel === undefined) return undefined;
    publishSeoStatus(key, {
      listing: from === "type" ? "type" : from === "page" ? "page" : "listed",
      count,
      typeLabel,
    });
    return () => publishSeoStatus(key, null);
  }, [key, from, count, typeLabel]);
}

/** Each of the panel's values, writable as the person typing it would. */
function useSeoFields(): Record<
  SeoPanelField,
  ReturnType<typeof useDocumentField>
> {
  return {
    metaTitle: useDocumentField(`${SEO_GROUP}.metaTitle`),
    metaDescription: useDocumentField(`${SEO_GROUP}.metaDescription`),
    socialTitle: useDocumentField(`${SEO_GROUP}.socialTitle`),
    socialDescription: useDocumentField(`${SEO_GROUP}.socialDescription`),
    ogImage: useDocumentField(`${SEO_GROUP}.ogImage`),
    canonical: useDocumentField(`${SEO_GROUP}.canonical`),
    canonicalElsewhere: useDocumentField(`${SEO_GROUP}.canonicalElsewhere`),
    noindex: useDocumentField(`${SEO_GROUP}.noindex`),
    structuredDataType: useDocumentField(`${SEO_GROUP}.structuredDataType`),
  };
}

/** Why each of the panel's values was refused at the last save. */
function useSeoErrors(
  control: DocumentTabProps["control"]
): Partial<Record<SeoPanelField, string>> {
  const { errors } = useFormState({ control, name: SEO_GROUP });
  const group: unknown = errors[SEO_GROUP];
  if (!isRecord(group)) return {};
  const refused: Partial<Record<SeoPanelField, string>> = {};
  for (const [name, error] of Object.entries(group)) {
    if (isRecord(error) && typeof error.message === "string") {
      refused[name as SeoPanelField] = error.message;
    }
  }
  return refused;
}

/**
 * Where the page's check of what search engines received is: a saved page
 * with an address of its own can be checked, at the address its language
 * serves it at; one being created has nothing served yet.
 */
export function receivedHrefOf(
  id: string | null,
  levels: SeoTabContext | undefined
): string | undefined {
  const served = levels?.served;
  if (id === null || served === undefined || levels === undefined) {
    return undefined;
  }
  return receivedHrefFor(new URL(served, levels.site.origin).href);
}

/** The media library, opened to choose the page's share image. */
function ShareImagePicker({
  open,
  imageId,
  onOpenChange,
  onChoose,
}: {
  open: boolean;
  imageId: string | undefined;
  onOpenChange: (open: boolean) => void;
  onChoose: (id: string) => void;
}): ReactNode {
  return (
    <MediaPickerDialog
      mode="single"
      accept="image/*"
      open={open}
      onOpenChange={onOpenChange}
      {...(imageId === undefined
        ? {}
        : { initialSelectedIds: new Set([imageId]) })}
      onSelect={chosen => {
        const first = chosen[0];
        if (first !== undefined) onChoose(first.id);
        onOpenChange(false);
      }}
    />
  );
}

export function SeoTab({
  context,
  control,
  documentLock,
  entry,
  setBadge,
}: DocumentTabProps): ReactNode {
  // The whole document as typed: any of its fields can feed an automatic
  // value (a title, an excerpt, a pattern's field, its address).
  const document = useWatch({ control }) as Record<string, unknown>;
  const fields = useSeoFields();
  const errors = useSeoErrors(control);
  const { target, documentKey } = useTabDocument(context, entry);
  const { context: levels, status } = useSeoTabContext(target, document);
  const [choosing, setChoosing] = useState(false);

  const values: SeoPanelValues = useMemo(() => {
    const seo = document[SEO_GROUP];
    return isRecord(seo) ? seo : {};
  }, [document]);
  const images = useShareImages(
    document,
    values,
    levels,
    documentKey,
    fields.ogImage?.set
  );
  const { imageId, chosenImage } = images;
  const answers = useMemo(
    () => panelAnswers(levels, values, chosenImage),
    [levels, values, chosenImage]
  );
  const problems = useProblemsBadge(answers, levels, setBadge);
  useStatusLine(context, answers, problems.length, levels?.typeLabel);

  if (target === null) return null;
  // Read-only while the document is held, and for someone who may not
  // change this page's SEO, whose save would keep the stored SEO.
  const writable =
    !documentLock.readOnly &&
    fields.metaTitle?.writable !== false &&
    levels?.mayChange !== false;
  return (
    <>
      <SeoPanel
        context={levels}
        status={status}
        answers={answers}
        problems={problems}
        values={values}
        chosenImage={chosenImage}
        writable={writable}
        errors={errors}
        onSet={(field, next) => {
          fields[field]?.set(next);
        }}
        documentKey={documentKey}
        onChooseImage={() => setChoosing(true)}
        shownImageFile={images.contentImage}
        onMakeShareImage={images.make}
        onGoToField={goToContent}
        receivedHref={receivedHrefOf(target.id, levels)}
      />
      <ShareImagePicker
        open={choosing}
        imageId={imageId}
        onOpenChange={setChoosing}
        onChoose={id => fields.ogImage?.set(id)}
      />
    </>
  );
}

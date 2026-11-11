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
  writePluginRoute,
  useDocumentField,
  useDocumentLocale,
  useMediaItem,
  type DocumentTabProps,
} from "@nextlyhq/plugin-sdk/admin";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useFormState, useWatch } from "react-hook-form";

import { SHARE_IMAGE_ROUTE_PATH } from "../social/contract";
import { SEO_PLUGIN_NAME, type SeoTabContext } from "../tab/contract";
import { problemsBadge, seoProblems, type SeoProblem } from "../tab/problems";
import { SEO_GROUP } from "../tab/typed";

import { SeoPanel } from "./SeoPanel";
import { publishSeoStatus, statusKeyOf } from "./status";
import { useSeoTabContext, type SeoTabDocument } from "./use-seo-tab-context";
import {
  panelAnswers,
  type ChosenImage,
  type PanelAnswers,
  type SeoPanelField,
  type SeoPanelValues,
} from "./values";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Which document the tab is on, from its place's context. */
function documentOf(
  context: DocumentTabProps["context"],
  locale: string | null
): SeoTabDocument | null {
  if ("single" in context) {
    return { kind: "single", slug: context.single, locale, id: null };
  }
  if ("collection" in context) {
    return {
      kind: "collection",
      slug: context.collection,
      locale,
      id: context.entryId,
    };
  }
  return null;
}

/** Which document and language the tab shows, as one key. */
function documentKeyOf(
  target: SeoTabDocument,
  context: DocumentTabProps["context"]
): string {
  const entryId = "entryId" in context ? context.entryId : null;
  return [target.kind, target.slug, entryId, target.locale].join(":");
}

/** The id a stored share image names: an id, or a read media document's. */
function imageIdOf(value: unknown): string | undefined {
  if (typeof value === "string" && value !== "") return value;
  if (isRecord(value) && typeof value.id === "string") return value.id;
  return undefined;
}

/** A media document as the panel shows a chosen share image. */
function chosenImageOf(
  media: ReturnType<typeof useMediaItem>["data"]
): ChosenImage | undefined {
  if (media === undefined) return undefined;
  return {
    url: media.url,
    filename: media.originalFilename || media.filename,
    ...(typeof media.width === "number" ? { width: media.width } : {}),
    ...(typeof media.height === "number" ? { height: media.height } : {}),
    ...(media.altText ? { alt: media.altText } : {}),
    bytes: media.size,
    mimeType: media.mimeType,
  };
}

/**
 * The share image made from the page's picture, set as the page's own:
 * answers whether it was, false where the person may not add to the media
 * library or the copy could not be made.
 */
async function madeShareImage(
  mediaId: string,
  set: ((next: unknown) => boolean) | undefined
): Promise<boolean> {
  try {
    const made = await writePluginRoute<{ item?: { id?: unknown } }>({
      plugin: SEO_PLUGIN_NAME,
      path: SHARE_IMAGE_ROUTE_PATH,
      body: { media: mediaId },
    });
    const id = made?.item?.id;
    return typeof id === "string" && set?.(id) === true;
  } catch {
    return false;
  }
}

/**
 * The page's share images: the one chosen for it, the page's own picture the
 * automatic one is, and the action that makes a copy of the right size from
 * whichever is shown, where there is one to make it from.
 */
function useShareImages(
  document: Readonly<Record<string, unknown>>,
  values: SeoPanelValues,
  levels: SeoTabContext | undefined,
  set: ((next: unknown) => boolean) | undefined
): {
  imageId: string | undefined;
  chosenImage: ChosenImage | undefined;
  contentImage: ChosenImage | undefined;
  make: (() => Promise<boolean>) | undefined;
} {
  const imageId = imageIdOf(values.ogImage);
  const chosenImage = useChosenImage(imageId);
  const contentField = levels?.levels.content.image?.field;
  const contentImageId =
    contentField === undefined ? undefined : imageIdOf(document[contentField]);
  const contentImage = useChosenImage(contentImageId);
  const source = imageId ?? contentImageId;
  return {
    imageId,
    chosenImage,
    contentImage,
    make: source === undefined ? undefined : () => madeShareImage(source, set),
  };
}

/** Opens the page's own content, where a field the page lacks is filled in. */
function goToContent(): void {
  const url = new URL(window.location.href);
  url.searchParams.delete("tab");
  navigateTo(`${url.pathname}${url.search}${url.hash}`);
}

/** The chosen share image, read from the media library by its id. */
function useChosenImage(imageId: string | undefined): ChosenImage | undefined {
  const media = useMediaItem(imageId);
  return useMemo(
    () => (imageId === undefined ? undefined : chosenImageOf(media.data)),
    [imageId, media.data]
  );
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

export function SeoTab({
  context,
  control,
  documentLock,
  setBadge,
}: DocumentTabProps): ReactNode {
  const locale = useDocumentLocale();
  // The whole document as typed: any of its fields can feed an automatic
  // value (a title, an excerpt, a pattern's field, its address).
  const document = useWatch({ control }) as Record<string, unknown>;
  const fields = useSeoFields();
  const errors = useSeoErrors(control);
  const target = useMemo(
    () => documentOf(context, locale?.code ?? null),
    [context, locale?.code]
  );
  const { context: levels, status } = useSeoTabContext(target, document);
  const [choosing, setChoosing] = useState(false);

  const values: SeoPanelValues = useMemo(() => {
    const seo = document[SEO_GROUP];
    return isRecord(seo) ? seo : {};
  }, [document]);
  const images = useShareImages(document, values, levels, fields.ogImage?.set);
  const { imageId, chosenImage } = images;
  const answers = useMemo(
    () => panelAnswers(levels, values, chosenImage),
    [levels, values, chosenImage]
  );
  const problems = useProblemsBadge(answers, levels, setBadge);
  useStatusLine(context, answers, problems.length, levels?.typeLabel);

  if (target === null) return null;
  const writable =
    !documentLock.readOnly && fields.metaTitle?.writable !== false;
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
        documentKey={documentKeyOf(target, context)}
        onChooseImage={() => setChoosing(true)}
        shownImageFile={images.contentImage}
        onMakeShareImage={images.make}
        onGoToField={goToContent}
      />
      <MediaPickerDialog
        mode="single"
        accept="image/*"
        open={choosing}
        onOpenChange={setChoosing}
        {...(imageId === undefined
          ? {}
          : { initialSelectedIds: new Set([imageId]) })}
        onSelect={chosen => {
          const first = chosen[0];
          if (first !== undefined) fields.ogImage?.set(first.id);
          setChoosing(false);
        }}
      />
    </>
  );
}

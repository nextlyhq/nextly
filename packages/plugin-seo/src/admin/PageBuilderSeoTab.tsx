/**
 * The SEO tab in the Page Builder's Settings dialog: the one panel, for what
 * the editor has open.
 *
 * - **A page** gets its own SEO tab, the one its edit page draws, editing its
 *   `seo` group through the page's form, so Save and Publish store it. The
 *   tab is in the row exactly where the page's edit page draws its SEO tab:
 *   it asks the admin that page's own question (`useContributionApplies`),
 *   and leaves the row where the answer is no.
 * - **A design** (a collection's template, or an entry's own design) gets the
 *   rule every page it draws follows (`TemplateSeoPanel`).
 *
 * The Page Builder hands the place's context (which document, and for a
 * design the collection it draws) and, as every tab there, the design's own
 * metadata with the edit that changes it, the document as edited, the
 * page's form and whether it takes edits now.
 *
 * @module admin/PageBuilderSeoTab
 */
import {
  useContributionApplies,
  type DocumentTabProps,
  type PlaceTabProps,
} from "@nextlyhq/plugin-sdk/admin";
// The Page Builder's place, typed for this tab's props: imported here so the
// published declarations of the admin entry carry the augmentation.
import "./page-builder-place";
import { useLayoutEffect, type ReactNode } from "react";
import type { Control, FieldValues } from "react-hook-form";

import { SEO_TAB_ID } from "../problems/contract";

import { SeoTab, type SeoTabElsewhere } from "./SeoTab";
import { TemplateSeoPanel, type DesignSeo } from "./TemplateSeoPanel";

/** What the Page Builder hands every tab at its Settings place. */
export type PageBuilderSeoTabProps =
  PlaceTabProps<"nextlyhq-plugin-page-builder.settings"> & {
    seo?: {
      value: DesignSeo | undefined;
      set: (next: DesignSeo | null) => boolean | void;
    };
    design?: Readonly<Record<string, unknown>>;
    control?: Control<FieldValues>;
    writable?: boolean;
    holdEdit?: (make: () => void) => () => void;
    designField?: string;
    openGeneral?: () => void;
  };

/** A page's own SEO, as its edit page's tab edits it. */
function PageSeo({
  userId,
  collection,
  entryId,
  control,
  writable,
  setBadge,
  setLeftOut,
  elsewhere,
}: {
  userId: string;
  collection: string;
  entryId: string | null;
  control: Control<FieldValues>;
  writable: boolean;
  setBadge: PageBuilderSeoTabProps["setBadge"];
  setLeftOut: PageBuilderSeoTabProps["setLeftOut"];
  elsewhere: SeoTabElsewhere;
}): ReactNode {
  const props: DocumentTabProps = {
    context: { userId, collection, entryId },
    control,
    documentLock: { readOnly: !writable, actionsDisabled: !writable },
    ...(entryId === null ? {} : { entry: { id: entryId } }),
    setBadge,
    setLeftOut,
  };
  return <SeoTab {...props} {...elsewhere} />;
}

/**
 * What a page's SEO tab is told in the builder: the design being edited,
 * which the form holds only once the editor stores it, so the preview reads
 * the blocks on screen; and General, where the page's own fields are.
 */
function elsewhereOf(props: PageBuilderSeoTabProps): SeoTabElsewhere {
  const { design, designField, openGeneral } = props;
  return {
    ...(design === undefined || designField === undefined
      ? {}
      : { unsaved: { path: designField, value: design } }),
    ...(openGeneral === undefined ? {} : { onGoToContent: openGeneral }),
  };
}

/**
 * Whether the page's edit page draws its SEO tab for the page's type now:
 * the admin's own answer, so the builder's tab and the edit page's are in
 * their rows together. A design's tab is always in the row.
 */
function usePageSeoApplies(
  context: PageBuilderSeoTabProps["context"]
): boolean {
  const applies = useContributionApplies("collection.edit", SEO_TAB_ID, {
    kind: "collection",
    slug: context.collection,
  });
  return context.document !== "page" || applies;
}

export function PageBuilderSeoTab(props: PageBuilderSeoTabProps): ReactNode {
  const { context, setBadge, setLeftOut } = props;
  const writable = props.writable ?? false;
  const applies = usePageSeoApplies(context);
  // Before the row is painted, so a page whose type has no SEO tab never
  // shows one, not even for a frame.
  useLayoutEffect(() => {
    setLeftOut(!applies);
  }, [applies, setLeftOut]);
  if (!applies) return null;
  if (context.document === "page") {
    return props.control === undefined ? null : (
      <PageSeo
        userId={context.userId}
        collection={context.collection}
        entryId={context.entryId}
        control={props.control}
        writable={writable}
        setBadge={setBadge}
        setLeftOut={setLeftOut}
        elsewhere={elsewhereOf(props)}
      />
    );
  }
  if (context.draws === null) {
    return (
      <p className="m-0 pt-4 text-[13px] text-muted-foreground">
        Choose the content type this template draws, under General, to set the
        SEO rules its pages follow.
      </p>
    );
  }
  if (props.seo === undefined || props.design === undefined) return null;
  return (
    <TemplateSeoPanel
      draws={context.draws}
      seo={props.seo}
      design={props.design}
      writable={writable}
      setBadge={setBadge}
      {...(props.holdEdit === undefined ? {} : { holdEdit: props.holdEdit })}
    />
  );
}

/**
 * What the Page Builder shows of a page's search result, drawn by the SEO
 * plugin wherever it is installed: in Page settings' General, and in the
 * right panel's page settings. The builder's own plain preview stands in
 * only where no plugin draws one.
 *
 * - **Where the plugin edits SEO for the page's type** (the page's edit page
 *   draws its SEO tab, asked of the admin as the builder's SEO tab asks it):
 *   General shows nothing, since the SEO tab beside it is the page's one SEO
 *   panel; the right panel shows the page's result on Google, worked out by
 *   the same answer and drawn by the same part as the tab's preview, so the
 *   two can never disagree.
 * - **Where it does not**: that SEO is turned off for the type, with the way
 *   to the SEO settings for someone who may change them, and no preview.
 * - **A design** states its pages' rule in its SEO tab, so nothing here.
 *
 * @module admin/PageBuilderSearchResult
 */
import {
  humanizeFieldName,
  useContributionApplies,
  usePluginRoute,
  type PlaceContributionProps,
} from "@nextlyhq/plugin-sdk/admin";
import "./page-builder-place";
import { useMemo, type ReactNode } from "react";
import type { Control, FieldValues } from "react-hook-form";

import { SEO_TAB_ID } from "../problems/contract";
import {
  SEO_PLUGIN_NAME,
  SETTINGS_DOCUMENT_ROUTE_PATH,
  SETTINGS_PAGE_HREF,
  type SettingsDocumentBody,
} from "../settings/contract";
import { SEO_GROUP } from "../tab/typed";

import type { PageBuilderSettingsBlockProps } from "./page-builder-place";
import { SearchResult } from "./previews";
import { AdminLink } from "./section";
import { useTypedDocument } from "./SeoTab";
import { useTabDocument } from "./tab-document";
import { useSeoTabContext } from "./use-seo-tab-context";
import { panelAnswers, type SeoPanelValues } from "./values";

/** What the block is handed at the Page Builder's place. */
export type PageBuilderSearchResultProps =
  PlaceContributionProps<"nextlyhq-plugin-page-builder.settings"> &
    PageBuilderSettingsBlockProps;

/** The Content types tab of the SEO settings, where a type's SEO is turned on or off. */
const CONTENT_TYPES_HREF = `${SETTINGS_PAGE_HREF}?tab=types`;

/** The line said where SEO is turned off for the page's type. */
function seoTurnedOffText(plural: string): string {
  return `SEO is turned off for ${plural}.`;
}

export function PageBuilderSearchResult(
  props: PageBuilderSearchResultProps
): ReactNode {
  const { context, at } = props;
  // The page's edit page's own question, so this and the builder's SEO tab
  // always agree on whether the plugin edits SEO for the page's type.
  const edits = useContributionApplies("collection.edit", SEO_TAB_ID, {
    kind: "collection",
    slug: context.collection,
  });
  if (context.document !== "page") return null;
  if (!edits) {
    return (
      <SeoTurnedOff
        plural={props.typePlural ?? humanizeFieldName(context.collection)}
      />
    );
  }
  if (at !== "panel" || props.control === undefined) return null;
  return (
    <PanelSearchResult
      context={context}
      control={props.control}
      {...(props.design === undefined || props.designField === undefined
        ? {}
        : { unsaved: { path: props.designField, value: props.design } })}
    />
  );
}

/**
 * That SEO is turned off for the page's type, and, for someone who may
 * change the SEO settings (the settings document route answers them alone,
 * and says whether they may change them), the way there.
 */
function SeoTurnedOff({ plural }: { plural: string }): ReactNode {
  const settings = usePluginRoute<SettingsDocumentBody>({
    plugin: SEO_PLUGIN_NAME,
    path: SETTINGS_DOCUMENT_ROUTE_PATH,
  });
  const mayChange = settings.data?.canChange === true;
  return (
    <section
      aria-label="Search and sharing"
      className="space-y-1"
      data-seo-turned-off=""
    >
      <p className="m-0 text-sm text-muted-foreground">
        {seoTurnedOffText(plural)}
      </p>
      {mayChange ? (
        <AdminLink
          href={CONTENT_TYPES_HREF}
          className="text-sm font-medium text-primary underline-offset-4 hover:underline"
        >
          SEO settings
        </AdminLink>
      ) : null}
    </section>
  );
}

/**
 * The page's result on Google in the right panel: the SEO tab's own answer
 * for the page as typed (its levels read from the plugin's route, the typed
 * values on top), drawn by the tab's own result.
 */
function PanelSearchResult({
  context,
  control,
  unsaved,
}: {
  context: PageBuilderSearchResultProps["context"];
  control: Control<FieldValues>;
  unsaved?: { path: string; value: unknown };
}): ReactNode {
  const document = useTypedDocument(control, unsaved);
  const { target } = useTabDocument(
    {
      userId: context.userId,
      collection: context.collection,
      entryId: context.entryId,
    },
    context.entryId === null ? undefined : { id: context.entryId }
  );
  const { context: levels } = useSeoTabContext(target, document);
  const values: SeoPanelValues = useMemo(() => {
    const seo = document[SEO_GROUP];
    return typeof seo === "object" && seo !== null ? seo : {};
  }, [document]);
  const answer = useMemo(
    () => panelAnswers(levels, values, undefined)?.answer,
    [levels, values]
  );
  return (
    <section aria-label="Search result" className="nx-inspector__field">
      <p className="nx-inspector__field-name" aria-hidden="true">
        Search result
      </p>
      <div className="min-w-0 rounded-md border border-border px-2.5 py-2">
        {answer === undefined || levels === undefined ? (
          <p className="m-0 text-xs text-muted-foreground">
            Reading this page&apos;s search result…
          </p>
        ) : (
          <SearchResult answer={answer} site={levels.site} />
        )}
      </div>
      <p className="nx-inspector__note">From the SEO plugin, as on its tab.</p>
    </section>
  );
}

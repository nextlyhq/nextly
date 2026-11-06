"use client";

import { Fragment, type ReactElement, type ReactNode } from "react";

import { Clock, Hash } from "@admin/components/icons";
import { PluginSlot } from "@admin/components/shared/plugin-slot";
import type { PlaceContributionProps } from "@admin/components/shared/target-slot";
import { usePlaceContributions } from "@admin/components/shared/target-slot/usePlaceContributions";
import { Skeleton } from "@admin/components/ui";
import { useAdminDateFormatter } from "@admin/hooks/useAdminDateFormatter";
import { useLocalization } from "@admin/hooks/useLocalization";
import type { DocumentPanelSectionProps } from "@admin/lib/plugins/component-registry";
import type { PluginPanelSectionEntry } from "@admin/lib/plugins/document-surfaces";
import type { ReleaseDocumentRef } from "@admin/types/releases";

import { useEntryLocale } from "../../EntryLocaleContext";
import { DocumentLanguagePanel, hasLanguages } from "../../LanguagePanel";
import type { DocumentPlace } from "../document-place";
import { DocumentIdCopy } from "../DocumentIdCopy";
import type { EntryData, EntryFormMode } from "../useEntryForm";

import { PanelSection } from "./PanelSection";
import { PublishingSection } from "./PublishingSection";
import { StatusSection, type PanelDocumentStatus } from "./StatusSection";

// The document panel's sections, in the one order both editors draw them:
// Status, then Publishing, then Language, then Details, then any a plugin
// adds for the collection. Each section decides
// whether it applies and draws nothing where it does not, so a document
// without a lifecycle or languages reads the sections it has, in that order.
//
// They are the edit page's place's built-in sections, by those names, and
// plugins' sections stand among them in the order the server sent: each a
// section of the panel under its own label, its component behind its own
// boundary, and one that replaces a built-in drawn where that one was. With
// nothing contributed the panel draws exactly its own four. Sections a plugin
// adds through the collection's document surfaces (`pluginSections`) follow
// all of these, after Details.

export { pillStateFromForm, PILL_LABEL, type PillState } from "./pill-state";

export interface DocumentPanelProps {
  /** The edit page's place, whose side panel sections this draws. */
  place: DocumentPlace;
  /** Form mode. Nothing is drawn before the document exists. */
  mode: EntryFormMode;
  /** Entry data with id and timestamps. */
  entry?: EntryData | null;
  /** Whether the collection has the Draft/Published feature enabled, which
   *  the Status and Publishing sections and the language panel read. */
  hasStatus: boolean;
  /**
   * The status in the language being edited, as the document bar's pill reads
   * it. The Status section says it as a sentence; absent, it is not drawn.
   */
  documentStatus?: PanelDocumentStatus;
  /**
   * The document as releases address it, which the Publishing section reads.
   * Absent, the section is not drawn.
   */
  releaseDocument?: ReleaseDocumentRef;
  /** The active editing locale, forwarded to the language panel. */
  locale?: string;
  /** Switch the editor to a language, forwarded to the language panel. */
  onLocaleChange?: (locale: string, options?: { seedFrom?: string }) => void;
  /** Withholds the panel's mutating actions (reading a past version). */
  actionsDisabled?: boolean;
  /** Withholds opening another language; the same as `actionsDisabled` unless given. */
  navigationDisabled?: boolean;
  /** Withholds publishing every language; the same as `actionsDisabled` unless given. */
  publishAllDisabled?: boolean;
  /**
   * Sections plugins add for this collection, drawn after Details under the
   * heading the panel draws for its own sections.
   */
  pluginSections?: readonly PluginPanelSectionEntry[];
  /**
   * What each plugin section is handed. Absent, none is drawn: a section
   * needs the document it is about.
   */
  pluginSectionProps?: DocumentPanelSectionProps;
}

export function DocumentPanel({
  place,
  mode,
  entry,
  hasStatus,
  documentStatus,
  releaseDocument,
  locale,
  onLocaleChange,
  actionsDisabled = false,
  navigationDisabled = actionsDisabled,
  publishAllDisabled = actionsDisabled,
  pluginSections = [],
  pluginSectionProps,
}: DocumentPanelProps): ReactElement | null {
  const sections = usePlaceContributions(place.place, "sidebarSection", {
    context: place.context,
    entry: place.entry,
  });
  // Nothing to say until the document exists.
  if (mode === "create") return null;

  // Per-language translation-status pills. Present only when the entry was
  // fetched with `?translation-status=1` on a localized collection; inert otherwise.
  const translations = entry?._translations as
    | Record<string, { translated: boolean; status?: string }>
    | undefined;

  const builtIns: Readonly<Record<string, ReactNode>> = {
    status:
      hasStatus && documentStatus ? (
        <StatusSection documentStatus={documentStatus} />
      ) : null,
    // A release publishes or unpublishes, so only a document with that
    // lifecycle has a schedule to read.
    publishing: hasStatus ? (
      <PublishingSection document={releaseDocument} />
    ) : null,
    language: (
      <LanguageSection>
        <DocumentLanguagePanel
          translations={translations}
          locale={locale}
          onLocaleChange={onLocaleChange}
          hasStatus={hasStatus}
          actionsDisabled={actionsDisabled}
          navigationDisabled={navigationDisabled}
          publishAllDisabled={publishAllDisabled}
        />
      </LanguageSection>
    ),
    details: (
      <PanelSection title="Details">
        <dl className="space-y-3">
          <IdRow id={entry?.id} />
          <TimestampRows entry={entry} />
        </dl>
      </PanelSection>
    ),
  };
  const { context } = place;

  return (
    <div className="flex flex-col" data-testid="document-panel-sections">
      {/* Keyed, so a built-in section keeps its state when contributed ones
          arrive with the admin's metadata and the list around it grows. */}
      {sections.map(item =>
        "builtIn" in item ? (
          <Fragment key={`builtIn:${item.builtIn}`}>
            {builtIns[item.builtIn] ?? null}
          </Fragment>
        ) : context !== null && item.kind === "sidebarSection" ? (
          <PanelSection key={item.id} title={item.label}>
            <PluginSlot<PlaceContributionProps>
              path={item.component}
              props={{
                context,
                ...(place.entry === undefined ? {} : { entry: place.entry }),
              }}
            />
          </PanelSection>
        ) : null
      )}
      {pluginSectionProps === undefined
        ? null
        : pluginSections.map(section => (
            // The panel's own section, so its heading, padding and divider
            // are the built-in ones in either scheme; the plugin draws the
            // body, inside its own error boundary.
            <PanelSection
              key={`${section.plugin}:${section.component}:${section.title}`}
              title={section.title}
            >
              {section.loading === true ? (
                // The panel's own loading look, as the Publishing section
                // draws it, until the component has arrived.
                <div aria-busy="true">
                  <span className="sr-only">Loading {section.title}</span>
                  <Skeleton className="h-4 w-40" />
                </div>
              ) : (
                <PluginSlot
                  path={section.component}
                  props={pluginSectionProps}
                />
              )}
            </PanelSection>
          ))}
    </div>
  );
}

/**
 * The Language section, where the document has languages to show: the
 * language panel as the editor has always drawn it, one row per language with
 * its state and the actions that make sense of it. The panel's own header
 * names it on screen, so the section's heading is said only to a screen reader.
 */
function LanguageSection({ children }: { children: ReactNode }) {
  const { enabled, locales } = useLocalization();
  const { collectionLocalized } = useEntryLocale();
  // The panel's own rule for when it draws anything, so the section and its
  // content cannot disagree about an empty section. Without languages the
  // panel is still mounted, as it always has been, and draws nothing itself.
  if (!hasLanguages(enabled, collectionLocalized, locales.length)) {
    return <>{children}</>;
  }
  return (
    <PanelSection title="Language" titleHidden>
      {children}
    </PanelSection>
  );
}

function RowIcon({ icon: Icon }: { icon: typeof Hash }) {
  return (
    <Icon
      className="h-3.5 w-3.5 text-muted-foreground shrink-0"
      aria-hidden="true"
    />
  );
}

function IdRow({ id }: { id?: string | null }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="flex items-center gap-2 text-xs text-muted-foreground shrink-0">
        <RowIcon icon={Hash} />
        <span>ID</span>
      </dt>
      <dd className="flex items-center gap-1 min-w-0">
        <DocumentIdCopy id={id} />
      </dd>
    </div>
  );
}

function TimestampRows({ entry }: { entry?: EntryData | null }) {
  const { formatDate } = useAdminDateFormatter();

  const createdAt =
    entry?.createdAt ?? (entry?.created_at as string | undefined) ?? undefined;
  const updatedAt =
    entry?.updatedAt ?? (entry?.updated_at as string | undefined) ?? undefined;

  const formatRowDate = (dateString: string | undefined) => {
    if (!dateString) return "—";
    return formatDate(
      dateString,
      { dateStyle: "medium", timeStyle: "short" },
      dateString
    );
  };

  return (
    <>
      <TimestampRow label="Created" value={formatRowDate(createdAt)} />
      <TimestampRow label="Updated" value={formatRowDate(updatedAt)} />
    </>
  );
}

function TimestampRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="flex items-center gap-2 text-xs text-muted-foreground shrink-0">
        <RowIcon icon={Clock} />
        <span>{label}</span>
      </dt>
      <dd className="text-xs text-foreground" title={value}>
        {value}
      </dd>
    </div>
  );
}

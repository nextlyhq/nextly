"use client";

import { Fragment } from "react";
import type React from "react";

import { Clock, Hash } from "@admin/components/icons";
import { PluginSlot } from "@admin/components/shared/plugin-slot";
import { containedContributionEvents } from "@admin/components/shared/target-slot/IsolatedContribution";
import { PlaceContributionFallback } from "@admin/components/shared/target-slot/PlaceContributionFallback";
import { Skeleton } from "@admin/components/ui";
import { useAdminDateFormatter } from "@admin/hooks/useAdminDateFormatter";
import { useLocalization } from "@admin/hooks/useLocalization";
import type {
  DocumentPanelSectionProps,
  SidebarSectionProps,
} from "@admin/lib/plugins/component-registry";
import type {
  PanelOrderEntry,
  PlacedPanelSection,
  PluginPanelSectionEntry,
} from "@admin/lib/plugins/document-surfaces";
import { cn } from "@admin/lib/utils";
import type { ReleaseDocumentRef } from "@admin/types/releases";

import { useEntryLocale } from "../../EntryLocaleContext";
import { DocumentLanguagePanel, hasLanguages } from "../../LanguagePanel";
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
// A side panel section a plugin declares at an edit page's place is drawn
// where the server placed it among the built-in four (`panelOrder`, from
// `placedPanelOrder`), and a built-in it replaces is not drawn.

export { pillStateFromForm, PILL_LABEL, type PillState } from "./pill-state";

export interface DocumentPanelProps {
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
  /**
   * The panel's sections in the order the server placed them, with the side
   * panel sections plugins declared at the page's place among them
   * (`placedPanelOrder`). Absent, the built-in sections are drawn in their
   * usual order.
   */
  panelOrder?: readonly PanelOrderEntry[];
  /**
   * What each placed section is handed: the place's context and entry, and on
   * a collection entry's page the document's handles too. Absent, placed
   * sections are handed `pluginSectionProps`; with neither, none is drawn.
   */
  placedSectionProps?: SidebarSectionProps | DocumentPanelSectionProps;
}

/** The built-in sections, in the order drawn when nothing places them. */
const BUILT_IN_ORDER: readonly PanelOrderEntry[] = [
  { kind: "builtIn", name: "status" },
  { kind: "builtIn", name: "publishing" },
  { kind: "builtIn", name: "language" },
  { kind: "builtIn", name: "details" },
];

export function DocumentPanel({
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
  panelOrder = BUILT_IN_ORDER,
  placedSectionProps = pluginSectionProps,
}: DocumentPanelProps): React.ReactElement | null {
  // Nothing to say until the document exists.
  if (mode === "create") return null;

  // Per-language translation-status pills. Present only when the entry was
  // fetched with `?translation-status=1` on a localized collection; inert otherwise.
  const translations = entry?._translations as
    | Record<string, { translated: boolean; status?: string }>
    | undefined;

  // Each built-in section by the name the server places it under.
  const builtIn = (name: string): React.ReactNode => {
    switch (name) {
      case "status":
        return hasStatus && documentStatus ? (
          <StatusSection documentStatus={documentStatus} />
        ) : null;
      case "publishing":
        // A release publishes or unpublishes, so only a document with that
        // lifecycle has a schedule to read.
        return hasStatus ? (
          <PublishingSection document={releaseDocument} />
        ) : null;
      case "language":
        return (
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
        );
      case "details":
        return (
          <PanelSection title="Details">
            <dl className="space-y-3">
              <IdRow id={entry?.id} />
              <TimestampRows entry={entry} />
            </dl>
          </PanelSection>
        );
      default:
        return null;
    }
  };

  return (
    <div className="flex flex-col" data-testid="document-panel-sections">
      {panelOrder.map(part =>
        part.kind === "builtIn" ? (
          <Fragment key={`built-in:${part.name}`}>
            {builtIn(part.name)}
          </Fragment>
        ) : placedSectionProps === undefined ? null : (
          <PlacedSection
            key={`placed:${part.id}`}
            part={part}
            props={placedSectionProps}
          />
        )
      )}
      {pluginSectionProps === undefined
        ? null
        : pluginSections.map(section => (
            // The panel's own section, so its heading, padding and divider
            // are the built-in ones in either scheme; the plugin draws the
            // body, inside its own error boundary, and a body that draws
            // nothing for this document leaves no empty heading.
            <PanelSection
              key={`${section.plugin}:${section.component}:${section.title}`}
              title={section.title}
              collapsesWhenEmpty
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
 * A section a plugin placed: the panel's own frame, the plugin's body. It
 * applies to some documents and not others, so it leaves no heading behind
 * where its component draws nothing. `flush` draws it above the fields
 * rather than in the panel. Like every contributed component, its body is
 * kept to itself (a form of its own does not submit the document's) and one
 * that cannot be found says so under the heading.
 */
function PlacedSection({
  part,
  props,
  flush = false,
}: {
  part: PlacedPanelSection;
  props: SidebarSectionProps | DocumentPanelSectionProps;
  flush?: boolean;
}): React.ReactElement {
  return (
    <PanelSection
      title={part.title}
      collapsesWhenEmpty
      flush={flush}
      // Kept on the section itself, with no wrapper inside it, so a body that
      // draws nothing still leaves the section empty to collapse.
      {...containedContributionEvents}
    >
      <PluginSlot
        path={part.component}
        props={props}
        fallback={<PlaceContributionFallback />}
      />
    </PanelSection>
  );
}

/**
 * The placed sections drawn above the fields where the editor is too narrow
 * to keep the panel beside them (`placePanelParts`), so a section an author
 * should meet first is on screen without opening the panel. Each keeps its
 * heading and its landmark, and draws nothing until there is a document.
 */
export function PanelSectionsAboveForm({
  sections,
  pluginSectionProps,
  placedSectionProps = pluginSectionProps,
  className,
}: {
  sections: readonly PlacedPanelSection[];
  /** What each section is handed, where `placedSectionProps` is not given. */
  pluginSectionProps?: DocumentPanelSectionProps;
  /** What each section is handed. Absent with the above, none is drawn. */
  placedSectionProps?: SidebarSectionProps | DocumentPanelSectionProps;
  className?: string;
}): React.ReactElement | null {
  if (sections.length === 0 || placedSectionProps === undefined) return null;
  return (
    <div
      className={cn("flex flex-col", className)}
      data-testid="document-panel-above-form"
    >
      {sections.map(part => (
        <PlacedSection
          key={`placed:${part.id}`}
          part={part}
          props={placedSectionProps}
          flush
        />
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
function LanguageSection({ children }: { children: React.ReactNode }) {
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

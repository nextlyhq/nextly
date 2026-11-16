"use client";

import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Skeleton,
} from "@nextlyhq/ui";
import { type JSX, useCallback, useMemo, useState } from "react";

import { AlertTriangle, Loader2 } from "@admin/components/icons";
import { toast } from "@admin/components/ui";
import { Link } from "@admin/components/ui/link";
import {
  EMAIL_TEMPLATE_PREVIEW_PERMISSIONS,
  EMAIL_TEMPLATE_UPDATE_PERMISSIONS,
  holdsAny,
} from "@admin/constants/email-hub";
import {
  useEmailBrand,
  useUpdateEmailBrand,
} from "@admin/hooks/queries/useEmailBrand";
import { useEmailTemplates } from "@admin/hooks/queries/useEmailTemplates";
import { useCurrentUserPermissions } from "@admin/hooks/useCurrentUserPermissions";
import { apiErrorMessage } from "@admin/lib/api/parseApiError";
import type {
  BrandOverview,
  BrandSettings,
  BrandSettingsChange,
} from "@admin/services/emailBrandApi";
import type { EmailTemplateRecord } from "@admin/services/emailTemplateApi";

import { DEFAULT_LAYOUT_SLUG } from "../messages/messages-model";
import { editRouteFor, useTemplateActions } from "../useTemplateActions";

import { BrandPreview } from "./BrandPreview";
import { BrandReachCard } from "./BrandReachCard";
import { BrandSettingsForm, type BrandEdit } from "./BrandSettingsForm";
import {
  changeOf,
  defaultLayoutKept,
  draftOf,
  isEmptyChange,
  plural,
  previewChangeOf,
  previewEmailOrder,
} from "./design-model";
import { MatchMySite, useSiteStyle, type SiteMatch } from "./MatchMySite";

/** The edits still to save once a save carrying `sent` has gone through. */
function withoutSent(
  edits: Partial<BrandSettings>,
  sent: BrandSettingsChange
): Partial<BrandSettings> {
  const left: Partial<BrandSettings> = { ...edits };
  for (const key of Object.keys(sent) as Array<keyof BrandSettings>) {
    if (JSON.stringify(left[key]) === JSON.stringify(sent[key])) {
      delete left[key];
    }
  }
  return left;
}

/** The settings being edited, over the saved ones, and what a save changes. */
function useBrandDraft(saved: BrandSettings) {
  const [edits, setEdits] = useState<Partial<BrandSettings>>({});
  const draft = useMemo(() => draftOf(saved, edits), [saved, edits]);
  const change = useMemo(() => changeOf(saved, draft), [saved, draft]);
  const edit: BrandEdit = useCallback(
    (key, value) => setEdits(current => ({ ...current, [key]: value })),
    []
  );
  const apply = useCallback(
    (values: Partial<BrandSettings>) =>
      setEdits(current => ({ ...current, ...values })),
    []
  );
  const discard = useCallback(() => setEdits({}), []);
  // After a save, only the edits it carried are dropped: one made while it
  // was on its way is still waiting to be saved.
  const settle = useCallback(
    (sent: BrandSettingsChange) =>
      setEdits(current => withoutSent(current, sent)),
    []
  );
  return { draft, change, edit, apply, discard, settle };
}

/** Unsaved changes, with what saving them changes, and Discard and Save. */
/** What a save changes, said under Unsaved changes. */
function saveEffect(reached: number, layoutKept: boolean): string {
  if (reached > 0)
    return `Saving changes the look of ${plural(reached, "email")}.`;
  return layoutKept
    ? "Saving keeps them for when the Default layout is reset."
    : "No email uses these settings yet.";
}

function SaveBar({
  reached,
  layoutKept,
  saving,
  onDiscard,
  onSave,
}: {
  reached: number;
  layoutKept: boolean;
  saving: boolean;
  onDiscard: () => void;
  onSave: () => void;
}) {
  return (
    <div
      role="region"
      aria-label="Unsaved changes"
      className="sticky bottom-4 z-10 flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card p-3 shadow-lg"
    >
      <span
        aria-hidden="true"
        className="h-2 w-2 shrink-0 rounded-full bg-warning"
      />
      <div className="min-w-0 flex-1 text-sm">
        <span className="font-semibold">Unsaved changes</span>{" "}
        <span className="text-muted-foreground">
          {saveEffect(reached, layoutKept)}
        </span>
      </div>
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={saving}
        onClick={onDiscard}
      >
        Discard
      </Button>
      <Button type="button" size="sm" disabled={saving} onClick={onSave}>
        {saving && <Loader2 className="h-4 w-4 animate-spin" />}
        Save
      </Button>
    </div>
  );
}

/** Said when the site's own Default layout keeps the settings from its emails. */
function LayoutKeptNotice({
  defaultLayout,
  canOpen,
}: {
  defaultLayout: EmailTemplateRecord | undefined;
  canOpen: boolean;
}) {
  return (
    <Alert variant="warning">
      <AlertTriangle className="h-4 w-4" />
      <AlertTitle>The brand settings don&apos;t reach your emails</AlertTitle>
      <AlertDescription className="flex flex-col items-start gap-2">
        <span>
          Your site changed the Default layout, so its emails keep your
          version&apos;s look until the layout is reset to Nextly&apos;s
          version, which is built from these settings.
        </span>
        {defaultLayout && canOpen && (
          <Link href={editRouteFor(defaultLayout)}>
            <Button type="button" size="sm" variant="outline">
              Open the Default layout
            </Button>
          </Link>
        )}
      </AlertDescription>
    </Alert>
  );
}

/**
 * Said in the preview's place to someone who may read the settings but not
 * render a preview, which the server asks a create grant for.
 */
function NoPreview(): JSX.Element {
  return (
    <section className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
      Previewing needs permission to create templates.
    </section>
  );
}

function BrandEditor({
  overview,
  templates,
}: {
  overview: BrandOverview;
  templates: EmailTemplateRecord[];
}) {
  const { hasPermission } = useCurrentUserPermissions();
  const canEdit = holdsAny(hasPermission, EMAIL_TEMPLATE_UPDATE_PERMISSIONS);
  const canPreview = holdsAny(
    hasPermission,
    EMAIL_TEMPLATE_PREVIEW_PERMISSIONS
  );
  const { canOpen } = useTemplateActions();
  const { draft, change, edit, apply, discard, settle } = useBrandDraft(
    overview.settings
  );
  const { mutate: save, isPending: saving } = useUpdateEmailBrand();
  const { data: site } = useSiteStyle();

  const emails = useMemo(
    () => templates.filter(record => record.kind === "template"),
    [templates]
  );
  const kept = defaultLayoutKept(overview.reach);
  const reachedCount = overview.reach.filter(entry => entry.reached).length;
  const unsaved = !isEmptyChange(change);
  const previewChange = useMemo(() => previewChangeOf(change), [change]);

  const onSave = () =>
    save(change, {
      onSuccess: (_settings, sent) => {
        settle(sent);
        toast.success("Brand settings saved");
      },
      onError: error =>
        toast.error("The brand settings couldn't be saved", {
          description: apiErrorMessage(error) || error.message,
        }),
    });
  const onMatch = (match: SiteMatch) => {
    apply(match);
    toast.success(
      "Your site's colours and font are in the draft. Save to use them."
    );
  };

  return (
    <div className="space-y-6">
      {kept && (
        <LayoutKeptNotice
          defaultLayout={templates.find(t => t.slug === DEFAULT_LAYOUT_SLUG)}
          canOpen={canOpen}
        />
      )}
      <div className="grid gap-6 xl:grid-cols-2">
        <BrandSettingsForm
          draft={draft}
          fonts={overview.fonts}
          edit={edit}
          readOnly={!canEdit}
          matchMySite={
            canEdit && site ? (
              <MatchMySite
                site={site}
                current={draft}
                fonts={overview.fonts}
                onApply={onMatch}
              />
            ) : null
          }
        />
        {canPreview ? (
          <BrandPreview
            emails={previewEmailOrder(overview.reach, emails)}
            change={previewChange}
            unsaved={unsaved}
            layoutKept={kept}
          />
        ) : (
          <NoPreview />
        )}
      </div>
      <BrandReachCard
        reach={overview.reach}
        emails={emails}
        canOpen={canOpen}
      />
      {canEdit && unsaved && (
        <SaveBar
          reached={reachedCount}
          layoutKept={kept}
          saving={saving}
          onDiscard={discard}
          onSave={onSave}
        />
      )}
    </div>
  );
}

/**
 * The brand settings beside a live preview of a chosen email, and where the
 * settings reach. Everyone who may read templates sees them; those who may
 * manage templates change them.
 */
export function BrandDesign(): JSX.Element {
  const brand = useEmailBrand();
  const templates = useEmailTemplates();
  if (brand.isError || templates.isError) {
    return (
      <Alert variant="destructive">
        <AlertDescription>
          {brand.error?.message ??
            templates.error?.message ??
            "The brand settings couldn't be loaded. Please try again."}
        </AlertDescription>
      </Alert>
    );
  }
  if (!brand.data || !templates.data) {
    return <Skeleton className="h-96 w-full rounded-lg" />;
  }
  return <BrandEditor overview={brand.data} templates={templates.data} />;
}

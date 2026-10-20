"use client";

/**
 * What the share popover shows: a lifetime to choose, a button that creates a
 * link and copies it in one step, the document's live links with who made each,
 * when it ends and how often it was opened, and a way to revoke any of them.
 *
 * Every rule lives elsewhere: the server decides who may share and list, and
 * `usePreviewShare` owns the requests. This only renders them.
 *
 * @module components/features/entries/PreviewShare/SharePreviewPanel
 */

import { useState } from "react";

import { Copy, Link, Loader2, X } from "@admin/components/icons";
import {
  Button,
  RadioGroup,
  RadioGroupItem,
  Separator,
  Skeleton,
} from "@admin/components/ui";
import {
  DEFAULT_PREVIEW_LINK_LIFETIME,
  PREVIEW_LINK_LIFETIMES,
  usePreviewShare,
  type PreviewLinkLifetime,
} from "@admin/hooks/usePreviewShare";
import { formatGlobalDateTime } from "@admin/lib/dates/format";
import { cn } from "@admin/lib/utils";
import type {
  ListedPreviewLink,
  OlderPreviewLinks,
  PreviewLinkDocument,
} from "@admin/services/previewLinkApi";

const WHEN: Intl.DateTimeFormatOptions = {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
};

function when(iso: string): string {
  return formatGlobalDateTime(iso, WHEN, iso);
}

function opened(count: number): string {
  if (count === 0) return "Not opened yet";
  return count === 1 ? "Opened once" : `Opened ${count} times`;
}

/** Who made a link, as the list names them. */
function maker(link: ListedPreviewLink): string {
  // A deleted maker's account is gone; one with no name is still there. The
  // list never carries an address, so a name is all there is to show.
  if (link.createdBy === null) return "A deleted user";
  return link.createdBy.name ?? "An unnamed user";
}

/** The lifetimes a new link can be made for, as one radio group. */
function LifetimeChoice({
  value,
  onChange,
}: {
  value: PreviewLinkLifetime;
  onChange: (value: PreviewLinkLifetime) => void;
}) {
  return (
    <fieldset className="space-y-1.5">
      <legend className="text-xs font-medium text-foreground">
        Link works for
      </legend>
      <RadioGroup
        value={value}
        onValueChange={next => onChange(next as PreviewLinkLifetime)}
        // Two by two at every width: four across leaves "3 days" too little
        // room beside its radio and breaks it over two lines.
        className="grid grid-cols-2 gap-1.5"
        aria-label="Link works for"
      >
        {PREVIEW_LINK_LIFETIMES.map(option => (
          <label
            key={option.id}
            className={cn(
              "flex cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-md border border-border px-2 py-1.5 text-xs",
              // The chosen one by its border, with the quiet fill the admin's
              // selected rows use; the accent fill is for actions.
              value === option.id && "border-primary bg-muted"
            )}
          >
            <RadioGroupItem value={option.id} />
            {option.label}
          </label>
        ))}
      </RadioGroup>
    </fieldset>
  );
}

/** One live link: who made it, when it ends, how often it was opened. */
function LiveLinkRow({
  link,
  onRevoke,
  revoking,
}: {
  link: ListedPreviewLink;
  onRevoke: () => void;
  revoking: boolean;
}) {
  return (
    <li
      className="flex items-center justify-between gap-3 rounded-md px-1 py-1.5"
      data-share-link={link.id}
    >
      <div className="min-w-0">
        <p className="flex items-center gap-1.5 truncate text-sm text-foreground">
          <Link
            className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
            aria-hidden="true"
          />
          <span className="truncate">{maker(link)}</span>
          {link.locale === null ? null : (
            <span className="shrink-0 text-xs text-muted-foreground">
              {link.locale}
            </span>
          )}
        </p>
        <p className="text-xs text-muted-foreground">
          Ends {when(link.expiresAt)} · {opened(link.openCount)}
        </p>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="shrink-0 text-destructive"
        onClick={onRevoke}
        disabled={revoking}
        aria-label={`Revoke the link ${maker(link)} made, ending ${when(link.expiresAt)}`}
      >
        Revoke
      </Button>
    </li>
  );
}

/** The live list's body: loading, a failure, nothing, or the rows. */
function LiveLinks({
  share,
  live,
}: {
  share: ReturnType<typeof usePreviewShare>;
  live: ListedPreviewLink[];
}) {
  const { links, revoke } = share;
  if (links.isPending) {
    return (
      <div className="space-y-2" aria-busy="true">
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-full" />
      </div>
    );
  }
  if (links.isError) {
    return (
      <p className="text-xs text-muted-foreground" role="alert">
        {links.error instanceof Error && links.error.message.length > 0
          ? links.error.message
          : "The live links couldn't be loaded."}
      </p>
    );
  }
  if (live.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        No live links to this page.
      </p>
    );
  }
  return (
    <ul className="space-y-1" data-share-links>
      {live.map(link => (
        <LiveLinkRow
          key={link.id}
          link={link}
          onRevoke={() => revoke.mutate(link.id)}
          revoking={revoke.isPending && revoke.variables === link.id}
        />
      ))}
    </ul>
  );
}

/**
 * Revoke every link of the page. It ends links other people are relying on,
 * so it asks once more before it does.
 */
function RevokeAll({ share }: { share: ReturnType<typeof usePreviewShare> }) {
  const [confirming, setConfirming] = useState(false);
  const { revokeAll } = share;
  if (!confirming) {
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="w-full text-destructive"
        onClick={() => setConfirming(true)}
        data-share-revoke-all
      >
        Revoke all links to this page
      </Button>
    );
  }
  return (
    <div className="space-y-2" role="group" aria-label="Revoke all">
      <p className="text-xs text-foreground">
        Revoke every link to this page? Nobody holding one can open it again.
      </p>
      <div className="flex justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setConfirming(false)}
        >
          Cancel
        </Button>
        <Button
          type="button"
          variant="destructive"
          size="sm"
          disabled={revokeAll.isPending}
          onClick={() =>
            revokeAll.mutate(undefined, {
              onSettled: () => setConfirming(false),
            })
          }
          data-share-revoke-all-confirm
        >
          Revoke all
        </Button>
      </div>
    </div>
  );
}

export interface SharePreviewPanelProps {
  /** The one document whose links these are. */
  document: PreviewLinkDocument;
  /** Closes the popover the panel is shown in. */
  onClose: () => void;
}

export function SharePreviewPanel({
  document,
  onClose,
}: SharePreviewPanelProps) {
  const [lifetime, setLifetime] = useState<PreviewLinkLifetime>(
    DEFAULT_PREVIEW_LINK_LIFETIME
  );
  const share = usePreviewShare(document, { enabled: true });
  const { links, create } = share;

  const items = links.data?.items ?? [];
  const totalLive = links.data?.total ?? 0;
  const live = items.filter(
    (item): item is ListedPreviewLink => item.kind === "link"
  );
  const older = items.find(
    (item): item is OlderPreviewLinks => item.kind === "older"
  );
  const seconds =
    PREVIEW_LINK_LIFETIMES.find(option => option.id === lifetime)?.seconds ??
    PREVIEW_LINK_LIFETIMES[1].seconds;

  return (
    <div className="flex flex-col" data-share-preview>
      <div className="space-y-3 p-4">
        <div className="space-y-1">
          <div className="flex items-start justify-between gap-2">
            <h2 className="text-sm font-semibold text-foreground">
              Share a preview
            </h2>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="-mr-2 -mt-1 h-7 w-7 p-0"
              onClick={onClose}
              aria-label="Close"
              title="Close"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Anyone with the link sees this draft, without signing in, until the
            link ends.
          </p>
        </div>

        <LifetimeChoice value={lifetime} onChange={setLifetime} />

        <Button
          type="button"
          className="w-full"
          onClick={() => create.mutate({ ttlSeconds: seconds })}
          disabled={create.isPending}
          data-share-create
        >
          {create.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <Copy className="h-4 w-4" aria-hidden="true" />
          )}
          Create and copy link
        </Button>
        {/* The link is a credential and is never stored, so the moment it is
          made is the only moment it can be copied. Said here, where an editor
          would otherwise look for a Copy button on the list below. */}
        <p className="text-xs text-muted-foreground">
          A link can only be copied when it is made. To share again, make a new
          one.
        </p>
      </div>

      <Separator />

      <section className="space-y-2 p-4" aria-labelledby="share-preview-live">
        <h3
          id="share-preview-live"
          className="text-xs font-medium text-foreground"
        >
          Live links
        </h3>

        <LiveLinks share={share} live={live} />

        {totalLive > live.length ? (
          <p className="text-xs text-muted-foreground">
            Showing the newest {live.length} of {totalLive} live links. Revoking
            all ends every one of them.
          </p>
        ) : null}

        {older === undefined ? null : (
          <div
            className="space-y-1 rounded-md border border-border p-3"
            data-share-older
          >
            <p className="text-sm text-foreground">Earlier links</p>
            <p className="text-xs text-muted-foreground">
              Links shared before this version weren&apos;t recorded, so they
              can only be revoked all together. Any of them stops working by{" "}
              {when(older.latestEnd)}.
            </p>
          </div>
        )}
      </section>

      {live.length > 0 || older !== undefined ? (
        <>
          <Separator />
          <div className="p-4">
            <RevokeAll share={share} />
          </div>
        </>
      ) : null}
    </div>
  );
}

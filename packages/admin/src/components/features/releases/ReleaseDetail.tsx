"use client";

/**
 * One release, and everything in it.
 *
 * This is where a release becomes safe to commit to: the instant and the
 * contents are on screen together, so "what ships on Friday" is answered by
 * looking rather than by remembering. Scheduling lives here for that reason and
 * not on the list, where the contents are not visible.
 *
 * @module components/features/releases/ReleaseDetail
 */

import { useState } from "react";

import { CalendarClock, ExternalLink, Trash2 } from "@admin/components/icons";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Badge,
  Button,
  Card,
} from "@admin/components/ui";
import { Link } from "@admin/components/ui/link";
import { DataTableView } from "@admin/components/ui/table/data-table";
import type { NextlyColumn } from "@admin/components/ui/table/data-table";
import { buildRoute, ROUTES } from "@admin/constants/routes";
import {
  useRelease,
  useReleaseMembers,
  useRemoveReleaseMember,
} from "@admin/hooks/queries/useReleases";
import type {
  Release,
  ReleaseMember,
  ReleaseState,
} from "@admin/types/releases";

import { BlockedReleaseNotice } from "./BlockedReleaseNotice";
import { CancelReleaseButton } from "./CancelReleaseButton";
import { releaseErrorMessage } from "./release-error";
import { describeRelease, RELEASE_STATE_LABEL } from "./release-schedule";
import { ScheduleReleaseDialog } from "./ScheduleReleaseDialog";

/** What a member will DO, said as the consequence rather than the verb. */
const ACTION_LABEL: Record<ReleaseMember["action"], string> = {
  publish: "Goes live",
  unpublish: "Comes down",
};

/**
 * Where a member's document lives, so the row is a way back to it.
 *
 * A release that lists documents an editor cannot open from it is a list of
 * identifiers; being one click from the thing itself is most of the value of
 * having the page at all.
 */
/**
 * What a member row shows: the effect, the document, and the way out.
 *
 * The ACTION leads, for the same reason state leads the release list — publish
 * and unpublish are opposite outcomes, and a row that opened with the document
 * would present them as the same thing with a label attached.
 */
function memberColumns(
  releaseId: string,
  removable: boolean
): NextlyColumn<ReleaseMember>[] {
  const columns: NextlyColumn<ReleaseMember>[] = [
    {
      name: "action",
      header: "Action",
      cell: ({ row }) => (
        <Badge variant={row.action === "publish" ? "success" : "outline"}>
          {ACTION_LABEL[row.action]}
        </Badge>
      ),
    },
    {
      name: "document",
      header: "Document",
      cell: ({ row }) => (
        <Link
          href={documentHref(row)}
          className="inline-flex min-w-0 items-center gap-1 truncate font-medium text-foreground"
        >
          <span className="truncate">
            {row.scopeSlug}
            {row.scopeKind === "collection" ? ` / ${row.entryId}` : ""}
          </span>
          <ExternalLink className="size-3.5 shrink-0" aria-hidden />
        </Link>
      ),
    },
    {
      name: "kind",
      header: "Kind",
      cell: ({ row }) => (
        <span className="text-muted-foreground">
          {row.scopeKind === "single" ? "Single" : "Collection entry"}
        </span>
      ),
    },
  ];

  // The column is ABSENT rather than empty when the reader cannot remove
  // anything: a header for a control that never appears reads as a permission
  // that failed to load.
  if (removable) {
    columns.push({
      name: "remove",
      header: "",
      cell: ({ row }) => (
        <MemberRemoveButton member={row} releaseId={releaseId} />
      ),
    });
  }
  return columns;
}

function documentHref(member: ReleaseMember): string {
  return member.scopeKind === "single"
    ? buildRoute(ROUTES.SINGLE_EDIT, { slug: member.scopeSlug })
    : buildRoute(ROUTES.COLLECTION_ENTRY_EDIT, {
        slug: member.scopeSlug,
        id: member.entryId,
      });
}

/**
 * The per-row removal, with its confirmation.
 *
 * A cell rather than a `RowAction`, because the removal has to hold its dialog
 * OPEN while it is failing — see the note below — and a generic row action has
 * nowhere to keep that state.
 */
function MemberRemoveButton({
  member,
  releaseId,
}: {
  member: ReleaseMember;
  releaseId: string;
}) {
  const remove = useRemoveReleaseMember(releaseId);
  const [confirming, setConfirming] = useState(false);
  // Held open while the removal is FAILING. `AlertDialogAction` closes on
  // click, so without this the row still shows the document, the editor reads
  // that as the removal not having applied yet, and nothing ever says it failed.
  const open = confirming || remove.isError;

  return (
    <AlertDialog
      open={open}
      onOpenChange={next => {
        if (!next) remove.reset();
        setConfirming(next);
      }}
    >
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setConfirming(true)}
        disabled={remove.isPending}
        // Named, not "Remove": a screen reader hears the rows in sequence
        // and "Remove, Remove, Remove" identifies none of them.
        aria-label={`Remove ${member.scopeSlug} from this release`}
      >
        <Trash2 className="size-4" aria-hidden />
      </Button>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Remove from this release?</AlertDialogTitle>
          <AlertDialogDescription>
            The document itself is not changed. It simply stops being part of
            what goes live with this release.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {remove.isError ? (
          <p role="alert" className="text-sm text-destructive">
            {releaseErrorMessage(
              remove.error,
              "This document was not removed — it is still in the release."
            )}
          </p>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel>Keep it</AlertDialogCancel>
          <AlertDialogAction onClick={() => remove.mutate(member.id)}>
            Remove
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/**
 * What this release will do when it fires, in one sentence.
 *
 * Stated as a count of consequences rather than "3 members", because the number
 * that matters on the day is how many things change, and in which direction.
 */
function contentsSummary(members: ReleaseMember[]): string {
  if (members.length === 0) return "Nothing in it yet.";
  const live = members.filter(m => m.action === "publish").length;
  const down = members.length - live;
  const parts: string[] = [];
  if (live > 0) parts.push(`${live} document${live === 1 ? "" : "s"} go live`);
  if (down > 0) {
    parts.push(`${down} document${down === 1 ? "" : "s"} come down`);
  }
  return `${parts.join(", ")}.`;
}

/**
 * What the one scheduling control MEANS, given where the release stands.
 *
 * Setting a first instant, moving one already committed to, and reinstating a
 * launch that was called off are three different acts, and the verb is what an
 * editor reads before clicking. "Schedule" on a release that already has an
 * instant reads as though it has none.
 *
 * Derived from the state, which is a presentational question. WHETHER the
 * control appears is a different one, and the server answers that.
 */
function scheduleLabel(state: ReleaseState): string {
  return state === "draft" ? "Schedule…" : "Reschedule…";
}

/**
 * The two lifecycle controls, and the state each is offered from.
 *
 * Separated from the header's identity block because they own the dialog state:
 * keeping them together re-renders the title, the schedule line and the
 * description every time a dialog opens, and mixes a question about authority
 * with one about presentation.
 */
function HeaderActions({
  release,
  contentsKnown,
}: {
  release: Release;
  contentsKnown: boolean;
}) {
  const [scheduling, setScheduling] = useState(false);

  // The server's verdict, not a rule of our own. It knows both halves — the
  // release's state and this caller's grants — and a scoped API key is judged
  // by its own, so anything computed here would be guessing at the half the
  // admin cannot see.
  if (release.can?.cancel === true && release.can.schedule !== true) {
    return <CancelReleaseButton release={release} />;
  }

  if (release.can?.schedule !== true) return null;

  return (
    <div className="flex flex-wrap items-start justify-end gap-2">
      <div className="flex flex-col items-end gap-1">
        <Button
          onClick={() => setScheduling(true)}
          // Committing a release whose contents have not arrived defeats the
          // reason this page exists: the instant is chosen with what ships on
          // screen. A FAILED members request is the same situation as a pending
          // one — the editor cannot see what they are committing.
          disabled={!contentsKnown}
        >
          {scheduleLabel(release.state)}
        </Button>
        {!contentsKnown ? (
          <p className="text-xs text-muted-foreground">
            Available once the contents have loaded.
          </p>
        ) : null}
        <ScheduleReleaseDialog
          release={release}
          open={scheduling}
          onOpenChange={setScheduling}
        />
      </div>
      {release.can.cancel ? <CancelReleaseButton release={release} /> : null}
    </div>
  );
}

function Header({
  release,
  contentsKnown,
}: {
  release: Release;
  contentsKnown: boolean;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <Badge
            variant={release.state === "scheduled" ? "warning" : "outline"}
          >
            {RELEASE_STATE_LABEL[release.state]}
          </Badge>
          <h1 className="truncate text-xl font-semibold tracking-tight">
            {release.title}
          </h1>
        </div>
        <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
          <CalendarClock className="size-4 shrink-0" aria-hidden />
          {describeRelease(release)}
        </p>
        {release.description ? (
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            {release.description}
          </p>
        ) : null}
      </div>

      <HeaderActions release={release} contentsKnown={contentsKnown} />
    </div>
  );
}

export function ReleaseDetail({ id }: { id: string }) {
  const release = useRelease(id);
  const members = useReleaseMembers(id);

  if (release.isPending) {
    return (
      <p role="status" className="text-sm text-muted-foreground">
        Loading release…
      </p>
    );
  }

  if (release.isError || !release.data) {
    // A release that cannot be read and one that does not exist are the same
    // thing to an editor standing here: either way this is not their release.
    return (
      <div className="flex flex-col items-start gap-3">
        <p role="alert" className="text-sm text-destructive">
          This release could not be loaded.
        </p>
        <Link href={ROUTES.RELEASES} className="text-sm underline">
          Back to all releases
        </Link>
      </div>
    );
  }

  const rows = members.data?.items ?? [];

  // The server's verdict again. Membership is editable freely in some states and
  // only by a publisher in others — the drain reads membership AT the instant,
  // so changing a scheduled release changes what a publisher committed to — and
  // that rule lives with the fence that enforces it, not here.
  const removable = release.data.can?.removeMember ?? false;

  // A members request that has not returned and one that FAILED are the same
  // fact for scheduling: the editor cannot see what they would be committing.
  const contentsKnown = !members.isPending && !members.isError;

  return (
    <>
      <Header release={release.data} contentsKnown={contentsKnown} />

      {/* Above the contents, because it changes what the contents MEAN: this
          is not a list of what will ship, it is a list of what did not. */}
      {release.data.state === "blocked" ? (
        <BlockedReleaseNotice blockers={release.data.blockedBy ?? []} />
      ) : null}

      <section aria-labelledby="release-contents">
        <div className="mb-3 flex items-baseline justify-between gap-3">
          <h2 id="release-contents" className="text-base font-medium">
            What is in it
          </h2>
          <p className="text-sm text-muted-foreground">
            {members.isPending ? "Loading…" : contentsSummary(rows)}
          </p>
        </div>

        {members.isError ? (
          <p role="alert" className="text-sm text-destructive">
            The contents of this release could not be loaded.
          </p>
        ) : null}

        {!members.isPending && !members.isError && rows.length === 0 ? (
          <Card className="px-6 py-10 text-center">
            <p className="text-sm text-muted-foreground">
              Nothing has been added yet. Open a document and add it to this
              release from there — that is where you can see what you are
              scheduling.
            </p>
          </Card>
        ) : (
          <DataTableView<ReleaseMember>
            columns={memberColumns(id, removable)}
            rows={rows}
            getRowId={member => member.id}
            primaryColumn="document"
            registryKey="release-members"
            ariaLabel="Documents in this release"
            emptyMessage="Nothing has been added to this release yet."
          />
        )}
      </section>
    </>
  );
}

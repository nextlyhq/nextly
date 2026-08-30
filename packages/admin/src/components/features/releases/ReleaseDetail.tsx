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
import { buildRoute, ROUTES } from "@admin/constants/routes";
import {
  useRelease,
  useReleaseMembers,
  useRemoveReleaseMember,
} from "@admin/hooks/queries/useReleases";
import { useCan } from "@admin/hooks/useCan";
import type { Release, ReleaseMember } from "@admin/types/releases";

import { CancelReleaseButton } from "./CancelReleaseButton";
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
function documentHref(member: ReleaseMember): string {
  return member.scopeKind === "single"
    ? buildRoute(ROUTES.SINGLE_EDIT, { slug: member.scopeSlug })
    : buildRoute(ROUTES.COLLECTION_ENTRY_EDIT, {
        slug: member.scopeSlug,
        id: member.entryId,
      });
}

function MemberRow({
  member,
  releaseId,
  removable,
}: {
  member: ReleaseMember;
  releaseId: string;
  removable: boolean;
}) {
  const remove = useRemoveReleaseMember(releaseId);
  const [confirming, setConfirming] = useState(false);

  return (
    <li>
      <Card className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Badge
              variant={member.action === "publish" ? "success" : "outline"}
            >
              {ACTION_LABEL[member.action]}
            </Badge>
            <Link
              href={documentHref(member)}
              className="inline-flex min-w-0 items-center gap-1 truncate font-medium text-foreground"
            >
              <span className="truncate">
                {member.scopeSlug}
                {member.scopeKind === "collection"
                  ? ` / ${member.entryId}`
                  : ""}
              </span>
              <ExternalLink className="size-3.5 shrink-0" aria-hidden />
            </Link>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {member.scopeKind === "single" ? "Single" : "Collection entry"}
          </p>
        </div>

        {removable ? (
          <AlertDialog open={confirming} onOpenChange={setConfirming}>
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
                  The document itself is not changed. It simply stops being part
                  of what goes live with this release.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Keep it</AlertDialogCancel>
                <AlertDialogAction onClick={() => remove.mutate(member.id)}>
                  Remove
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        ) : null}
      </Card>
    </li>
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

function Header({
  release,
  canPublish,
}: {
  release: Release;
  canPublish: boolean;
}) {
  const [scheduling, setScheduling] = useState(false);

  // `draft` is the only state that can be committed, and `scheduled` the only
  // one that can be called off. Offering either outside its state would put a
  // button on screen whose only possible outcome is a refusal.
  const schedulable = release.state === "draft";
  const cancellable = release.state === "scheduled";

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

      {/* Gated on the same authority the server checks. Its refusal is one
          fixed sentence that cannot say WHY, so the only place a reason can be
          given is here — and not offering the action is the clearest one. */}
      {canPublish && schedulable ? (
        <>
          <Button onClick={() => setScheduling(true)}>Schedule…</Button>
          <ScheduleReleaseDialog
            release={release}
            open={scheduling}
            onOpenChange={setScheduling}
          />
        </>
      ) : null}
      {canPublish && cancellable ? (
        <CancelReleaseButton release={release} />
      ) : null}
    </div>
  );
}

export function ReleaseDetail({ id }: { id: string }) {
  const release = useRelease(id);
  const members = useReleaseMembers(id);
  const canAssemble = useCan("create-content-releases");
  const canPublish = useCan("publish-content-releases");

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

  // What the service enforces, asked here so the control is not offered where
  // it can only be refused. A draft is changed with `create` alone; a SCHEDULED
  // release additionally needs `publish`, because its membership is read at the
  // instant rather than at scheduling time — so editing it changes what a
  // publisher already committed to. Published and cancelled releases are never
  // materialised again, so their contents cannot change at all.
  const state = release.data.state;
  const removable =
    canAssemble && (state === "draft" || (state === "scheduled" && canPublish));

  return (
    <>
      <Header release={release.data} canPublish={canPublish} />

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
          <ul className="flex flex-col gap-2">
            {rows.map(member => (
              <MemberRow
                key={member.id}
                member={member}
                releaseId={id}
                removable={removable}
              />
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

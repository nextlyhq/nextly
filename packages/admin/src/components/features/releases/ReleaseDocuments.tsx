"use client";

/**
 * What is in a release: how ready it is, then its documents, grouped by
 * collection and named by title, each saying what it does when the release
 * runs and whether it is ready, with what to do about a problem beside it.
 *
 * Documents the reader may not read are counted in their collection's group
 * and never named, so the release reads as the size it is. Readiness counts
 * them too, from the server's own tally.
 *
 * @module components/features/releases/ReleaseDocuments
 */

import { useState, type JSX } from "react";

import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ExternalLink,
  Eye,
  EyeOff,
  Info,
  MoreHorizontal,
} from "@admin/components/icons";
import { SectionErrorFallback } from "@admin/components/shared/error-fallbacks";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Progress,
  Skeleton,
} from "@admin/components/ui";
import { Link } from "@admin/components/ui/link";
import { buildRoute, ROUTES } from "@admin/constants/routes";
import {
  useChangeReleaseMemberAction,
  useRemoveReleaseMember,
  type ReleaseDocumentNames,
} from "@admin/hooks/queries/useReleases";
import { cn } from "@admin/lib/utils";
import type {
  HiddenReleaseMembers,
  Release,
  ReleaseMember,
  ReleaseMemberAction,
  ReleaseReadiness,
} from "@admin/types/releases";

import {
  documentLabel,
  documentStatusLine,
  groupReleaseDocuments,
  MEMBER_ACTION_LABEL,
  type DocumentLabel,
  type ReleaseDocumentGroup,
} from "./release-documents";
import { releaseErrorMessage } from "./release-error";
import { describeUnshownNeedFix } from "./release-hidden";
import { describeMemberActions, documentCount } from "./release-list";
import { memberControls, type MemberControls } from "./release-member-controls";
import { readinessHeadline } from "./release-page";
import {
  problemsByMember,
  type MemberProblems,
  type ProblemWords,
} from "./release-problems";
import { relativeTime } from "./release-time";

/** What the readiness read gave, as the section reads it. */
export interface ReadinessState {
  /** Whether the release still has a moment ahead, so readiness matters. */
  ahead: boolean;
  data: ReleaseReadiness | undefined;
  isPending: boolean;
  isError: boolean;
  refetch: () => void;
}

/** The id the first document needing a fix is reached by, from the panel. */
const FIRST_PROBLEM_ID = "release-first-problem";

/** Where a document is edited, so a row is a way back to it. */
function documentHref(member: ReleaseMember): string {
  return member.scopeKind === "single"
    ? buildRoute(ROUTES.SINGLE_EDIT, { slug: member.scopeSlug })
    : buildRoute(ROUTES.COLLECTION_ENTRY_EDIT, {
        slug: member.scopeSlug,
        id: member.entryId,
      });
}

/** What the section receives from the page. */
interface ReleaseDocumentsProps {
  release: Release;
  members: ReleaseMember[];
  hidden: HiddenReleaseMembers[] | undefined;
  membersPending: boolean;
  membersFailed: boolean;
  names: ReleaseDocumentNames;
  readiness: ReadinessState;
  releaseTitleOf: (id: string) => string | undefined;
}

/** What the section shows, worked out from what it was given. */
function documentsView({
  release,
  members,
  hidden,
  names,
  readiness,
  releaseTitleOf,
}: ReleaseDocumentsProps) {
  const checked = readiness.ahead ? readiness.data : undefined;
  const groups = groupReleaseDocuments({
    members,
    hidden,
    hiddenProblems: checked?.hidden,
    scopeNamesOf: names.scopeNamesOf,
  });
  const total = groups.reduce((sum, group) => sum + group.total, 0);
  const problemsOf = problemsByMember(checked, {
    releaseId: release.id,
    singularOf: slug => names.scopeNamesOf(slug)?.singular ?? slug,
    releaseTitleOf,
  });
  const goLive = members.filter(m => m.action === "publish").length;
  const actions = describeMemberActions(
    { goLive, comeDown: members.length - goLive },
    release.state === "published" ? "ran" : "ahead"
  );
  return {
    groups,
    total,
    problemsOf,
    firstProblem: members.find(m => problemsOf(m.id).hard.length > 0),
    // What the visible documents do, said as about those alone when some
    // are hidden, so it never reads as the whole release.
    actionsLine:
      actions && hidden && hidden.length > 0
        ? `Of those you can view, ${actions}`
        : actions,
  };
}

export function ReleaseDocuments(props: ReleaseDocumentsProps): JSX.Element {
  const { release, readiness } = props;
  const view = documentsView(props);
  return (
    <section
      aria-labelledby="release-documents"
      className="flex flex-col gap-4"
    >
      {readiness.ahead && view.total > 0 ? (
        <ReadinessPanel
          release={release}
          total={view.total}
          readiness={readiness}
          firstProblemId={view.firstProblem ? FIRST_PROBLEM_ID : null}
        />
      ) : null}
      <DocumentsHeading total={view.total} actionsLine={view.actionsLine} />
      <DocumentsBody
        {...props}
        groups={view.groups}
        problemsOf={view.problemsOf}
        firstProblemMemberId={view.firstProblem?.id}
      />
    </section>
  );
}

/** The section's heading: how many documents, and what they do. */
function DocumentsHeading({
  total,
  actionsLine,
}: {
  total: number;
  actionsLine: string;
}) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
      <h2
        id="release-documents"
        className="text-base font-semibold text-foreground"
      >
        Documents
        {total > 0 ? (
          <span className="ml-2 font-normal tabular-nums text-muted-foreground">
            <span className="sr-only"> ({documentCount(total)})</span>
            <span aria-hidden>{total}</span>
          </span>
        ) : null}
      </h2>
      {actionsLine ? (
        <p className="text-sm text-muted-foreground">{actionsLine}</p>
      ) : null}
    </div>
  );
}

/** The groups, or why there are none to show. */
function DocumentsBody({
  release,
  membersPending,
  membersFailed,
  names,
  readiness,
  groups,
  problemsOf,
  firstProblemMemberId,
}: ReleaseDocumentsProps & {
  groups: ReleaseDocumentGroup[];
  problemsOf: (memberId: string) => MemberProblems;
  firstProblemMemberId: string | undefined;
}) {
  if (membersFailed) {
    return (
      <p
        role="alert"
        className="text-sm text-destructive-700 dark:text-destructive"
      >
        The documents in this release could not be loaded.
      </p>
    );
  }
  if (membersPending) {
    return (
      <div className="flex flex-col gap-2" aria-busy="true">
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-14 w-full" />
      </div>
    );
  }
  if (groups.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-border px-6 py-10 text-center text-sm text-muted-foreground">
        Nothing has been added yet. Open a document and add it to this release
        from there, where you can see what you are scheduling.
      </p>
    );
  }
  const controls = memberControls(release);
  return (
    <>
      {groups.map(group => (
        <DocumentGroup
          key={group.key}
          release={release}
          group={group}
          names={names}
          problemsOf={problemsOf}
          readinessKnown={rowReadiness(readiness)}
          ahead={readiness.ahead}
          controls={controls}
          firstProblemMemberId={firstProblemMemberId}
        />
      ))}
    </>
  );
}

/**
 * How ready the release is, as a bar and one sentence, with a way to the
 * first document that needs a fix.
 */
function ReadinessPanel({
  release,
  total,
  readiness,
  firstProblemId,
}: {
  release: Release;
  total: number;
  readiness: ReadinessState;
  firstProblemId: string | null;
}) {
  if (readiness.data === undefined) {
    if (readiness.isError) {
      // The admin's own section error, as the releases list shows a read
      // that failed. Scheduling stays open: the server judges again then.
      return (
        <SectionErrorFallback
          title="Readiness couldn't be checked"
          description="Whether these documents are ready is unknown for now. Schedule and Publish now still work, and are checked again when you use them."
          reset={readiness.refetch}
          showDetails={false}
        />
      );
    }
    return <Skeleton className="h-[60px] w-full rounded-lg" aria-busy="true" />;
  }
  const headline = readinessHeadline(release, total, readiness.data);
  const Icon = headline.tone === "ready" ? CheckCircle2 : AlertCircle;
  return (
    <div
      role="status"
      className={cn(
        "flex flex-col gap-3 rounded-lg border px-4 py-3 sm:flex-row sm:items-center",
        headline.tone === "ready"
          ? "border-border bg-card"
          : "border-destructive bg-destructive/5"
      )}
    >
      <Icon
        className={cn(
          "hidden size-5 shrink-0 sm:block",
          headline.tone === "ready"
            ? "text-success-600 dark:text-success-400"
            : "text-destructive-700 dark:text-destructive"
        )}
        aria-hidden
      />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <p className="text-sm text-foreground">
          <strong className="font-semibold">{headline.lead}</strong>
          {headline.detail ? (
            <span className="text-muted-foreground"> {headline.detail}</span>
          ) : null}
        </p>
        <Progress
          value={headline.summary.ready}
          max={headline.summary.total}
          variant="success"
          className="h-1.5 w-full max-w-xs"
          aria-label={`${headline.summary.ready} of ${headline.summary.total} documents ready`}
        />
      </div>
      {firstProblemId ? (
        <Button
          variant="outline"
          size="sm"
          className="self-start sm:self-center"
          onClick={() => {
            const row = document.getElementById(firstProblemId);
            row?.scrollIntoView({ block: "center", behavior: "smooth" });
            row?.focus({ preventScroll: true });
          }}
        >
          Show the first to fix
        </Button>
      ) : null}
    </div>
  );
}

function DocumentGroup({
  release,
  group,
  names,
  problemsOf,
  readinessKnown,
  ahead,
  controls,
  firstProblemMemberId,
}: {
  release: Release;
  group: ReleaseDocumentGroup;
  names: ReleaseDocumentNames;
  problemsOf: (memberId: string) => MemberProblems;
  readinessKnown: RowReadiness;
  ahead: boolean;
  controls: MemberControls;
  firstProblemMemberId: string | undefined;
}) {
  const headingId = `release-group-${group.key.replace(/[^a-z0-9-]/gi, "-")}`;
  return (
    <div
      role="group"
      aria-labelledby={headingId}
      className="overflow-hidden rounded-lg border border-border bg-card"
    >
      <h3
        id={headingId}
        className="border-b border-border bg-muted/40 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
      >
        {group.heading}
        <span className="font-normal"> · {group.total}</span>
      </h3>
      <ul className="divide-y divide-border">
        {group.members.map(member => (
          <DocumentRow
            key={member.id}
            release={release}
            member={member}
            names={names}
            problems={problemsOf(member.id)}
            readinessKnown={readinessKnown}
            ahead={ahead}
            controls={controls}
            first={member.id === firstProblemMemberId}
          />
        ))}
        {group.hiddenLine ? (
          <li className="flex items-start gap-3 px-4 py-3 text-sm text-muted-foreground">
            {/* The icon stays beside the first line when the text wraps. */}
            <EyeOff className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
              <span>{group.hiddenLine}</span>
              {group.hiddenNeedFix > 0 ? (
                <span className="inline-flex items-center gap-1 font-medium text-destructive-700 dark:text-destructive">
                  <AlertCircle className="size-3.5 shrink-0" aria-hidden />
                  {describeUnshownNeedFix(group.hiddenNeedFix)}
                </span>
              ) : null}
            </span>
          </li>
        ) : null}
      </ul>
    </div>
  );
}

/** What a row is called, whether it can be opened, and where it stands. */
function rowNaming(member: ReleaseMember, names: ReleaseDocumentNames) {
  const info = names.documentOf(member);
  const pending = names.isPending(member.scopeSlug);
  const label = documentLabel(info, {
    pending,
    failed: names.isError(member.scopeSlug),
    singular: names.scopeNamesOf(member.scopeSlug)?.singular ?? "Document",
  });
  const edited = info?.updatedAt
    ? `edited ${relativeTime(Date.parse(info.updatedAt), Date.now())}`
    : null;
  return {
    label,
    // A document the read did not find is no longer there to open.
    openable: info !== undefined || pending,
    statusLine: [documentStatusLine(info), edited].filter(Boolean).join(" · "),
  };
}

/** The document's title, as a way to it where it can be opened. */
function DocumentTitle({
  member,
  label,
  openable,
  statusLine,
}: {
  member: ReleaseMember;
  label: DocumentLabel;
  openable: boolean;
  statusLine: string;
}) {
  return (
    <>
      {openable && !label.muted ? (
        <Link
          href={documentHref(member)}
          className="group inline-flex max-w-full items-center gap-1 font-medium text-foreground hover:underline"
        >
          <span className="truncate">{label.text}</span>
          <ExternalLink
            className="size-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
            aria-hidden
          />
        </Link>
      ) : (
        <span
          className={cn(
            "font-medium",
            label.muted ? "italic text-muted-foreground" : "text-foreground"
          )}
        >
          {label.text}
        </span>
      )}
      {statusLine ? (
        <p className="mt-0.5 text-xs text-muted-foreground">{statusLine}</p>
      ) : null}
    </>
  );
}

function DocumentRow({
  release,
  member,
  names,
  problems,
  readinessKnown,
  ahead,
  controls,
  first,
}: {
  release: Release;
  member: ReleaseMember;
  names: ReleaseDocumentNames;
  problems: MemberProblems;
  readinessKnown: RowReadiness;
  ahead: boolean;
  controls: MemberControls;
  first: boolean;
}) {
  const { label, openable, statusLine } = rowNaming(member, names);
  const [removing, setRemoving] = useState(false);
  const mayRemove =
    controls.remove.offered && controls.remove.disabledReason === null;

  return (
    <li
      id={first ? FIRST_PROBLEM_ID : undefined}
      tabIndex={first ? -1 : undefined}
      aria-label={label.text}
      className="flex flex-col gap-2 px-4 py-3 outline-none focus-visible:bg-muted/40 sm:flex-row sm:items-start sm:gap-4"
    >
      <div className="min-w-0 flex-1">
        <DocumentTitle
          member={member}
          label={label}
          openable={openable}
          statusLine={statusLine}
        />
        <ProblemList
          problems={problems.hard}
          tone="hard"
          member={member}
          onRemove={mayRemove ? () => setRemoving(true) : undefined}
        />
        <ProblemList problems={problems.soft} tone="soft" member={member} />
      </div>

      <div className="flex flex-wrap items-center gap-2 sm:shrink-0 sm:justify-end">
        <ActionControl
          release={release}
          member={member}
          title={label.text}
          mayChange={controls.switchAction}
        />
        {ahead ? (
          <ReadinessMark
            known={readinessKnown}
            ready={problems.hard.length === 0}
          />
        ) : null}
        <RowMenu
          member={member}
          title={label.text}
          openable={openable}
          controls={controls}
          onRemove={() => setRemoving(true)}
        />
      </div>

      {controls.remove.offered ? (
        <RemoveDialog
          release={release}
          member={member}
          title={label.text}
          cancelsRelease={controls.remove.cancelsRelease}
          open={removing}
          onOpenChange={setRemoving}
        />
      ) : null}
    </li>
  );
}

/**
 * A document's problems, or its notes, under its title, each with the way
 * out the page offers: open the document to fix it, or take it out.
 */
function ProblemList({
  problems,
  tone,
  member,
  onRemove,
}: {
  problems: ProblemWords[];
  tone: "hard" | "soft";
  member: ReleaseMember;
  /** Takes the document out, where the reader may. */
  onRemove?: () => void;
}) {
  if (problems.length === 0) return null;
  const Icon = tone === "hard" ? AlertCircle : Info;
  return (
    <ul className="mt-1.5 flex flex-col gap-1">
      {problems.map(problem => (
        <li
          key={problem.text}
          className={cn(
            "flex items-start gap-1.5 text-xs",
            tone === "hard"
              ? "text-destructive-700 dark:text-destructive"
              : "text-muted-foreground"
          )}
        >
          <Icon className="mt-px size-3.5 shrink-0" aria-hidden />
          <span>
            {problem.otherReleaseId ? (
              <Link
                href={buildRoute(ROUTES.RELEASES_DETAIL, {
                  id: problem.otherReleaseId,
                })}
                className="underline-offset-2 hover:underline"
              >
                {problem.text}
              </Link>
            ) : (
              problem.text
            )}
            {problem.remedy === "open" && tone === "hard" ? (
              <>
                {" · "}
                <Link
                  href={documentHref(member)}
                  className="font-medium underline underline-offset-2"
                >
                  Fix
                </Link>
              </>
            ) : null}
            {problem.remedy === "remove" && tone === "hard" && onRemove ? (
              <>
                {" · "}
                <button
                  type="button"
                  onClick={onRemove}
                  className="font-medium underline underline-offset-2"
                >
                  Remove it
                </button>
              </>
            ) : null}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** What a row knows of its readiness: the checks answered, are on their way, or failed. */
type RowReadiness = "known" | "pending" | "failed";

function rowReadiness(readiness: ReadinessState): RowReadiness {
  if (readiness.data !== undefined) return "known";
  return readiness.isError ? "failed" : "pending";
}

/**
 * Whether the document is ready, in a word and an icon; "Could not check",
 * as the releases list says it, when the checks failed.
 */
function ReadinessMark({
  known,
  ready,
}: {
  known: RowReadiness;
  ready: boolean;
}) {
  if (known === "pending") return <Skeleton className="h-5 w-16" />;
  if (known === "failed") {
    return (
      <span className="inline-flex min-w-[5.75rem] text-xs text-muted-foreground">
        Could not check
      </span>
    );
  }
  return ready ? (
    <span className="inline-flex min-w-[5.75rem] items-center gap-1 text-xs font-medium text-success-700 dark:text-success-400">
      <CheckCircle2 className="size-3.5" aria-hidden />
      Ready
    </span>
  ) : (
    <span className="inline-flex min-w-[5.75rem] items-center gap-1 text-xs font-medium text-destructive-700 dark:text-destructive">
      <AlertCircle className="size-3.5" aria-hidden />
      Needs a fix
    </span>
  );
}

/**
 * What the document does when the release runs, switchable between going
 * live and coming down by someone who may change the release's documents.
 */
function ActionControl({
  release,
  member,
  title,
  mayChange,
}: {
  release: Release;
  member: ReleaseMember;
  title: string;
  mayChange: boolean;
}) {
  const change = useChangeReleaseMemberAction(release.id);
  const Icon = member.action === "publish" ? Eye : EyeOff;
  const pill = (
    <>
      <Icon className="size-3.5" aria-hidden />
      {MEMBER_ACTION_LABEL[member.action]}
    </>
  );
  if (!mayChange) {
    return (
      <span className="inline-flex h-7 min-w-[7.5rem] items-center gap-1.5 rounded-md border border-border px-2 text-xs font-medium text-foreground">
        {pill}
      </span>
    );
  }
  return (
    <div className="flex flex-col items-start gap-1 sm:items-end">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="h-7 min-w-[7.5rem] justify-between gap-1.5 px-2 text-xs"
            disabled={change.isPending}
            aria-label={`${MEMBER_ACTION_LABEL[member.action]}: change what “${title}” does`}
          >
            {pill}
            <ChevronDown
              className="size-3.5 text-muted-foreground"
              aria-hidden
            />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel>When the release runs</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={member.action}
            onValueChange={value => {
              const action = value as ReleaseMemberAction;
              if (action !== member.action) {
                change.mutate({ memberId: member.id, action });
              }
            }}
          >
            <DropdownMenuRadioItem value="publish">
              Goes live
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="unpublish">
              Comes down
            </DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      {change.isError ? (
        <p
          role="alert"
          className="max-w-[16rem] text-xs text-destructive-700 dark:text-destructive"
        >
          {releaseErrorMessage(change.error, "It was not changed.")}
        </p>
      ) : null}
    </div>
  );
}

/** The row's menu: open the document, and take it out of the release. */
function RowMenu({
  member,
  title,
  openable,
  controls,
  onRemove,
}: {
  member: ReleaseMember;
  title: string;
  openable: boolean;
  controls: MemberControls;
  onRemove: () => void;
}) {
  const { remove } = controls;
  if (!openable && !remove.offered) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="ml-auto size-7 sm:ml-0"
          aria-label={`Actions for ${title}`}
        >
          <MoreHorizontal className="size-4" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-w-[18rem]">
        {openable ? (
          <DropdownMenuItem asChild>
            <Link href={documentHref(member)}>Open document</Link>
          </DropdownMenuItem>
        ) : null}
        {remove.offered ? (
          <RemoveMenuItem
            remove={remove}
            reasonId={`remove-reason-${member.id}`}
            separated={openable}
            onRemove={onRemove}
          />
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Taking the document out, as its menu offers it: drawn for a reader who may
 * change the release's documents, and held back, with the reason beside it,
 * where taking it out would cancel a release the reader may not cancel.
 */
function RemoveMenuItem({
  remove,
  reasonId,
  separated,
  onRemove,
}: {
  remove: MemberControls["remove"];
  reasonId: string;
  separated: boolean;
  onRemove: () => void;
}) {
  const reason = remove.disabledReason;
  return (
    <>
      {separated ? <DropdownMenuSeparator /> : null}
      <DropdownMenuItem
        onSelect={onRemove}
        disabled={reason !== null}
        aria-describedby={reason ? reasonId : undefined}
        className="flex-col items-start gap-0.5 text-destructive-700 dark:text-destructive"
      >
        {remove.cancelsRelease
          ? "Remove and cancel release…"
          : "Remove from release…"}
      </DropdownMenuItem>
      {reason ? (
        <p id={reasonId} className="px-2 pb-1.5 text-xs text-muted-foreground">
          {reason}
        </p>
      ) : null}
    </>
  );
}

/**
 * The confirmation before a document leaves the release. Held open while the
 * removal is failing, so a refusal is read by the person who asked for it.
 * Taking the only document out of a single-document release cancels the
 * release, and the confirmation says so before anything happens.
 */
function RemoveDialog({
  release,
  member,
  title,
  cancelsRelease,
  open,
  onOpenChange,
}: {
  release: Release;
  member: ReleaseMember;
  title: string;
  cancelsRelease: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const remove = useRemoveReleaseMember(release.id);
  return (
    <AlertDialog
      open={open || remove.isError}
      onOpenChange={next => {
        if (!next) remove.reset();
        onOpenChange(next);
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          {/* A title that names the document runs to two lines; the theme's
              snug leading keeps them apart where the shared style sets none. */}
          <AlertDialogTitle className="leading-snug">
            {cancelsRelease
              ? `Remove “${title}” and cancel this release?`
              : `Remove “${title}” from this release?`}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {cancelsRelease
              ? "This is a single-document release: it holds only this document. This cancels the release. It moves to Done as cancelled, and nothing in it goes live or comes down. The document itself is not changed."
              : "The document itself is not changed. It simply stops being part of what this release does."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {remove.isError ? (
          <p
            role="alert"
            className="text-sm text-destructive-700 dark:text-destructive"
          >
            {releaseErrorMessage(
              remove.error,
              "This document was not removed. It is still in the release."
            )}
          </p>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={remove.isPending}>
            Keep it
          </AlertDialogCancel>
          <Button
            variant="destructive"
            disabled={remove.isPending}
            onClick={() =>
              remove.mutate(member.id, { onSuccess: () => onOpenChange(false) })
            }
          >
            {remove.isPending
              ? "Removing…"
              : cancelsRelease
                ? "Remove and cancel release"
                : "Remove"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

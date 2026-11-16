"use client";

import type { DeclaredComponentProps } from "nextly/widget-result";
import type React from "react";
import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import * as Icons from "@admin/components/icons";
import {
  Badge,
  Button,
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@admin/components/ui";
import { Link } from "@admin/components/ui/link";
import { useNowTick } from "@admin/hooks/useNowTick";
import { cn } from "@admin/lib/utils";

import { useToastAboveFooter } from "../widgets/edit/useToastAboveFooter";
import {
  CARD_FOOTER_LINK_CLASS,
  CardFooterContent,
} from "../widgets/frame/footer-slot";

import { reportRuns } from "./report-runs";
import {
  healthSummary,
  pluginDetails,
  runtimeDetails,
  systemHealthFacts,
  type HealthAction,
  type HealthDetail,
  type HealthFact,
  type HealthSummary,
} from "./system-health-model";
import {
  useCopyDiagnostics,
  type CopyDiagnostics,
} from "./use-copy-diagnostics";

/**
 * System health, for super-admins: one status line, then the Nextly version,
 * the environment, the database, whether its connection is encrypted,
 * migrations, storage, email and background jobs; and "Copy diagnostics" and
 * "Details" at its foot. Details opens a drawer adding the runtime, the plugins
 * and the exact report "Copy diagnostics" copies.
 *
 * A declared widget's view: the frame draws loading and error, and this draws
 * every fact `load` answered, "Encrypted" and "Up to date" included, since
 * all well is an answer too. A fact's status is a word in a quiet chip with a
 * dot in its status's colour, so colour is never the only signal.
 *
 * A storage failure's age is derived from a ticking clock (`useNowTick`, as
 * the other relative-time cards do): widget batches do not poll, so without
 * it a failure drawn "just now" kept that wording while the card stayed open.
 */
export const SystemHealthCard: React.FC<DeclaredComponentProps> = ({
  data,
}) => {
  const now = useNowTick();
  const facts = useMemo(() => systemHealthFacts(data, now), [data, now]);
  const summary = useMemo(() => healthSummary(facts), [facts]);
  const [detailsOpen, setDetailsOpen] = useState(false);
  // A refused copy opens Details on the report it just read, so it is not read
  // again: the text the reader is asked to copy is the one selected.
  const showRefused = useCallback(() => setDetailsOpen(true), []);
  const diagnostics = useCopyDiagnostics(showRefused);
  const { load } = diagnostics;
  const onDetailsChange = useCallback(
    (open: boolean) => {
      setDetailsOpen(open);
      if (open) void load().catch(() => undefined);
    },
    [load]
  );
  return (
    <div data-testid="system-health" className="min-w-0">
      <StatusLine summary={summary} />
      <HealthFacts facts={facts} />
      <CardFooterContent>
        <CopyDiagnosticsButton
          diagnostics={diagnostics}
          className="mr-auto h-7 rounded-[7px] px-2.5 text-[12.5px]"
          variant="outline"
          testId="system-health-copy"
        />
        <button
          type="button"
          className={cn(CARD_FOOTER_LINK_CLASS, "cursor-pointer")}
          onClick={() => onDetailsChange(true)}
          data-testid="system-health-details-open"
        >
          Details
        </button>
      </CardFooterContent>
      <SystemDetails
        open={detailsOpen}
        onOpenChange={onDetailsChange}
        facts={facts}
        summary={summary}
        data={data}
        diagnostics={diagnostics}
      />
    </div>
  );
};

SystemHealthCard.displayName = "SystemHealthCard";

/** "Copy diagnostics": a button with the copy mark, busy while a copy is in flight. */
function CopyDiagnosticsButton({
  diagnostics,
  className,
  variant,
  testId,
}: {
  diagnostics: CopyDiagnostics;
  className?: string;
  variant: "outline" | "default";
  testId: string;
}) {
  const { copy, copying } = diagnostics;
  return (
    <Button
      type="button"
      size="sm"
      variant={variant}
      className={cn("shrink-0 gap-1.5", className)}
      onClick={() => void copy()}
      disabled={copying}
      aria-busy={copying || undefined}
      data-testid={testId}
    >
      <Icons.Copy aria-hidden className="size-3.5" />
      Copy diagnostics
    </Button>
  );
}

/** A status's solid dot, by the tone it is drawn in. */
const DOT_CLASS: Readonly<Record<HealthSummary["tone"], string>> = {
  success: "bg-success-solid",
  warning: "bg-warning-solid",
  destructive: "bg-danger-solid",
};

/** The one line that says whether anything is wrong, counted by the rule. */
function StatusLine({ summary }: { summary: HealthSummary }) {
  return (
    <p
      data-testid="system-health-status"
      data-tone={summary.tone}
      className="m-0 flex items-center gap-2 pt-0.5 pb-2 text-[13px] font-medium text-foreground"
    >
      <span
        aria-hidden="true"
        className={cn(
          "size-1.5 shrink-0 rounded-full",
          DOT_CLASS[summary.tone]
        )}
      />
      {summary.text}
    </p>
  );
}

/**
 * The facts as a two-column list: each name on the left, and on the right its
 * value, its chip and what to do. Rows are ruled between, not around.
 */
function HealthFacts({ facts }: { facts: readonly HealthFact[] }) {
  return (
    <dl
      data-testid="system-health-facts"
      className="m-0 grid min-w-0 grid-cols-[auto_minmax(0,1fr)] text-[13px] [&>*]:border-border [&>*:nth-child(n+3)]:border-t"
    >
      {facts.map(item => (
        <FactRow key={item.id} fact={item} />
      ))}
    </dl>
  );
}

/** One fact: its name, then its value, chip, note, detail and actions. */
function FactRow({ fact }: { fact: HealthFact }) {
  return (
    <Fragment>
      <dt className="py-[7px] whitespace-nowrap text-muted-foreground">
        {fact.label}
      </dt>
      <dd
        className="m-0 flex min-w-0 flex-wrap items-center justify-end gap-x-2 gap-y-1 py-[7px] pl-4 text-right"
        data-testid={`system-health-${fact.id}`}
      >
        <span
          data-testid="system-health-value"
          className={cn(
            "min-w-0 break-words",
            fact.unread ? "text-muted-foreground" : "text-foreground"
          )}
        >
          {fact.value}
        </span>
        {fact.note !== undefined && (
          <span className="text-xs text-muted-foreground">{fact.note}</span>
        )}
        {fact.chip !== undefined && (
          <Badge
            variant={fact.chip.tone}
            className="h-[22px] rounded-md px-2 font-normal"
            data-testid="system-health-chip"
          >
            {fact.chip.label}
          </Badge>
        )}
        {fact.actions.map(action => (
          <FactAction key={action.href} action={action} />
        ))}
        {fact.detail !== undefined && (
          <span
            className="w-full text-xs break-words text-muted-foreground"
            data-testid="system-health-detail"
          >
            {fact.detail}
          </span>
        )}
      </dd>
    </Fragment>
  );
}

/** A fact's action as a small button: the documentation in a new tab, or an admin page. */
function FactAction({ action }: { action: HealthAction }) {
  return (
    <Button
      asChild
      size="sm"
      variant="outline"
      className="h-7 shrink-0 rounded-md px-2.5 text-xs"
    >
      {action.external ? (
        <a href={action.href} target="_blank" rel="noopener noreferrer">
          {action.label}
        </a>
      ) : (
        <Link href={action.href}>{action.label}</Link>
      )}
    </Button>
  );
}

/**
 * Details: every fact of the card with its status line, then the runtime,
 * each plugin with its version, and the exact report "Copy diagnostics"
 * copies, in a drawer from the right, with "Copy diagnostics" at its foot.
 */
function SystemDetails({
  open,
  onOpenChange,
  facts,
  summary,
  data,
  diagnostics,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  facts: readonly HealthFact[];
  summary: HealthSummary;
  data: unknown;
  diagnostics: CopyDiagnostics;
}) {
  const runtime = runtimeDetails(data);
  const plugins = pluginDetails(data);
  const reportRef = useRef<HTMLPreElement>(null);
  // Toasts said while Details is open ("Diagnostics copied") stand above its footer, not over
  // the Copy diagnostics button there.
  const [footer, setFooter] = useState<HTMLDivElement | null>(null);
  useToastAboveFooter(footer);
  const { selectPending, selectRequest } = diagnostics;
  // A copy refused from Details' own button, with Details already open: the
  // report is selected again where it stands. Opening Details is handled
  // where the drawer gives its first focus, below.
  const wasOpen = useRef(open);
  useEffect(() => {
    const alreadyOpen = wasOpen.current;
    wasOpen.current = open;
    if (!open || !alreadyOpen || !selectPending.current) return;
    const pre = reportRef.current;
    if (pre === null) return;
    selectPending.current = false;
    selectContents(pre);
  }, [open, selectRequest, selectPending]);
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 overflow-hidden p-0 sm:w-[440px] sm:max-w-[440px]"
        data-testid="system-health-details"
        // Opened to show a refused report: the report is selected and takes
        // the focus the close button would, so Ctrl+C or ⌘C copies it. Done
        // here because the drawer's content is mounted by now.
        onOpenAutoFocus={event => {
          if (!selectPending.current) return;
          selectPending.current = false;
          const pre = reportRef.current;
          if (pre === null) return;
          event.preventDefault();
          selectContents(pre);
        }}
      >
        <div className="flex shrink-0 items-center gap-2.5 border-b border-border py-3 pr-3 pl-5">
          <SheetHeader className="min-w-0 flex-1 space-y-0.5 text-left">
            <SheetTitle className="truncate text-[15px] leading-5 font-semibold">
              System health
            </SheetTitle>
            <SheetDescription className="text-xs">
              For super-admins
            </SheetDescription>
          </SheetHeader>
          <SheetClose asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-8 shrink-0 text-muted-foreground hover:text-foreground"
              aria-label="Close"
            >
              <Icons.X aria-hidden className="size-4" />
            </Button>
          </SheetClose>
        </div>
        {/* The part that scrolls takes focus itself, so a keyboard alone can scroll through
            Details where nothing inside it can take focus (no action, and the report still
            being read). */}
        <div
          tabIndex={0}
          role="region"
          aria-label="System health details"
          className="flex min-h-0 flex-1 flex-col overflow-y-auto px-5 pt-4 pb-5 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
        >
          <DetailsSection title="Checks">
            <StatusLine summary={summary} />
            <HealthFacts facts={facts} />
          </DetailsSection>
          <DetailsSection title="Runtime">
            <DetailList items={runtime} testId="system-health-runtime" />
          </DetailsSection>
          <DetailsSection title={`Plugins (${plugins.length})`}>
            {plugins.length === 0 ? (
              <p className="m-0 text-[13px] text-muted-foreground">
                No plugins.
              </p>
            ) : (
              <DetailList items={plugins} testId="system-health-plugins" />
            )}
          </DetailsSection>
          <DetailsSection title={'What "Copy diagnostics" copies'}>
            <DiagnosticsReport
              report={diagnostics.report}
              reportRef={reportRef}
              onRetry={() => void diagnostics.load().catch(() => undefined)}
            />
            <p className="m-0 mt-2.5 text-[12.5px] text-muted-foreground">
              Never included: passwords, keys and tokens, connection addresses,
              host names, email addresses, people&apos;s names, entry content,
              or any environment variable&apos;s value.
            </p>
          </DetailsSection>
        </div>
        <div
          ref={setFooter}
          className="flex shrink-0 justify-end gap-2 border-t border-border px-5 py-3"
        >
          <CopyDiagnosticsButton
            diagnostics={diagnostics}
            variant="default"
            testId="system-health-details-copy"
          />
        </div>
      </SheetContent>
    </Sheet>
  );
}

/** Focuses `element` and selects all its text. */
function selectContents(element: HTMLElement): void {
  element.focus({ preventScroll: true });
  element.scrollIntoView?.({ block: "nearest" });
  const range = document.createRange();
  range.selectNodeContents(element);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

/**
 * The report as it is copied, in a monospace block; while it is first read, a
 * quiet line, and when it could not be built, a way to try again.
 */
function DiagnosticsReport({
  report,
  reportRef,
  onRetry,
}: {
  report: CopyDiagnostics["report"];
  reportRef: React.RefObject<HTMLPreElement | null>;
  onRetry: () => void;
}) {
  if (report.text !== undefined) {
    return (
      <pre
        ref={reportRef}
        tabIndex={-1}
        aria-label="Diagnostics report"
        aria-busy={report.status === "loading" || undefined}
        data-testid="system-health-report"
        className="m-0 rounded-lg border border-border bg-background px-3 py-2.5 font-mono text-[11.5px] leading-[1.55] break-words whitespace-pre-wrap text-foreground focus:outline-2 focus:outline-offset-2 focus:outline-primary"
      >
        <ReportLines text={report.text} />
      </pre>
    );
  }
  if (report.status === "failed") {
    return (
      <p
        className="m-0 text-[13px] text-muted-foreground"
        data-testid="system-health-report-failed"
      >
        Couldn&apos;t build the report.{" "}
        <button
          type="button"
          className={cn(CARD_FOOTER_LINK_CLASS, "cursor-pointer text-[13px]")}
          onClick={onRetry}
        >
          Try again
        </button>
      </p>
    );
  }
  return (
    <p
      className="m-0 text-[13px] text-muted-foreground"
      role="status"
      data-testid="system-health-report-loading"
    >
      Building the report…
    </p>
  );
}

/**
 * The report's text, line by line, with each phrase that reads as one fact
 * ("24 h", "3 locales (en, es, ar)") kept on one line where the block wraps
 * (`reportRuns`). The text is the report's own, character for character, so
 * selecting and copying it gives exactly what "Copy diagnostics" copies.
 */
function ReportLines({ text }: { text: string }) {
  return text.split("\n").map((line, index) => (
    <Fragment key={index}>
      {index > 0 && "\n"}
      {reportRuns(line).map((run, at) =>
        run.whole ? (
          <span key={at} className="whitespace-nowrap">
            {run.text}
          </span>
        ) : (
          run.text
        )
      )}
    </Fragment>
  ));
}

/** A section of Details: a small heading, ruled from the one before. */
function DetailsSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="[&+&]:mt-4 [&+&]:border-t [&+&]:border-border [&+&]:pt-4">
      <h4 className="m-0 mb-2.5 text-xs font-semibold tracking-[.02em] text-muted-foreground">
        {title}
      </h4>
      {children}
    </section>
  );
}

/** Names and values in the facts' two-column form. */
function DetailList({
  items,
  testId,
}: {
  items: readonly HealthDetail[];
  testId: string;
}) {
  return (
    <dl
      data-testid={testId}
      className="m-0 grid min-w-0 grid-cols-[auto_minmax(0,1fr)] text-[13px] [&>*]:border-border [&>*:nth-child(n+3)]:border-t"
    >
      {items.map(item => (
        <Fragment key={item.name}>
          <dt className="py-[7px] text-muted-foreground">{item.name}</dt>
          <dd className="m-0 py-[7px] pl-4 text-right break-words text-foreground">
            {item.value}
          </dd>
        </Fragment>
      ))}
    </dl>
  );
}

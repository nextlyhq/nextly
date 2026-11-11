"use client";

import type { DeclaredComponentProps } from "nextly/widget-result";
import type React from "react";
import { Fragment, useMemo, useState } from "react";

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

import {
  CARD_FOOTER_LINK_CLASS,
  CardFooterContent,
} from "../widgets/frame/footer-slot";

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

/**
 * System health, for super-admins: one status line, then the Nextly version,
 * the environment, the database, whether its connection is encrypted,
 * migrations, storage, email and background jobs; and "Details" at its foot,
 * which opens a drawer adding the runtime and the plugins.
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
  return (
    <div data-testid="system-health" className="min-w-0">
      <StatusLine summary={summary} />
      <HealthFacts facts={facts} />
      <CardFooterContent>
        <button
          type="button"
          className={cn(CARD_FOOTER_LINK_CLASS, "cursor-pointer")}
          onClick={() => setDetailsOpen(true)}
          data-testid="system-health-details-open"
        >
          Details
        </button>
      </CardFooterContent>
      <SystemDetails
        open={detailsOpen}
        onOpenChange={setDetailsOpen}
        facts={facts}
        summary={summary}
        data={data}
      />
    </div>
  );
};

SystemHealthCard.displayName = "SystemHealthCard";

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
 * Details: every fact of the card with its status line, then the runtime and
 * each plugin with its version, in a drawer from the right.
 */
function SystemDetails({
  open,
  onOpenChange,
  facts,
  summary,
  data,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  facts: readonly HealthFact[];
  summary: HealthSummary;
  data: unknown;
}) {
  const runtime = runtimeDetails(data);
  const plugins = pluginDetails(data);
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 overflow-hidden p-0 sm:w-[440px] sm:max-w-[440px]"
        data-testid="system-health-details"
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
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-5 pt-4 pb-5">
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
        </div>
      </SheetContent>
    </Sheet>
  );
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

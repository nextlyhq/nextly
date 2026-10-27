"use client";

import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
} from "@nextlyhq/ui";
import type { JSX } from "react";
import { useMemo, useState } from "react";

import {
  ArrowUp,
  Code,
  Globe,
  Info,
  Mail,
  Puzzle,
  Search,
} from "@admin/components/icons";
import { Link } from "@admin/components/ui/link";
import { EMAIL_DELIVERIES_READ_PERMISSION } from "@admin/constants/email-hub";
import { useEmailTemplates } from "@admin/hooks/queries/useEmailTemplates";
import { useCurrentUserPermissions } from "@admin/hooks/useCurrentUserPermissions";
import { formatRelativeTime } from "@admin/lib/dashboard";
import type { EmailTemplateRecord } from "@admin/services/emailTemplateApi";

import { TemplateActionsMenu } from "../TemplateActionsMenu";
import {
  editRouteFor,
  useTemplateActions,
  type TemplateAction,
} from "../useTemplateActions";

import {
  KEPT_HELP,
  KEPT_LABEL,
  STATE_FILTER_LABELS,
  STATE_HELP,
  STATE_LABELS,
  groupByOwner,
  isMessage,
  matchesQuery,
  ownerGroupOf,
  stateOf,
  compareGroups,
  type MessageGroup,
  type MessagesQuery,
  type OwnerGroup,
  type StateFilter,
} from "./messages-model";

const STATE_FILTERS = Object.keys(STATE_FILTER_LABELS) as StateFilter[];

/**
 * The state badge, with Off beside it when the email won't be sent and Kept
 * as before when it still sends as the previous engine did. A site's own
 * email that is on says nothing more than the badges beside it already do.
 */
function StateBadges({ record }: { record: EmailTemplateRecord }) {
  const state = stateOf(record);
  const off = !record.isActive;
  const kept = Boolean(record.keptOnOldEngine);
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      {off && (
        <Badge variant="outline" title="Not sent until it's turned on.">
          Off
        </Badge>
      )}
      {kept && (
        <Badge variant="warning" title={KEPT_HELP}>
          {KEPT_LABEL}
        </Badge>
      )}
      {!(state === "own" && (off || kept)) && (
        <Badge
          variant={
            state === "update"
              ? "warning"
              : state === "own"
                ? "success"
                : state === "customised"
                  ? "outline"
                  : "default"
          }
          title={STATE_HELP[state]}
        >
          {state === "update" && <ArrowUp className="h-3 w-3" />}
          {STATE_LABELS[state]}
        </Badge>
      )}
    </span>
  );
}

function GroupIcon({ group }: { group: OwnerGroup }) {
  const className = "h-3.5 w-3.5";
  if (group.key === "core") return <Mail className={className} />;
  if (group.key === "site") return <Globe className={className} />;
  return <Puzzle className={className} />;
}

function EmailName({
  record,
  canOpen,
}: {
  record: EmailTemplateRecord;
  canOpen: boolean;
}) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      {canOpen ? (
        <Link
          href={editRouteFor(record)}
          className="font-medium text-foreground hover:underline"
        >
          {record.name}
        </Link>
      ) : (
        <span className="font-medium">{record.name}</span>
      )}
      {record.setInCode && (
        <Badge variant="outline" title="A version is set in the site's code">
          <Code className="h-3 w-3" />
          Set in code
        </Badge>
      )}
    </div>
  );
}

function LastSent({ value }: { value: string | null | undefined }) {
  if (!value) return <span className="text-muted-foreground">Never</span>;
  return (
    <span className="tabular-nums" title={new Date(value).toLocaleString()}>
      {formatRelativeTime(value)}
    </span>
  );
}

interface ViewProps {
  groups: MessageGroup[];
  showLastSent: boolean;
  canOpen: boolean;
  actionsFor: (record: EmailTemplateRecord) => TemplateAction[];
}

/** From tablet width up: one table, a heading row per owner. */
function MessagesTable({
  groups,
  showLastSent,
  canOpen,
  actionsFor,
}: ViewProps) {
  return (
    <div className="hidden overflow-hidden rounded-lg border border-border bg-card md:block">
      <table className="w-full table-fixed text-sm" aria-label="Emails">
        <thead>
          <tr className="border-b border-border text-left text-xs uppercase tracking-wider text-muted-foreground">
            <th scope="col" className="px-4 py-3 font-medium">
              Email
            </th>
            <th
              scope="col"
              className="hidden w-[28%] px-4 py-3 font-medium lg:table-cell"
            >
              Sent when
            </th>
            <th scope="col" className="w-[22%] px-4 py-3 font-medium">
              State
            </th>
            {showLastSent && (
              <th scope="col" className="w-[14%] px-4 py-3 font-medium">
                Last sent
              </th>
            )}
            <th scope="col" className="w-14 px-2 py-3">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        {groups.map(({ group, rows }) => (
          <tbody key={group.key}>
            <tr className="border-b border-border bg-muted/50">
              <th
                scope="colgroup"
                colSpan={showLastSent ? 5 : 4}
                className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground"
              >
                <span className="flex items-center gap-2">
                  <GroupIcon group={group} />
                  {group.label} · {rows.length}
                </span>
              </th>
            </tr>
            {rows.map(record => (
              <tr
                key={record.id}
                className="border-b border-border last:border-b-0"
              >
                <td className="px-4 py-3 align-top">
                  <EmailName record={record} canOpen={canOpen} />
                  <div className="mt-0.5 truncate font-mono text-xs text-muted-foreground">
                    {record.slug}
                  </div>
                </td>
                <td className="hidden px-4 py-3 align-top text-muted-foreground lg:table-cell">
                  {record.description ?? "—"}
                </td>
                <td className="px-4 py-3 align-top">
                  <StateBadges record={record} />
                </td>
                {showLastSent && (
                  <td className="px-4 py-3 align-top">
                    <LastSent value={record.lastSentAt} />
                  </td>
                )}
                <td className="px-2 py-2 text-right align-top">
                  <TemplateActionsMenu
                    name={record.name}
                    actions={actionsFor(record)}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        ))}
      </table>
    </div>
  );
}

/** At phone width: a card per email carrying the same information. */
function MessagesCards({
  groups,
  showLastSent,
  canOpen,
  actionsFor,
}: ViewProps) {
  return (
    <div className="space-y-3 md:hidden">
      {groups.map(({ group, rows }) => (
        <section key={group.key} aria-label={group.label} className="space-y-2">
          <h3 className="flex items-center gap-2 px-0.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            <GroupIcon group={group} />
            {group.label} · {rows.length}
          </h3>
          {rows.map(record => (
            <article
              key={record.id}
              className="space-y-2 rounded-lg border border-border bg-card p-4"
            >
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <EmailName record={record} canOpen={canOpen} />
                  <div className="mt-0.5 break-all font-mono text-xs text-muted-foreground">
                    {record.slug}
                  </div>
                </div>
                <TemplateActionsMenu
                  name={record.name}
                  actions={actionsFor(record)}
                />
              </div>
              {record.description && (
                <p className="text-sm text-muted-foreground">
                  {record.description}
                </p>
              )}
              <div className="flex flex-wrap items-center gap-2">
                <StateBadges record={record} />
                {showLastSent && (
                  <span className="ml-auto text-xs text-muted-foreground">
                    Last sent <LastSent value={record.lastSentAt} />
                  </span>
                )}
              </div>
            </article>
          ))}
        </section>
      ))}
    </div>
  );
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/**
 * Messages: every email the site sends, grouped by who owns it.
 *
 * Each row names the email, says when it is sent and what state it is in,
 * and, for someone who may read deliveries, when it was last sent. Above the
 * list, notices name the emails waiting on someone: an owner's update to
 * review, and emails kept as the previous engine sent them.
 */
export function MessagesList(): JSX.Element {
  const {
    data: templates = [],
    isLoading,
    isError,
    error,
  } = useEmailTemplates();
  const { hasPermission } = useCurrentUserPermissions();
  const { actionsFor, canOpen, dialogs } = useTemplateActions();
  const [query, setQuery] = useState<MessagesQuery>({
    search: "",
    owner: "all",
    state: "all",
  });

  const messages = useMemo(() => templates.filter(isMessage), [templates]);
  const owners = useMemo(() => {
    const seen = new Map<string, OwnerGroup>();
    for (const record of messages) {
      const group = ownerGroupOf(record.owner);
      seen.set(group.key, group);
    }
    return [...seen.values()].sort(compareGroups);
  }, [messages]);
  const groups = useMemo(
    () => groupByOwner(messages.filter(record => matchesQuery(record, query))),
    [messages, query]
  );

  // Shown to a reader who may read deliveries, once the list reports it.
  const showLastSent =
    hasPermission(EMAIL_DELIVERIES_READ_PERMISSION) &&
    messages.some(record => record.lastSentAt !== undefined);

  const updates = messages.filter(record => stateOf(record) === "update");
  const kept = messages.filter(record => record.keptOnOldEngine);

  if (isError) {
    return (
      <Alert variant="destructive">
        <AlertDescription>
          {error?.message ?? "Failed to load emails. Please try again."}
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-4">
      {updates.length > 0 && (
        <Alert>
          <ArrowUp className="h-4 w-4" />
          <AlertTitle>
            {plural(updates.length, "email has", "emails have")} an update from
            its owner
          </AlertTitle>
          <AlertDescription className="flex flex-col items-start gap-3">
            <span>
              {updates.map(record => record.name).join(", ")} changed since you
              customised {updates.length === 1 ? "it" : "them"}.
            </span>
            <Button
              variant="outline"
              size="sm"
              // Clears the search and owner too: the notice promises these
              // emails, and a filter set earlier could hide them.
              onClick={() =>
                setQuery({ search: "", owner: "all", state: "update" })
              }
            >
              Show {updates.length === 1 ? "it" : "them"}
            </Button>
          </AlertDescription>
        </Alert>
      )}
      {kept.length > 0 && (
        <Alert>
          <Info className="h-4 w-4" />
          <AlertTitle>
            {plural(kept.length, "email is", "emails are")} kept as{" "}
            {kept.length === 1 ? "it was" : "they were"}
          </AlertTitle>
          <AlertDescription className="flex flex-col items-start gap-3">
            <span>
              {kept.map(record => record.name).join(", ")}{" "}
              {kept.length === 1 ? "holds" : "hold"} text the previous engine
              sent as written, and {kept.length === 1 ? "keeps" : "keep"}{" "}
              sending exactly as before until someone changes those lines.
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                setQuery({ search: "", owner: "all", state: "kept" })
              }
            >
              Show {kept.length === 1 ? "it" : "them"}
            </Button>
          </AlertDescription>
        </Alert>
      )}

      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            value={query.search}
            onChange={event =>
              setQuery(q => ({ ...q, search: event.target.value }))
            }
            placeholder="Search emails by name or what sends them"
            aria-label="Search emails"
            className="pl-9"
          />
        </div>
        <div className="grid grid-cols-2 gap-2 sm:flex">
          <Select
            value={query.owner}
            onValueChange={owner => setQuery(q => ({ ...q, owner }))}
          >
            <SelectTrigger className="sm:w-44" aria-label="Owner">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All owners</SelectItem>
              {owners.map(owner => (
                <SelectItem key={owner.key} value={owner.key}>
                  {owner.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={query.state}
            onValueChange={state =>
              setQuery(q => ({ ...q, state: state as StateFilter }))
            }
          >
            <SelectTrigger className="sm:w-44" aria-label="State">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STATE_FILTERS.map(state => (
                <SelectItem key={state} value={state}>
                  {STATE_FILTER_LABELS[state]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {isLoading ? (
        <div className="rounded-lg border border-border bg-card p-4">
          <Skeleton className="h-50 w-full rounded-lg" />
        </div>
      ) : groups.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          {messages.length === 0
            ? "No emails yet. Create one to get started."
            : "No emails match the search and filters."}
        </div>
      ) : (
        <>
          <MessagesTable
            groups={groups}
            showLastSent={showLastSent}
            canOpen={canOpen}
            actionsFor={actionsFor}
          />
          <MessagesCards
            groups={groups}
            showLastSent={showLastSent}
            canOpen={canOpen}
            actionsFor={actionsFor}
          />
        </>
      )}

      {dialogs}
    </div>
  );
}

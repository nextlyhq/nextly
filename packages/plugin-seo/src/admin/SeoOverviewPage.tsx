/**
 * The SEO section's Overview, where the section opens: a setup checklist
 * worked out from what the plugin stores, the site's search health, how its
 * public pages stand, the addresses not found lately, and the optional
 * connections.
 *
 * Drawn only from the admin's own parts (`PageFrame`, `PageHeader`,
 * `Breadcrumbs`, `Card`, `Checklist`, `Stat`, `Button`), so
 * it looks like the rest of the admin. Each card reads its own route and
 * says for itself when that read fails, so one that cannot be read never
 * takes the rest of the page with it.
 *
 * @module admin/SeoOverviewPage
 */
import {
  apiErrorMessage,
  Button,
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Checklist,
  ChecklistItem,
  navigateTo,
  PageFrame,
  PageHeader,
  Stat,
  toastMutationResult,
  usePluginRoute,
  usePluginRouteMutation,
} from "@nextlyhq/plugin-sdk/admin";
import { useEffect, useId, useMemo, type JSX, type ReactNode } from "react";

import {
  ADDRESSES_ROUTE_PATH,
  coverageOf,
  PAGES_PAGE_HREF,
  type SiteAddress,
} from "../code-pages/contract";
import { CONNECTIONS_ROUTE_PATH } from "../connections/contract";
import type { ConnectionsBody } from "../connections/contract";
import {
  CHECKLIST_ROUTE_PATH,
  checklistItemText,
  indexNowConnection,
  recentNotFound,
  redirectsConnection,
  searchConsoleConnection,
  type ChecklistBody,
  type ChecklistVisibility,
  type ConnectionLine,
} from "../overview/contract";
import {
  problemsHref,
  severityCounts,
  SEVERITY_ORDER,
  type ProblemSeverity,
} from "../problems/contract";
import {
  newRedirectHref,
  NOT_FOUND_TAB_HREF,
  REDIRECT_ROUTES,
  type NotFoundView,
  type ProxyStatus,
} from "../redirects/contract";
import { SEO_PLUGIN_NAME, SETTINGS_PAGE_HREF } from "../settings/contract";

import { useCheckedProblemList, type CheckedProblemList } from "./problem-list";
import { AdminLink, SeoTrail } from "./section";

/** A list route's answer. */
interface ListBody<T> {
  items: T[];
}

/** A read's three states, as each card draws them. */
function ReadState({
  what,
  pending,
  error,
  children,
}: {
  what: string;
  pending: boolean;
  error: Error | null;
  children: () => ReactNode;
}): JSX.Element {
  if (error !== null) {
    return (
      <p className="text-sm text-danger-text" role="alert">
        {`${what} could not be read. ${apiErrorMessage(error)}`}
      </p>
    );
  }
  if (pending) {
    return (
      <p className="text-sm text-muted-foreground" role="status">
        Loading…
      </p>
    );
  }
  return <>{children()}</>;
}

/** One line of a card: a name, and its number or link on the right. */
function Line({
  name,
  end,
  truncate = false,
}: {
  name: ReactNode;
  end: ReactNode;
  /** Cut a long name to one line, as an address is; others wrap. */
  truncate?: boolean;
}): JSX.Element {
  return (
    <li className="flex items-center justify-between gap-2 text-sm">
      <span className={truncate ? "min-w-0 truncate" : "min-w-0 break-words"}>
        {name}
      </span>
      <span className="shrink-0">{end}</span>
    </li>
  );
}

/** A link written as part of a line's text, underlined so colour is never its only sign. */
function TextLink({
  href,
  className,
  children,
}: {
  href: string;
  className?: string;
  children: ReactNode;
}): JSX.Element {
  return (
    <AdminLink
      href={href}
      className={`text-sm font-medium underline underline-offset-4 ${className ?? "text-foreground"}`}
    >
      {children}
    </AdminLink>
  );
}

/**
 * One of the four small cards: a region named by its title, which is its
 * heading, or, while the card leads with a figure, the `Stat`'s label drawn
 * above it. A card whose figure is not drawn (still loading, or its read
 * failed) shows its title as the heading instead, so it always says what it
 * is.
 */
function SmallCard({
  title,
  leadsWithStat = false,
  children,
  footer,
}: {
  title: string;
  leadsWithStat?: boolean;
  children: ReactNode;
  footer?: ReactNode;
}): JSX.Element {
  const id = useId();
  return (
    <Card>
      <CardContent className="flex h-full flex-col gap-3">
        <section
          {...(leadsWithStat
            ? { "aria-label": title }
            : { "aria-labelledby": id })}
          className="flex flex-1 flex-col gap-3"
        >
          {leadsWithStat ? null : (
            <h2 id={id} className="text-sm font-semibold text-muted-foreground">
              {title}
            </h2>
          )}
          {children}
          {footer === undefined ? null : (
            <div className="mt-auto text-sm">{footer}</div>
          )}
        </section>
      </CardContent>
    </Card>
  );
}

/**
 * Whether this admin session has sent the reader on to setup already. A
 * read cached before setup was answered still says it waits, so the reader
 * is sent at most once until the admin loads again, when the read is fresh.
 */
let sentToSetup = false;

/** First-time setup still waits: the first visit is sent on to it. */
function useSetupFirst(checklist: ChecklistBody | undefined): void {
  const waiting = checklist?.setupWaiting === true;
  useEffect(() => {
    if (!waiting || sentToSetup) return;
    sentToSetup = true;
    navigateTo(SETTINGS_PAGE_HREF, { replace: true });
  }, [waiting]);
}

/** Hiding and showing the checklist, for everyone who opens the Overview. */
interface ChecklistVisibilityWrite {
  set: (hidden: boolean) => Promise<void>;
  pending: boolean;
  error: Error | null;
}

function useChecklistVisibility(): ChecklistVisibilityWrite {
  const write = usePluginRouteMutation<ChecklistVisibility, object>({
    plugin: SEO_PLUGIN_NAME,
    path: CHECKLIST_ROUTE_PATH,
    method: "POST",
    invalidates: [CHECKLIST_ROUTE_PATH],
  });
  return {
    set: async hidden => {
      const answer = await write.write({ hidden });
      if (answer !== undefined) {
        toastMutationResult(
          hidden ? "Setup checklist hidden" : "Setup checklist shown",
          undefined
        );
      }
    },
    pending: write.pending,
    error: write.error,
  };
}

/**
 * The header's way back to a hidden checklist, with its progress, until
 * every step is done; nothing while the checklist shows, or once it is done.
 */
function ShowSetup({
  checklist,
  visibility,
}: {
  checklist: ChecklistBody | undefined;
  visibility: ChecklistVisibilityWrite;
}): JSX.Element | null {
  if (checklist?.hidden !== true) return null;
  const total = checklist.items.length;
  const done = checklist.items.filter(item => item.done).length;
  if (done >= total) return null;
  return (
    <Button
      type="button"
      variant="outline"
      disabled={visibility.pending}
      onClick={() => void visibility.set(false)}
    >
      {`Show setup · ${done} of ${total}`}
    </Button>
  );
}

/** The setup checklist, with its progress and the way to hide it. */
function SetupCard({
  checklist,
  pending,
  error,
  visibility,
}: {
  checklist: ChecklistBody | undefined;
  pending: boolean;
  error: Error | null;
  visibility: ChecklistVisibilityWrite;
}): JSX.Element {
  const titleId = useId();
  const items = checklist?.items ?? [];
  const done = items.filter(item => item.done).length;
  return (
    <Card>
      <section aria-labelledby={titleId}>
        <CardHeader noBorder className="flex-row items-start gap-4">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <CardTitle id={titleId} className="text-base">
              Set up SEO
            </CardTitle>
            {checklist === undefined ? null : (
              <CardDescription>{`${done} of ${items.length} done`}</CardDescription>
            )}
          </div>
          {checklist === undefined ? null : (
            <CardAction>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={visibility.pending}
                onClick={() => void visibility.set(true)}
              >
                Hide
              </Button>
            </CardAction>
          )}
        </CardHeader>
        <CardContent className="pt-0">
          <ReadState what="The setup checklist" pending={pending} error={error}>
            {() => (
              // Two columns where the card is wide enough, each done step
              // crossed off.
              <Checklist
                label="Setup steps"
                done={done}
                total={items.length}
                columns={2}
                doneStyle="struck"
              >
                {items.map(item => {
                  const text = checklistItemText(item);
                  return (
                    <ChecklistItem
                      key={item.id}
                      status={item.done ? "done" : "open"}
                      label={text.label}
                      actions={
                        item.done ? undefined : (
                          <TextLink href={text.href}>{text.action}</TextLink>
                        )
                      }
                    />
                  );
                })}
              </Checklist>
            )}
          </ReadState>
          {visibility.error === null ? null : (
            <p className="mt-2 text-sm text-danger-text" role="alert">
              {apiErrorMessage(visibility.error)}
            </p>
          )}
        </CardContent>
      </section>
    </Card>
  );
}

/**
 * Each severity's name on the health card, and the text colour its count is
 * written in while there is any: a number in its severity's colour reads
 * quieter than a chip, and the name beside it says what it counts, so colour
 * is never the only sign. A count of none is muted whatever its severity.
 */
const SEVERITY_TEXT: Record<ProblemSeverity, { name: string; count: string }> =
  {
    error: { name: "Errors", count: "text-danger-text" },
    warning: { name: "Warnings", count: "text-warning-text" },
    notice: { name: "Notices", count: "text-muted-foreground" },
  };

/** The site's search health: a verdict, and how many of each severity. */
function HealthCard({ checked }: { checked: CheckedProblemList }): JSX.Element {
  const { list, failed, checking } = checked;
  // A list never checked whole, or due a check, is no measure of the site:
  // the check this screen asks for is waited on rather than read as healthy.
  const unchecked =
    list !== undefined && (list.checkedAt === undefined || list.due);
  // The verdict is drawn only for a list checked whole.
  const drawsVerdict = list !== undefined && !unchecked;
  return (
    <SmallCard title="Search health" leadsWithStat={drawsVerdict}>
      <ReadState
        what="The problem list"
        pending={list === undefined && failed === null}
        error={list === undefined ? failed : null}
      >
        {() => {
          if (list === undefined) return null;
          if (unchecked && (checking || failed === null)) {
            return (
              <p className="text-sm text-muted-foreground" role="status">
                Checking the site…
              </p>
            );
          }
          if (unchecked) {
            return (
              <p className="text-sm text-danger-text" role="alert">
                {`The site hasn't been checked yet. ${apiErrorMessage(failed)}`}
              </p>
            );
          }
          const counts = severityCounts(list.problems);
          const good = counts.error + counts.warning === 0;
          return (
            <>
              <Stat
                label="Search health"
                value={good ? "Good" : "Should improve"}
                tone={good ? "success" : "warning"}
                size="compact"
              />
              <ul className="flex flex-col gap-2">
                {SEVERITY_ORDER.map(severity => (
                  <Line
                    key={severity}
                    name={
                      <TextLink href={problemsHref(severity)}>
                        {SEVERITY_TEXT[severity].name}
                      </TextLink>
                    }
                    end={
                      <span
                        className={`font-semibold ${
                          counts[severity] === 0
                            ? "text-muted-foreground"
                            : SEVERITY_TEXT[severity].count
                        }`}
                      >
                        {counts[severity]}
                      </span>
                    }
                  />
                ))}
              </ul>
            </>
          );
        }}
      </ReadState>
    </SmallCard>
  );
}

/** How the site's public pages stand, as the Pages list counts them. */
function PagesCard(): JSX.Element {
  const pages = usePluginRoute<ListBody<SiteAddress>>({
    plugin: SEO_PLUGIN_NAME,
    path: ADDRESSES_ROUTE_PATH,
    staleTime: 0,
  });
  const coverage = useMemo(
    () => coverageOf(pages.data?.items ?? []),
    [pages.data]
  );
  return (
    <SmallCard
      title="Pages"
      leadsWithStat={!pages.pending && pages.error === null}
    >
      <ReadState what="The pages" pending={pages.pending} error={pages.error}>
        {() => (
          <>
            <Stat
              label="Pages"
              value={`${coverage.total} public ${coverage.total === 1 ? "page" : "pages"}`}
              size="compact"
            />
            <ul className="flex flex-col gap-2">
              <Line name="Hidden from search" end={<b>{coverage.hidden}</b>} />
              <Line
                name="Both set for the page"
                end={<b>{coverage.bothSet}</b>}
              />
              <Line
                name="Both worked out"
                end={<b>{coverage.bothWorkedOut}</b>}
              />
              <Line name="One of each" end={<b>{coverage.oneOfEach}</b>} />
              {coverage.seoOff === 0 ? null : (
                // Their pages get nothing from the plugin, so they are
                // counted apart and listed in Pages, marked SEO off.
                <Line
                  name={
                    <TextLink href={`${PAGES_PAGE_HREF}?status=seo-off`}>
                      Pages with SEO off
                    </TextLink>
                  }
                  end={<b>{coverage.seoOff}</b>}
                />
              )}
            </ul>
            <p className="text-xs text-muted-foreground">
              &ldquo;Set&rdquo; means typed for the page or given by its code.
            </p>
          </>
        )}
      </ReadState>
    </SmallCard>
  );
}

/** The addresses not found lately, each one click from a redirect. */
function NotFoundCard(): JSX.Element {
  const missing = usePluginRoute<ListBody<NotFoundView>>({
    plugin: SEO_PLUGIN_NAME,
    path: REDIRECT_ROUTES.notFound,
    staleTime: 0,
  });
  return (
    <SmallCard
      title="Not found, last 7 days"
      footer={
        <TextLink href={NOT_FOUND_TAB_HREF} className="text-muted-foreground">
          All not found
        </TextLink>
      }
    >
      <ReadState
        what="The addresses not found"
        pending={missing.pending}
        error={missing.error}
      >
        {() => {
          const rows = recentNotFound(missing.data?.items ?? []);
          if (rows.length === 0) {
            return (
              <p className="text-sm text-muted-foreground">
                No addresses not found in the last 7 days.
              </p>
            );
          }
          return (
            <ul className="flex flex-col gap-2">
              {rows.map(row => (
                <Line
                  key={row.id}
                  truncate
                  name={
                    <span className="font-mono" title={row.path}>
                      {row.path}
                    </span>
                  }
                  end={
                    <TextLink href={newRedirectHref(row.from, row.suggestion)}>
                      <span aria-hidden="true">Redirect</span>
                      <span className="sr-only">{`Redirect ${row.path}`}</span>
                    </TextLink>
                  }
                />
              ))}
            </ul>
          );
        }}
      </ReadState>
    </SmallCard>
  );
}

/** The colour a connection's standing is written in. */
const STANDING_TEXT: Record<ConnectionLine["standing"], string> = {
  connected: "text-success-text",
  "not-connected": "text-muted-foreground",
  failing: "text-danger-text",
};

/** One connection's line: its name, and its standing linking to its settings. */
function ConnectionRow({ line }: { line: ConnectionLine }): JSX.Element {
  return (
    <Line
      name={line.name}
      end={
        line.href === undefined ? (
          <span className={`font-medium ${STANDING_TEXT[line.standing]}`}>
            {line.text}
          </span>
        ) : (
          <TextLink href={line.href} className={STANDING_TEXT[line.standing]}>
            {line.text}
          </TextLink>
        )
      }
    />
  );
}

/** A line whose state could not be read, said in its own place. */
function UnreadRow({ name }: { name: string }): JSX.Element {
  return (
    <Line
      name={name}
      end={<span className="text-muted-foreground">Couldn&apos;t check</span>}
    />
  );
}

/** Search Console, IndexNow and the site's Proxy, each read on its own. */
function ConnectionsCard(): JSX.Element {
  const connections = usePluginRoute<ConnectionsBody>({
    plugin: SEO_PLUGIN_NAME,
    path: CONNECTIONS_ROUTE_PATH,
    staleTime: 0,
  });
  const proxy = usePluginRoute<ProxyStatus>({
    plugin: SEO_PLUGIN_NAME,
    path: REDIRECT_ROUTES.proxy,
    staleTime: 0,
  });
  // A read that failed is said, even over an earlier answer it would show.
  const read = connections.error === null ? connections.data : undefined;
  const proxyRead = proxy.error === null ? proxy.data : undefined;
  return (
    <SmallCard
      title="Connections"
      footer={
        <TextLink
          href={`${SETTINGS_PAGE_HREF}?tab=connections`}
          className="text-muted-foreground"
        >
          Manage connections
        </TextLink>
      }
    >
      <ul className="flex flex-col gap-2">
        {read === undefined ? (
          connections.pending ? null : (
            <>
              <UnreadRow name="Search Console" />
              <UnreadRow name="IndexNow" />
            </>
          )
        ) : (
          <>
            <ConnectionRow line={searchConsoleConnection(read.searchConsole)} />
            <ConnectionRow line={indexNowConnection(read.indexNow)} />
          </>
        )}
        {proxyRead === undefined ? (
          proxy.pending ? null : (
            <UnreadRow name="Redirects on the site" />
          )
        ) : (
          <ConnectionRow line={redirectsConnection(proxyRead)} />
        )}
      </ul>
    </SmallCard>
  );
}

/** The Overview, as the admin mounts it. */
export function SeoOverviewPage(): JSX.Element {
  const checklist = usePluginRoute<ChecklistBody>({
    plugin: SEO_PLUGIN_NAME,
    path: CHECKLIST_ROUTE_PATH,
    staleTime: 0,
  });
  useSetupFirst(checklist.data);
  const visibility = useChecklistVisibility();
  // Read once for the page, and checked where a full check is due: the
  // health card counts it, and it names the site's production host.
  const problems = useCheckedProblemList();
  const host =
    problems.list?.site ??
    (typeof window === "undefined" ? "the site" : window.location.host);
  return (
    <PageFrame type="list">
      <PageHeader
        title="Overview"
        description={`How ${host} shows up in search, and what to do next.`}
        breadcrumbs={<SeoTrail steps={[{ label: "Overview" }]} />}
        actions={
          <>
            <ShowSetup checklist={checklist.data} visibility={visibility} />
            <Button variant="outline" asChild>
              <AdminLink href={PAGES_PAGE_HREF}>Open pages</AdminLink>
            </Button>
          </>
        }
      />
      <div className="flex flex-col gap-6">
        {/* The card that says why a hide failed is not drawn while hidden. */}
        {checklist.data?.hidden === true && visibility.error !== null ? (
          <p className="text-sm text-danger-text" role="alert">
            {`The setup checklist could not be shown. ${apiErrorMessage(visibility.error)}`}
          </p>
        ) : null}
        {checklist.data?.hidden === true ? null : (
          <SetupCard
            checklist={checklist.data}
            pending={checklist.pending}
            error={checklist.error}
            visibility={visibility}
          />
        )}
        {/* Four across where the column has room for them, two by two on
            a tablet or a narrow laptop, one under another on a phone; sized
            by the column, not the window, as the admin's own grids are. */}
        <div className="@container">
          <div className="grid grid-cols-1 gap-4 @xl:grid-cols-2 @4xl:grid-cols-4">
            <HealthCard checked={problems} />
            <PagesCard />
            <NotFoundCard />
            <ConnectionsCard />
          </div>
        </div>
      </div>
    </PageFrame>
  );
}

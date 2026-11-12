/**
 * The SEO section's Overview, where the section opens: a setup checklist
 * worked out from what the plugin stores, the site's search health, how its
 * public pages stand, the addresses not found lately, and the optional
 * connections.
 *
 * Drawn only from the admin's own parts (`PageFrame`, `PageHeader`,
 * `Breadcrumbs`, `Card`, `Checklist`, `Stat`, `Grid`, `Badge`, `Button`), so
 * it looks like the rest of the admin. Each card reads its own route and
 * says for itself when that read fails, so one that cannot be read never
 * takes the rest of the page with it.
 *
 * @module admin/SeoOverviewPage
 */
import {
  apiErrorMessage,
  Badge,
  Button,
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  ChecklistItem,
  ChecklistProgress,
  Grid,
  navigateTo,
  PageFrame,
  PageHeader,
  Stat,
  toastMutationResult,
  usePluginRoute,
  usePluginRouteMutation,
  type BadgeProps,
  type PluginRouteRead,
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
  PROBLEMS_ROUTE_PATH,
  problemsHref,
  severityCounts,
  SEVERITY_ORDER,
  type ProblemListBody,
  type ProblemSeverity,
} from "../problems/contract";
import {
  REDIRECT_ROUTES,
  REDIRECTS_PAGE,
  type NotFoundView,
  type ProxyStatus,
} from "../redirects/contract";
import {
  SEO_ADMIN_SLUG,
  SEO_PLUGIN_NAME,
  SETTINGS_PAGE_HREF,
} from "../settings/contract";

import { AdminLink, SeoTrail } from "./section";

/** A list route's answer. */
interface ListBody<T> {
  items: T[];
}

/** Where the redirects screen is. */
const REDIRECTS_HREF = `/admin/plugins/${SEO_ADMIN_SLUG}/${REDIRECTS_PAGE.path}`;

/** A new redirect from `row`'s address, its To the closest live page. */
function redirectFromHref(row: NotFoundView): string {
  const query = new URLSearchParams({ from: row.from });
  if (row.suggestion !== null) query.set("to", row.suggestion);
  return `${REDIRECTS_HREF}?${query.toString()}`;
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
function Line({ name, end }: { name: ReactNode; end: ReactNode }): JSX.Element {
  return (
    <li className="flex items-center justify-between gap-2 text-sm">
      <span className="min-w-0 truncate">{name}</span>
      <span className="shrink-0">{end}</span>
    </li>
  );
}

/** A link written as part of a line's text. */
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
      className={`font-medium underline-offset-4 hover:underline ${className ?? "text-foreground"}`}
    >
      {children}
    </AdminLink>
  );
}

/**
 * One of the four small cards: a region named by its title, which is its
 * heading, or, where the card leads with a figure, the `Stat`'s label drawn
 * above it.
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

/** First-time setup still waits: the first visit is sent on to it. */
function useSetupFirst(checklist: ChecklistBody | undefined): void {
  const waiting = checklist?.setupWaiting === true;
  useEffect(() => {
    if (waiting) navigateTo(SETTINGS_PAGE_HREF, { replace: true });
  }, [waiting]);
}

/** The setup checklist, or the line that shows it again once hidden. */
function SetupCard({
  checklist,
  pending,
  error,
}: {
  checklist: ChecklistBody | undefined;
  pending: boolean;
  error: Error | null;
}): JSX.Element | null {
  const titleId = useId();
  const visibility = usePluginRouteMutation<ChecklistVisibility, object>({
    plugin: SEO_PLUGIN_NAME,
    path: CHECKLIST_ROUTE_PATH,
    method: "POST",
    invalidates: [CHECKLIST_ROUTE_PATH],
  });
  const setHidden = async (hidden: boolean) => {
    const answer = await visibility.write({ hidden });
    if (answer !== undefined) {
      toastMutationResult(
        hidden ? "Setup checklist hidden" : "Setup checklist shown",
        undefined
      );
    }
  };

  if (checklist?.hidden === true) {
    return (
      <div className="flex justify-end">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={visibility.pending}
          onClick={() => void setHidden(false)}
        >
          Show setup
        </Button>
      </div>
    );
  }
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
                onClick={() => void setHidden(true)}
              >
                Hide
              </Button>
            </CardAction>
          )}
        </CardHeader>
        <CardContent className="pt-0">
          <ReadState what="The setup checklist" pending={pending} error={error}>
            {() => (
              <>
                <ChecklistProgress done={done} total={items.length} />
                <ol
                  aria-label="Setup steps"
                  className="grid grid-cols-1 gap-x-6 sm:grid-cols-2 sm:[&>li:nth-child(2)]:border-t-0"
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
                </ol>
              </>
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

/** Each severity's name on the health card, and its badge. */
const SEVERITY_TEXT: Record<
  ProblemSeverity,
  { name: string; badge: BadgeProps["variant"] }
> = {
  error: { name: "Errors", badge: "destructive" },
  warning: { name: "Warnings", badge: "warning" },
  notice: { name: "Notices", badge: "default" },
};

/** The site's search health: a verdict, and how many of each severity. */
function HealthCard({
  list,
}: {
  list: PluginRouteRead<ProblemListBody>;
}): JSX.Element {
  return (
    <SmallCard title="Search health" leadsWithStat>
      <ReadState
        what="The problem list"
        pending={list.pending}
        error={list.error}
      >
        {() => {
          const counts = severityCounts(list.data?.problems ?? []);
          const good = counts.error + counts.warning === 0;
          return (
            <>
              <Stat
                label="Search health"
                value={good ? "Good" : "Should improve"}
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
                      <Badge variant={SEVERITY_TEXT[severity].badge}>
                        {counts[severity]}
                      </Badge>
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
    <SmallCard title="Pages" leadsWithStat>
      <ReadState what="The pages" pending={pages.pending} error={pages.error}>
        {() => (
          <>
            <Stat
              label="Pages"
              value={`${coverage.total} public ${coverage.total === 1 ? "page" : "pages"}`}
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
        <TextLink
          href={`${REDIRECTS_HREF}?tab=notfound`}
          className="text-muted-foreground"
        >
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
                No address was not found in the last 7 days.
              </p>
            );
          }
          return (
            <ul className="flex flex-col gap-2">
              {rows.map(row => (
                <Line
                  key={row.id}
                  name={
                    <span className="font-mono" title={row.path}>
                      {row.path}
                    </span>
                  }
                  end={
                    <TextLink href={redirectFromHref(row)}>
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
  const read = connections.data;
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
        {proxy.data === undefined ? (
          proxy.pending ? null : (
            <UnreadRow name="Redirects on the site" />
          )
        ) : (
          <ConnectionRow line={redirectsConnection(proxy.data)} />
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
  // Read once for the page: the health card counts it, and it names the
  // site's production host.
  const problems = usePluginRoute<ProblemListBody>({
    plugin: SEO_PLUGIN_NAME,
    path: PROBLEMS_ROUTE_PATH,
    staleTime: 0,
  });
  const host =
    problems.data?.site ??
    (typeof window === "undefined" ? "the site" : window.location.host);
  return (
    <PageFrame type="list">
      <PageHeader
        title="Overview"
        description={`How ${host} shows up in search, and what to do next.`}
        breadcrumbs={<SeoTrail steps={[{ label: "Overview" }]} />}
        actions={
          <Button variant="outline" asChild>
            <AdminLink href={PAGES_PAGE_HREF}>Open pages</AdminLink>
          </Button>
        }
      />
      <div className="flex flex-col gap-6">
        <SetupCard
          checklist={checklist.data}
          pending={checklist.pending}
          error={checklist.error}
        />
        <Grid cols={4} gap={4} responsive>
          <HealthCard list={problems} />
          <PagesCard />
          <NotFoundCard />
          <ConnectionsCard />
        </Grid>
      </div>
    </PageFrame>
  );
}

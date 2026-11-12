/**
 * Inspect: what search engines receive for one of the site's pages, opened
 * from a row of Pages or a page's SEO tab with `?address=` naming the page.
 * The page is fetched live as Google, Bing, Facebook, X, LinkedIn and an AI
 * crawler, each crawler's result in a strip; a difference is explained in a
 * note in plain words, an expected one said to need nothing; the Head table
 * shows each value Nextly holds, where it comes from and what the chosen
 * crawler received; and the page's structured data is listed beside it.
 *
 * Where the address isn't fetched, or the fetch stops, what Nextly holds is
 * still shown. Drawn from the admin's own parts (`PageFrame`, `PageHeader`,
 * `Card`, `Alert`, `SegmentedChoice`, `Dialog`, `Button`).
 *
 * @module admin/SeoInspectPage
 */
import {
  Alert,
  AlertDescription,
  AlertTitle,
  apiErrorMessage,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  navigateTo,
  PageFrame,
  PageHeader,
  SegmentedChoice,
  writePluginRoute,
} from "@nextlyhq/plugin-sdk/admin";
import { useCallback, useEffect, useRef, useState, type JSX } from "react";

import { PAGES_PAGE_HREF } from "../code-pages/contract";
import {
  CRAWLER_NAMES,
  HEAD_CRAWLERS,
  RECEIVED_ROUTE_PATH,
  RECEIVED_ROWS,
  type CrawlerKey,
  type HeldStructuredData,
  type ReceivedAnswer,
  type ReceivedDifference,
  type StoredValues,
} from "../received/contract";
import { SEO_PLUGIN_NAME, SETTINGS_PAGE_HREF } from "../settings/contract";

import {
  crawlerLine,
  fetchedAgo,
  fetchNotice,
  heldText,
  originText,
  receivedText,
  type Checked,
  type Tone,
} from "./inspect-view";
import { AdminLink, PAGES_STEP, SeoTrail } from "./section";

/** The address the screen's own address names, where it names one. */
function addressInAddress(): string | undefined {
  if (typeof window === "undefined") return undefined;
  const named = new URLSearchParams(window.location.search).get("address");
  return named === null || named.trim() === "" ? undefined : named;
}

/** Each tone's text colour, from the admin's tokens. */
const TONE_TEXT: Record<Tone, string> = {
  good: "text-success-text",
  warning: "text-warning-text",
  danger: "text-danger-text",
  muted: "text-muted-foreground",
};

/** What the screen is showing. */
type CheckState =
  | { state: "fetching"; was?: ReceivedAnswer }
  | { state: "done"; answer: ReceivedAnswer }
  | { state: "failed"; message: string };

/** The check of `address`, run as the screen opens and again when asked. */
function useCheck(address: string | undefined): {
  check: CheckState;
  run: () => void;
} {
  const [check, setCheck] = useState<CheckState>({ state: "fetching" });
  const controller = useRef<AbortController | null>(null);
  const run = useCallback(() => {
    if (address === undefined) return;
    controller.current?.abort();
    const asking = new AbortController();
    controller.current = asking;
    setCheck(was =>
      was.state === "done"
        ? { state: "fetching", was: was.answer }
        : { state: "fetching" }
    );
    writePluginRoute<ReceivedAnswer>({
      plugin: SEO_PLUGIN_NAME,
      path: RECEIVED_ROUTE_PATH,
      body: { address },
      signal: asking.signal,
    }).then(
      answer => {
        if (asking.signal.aborted) return;
        setCheck(
          answer === undefined
            ? { state: "failed", message: "The check answered nothing." }
            : { state: "done", answer }
        );
      },
      (error: unknown) => {
        if (asking.signal.aborted) return;
        setCheck({ state: "failed", message: apiErrorMessage(error) });
      }
    );
  }, [address]);
  useEffect(() => {
    run();
    return () => controller.current?.abort();
  }, [run]);
  return { check, run };
}

/** A clock that moves every half minute, for "Fetched … ago". */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

/** Inspect, as the admin mounts it. */
export function SeoInspectPage(): JSX.Element {
  const [address] = useState(addressInAddress);
  // Inspect is of one page: with none named, Pages is where one is chosen.
  useEffect(() => {
    if (address === undefined) navigateTo(PAGES_PAGE_HREF, { replace: true });
  }, [address]);
  const { check, run } = useCheck(address);
  const answer =
    check.state === "done"
      ? check.answer
      : check.state === "fetching"
        ? check.was
        : undefined;
  const fetching = check.state === "fetching";
  const shown = answer?.address ?? address ?? "";
  return (
    <>
      <SeoTrail
        steps={[PAGES_STEP, { label: answer?.name ?? pathOf(shown) }]}
      />
      <PageFrame type="list">
        <PageHeader
          title="What search engines receive"
          description={
            <span className="break-all font-mono text-[13px]">{shown}</span>
          }
          actions={
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={fetching || address === undefined}
                onClick={run}
              >
                {fetching ? "Fetching…" : "Fetch the live page"}
              </Button>
              {answer?.editHref === undefined ? null : (
                <Button asChild>
                  <AdminLink href={answer.editHref}>Edit SEO</AdminLink>
                </Button>
              )}
            </div>
          }
        />
        <div className="flex flex-col gap-4">
          {check.state === "failed" ? (
            <Alert variant="destructive">
              <div className="flex flex-1 flex-col gap-1">
                <AlertTitle>The page couldn&apos;t be checked</AlertTitle>
                <AlertDescription>{check.message}</AlertDescription>
              </div>
              <Button type="button" variant="outline" size="sm" onClick={run}>
                Try again
              </Button>
            </Alert>
          ) : null}
          {answer === undefined ? (
            check.state === "fetching" ? (
              <p className="text-sm text-muted-foreground" role="status">
                Fetching the page as each crawler…
              </p>
            ) : null
          ) : (
            <Answer answer={answer} fetching={fetching} onRetry={run} />
          )}
        </div>
      </PageFrame>
    </>
  );
}

/** The path of an address, for the trail where the page has no name. */
function pathOf(address: string): string {
  try {
    return new URL(address).pathname;
  } catch {
    return address;
  }
}

/** Everything the check answered. */
function Answer({
  answer,
  fetching,
  onRetry,
}: {
  answer: ReceivedAnswer;
  fetching: boolean;
  onRetry: () => void;
}): JSX.Element {
  const host = typeof window === "undefined" ? "" : window.location.host;
  const notice = fetchNotice(answer, host);
  const [compareWith, setCompareWith] = useState<CrawlerKey>("googlebot");
  return (
    <>
      {answer.kind === "checked" ? <Strip answer={answer} /> : null}
      {notice?.kind === "not-fetched" ? (
        <Alert variant="info" role="status">
          <div className="flex flex-col gap-1">
            <AlertTitle>This address isn&apos;t fetched</AlertTitle>
            <AlertDescription>
              {notice.lead === undefined ? null : (
                <strong className="font-semibold">{notice.lead} </strong>
              )}
              {notice.text}
              {notice.settings === true ? (
                <>
                  {" "}
                  <AdminLink
                    href={`${SETTINGS_PAGE_HREF}?tab=general`}
                    className="font-medium underline underline-offset-4"
                  >
                    Open the settings
                  </AdminLink>
                </>
              ) : null}
            </AlertDescription>
          </div>
        </Alert>
      ) : null}
      {notice?.kind === "failed" ? (
        <Alert variant="destructive">
          <div className="flex flex-1 flex-col gap-1">
            <AlertTitle>Couldn&apos;t fetch the live page</AlertTitle>
            <AlertDescription>{notice.text}</AlertDescription>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={fetching}
            onClick={onRetry}
          >
            Try again
          </Button>
        </Alert>
      ) : null}
      {answer.kind === "checked" && notice === undefined ? (
        <Differences answer={answer} />
      ) : null}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <HeadCard
          answer={answer}
          stored={answer.stored}
          compareWith={compareWith}
          onCompareWith={setCompareWith}
        />
        <StructuredDataCard data={answer.structuredData} />
      </div>
    </>
  );
}

/** The live fetch's result for each crawler, side by side. */
function Strip({ answer }: { answer: Checked }): JSX.Element {
  return (
    <section
      aria-label="Live fetch by crawler"
      className="grid grid-cols-2 overflow-hidden rounded-lg border border-border bg-card sm:grid-cols-3 lg:grid-cols-6"
    >
      {answer.crawlers.map(crawler => {
        const line = crawlerLine(answer, crawler);
        return (
          <div
            key={crawler.key}
            className="flex flex-col gap-0.5 border-b border-r border-border px-3.5 py-3 last:border-r-0"
          >
            <span className="text-xs text-muted-foreground">
              {crawler.name}
            </span>
            <span className={`text-sm font-medium ${TONE_TEXT[line.tone]}`}>
              {line.text}
            </span>
          </div>
        );
      })}
    </section>
  );
}

/** The action that helps with a difference: within the admin, or outside it. */
function DifferenceAction({
  action,
}: {
  action: NonNullable<ReceivedDifference["action"]>;
}): JSX.Element {
  const className = "shrink-0 text-sm font-medium underline underline-offset-4";
  return action.href.startsWith("/admin/") ? (
    <AdminLink href={action.href} className={className}>
      {action.label}
    </AdminLink>
  ) : (
    <a
      href={action.href}
      target="_blank"
      rel="noopener noreferrer"
      className={className}
    >
      {action.label}
    </a>
  );
}

/** Each difference, as a note in plain words; an expected one said so. */
function Differences({ answer }: { answer: Checked }): JSX.Element | null {
  const now = useNow();
  if (answer.differences.length === 0) return null;
  const fetched = `Fetched ${fetchedAgo(answer.fetchedAt, now)}.`;
  return (
    <div className="flex flex-col gap-2">
      {answer.differences.map((difference, at) => (
        <Alert
          key={difference.number}
          variant={difference.expected === true ? "info" : "warning"}
          role="note"
        >
          <AlertDescription className="flex flex-1 flex-col gap-2 sm:flex-row sm:items-center">
            <span className="flex-1">
              <strong className="font-semibold">
                {difference.expected === true
                  ? "Expected, nothing to fix. "
                  : `${difference.title} `}
              </strong>
              {difference.expected === true
                ? `${difference.title} ${difference.text}`
                : difference.text}
              {at === 0 ? ` ${fetched}` : null}
            </span>
            {difference.action === undefined ? null : (
              <DifferenceAction action={difference.action} />
            )}
          </AlertDescription>
        </Alert>
      ))}
    </div>
  );
}

/** The Head table: each value Nextly holds, beside what a crawler received. */
function HeadCard({
  answer,
  stored,
  compareWith,
  onCompareWith,
}: {
  answer: ReceivedAnswer;
  stored: StoredValues | undefined;
  compareWith: CrawlerKey;
  onCompareWith: (key: CrawlerKey) => void;
}): JSX.Element {
  const name = CRAWLER_NAMES[compareWith];
  return (
    <Card className="overflow-hidden">
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-3">
        <CardTitle className="text-sm">Head</CardTitle>
        {answer.kind === "checked" ? (
          <SegmentedChoice
            aria-label="Compare with"
            options={HEAD_CRAWLERS.map(key => ({
              value: key,
              label: CRAWLER_NAMES[key],
            }))}
            value={compareWith}
            onSelect={next =>
              onCompareWith(
                HEAD_CRAWLERS.find(key => key === next) ?? "googlebot"
              )
            }
          />
        ) : null}
      </CardHeader>
      <CardContent className="overflow-x-auto p-0">
        {stored === undefined ? (
          <p className="px-4 py-3 text-sm text-muted-foreground">
            Nextly holds no published page at this address that you can read.
          </p>
        ) : (
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="text-left text-muted-foreground">
                <th scope="col" className="px-4 py-2 font-medium">
                  Tag
                </th>
                <th scope="col" className="px-2 py-2 font-medium">
                  Nextly holds
                </th>
                {answer.kind === "checked" ? (
                  <th scope="col" className="px-2 py-2 font-medium">
                    {name} received
                  </th>
                ) : null}
                <th scope="col" className="py-2 pl-2 pr-4 font-medium">
                  Comes from
                </th>
              </tr>
            </thead>
            <tbody>
              {RECEIVED_ROWS.map(row => {
                const received =
                  answer.kind === "checked"
                    ? receivedText(
                        answer.rows[row.key][compareWith],
                        compareWith
                      )
                    : undefined;
                return (
                  <tr
                    key={row.key}
                    className={`border-t border-border ${received?.tone === "warning" ? "bg-warning-surface" : ""}`}
                  >
                    <td className="whitespace-nowrap px-4 py-2.5 font-mono text-xs text-muted-foreground">
                      {row.tag}
                    </td>
                    <td className="break-words px-2 py-2.5">
                      {heldText(stored, row.key)}
                    </td>
                    {received === undefined ? null : (
                      <td
                        className={`break-words px-2 py-2.5 ${TONE_TEXT[received.tone]}`}
                      >
                        {received.text}
                      </td>
                    )}
                    <td className="py-2.5 pl-2 pr-4 text-muted-foreground">
                      {originText(row.key, stored.from[row.key])}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  );
}

/** The page's structured data: each type, valid or left out, and its JSON-LD. */
function StructuredDataCard({
  data,
}: {
  data: HeldStructuredData | undefined;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const empty =
    data === undefined ||
    (data.items.length === 0 && data.leftOut.length === 0);
  return (
    <Card className="self-start overflow-hidden">
      <CardHeader>
        <CardTitle className="text-sm">Structured data</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {empty ? (
          <p className="px-4 py-3 text-sm text-muted-foreground">
            Nextly gives this page no structured data.
          </p>
        ) : (
          <ul className="m-0 list-none p-0 text-sm">
            {data.items.map((item, at) => (
              <li
                key={`item-${at}`}
                className="flex justify-between gap-3 border-b border-border px-4 py-3 last:border-b-0"
              >
                <span className="min-w-0 break-words">
                  <strong className="font-semibold">{item.type}</strong>
                  {item.name === undefined ? null : ` · ${item.name}`}
                </span>
                <span className="shrink-0 text-success-text">Valid</span>
              </li>
            ))}
            {data.leftOut.map((item, at) => (
              <li
                key={`left-${at}`}
                className="flex justify-between gap-3 border-b border-border px-4 py-3 last:border-b-0"
              >
                <span className="min-w-0 break-words">
                  <strong className="font-semibold">{item.type}</strong>
                  {` · ${item.message}`}
                </span>
                <span className="shrink-0 text-warning-text">Left out</span>
              </li>
            ))}
          </ul>
        )}
        {data === undefined || data.items.length === 0 ? null : (
          <div className="border-t border-border px-4 py-2.5">
            <Button
              type="button"
              variant="link"
              className="h-auto p-0"
              onClick={() => setOpen(true)}
            >
              View the JSON-LD
            </Button>
          </div>
        )}
      </CardContent>
      {data === undefined ? null : (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>JSON-LD</DialogTitle>
            </DialogHeader>
            <pre className="max-h-[60vh] overflow-auto rounded-md bg-muted p-3 font-mono text-xs text-foreground">
              {data.json}
            </pre>
          </DialogContent>
        </Dialog>
      )}
    </Card>
  );
}

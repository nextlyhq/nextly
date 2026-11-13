/**
 * The "Your own rules" row of Search engines and AI: a box of robots.txt
 * lines, numbered, served after Nextly's own. Each line is read as it is
 * typed (`settings/robots-rules`): a rule that keeps every crawler, Googlebot
 * or Bingbot away from the home page or the whole site is refused, a
 * misspelt one warned about, a line that is not a standard rule kept with a
 * note, a group naming a crawler explained. Which sitemap pages the rules
 * would block is asked of the server once typing pauses, and a rule that
 * blocks any waits for "Block these N pages anyway" before it saves.
 *
 * @module admin/robots-rules
 */
import {
  Alert,
  AlertDescription,
  Checkbox,
  SettingsRowGroup,
  Textarea,
  writePluginRoute,
} from "@nextlyhq/plugin-sdk/admin";
import { AlertTriangle, Check, Info, XCircle } from "lucide-react";
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type JSX,
} from "react";

import { SEO_PLUGIN_NAME } from "../settings/contract";
import {
  readOwnRules,
  ROBOTS_RULES_CHECK_ROUTE_PATH,
  ROBOTS_SERVED_BY_HEADER,
  type RobotsRulesCheckBody,
  type RuleFinding,
} from "../settings/robots-rules";

import type { RobotsRulesDraft } from "./settings-draft";
import { ControlNote } from "./settings-parts";
import type { TabProps } from "./tabs";

/** How long typing pauses before the sitemap pages are checked. */
const CHECK_AFTER_MS = 500;

/** Where Google explains how robots.txt rules are read. */
const RULES_GUIDE =
  "https://developers.google.com/search/docs/crawling-indexing/robots/create-robots-txt";

/** The check of which sitemap pages the box's text blocks. */
export type RulesCheck =
  /** Nothing to check: an empty box, or one refused as typed. */
  | { state: "idle" }
  | { state: "checking"; text: string }
  | { state: "failed"; text: string }
  | { state: "done"; text: string; body: RobotsRulesCheckBody };

/** The text as stored and compared: without the blank lines at its end. */
const kept = (text: string): string => text.replace(/\s+$/, "");

/** Whether `text` needs the sitemap check: rules not refused as typed. */
const checkable = (text: string): boolean =>
  kept(text).trim() !== "" && !readOwnRules(text).refused;

/**
 * Which sitemap pages the box's text blocks, asked once typing pauses and
 * again on `retry`. The answer is for the text it was asked with, so an
 * answer for older text is never read as this one's.
 */
export function useRobotsRulesCheck(text: string): {
  check: RulesCheck;
  retry: () => void;
} {
  const [check, setCheck] = useState<RulesCheck>({ state: "idle" });
  const asking = useRef<AbortController | null>(null);
  const ask = useCallback((asked: string) => {
    asking.current?.abort();
    const controller = new AbortController();
    asking.current = controller;
    setCheck({ state: "checking", text: asked });
    writePluginRoute<RobotsRulesCheckBody>({
      plugin: SEO_PLUGIN_NAME,
      path: ROBOTS_RULES_CHECK_ROUTE_PATH,
      body: { text: asked },
      signal: controller.signal,
    }).then(
      body => {
        if (controller.signal.aborted) return;
        setCheck(
          body === undefined
            ? { state: "failed", text: asked }
            : { state: "done", text: asked, body }
        );
      },
      () => {
        if (!controller.signal.aborted) {
          setCheck({ state: "failed", text: asked });
        }
      }
    );
  }, []);
  useEffect(() => {
    if (!checkable(text)) {
      asking.current?.abort();
      setCheck({ state: "idle" });
      return undefined;
    }
    setCheck({ state: "checking", text: kept(text) });
    const timer = setTimeout(() => ask(kept(text)), CHECK_AFTER_MS);
    return () => clearTimeout(timer);
  }, [text, ask]);
  useEffect(() => () => asking.current?.abort(), []);
  return { check, retry: () => ask(kept(text)) };
}

/** How many sitemap pages the check found blocked, across every line. */
function blockedCount(body: RobotsRulesCheckBody): number {
  return Number(body.pagesKey.split(":")[0] ?? 0);
}

/** Whether the draft's confirmation is for its own text and these pages. */
function confirmedFor(draft: RobotsRulesDraft, pagesKey: string): boolean {
  return (
    draft.confirmed !== undefined &&
    kept(draft.confirmed.text) === kept(draft.text) &&
    draft.confirmed.pages === pagesKey
  );
}

/**
 * What stops the own rules being saved, said beside Save; null when nothing
 * does. Only a changed box is held up: rules already saved, which later
 * pages came to fall under, ask again on the screen without stopping a save
 * of anything else.
 */
export function ownRulesSaveProblem(
  draft: RobotsRulesDraft,
  storedText: string,
  check: RulesCheck
): string | null {
  const refused = readOwnRules(draft.text).findings.find(
    finding => finding.level === "refused"
  );
  if (refused !== undefined) {
    return refused.line > 0 && refused.message.startsWith("Line")
      ? `Fix line ${refused.line} of your own rules first.`
      : "Fix your own rules first.";
  }
  if (!checkable(draft.text) || kept(draft.text) === kept(storedText)) {
    return null;
  }
  if (check.state !== "done" || check.text !== kept(draft.text)) {
    return check.state === "failed" && check.text === kept(draft.text)
      ? "Couldn't check which pages your rules block. Try again."
      : "Checking your rules against the sitemap…";
  }
  const first = check.body.lines[0];
  if (first === undefined || confirmedFor(draft, check.body.pagesKey)) {
    return null;
  }
  return `Confirm line ${first.line} first.`;
}

/** Whether the site's robots.txt is the plugin's, the site's own, or not known. */
type ServedBy = "plugin" | "own" | "unknown";

/**
 * Who serves the site's robots.txt: the plugin marks its own with a header,
 * so a file without it is the site's, which wins over the plugin's. Read
 * once from the site itself; a failed read says nothing.
 */
function useServedBy(): ServedBy {
  const [served, setServed] = useState<ServedBy>("unknown");
  useEffect(() => {
    const controller = new AbortController();
    fetch("/robots.txt", { cache: "no-store", signal: controller.signal })
      .then(response => {
        if (!response.ok) return;
        setServed(
          response.headers.get(ROBOTS_SERVED_BY_HEADER) === null
            ? "own"
            : "plugin"
        );
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, []);
  return served;
}

/** The box: its numbered lines, and the textarea they number. */
function RulesBox({
  value,
  onChange,
  invalid,
  describedBy,
}: {
  value: string;
  onChange: (value: string) => void;
  invalid: boolean;
  describedBy: string;
}): JSX.Element {
  const count = value.split(/\r\n|\r|\n/).length;
  const rows = Math.max(5, count + 1);
  return (
    <div className="relative">
      {/* Numbers for the eye; a screen reader reads each finding's line. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute left-px top-px select-none py-2 pl-3 text-right font-mono text-[13px] leading-6 text-muted-foreground"
      >
        {Array.from({ length: rows }, (_, index) => (
          <div key={index} className="w-5">
            {index < count ? index + 1 : ""}
          </div>
        ))}
      </div>
      <Textarea
        className="resize-none whitespace-pre pl-11 font-mono text-[13px] leading-6"
        rows={rows}
        wrap="off"
        spellCheck={false}
        autoComplete="off"
        value={value}
        aria-label="Your own rules"
        aria-invalid={invalid}
        aria-describedby={describedBy}
        onChange={event => onChange(event.target.value)}
      />
    </div>
  );
}

/** A refused line, said in a danger box: its first sentence in bold. */
function Refusal({ finding }: { finding: RuleFinding }): JSX.Element {
  const stop = finding.message.indexOf(". ");
  const lead =
    stop === -1 ? finding.message : finding.message.slice(0, stop + 1);
  const rest = stop === -1 ? "" : finding.message.slice(stop + 2);
  return (
    <Alert variant="destructive" className="mt-2">
      <XCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <AlertDescription>
        <b className="font-semibold">{lead}</b> {rest}
      </AlertDescription>
    </Alert>
  );
}

/** What each line was found to be, under the box. */
function Findings({
  findings,
}: {
  findings: readonly RuleFinding[];
}): JSX.Element {
  return (
    <>
      {findings.map(finding =>
        finding.level === "refused" ? (
          <Refusal key={`${finding.line}-refused`} finding={finding} />
        ) : (
          <ControlNote
            key={`${finding.line}-${finding.message}`}
            tone={finding.level === "warning" ? "warning" : "muted"}
          >
            {finding.message}
          </ControlNote>
        )
      )}
    </>
  );
}

/** The sitemap pages the rules block, and the box that confirms blocking them. */
function BlockedPages({
  body,
  draft,
  confirm,
}: {
  body: RobotsRulesCheckBody;
  draft: RobotsRulesDraft;
  confirm: (on: boolean) => void;
}): JSX.Element {
  const confirmId = useId();
  const total = blockedCount(body);
  return (
    <div className="mt-2 grid gap-2">
      {body.lines.map(line => {
        const more = line.count - line.examples.length;
        return (
          <Alert key={line.line} variant="warning" role="status">
            <AlertTriangle
              className="mt-0.5 size-4 shrink-0"
              aria-hidden="true"
            />
            <AlertDescription>
              <b className="font-semibold">
                Line {line.line} keeps crawlers away from {line.count}{" "}
                {line.count === 1 ? "page" : "pages"} in your sitemap:
              </b>{" "}
              {line.examples.join(", ")}
              {more > 0 ? ` and ${more} more` : ""}. Search engines can&apos;t
              read them, and each stays on the problem list while the rule is
              here. To keep pages out of search, use Hide from search instead;
              robots.txt only stops crawling.
            </AlertDescription>
          </Alert>
        );
      })}
      <label
        htmlFor={confirmId}
        className="flex items-center gap-2 text-sm text-foreground"
      >
        <Checkbox
          id={confirmId}
          checked={confirmedFor(draft, body.pagesKey)}
          onCheckedChange={on => confirm(on === true)}
        />
        Block these {total} {total === 1 ? "page" : "pages"} anyway
      </label>
    </div>
  );
}

/** What the sitemap check says under the box, while it says anything. */
function CheckLine({
  check,
  draft,
  confirm,
  retry,
}: {
  check: RulesCheck;
  draft: RobotsRulesDraft;
  confirm: (on: boolean) => void;
  retry: () => void;
}): JSX.Element | null {
  if (check.state === "idle" || check.text !== kept(draft.text)) {
    return check.state === "idle" ? null : (
      <ControlNote>Checking your rules against the sitemap…</ControlNote>
    );
  }
  if (check.state === "checking") {
    return <ControlNote>Checking your rules against the sitemap…</ControlNote>;
  }
  if (check.state === "failed") {
    return (
      <ControlNote tone="warning">
        Couldn&apos;t check which pages your rules block.{" "}
        <button
          type="button"
          className="font-medium text-foreground underline underline-offset-2 hover:decoration-2"
          onClick={retry}
        >
          Try again
        </button>
      </ControlNote>
    );
  }
  if (check.body.lines.length > 0) {
    return <BlockedPages body={check.body} draft={draft} confirm={confirm} />;
  }
  return (
    <p
      role="status"
      className="mt-1.5 flex items-start gap-1 text-xs font-medium leading-normal text-success-text"
    >
      <Check className="mt-px size-3.5 shrink-0" aria-hidden="true" />
      <span>No rule blocks a page in your sitemap.</span>
    </p>
  );
}

/** A link under the box, styled as the screen's other small links. */
function SmallLink({
  href,
  children,
}: {
  href: string;
  children: string;
}): JSX.Element {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="text-xs font-medium text-foreground underline underline-offset-2 hover:decoration-2"
    >
      {children}
    </a>
  );
}

/** The row: the box, what was found, the sitemap check, and two links. */
export function OwnRulesRow({
  draft,
  change,
  check,
  retry,
}: TabProps & { check: RulesCheck; retry: () => void }): JSX.Element {
  const rules = draft.robotsRules;
  const read = readOwnRules(rules.text);
  const findingsId = useId();
  const served = useServedBy();
  const set = (next: RobotsRulesDraft) =>
    change(current => ({ ...current, robotsRules: next }));
  return (
    <SettingsRowGroup
      label="Your own rules"
      description={
        <>
          Extra lines for <code className="font-mono">/robots.txt</code>, added
          after Nextly&apos;s. For example, to keep crawlers out of
          search-results or filter addresses.
        </>
      }
    >
      <RulesBox
        value={rules.text}
        onChange={text => set({ ...rules, text })}
        invalid={read.refused}
        describedBy={findingsId}
      />
      <div id={findingsId}>
        <Findings findings={read.findings} />
        {read.refused ? null : (
          <CheckLine
            check={check}
            draft={rules}
            retry={retry}
            confirm={on => {
              if (check.state !== "done") return;
              const { confirmed: _was, ...rest } = rules;
              set(
                on
                  ? {
                      ...rest,
                      confirmed: {
                        text: kept(rules.text),
                        pages: check.body.pagesKey,
                      },
                    }
                  : rest
              );
            }}
          />
        )}
      </div>
      {served === "own" ? (
        <Alert variant="info" role="status" className="mt-2">
          <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <AlertDescription>
            Your site has its own robots.txt file, so these rules and the AI
            tools choice aren&apos;t used. A developer can remove the file to
            let Nextly write it.
          </AlertDescription>
        </Alert>
      ) : null}
      <div className="mt-3 flex flex-wrap gap-4">
        <SmallLink href="/robots.txt">See the whole file</SmallLink>
        <SmallLink href={RULES_GUIDE}>How robots.txt rules work</SmallLink>
      </div>
    </SettingsRowGroup>
  );
}

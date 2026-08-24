"use client";

/**
 * What came back, and what to do with it.
 *
 * Three tabs rather than one JSON pane: the body answers "did it work", the
 * headers answer "why did it do that" (they carry the request id we stamp on
 * every reply), and the code answers "how do I use this", which the playground
 * used to leave you to work out yourself.
 *
 * The tabs render whether or not a response exists, because the code is built
 * from the request — it is worth reading before you send, not only after.
 *
 * The tab selection is held here rather than left to the primitive, because the
 * toolbar has to act on what is being READ. A Copy that always took the body
 * put JSON on the clipboard while the reader was looking at a snippet, and did
 * it silently.
 *
 * @module components/entries/APIPlayground/ResponseViewer
 */

import {
  Button,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  toast,
} from "@nextlyhq/ui";
import { useState, useCallback, useMemo } from "react";

import {
  Copy,
  Check,
  Loader2,
  FileJson,
  AlertCircle,
  Download,
} from "@admin/components/icons";
import { UI } from "@admin/constants/ui";
import { usePersistedState } from "@admin/hooks/usePersistedState";
import { cn } from "@admin/lib/utils";

import { CodePanel } from "./CodePanel";
import type { CodeSnippets } from "./generate-code";
import { JsonViewer } from "./JsonViewer";

/** Which of the three panes is open, so the toolbar can act on it. */
type ResponseTab = "body" | "headers" | "code";

/**
 * The last code flavour read, remembered.
 *
 * Somebody who works in curl is working in curl on the next request too, and
 * being returned to the SDK tab every time is a small tax paid repeatedly.
 */
const FLAVOUR_KEY = "nextly:admin:api-playground:flavour";
const isFlavour = (value: string): value is keyof CodeSnippets =>
  value === "sdk" || value === "fetch" || value === "curl";

/**
 * The status dot, keyed to the same meaning as the status text beside it.
 */
function statusDotTone(status: number): string {
  if (status >= 200 && status < 300) return "bg-success";
  if (status >= 300 && status < 400) return "bg-muted-foreground";
  if (status >= 400 && status < 500) return "bg-warning";
  if (status >= 500) return "bg-destructive";
  return "bg-muted-foreground";
}

/**
 * Colour a response by what its status class means.
 *
 * A 4xx is the caller's mistake and a 5xx is the server's, so they read as
 * warning and error respectively.
 */
function statusTone(status: number): string {
  if (status >= 200 && status < 300) return "text-success";
  if (status >= 300 && status < 400) return "text-muted-foreground";
  if (status >= 400 && status < 500) return "text-warning";
  if (status >= 500) return "text-destructive";
  return "text-muted-foreground";
}

/**
 * A payload size someone can act on.
 *
 * Two significant figures past a kilobyte: the question a size answers here is
 * "is this response big?", and 2.4 KB answers it while 2438 B makes you count
 * digits.
 */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export interface ResponseViewerProps {
  /** Response data to display */
  data: unknown;
  /** Whether the request is loading */
  isLoading?: boolean;
  /** Error message if request failed */
  error?: string | null;
  /** Headers the API returned. */
  headers?: Record<string, string>;
  /** The body exactly as it arrived, for download. */
  raw?: string;
  /** The current request, as code. */
  code: CodeSnippets;
  /** Collection slug, for the download filename. */
  filename?: string;
  /** HTTP status, absent until the first reply. */
  status?: number;
  /** Round trip in milliseconds. */
  time?: number;
  /** Body size in bytes — what `depth` and `limit` are traded against. */
  size?: number;
}

/** One reading in the meta row, with a placeholder that holds its width. */
function Metric({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}

export function ResponseViewer({
  data,
  isLoading = false,
  error = null,
  headers,
  raw,
  code,
  filename = "response",
  status,
  time,
  size,
}: ResponseViewerProps) {
  // The text last copied, so the feedback belongs to it rather than to the
  // button. Null means nothing was copied recently.
  const [copied, setCopied] = useState<string | null>(null);
  const [tab, setTab] = useState<ResponseTab>("body");
  const [flavour, setFlavour] = usePersistedState(
    FLAVOUR_KEY,
    "sdk",
    isFlavour
  );

  const jsonString = useMemo(() => {
    if (data === undefined || data === null) return "";
    if (typeof data === "string") return data;
    try {
      return JSON.stringify(data, null, 2);
    } catch {
      // eslint-disable-next-line @typescript-eslint/no-base-to-string
      return String(data);
    }
  }, [data]);

  const headerEntries = Object.entries(headers ?? {});

  /**
   * The headers as text, in the form they arrived in.
   *
   * `name: value` per line is what a header block IS, and it is what pasting
   * one into a request or an issue expects. Rebuilding it from the map is the
   * only option -- `fetch` gives no access to the raw block.
   */
  const headerText = useMemo(
    () => headerEntries.map(([name, value]) => `${name}: ${value}`).join("\n"),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- entries are rebuilt each render from `headers`
    [headers]
  );

  /**
   * What the toolbar acts on is what the reader is looking at.
   *
   * All THREE tabs, not two. Copy took the body whenever the Code tab was
   * closed, so reading the headers and pressing Copy put the body on the
   * clipboard -- the same defect this control was rewritten to remove, one tab
   * further along.
   */
  const target: { text: string; label: string; filename: string } =
    tab === "code"
      ? {
          text: code[flavour],
          label: "Code",
          filename: `${filename}-${flavour}`,
        }
      : tab === "headers"
        ? {
            text: headerText,
            label: "Headers",
            filename: `${filename}-headers`,
          }
        : { text: jsonString, label: "Response", filename };
  const copyTarget = target.text;

  const handleCopy = useCallback(async () => {
    if (!copyTarget) return;
    try {
      await navigator.clipboard.writeText(copyTarget);
      // Keyed to WHAT was copied rather than a bare flag: switching tab or
      // flavour inside the feedback window otherwise leaves "Copied" standing
      // over a control that would now copy something else.
      setCopied(copyTarget);
      toast.success(`${target.label} copied to clipboard`);
      setTimeout(
        () => setCopied(current => (current === copyTarget ? null : current)),
        UI.COPY_FEEDBACK_TIMEOUT_MS
      );
    } catch {
      toast.error("Failed to copy");
    }
  }, [copyTarget, target.label]);

  const showCopied = copied !== null && copied === copyTarget;

  /**
   * Save the body to a file.
   *
   * The bytes as they arrived, not the re-formatted view: a saved response is
   * usually about to be diffed or replayed, and pretty-printing would make it
   * differ from what the API actually sent.
   */
  const handleDownload = useCallback(() => {
    // The body is saved as it ARRIVED rather than as it is displayed: a saved
    // response is usually about to be diffed or replayed, and pretty-printing
    // would make it differ from what the API sent. Headers have no raw form to
    // preserve, so the rendered block is the honest one.
    const body = tab === "headers" ? headerText : (raw ?? jsonString);
    if (!body) return;

    const isJson = tab === "body";
    const url = URL.createObjectURL(
      new Blob([body], { type: isJson ? "application/json" : "text/plain" })
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `${target.filename}.${isJson ? "json" : "txt"}`;
    link.click();
    // The object URL pins the blob in memory until it is let go.
    URL.revokeObjectURL(url);
  }, [raw, jsonString, headerText, tab, target.filename]);

  const hasResponse = Boolean(jsonString) || isLoading || Boolean(error);

  return (
    <Tabs
      value={tab}
      onValueChange={value => setTab(value as ResponseTab)}
      className="@container/response flex h-full min-h-0 flex-col"
    >
      {/* Always rendered, with placeholders holding the width. The metrics used
          to appear with the first reply, so the header reflowed at the moment
          somebody was reading it. */}
      <div
        data-testid="response-meta"
        // Wraps rather than clipping. The pane is resizable, and its minimum
        // against a wide admin sidebar leaves a few hundred pixels -- at which
        // a non-wrapping row puts the metrics past the card's clipped edge.
        className="flex shrink-0 flex-wrap items-center justify-end gap-x-4 gap-y-1 border-b border-border px-6 py-2"
      >
        <Metric label="Status">
          {status === undefined ? (
            <span className="font-mono text-sm text-muted-foreground">—</span>
          ) : (
            <>
              <span
                className={cn(
                  "h-1.5 w-1.5 rounded-full",
                  statusDotTone(status)
                )}
              />
              <span
                className={cn(
                  "font-mono text-sm font-semibold",
                  statusTone(status)
                )}
              >
                {status}
              </span>
            </>
          )}
        </Metric>
        <div className="h-4 w-px bg-border" />
        <Metric label="Latency">
          <span className="font-mono text-sm font-semibold text-foreground">
            {time === undefined ? "—" : `${time}ms`}
          </span>
        </Metric>
        <div className="h-4 w-px bg-border" />
        {/* Beside latency because they are the pair traded against each other
            when tuning depth and limit. */}
        <Metric label="Size">
          <span className="font-mono text-sm font-semibold text-foreground">
            {size === undefined ? "—" : formatBytes(size)}
          </span>
        </Metric>
      </div>

      {/* Stacks below a narrow pane so the tabs and the copy control stay
          reachable instead of overflowing the card's clipped edge. */}
      <div className="flex shrink-0 flex-col gap-1 border-b border-border bg-muted/30 px-6 py-1.5 @sm/response:flex-row @sm/response:items-center @sm/response:justify-between @sm/response:gap-2">
        <TabsList variant="ghost">
          <TabsTrigger value="body" size="sm">
            Body
          </TabsTrigger>
          <TabsTrigger value="headers" size="sm">
            Headers
            {headerEntries.length > 0 && (
              <span className="ml-1.5 font-mono text-xs text-muted-foreground">
                {headerEntries.length}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="code" size="sm">
            Code
          </TabsTrigger>
        </TabsList>

        <div className="flex items-center gap-1">
          {/* Absent on the Code tab: a snippet saved as `<collection>.json` is
              not a thing anybody wants, and offering it invites the mistake. */}
          {/* A snippet is copied, not saved: it belongs in an editor rather
              than in a file named after the collection. */}
          {tab !== "code" && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleDownload}
              disabled={!copyTarget}
              className="h-7 gap-1.5 text-xs text-muted-foreground hover:text-foreground"
            >
              <Download className="h-3.5 w-3.5" />
              Download
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              void handleCopy();
            }}
            disabled={!copyTarget}
            className="h-7 gap-1.5 text-xs text-muted-foreground hover:text-foreground"
          >
            {showCopied ? (
              <Check className="h-3.5 w-3.5 text-success" />
            ) : (
              <Copy className="h-3.5 w-3.5" />
            )}
            {showCopied ? "Copied" : "Copy"}
          </Button>
        </div>
      </div>

      {/* The mono face belongs to the JSON, which brings its own. It used to sit
          here, so the loading, error and empty states inherited it and the prose
          was set in a code face. */}
      <TabsContent
        value="body"
        className="mt-0 min-h-0 flex-1 overflow-auto bg-background selection:bg-primary selection:text-primary-foreground"
      >
        {isLoading ? (
          <div className="flex h-full flex-col items-center justify-center bg-muted/30">
            <Loader2 className="mb-4 h-8 w-8 animate-spin text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Sending request…</p>
          </div>
        ) : error ? (
          <div className="flex h-full flex-col items-center justify-center bg-destructive/5 p-12 text-center">
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-md bg-destructive/10">
              <AlertCircle className="h-6 w-6 text-destructive" />
            </div>
            <h3 className="mb-1 text-base font-semibold tracking-tight text-foreground">
              Request failed
            </h3>
            <p className="max-w-xs text-sm leading-relaxed text-muted-foreground">
              {error}
            </p>
          </div>
        ) : !jsonString ? (
          <div className="flex h-full flex-col items-center justify-center bg-muted/30 p-12 text-center">
            <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-md border border-border bg-card">
              <FileJson className="h-6 w-6 text-muted-foreground" />
            </div>
            <h3 className="mb-1 text-base font-semibold tracking-tight text-foreground">
              No response yet
            </h3>
            <p className="max-w-xs text-sm leading-relaxed text-muted-foreground">
              Send the request to see the response here. The Code tab already
              has the call.
            </p>
          </div>
        ) : (
          <JsonViewer value={jsonString} />
        )}
      </TabsContent>

      <TabsContent
        value="headers"
        className="mt-0 min-h-0 flex-1 overflow-auto"
      >
        {headerEntries.length === 0 ? (
          <div className="flex h-full items-center justify-center bg-muted/30 p-12 text-center">
            <p className="text-sm text-muted-foreground">
              {hasResponse
                ? "This response carried no headers."
                : "Send the request to see its response headers."}
            </p>
          </div>
        ) : (
          <dl className="divide-y divide-border-subtle">
            {headerEntries.map(([name, value]) => (
              <div key={name} className="grid grid-cols-3 gap-4 px-6 py-2">
                <dt className="truncate font-mono text-xs text-muted-foreground">
                  {name}
                </dt>
                {/* select-all: a header value is copied whole or not at all —
                    a request id is no use with a character missing. */}
                <dd className="col-span-2 select-all break-all font-mono text-xs text-foreground">
                  {value}
                </dd>
              </div>
            ))}
          </dl>
        )}
      </TabsContent>

      <TabsContent value="code" className="mt-0 min-h-0 flex-1 overflow-hidden">
        <CodePanel code={code} flavour={flavour} onFlavourChange={setFlavour} />
      </TabsContent>
    </Tabs>
  );
}

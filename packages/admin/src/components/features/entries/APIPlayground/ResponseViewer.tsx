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

import { CodePanel } from "./CodePanel";
import type { CodeSnippets } from "./generate-code";
import { JsonViewer } from "./JsonViewer";
import { ResponseMetrics } from "./ResponseMetrics";

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
    // `undefined` only. `null` is a VALID JSON body and stringifies to "null",
    // and collapsing the two made a real payload read as nothing returned --
    // unreadable in the pane, and un-copyable because the toolbar keys on this.
    if (data === undefined) return "";
    if (typeof data === "string") return data;
    try {
      return JSON.stringify(data, null, 2);
    } catch {
      // eslint-disable-next-line @typescript-eslint/no-base-to-string
      return String(data);
    }
  }, [data]);

  // Memoised so `headerText` can depend on it. Rebuilt on every render, the
  // array is a new identity each time and any memo keyed on it never holds.
  const headerEntries = useMemo(() => Object.entries(headers ?? {}), [headers]);

  /**
   * The headers as text, in the form they arrived in.
   *
   * `name: value` per line is what a header block IS, and it is what pasting
   * one into a request or an issue expects. Rebuilding it from the map is the
   * only option -- `fetch` gives no access to the raw block.
   */
  const headerText = useMemo(
    () => headerEntries.map(([name, value]) => `${name}: ${value}`).join("\n"),
    [headerEntries]
  );

  /**
   * What the toolbar acts on is what the reader is looking at.
   *
   * All THREE tabs, not two. Copy took the body whenever the Code tab was
   * closed, so reading the headers and pressing Copy put the body on the
   * clipboard -- the same defect this control was rewritten to remove, one tab
   * further along.
   */
  /**
   * The body as anything should act on it.
   *
   * `jsonString` is a VIEW of the body and `raw` is the bytes that arrived. A
   * body can render as an empty view and still exist -- a JSON `""` -- so
   * presence comes from the richer value, and the view is used only when it
   * has something to show. One expression rather than two, because the pane
   * and the toolbar disagreeing about whether there IS a body is exactly how
   * a real payload became uncopyable.
   */
  const bodyText = jsonString || (raw ?? "");

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
        : { text: bodyText, label: "Response", filename };
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

  // A completed request with an empty body -- a 204, or a 200 returning
  // nothing -- is a RESPONSE. Deriving this from the body alone made the
  // headers tab say "send the request" about a request that had just come
  // back, and its headers were sitting there unread.
  const hasResponse =
    status !== undefined || Boolean(jsonString) || isLoading || Boolean(error);

  return (
    <Tabs
      value={tab}
      onValueChange={value => setTab(value as ResponseTab)}
      className="@container/response flex h-full min-h-0 flex-col"
    >
      <ResponseMetrics status={status} time={time} size={size} />

      {/* Stacks below a narrow pane so the tabs and the copy control stay
          reachable instead of overflowing the card's clipped edge. */}
      <div
        data-testid="response-toolbar"
        className="flex shrink-0 flex-col gap-1 border-b border-border bg-muted/30 px-6 py-1.5 @sm/response:flex-row @sm/response:items-center @sm/response:justify-between @sm/response:gap-2"
      >
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
        ) : !bodyText ? (
          <div className="flex h-full flex-col items-center justify-center bg-muted/30 p-12 text-center">
            <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-md border border-border bg-card">
              <FileJson className="h-6 w-6 text-muted-foreground" />
            </div>
            {/* Two different facts, and telling a reader the wrong one wastes
                their time: nothing has been sent yet, versus it came back and
                carried no body -- which for a 204 is the CORRECT outcome, not
                an absence to keep waiting on. */}
            <h3 className="mb-1 text-base font-semibold tracking-tight text-foreground">
              {status === undefined ? "No response yet" : "No content"}
            </h3>
            <p className="max-w-xs text-sm leading-relaxed text-muted-foreground">
              {status === undefined ? (
                <>
                  Send the request to see the response here. The Code tab
                  already has the call.
                </>
              ) : (
                <>
                  The request returned {status} with an empty body. Its headers
                  are on the Headers tab.
                </>
              )}
            </p>
          </div>
        ) : (
          <JsonViewer value={bodyText} />
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

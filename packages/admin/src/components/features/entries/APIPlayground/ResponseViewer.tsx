"use client";

/**
 * What came back, and what to do with it.
 *
 * Three tabs rather than one JSON pane: the body answers "did it work", the
 * headers answer "why did it do that" (they carry the request id we stamp on
 * every reply), and the code answers "how do I use this", which is the step
 * the playground used to leave you to work out yourself.
 *
 * The tabs render whether or not a response exists, because the code is built
 * from the request — it is worth reading before you send, not only after.
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

import { CodePanel } from "./CodePanel";
import type { CodeSnippets } from "./generate-code";
import { JsonViewer } from "./JsonViewer";

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
}

export function ResponseViewer({
  data,
  isLoading = false,
  error = null,
  headers,
  raw,
  code,
  filename = "response",
}: ResponseViewerProps) {
  const [copied, setCopied] = useState(false);

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

  const handleCopy = useCallback(async () => {
    if (!jsonString) return;
    try {
      await navigator.clipboard.writeText(jsonString);
      setCopied(true);
      toast.success("Response copied to clipboard");
      setTimeout(() => setCopied(false), UI.COPY_FEEDBACK_TIMEOUT_MS);
    } catch {
      toast.error("Failed to copy response");
    }
  }, [jsonString]);

  /**
   * Save the body to a file.
   *
   * The bytes as they arrived, not the re-formatted view: a saved response is
   * usually about to be diffed or replayed, and pretty-printing would make it
   * differ from what the API actually sent.
   */
  const handleDownload = useCallback(() => {
    const body = raw ?? jsonString;
    if (!body) return;

    const url = URL.createObjectURL(
      new Blob([body], { type: "application/json" })
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `${filename}.json`;
    link.click();
    // The object URL pins the blob in memory until it is let go.
    URL.revokeObjectURL(url);
  }, [raw, jsonString, filename]);

  const headerEntries = Object.entries(headers ?? {});
  const hasResponse = Boolean(jsonString) || isLoading || Boolean(error);

  return (
    <Tabs defaultValue="body" className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border bg-muted/30 px-6 py-1.5">
        <TabsList className="h-8 bg-transparent p-0">
          <TabsTrigger value="body" className="text-xs">
            Body
          </TabsTrigger>
          <TabsTrigger value="headers" className="text-xs">
            Headers
            {headerEntries.length > 0 && (
              <span className="ml-1.5 font-mono text-[10px] text-muted-foreground">
                {headerEntries.length}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="code" className="text-xs">
            Code
          </TabsTrigger>
        </TabsList>

        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleDownload}
            disabled={!jsonString}
            className="h-7 gap-1.5 text-xs text-muted-foreground hover:text-foreground"
          >
            <Download className="h-3.5 w-3.5" />
            Download
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              void handleCopy();
            }}
            disabled={!jsonString}
            className="h-7 gap-1.5 text-xs text-muted-foreground hover:text-foreground"
          >
            {copied ? (
              <Check className="h-3.5 w-3.5 text-success" />
            ) : (
              <Copy className="h-3.5 w-3.5" />
            )}
            {copied ? "Copied" : "Copy"}
          </Button>
        </div>
      </div>

      <TabsContent
        value="body"
        className="mt-0 min-h-0 flex-1 overflow-auto bg-background font-mono text-xs leading-relaxed selection:bg-primary selection:text-primary-foreground"
      >
        {isLoading ? (
          <div className="flex h-full flex-col items-center justify-center bg-muted/30">
            <Loader2 className="mb-4 h-8 w-8 animate-spin text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Sending request…</p>
          </div>
        ) : error ? (
          <div className="flex h-full flex-col items-center justify-center bg-destructive/5 p-12 text-center">
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-none bg-destructive/10">
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
            <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-none border border-border bg-card">
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
        <CodePanel code={code} />
      </TabsContent>
    </Tabs>
  );
}

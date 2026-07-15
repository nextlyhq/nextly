"use client";

/**
 * API Playground Component
 *
 * Interactive API testing interface for collection endpoints.
 * Allows developers to build and execute API requests, view responses,
 * and test query parameters without leaving the admin panel.
 *
 * @module components/entries/APIPlayground/APIPlayground
 * @since 1.0.0
 */

import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  toast,
} from "@nextlyhq/ui";
import {
  useState,
  useCallback,
  useMemo,
  useEffect,
  useRef,
  lazy,
  Suspense,
} from "react";

import { RotateCcw } from "@admin/components/icons";
import { UI } from "@admin/constants/ui";
import { useTheme } from "@admin/context/providers/ThemeProvider";
import { cn } from "@admin/lib/utils";

import { generateCode } from "./generate-code";
import { QueryBuilder } from "./QueryBuilder";
import { METHOD_TONE, RequestBar } from "./RequestBar";
import { ResponseViewer } from "./ResponseViewer";

// CodeMirror reaches for browser globals on import, so it loads on demand.
const CodeMirrorEditor = lazy(() =>
  import("../fields/text/CodeMirrorEditor").then(m => ({
    default: m.CodeMirrorEditor,
  }))
);

// ============================================================================
// Types
// ============================================================================

export type HttpMethod = "GET" | "POST" | "PATCH" | "DELETE";

/** Available endpoint actions for collection entries */
export type EndpointAction =
  | "list"
  | "get"
  | "create"
  | "update"
  | "delete"
  | "count"
  | "bulk-delete"
  | "bulk-update"
  | "duplicate";

export interface APIPlaygroundProps {
  /** Collection slug */
  collectionSlug: string;
  /** Base URL for API requests (defaults to current origin) */
  baseUrl?: string;
  /** Is this playground for a Single? */
  isSingle?: boolean;
}

export interface QueryParams {
  depth?: string;
  limit?: string;
  page?: string;
  sort?: string;
  search?: string;
  where?: string;
  select?: string;
}

export interface APIResponse {
  /** HTTP status code */
  status: number;
  /** Status text (e.g., "OK", "Not Found") */
  statusText: string;
  /** Response data */
  data: unknown;
  /** Response time in milliseconds */
  time: number;
  /** Body size in bytes — what `depth` and `limit` are actually traded against. */
  size: number;
  /** What the API sent back, including the request id we stamp on every reply. */
  headers: Record<string, string>;
  /** The body as it arrived, for the raw view and for download. */
  raw: string;
}

// ============================================================================
// Constants
// ============================================================================

/** The status dot, keyed to the same meaning as the status text beside it. */
function statusDotTone(status: number): string {
  if (status >= 200 && status < 300) return "bg-success";
  if (status >= 300 && status < 400) return "bg-muted-foreground";
  if (status >= 400 && status < 500) return "bg-warning";
  if (status >= 500) return "bg-destructive";
  return "bg-muted-foreground";
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

/** Configuration for each endpoint action */
const ENDPOINT_ACTIONS: {
  value: EndpointAction;
  label: string;
  description: string;
  method: HttpMethod;
  requiresEntryId: boolean;
  pathSuffix?: string;
}[] = [
  {
    value: "list",
    label: "List Entries",
    description: "Get all entries with pagination",
    method: "GET",
    requiresEntryId: false,
  },
  {
    value: "get",
    label: "Get Entry",
    description: "Get a single entry by ID",
    method: "GET",
    requiresEntryId: true,
  },
  {
    value: "create",
    label: "Create Entry",
    description: "Create a new entry",
    method: "POST",
    requiresEntryId: false,
  },
  {
    value: "update",
    label: "Update Entry",
    description: "Update an existing entry",
    method: "PATCH",
    requiresEntryId: true,
  },
  {
    value: "delete",
    label: "Delete Entry",
    description: "Delete an entry by ID",
    method: "DELETE",
    requiresEntryId: true,
  },
  {
    value: "count",
    label: "Count Entries",
    description: "Get total entry count",
    method: "GET",
    requiresEntryId: false,
    pathSuffix: "/count",
  },
  {
    value: "bulk-delete",
    label: "Bulk Delete",
    description: "Delete multiple entries by IDs",
    method: "POST",
    requiresEntryId: false,
    pathSuffix: "/bulk-delete",
  },
  {
    value: "bulk-update",
    label: "Bulk Update",
    description: "Update multiple entries by IDs",
    method: "POST",
    requiresEntryId: false,
    pathSuffix: "/bulk-update",
  },
  {
    value: "duplicate",
    label: "Duplicate Entry",
    description: "Create a copy of an entry",
    method: "POST",
    requiresEntryId: true,
    pathSuffix: "/duplicate",
  },
];

// ============================================================================
// Component
// ============================================================================

/**
 * APIPlayground - Interactive API testing interface
 *
 * Provides a Postman-like interface for testing collection API endpoints
 * with support for:
 * - Structured endpoint builder with action selection
 * - Entry ID input for single-entry operations
 * - Query parameter builder
 * - Request body editor for POST/PATCH
 * - Response viewer with status, timing, and formatted JSON
 *
 * @example
 * ```tsx
 * <APIPlayground collectionSlug="posts" />
 * ```
 */
export function APIPlayground({
  collectionSlug,
  baseUrl = "",
  isSingle = false,
}: APIPlaygroundProps) {
  // Structured endpoint state
  const [action, setAction] = useState<EndpointAction>(
    isSingle ? "get" : "list"
  );
  const [entryId, setEntryId] = useState("");
  const [queryParams, setQueryParams] = useState<QueryParams>({});
  const [requestBody, setRequestBody] = useState("");

  // Response state
  const [response, setResponse] = useState<APIResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Copy state
  const [copied, setCopied] = useState(false);

  const { resolvedTheme } = useTheme();

  /** The in-flight request, so a re-send or Escape can call it off. */
  const abortRef = useRef<AbortController | null>(null);

  /**
   * Get the current action configuration
   */
  const currentAction = useMemo(() => {
    return (
      ENDPOINT_ACTIONS.find(a => a.value === action) ?? ENDPOINT_ACTIONS[0]
    );
  }, [action]);

  /**
   * The HTTP method is derived from the action
   */
  const method = currentAction.method;

  /**
   * Build the endpoint path from structured components
   */
  const endpointPath = useMemo(() => {
    if (isSingle) {
      return `/admin/api/singles/${collectionSlug}`;
    }

    const basePath = `/admin/api/collections/${collectionSlug}/entries`;

    // For actions that require an entry ID
    if (currentAction.requiresEntryId && entryId) {
      if (currentAction.pathSuffix) {
        // e.g., /api/collections/posts/entries/123/duplicate
        return `${basePath}/${entryId}${currentAction.pathSuffix}`;
      }
      // e.g., /api/collections/posts/entries/123
      return `${basePath}/${entryId}`;
    }

    // For actions with a path suffix but no entry ID
    if (currentAction.pathSuffix) {
      // e.g., /api/collections/posts/entries/count
      return `${basePath}${currentAction.pathSuffix}`;
    }

    // Default: just the base path
    return basePath;
  }, [collectionSlug, currentAction, entryId, isSingle]);

  /**
   * Build the full API URL from current state
   */
  const apiUrl = useMemo(() => {
    // Build query string
    const params = new URLSearchParams();
    Object.entries(queryParams).forEach(([key, value]) => {
      if (value && value.trim()) {
        params.set(key, value.trim());
      }
    });

    const queryString = params.toString();
    return queryString ? `${endpointPath}?${queryString}` : endpointPath;
  }, [endpointPath, queryParams]);

  /**
   * Full URL including origin
   */
  const fullUrl = useMemo(() => {
    const origin =
      baseUrl || (typeof window !== "undefined" ? window.location.origin : "");
    return `${origin}${apiUrl}`;
  }, [baseUrl, apiUrl]);

  /**
   * Generate placeholder request body based on action
   */
  const getBodyPlaceholder = useCallback(() => {
    switch (action) {
      case "create":
      case "update":
        return `{\n  "title": "Example Entry",\n  "status": "draft"\n}`;
      case "bulk-delete":
        return `{\n  "ids": ["id1", "id2", "id3"]\n}`;
      case "bulk-update":
        return `{\n  "ids": ["id1", "id2"],\n  "data": {\n    "status": "published"\n  }\n}`;
      default:
        return `{\n  "key": "value"\n}`;
    }
  }, [action]);

  /**
   * Clear entry ID when switching to an action that doesn't require it
   */
  useEffect(() => {
    if (!currentAction.requiresEntryId) {
      setEntryId("");
    }
  }, [currentAction.requiresEntryId]);

  /**
   * Execute the API request
   */
  const executeRequest = useCallback(async () => {
    // A second send replaces the first rather than racing it: the slower reply
    // could otherwise land last and overwrite the newer one.
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setIsLoading(true);
    setError(null);
    const startTime = performance.now();

    try {
      const options: RequestInit = {
        method,
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include", // Include cookies for authentication
        signal: controller.signal,
      };

      // Add body for POST/PATCH requests
      if (["POST", "PATCH"].includes(method) && requestBody.trim()) {
        try {
          // Validate JSON before sending
          JSON.parse(requestBody);
          options.body = requestBody;
        } catch {
          throw new Error("Invalid JSON in request body");
        }
      }

      const res = await fetch(fullUrl, options);
      const endTime = performance.now();

      // Read the body as text first: it is what gets measured, downloaded and
      // shown raw, and parsing it is only one of the things we do with it.
      const raw = await res.text();

      let data: unknown = raw;
      if (res.headers.get("content-type")?.includes("json")) {
        try {
          data = JSON.parse(raw);
        } catch {
          // A malformed body is a result worth seeing, not a failed request —
          // showing the text beats replacing it with a parser message.
          data = raw;
        }
      }

      const headers: Record<string, string> = {};
      res.headers.forEach((value, key) => {
        headers[key] = value;
      });

      setResponse({
        status: res.status,
        statusText: res.statusText,
        data,
        time: Math.round(endTime - startTime),
        size: new TextEncoder().encode(raw).length,
        headers,
        raw,
      });
    } catch (err) {
      // An abort is the user changing their mind; leave the previous response
      // alone rather than reporting their own keystroke back to them.
      if (err instanceof DOMException && err.name === "AbortError") return;

      const endTime = performance.now();
      const message = err instanceof Error ? err.message : "Request failed";
      setError(message);
      setResponse({
        status: 0,
        statusText: "Error",
        data: { error: message },
        time: Math.round(endTime - startTime),
        size: 0,
        headers: {},
        raw: message,
      });
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
        setIsLoading(false);
      }
    }
  }, [method, fullUrl, requestBody]);

  /** Stop an in-flight request without touching what is already on screen. */
  const cancelRequest = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setIsLoading(false);
  }, []);

  /**
   * Send with the keyboard, the way every API client does.
   *
   * Bound to the window rather than a form: the send is worth reaching from
   * wherever you are, and where you are is usually the body editor or a
   * parameter field. Escape is not prevented — an open menu should still close
   * on the same press.
   */
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        void executeRequest();
        return;
      }
      if (e.key === "Escape" && isLoading) {
        cancelRequest();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [executeRequest, cancelRequest, isLoading]);

  /**
   * Reset the playground to initial state
   */
  const handleReset = useCallback(() => {
    setAction(isSingle ? "get" : "list");
    setEntryId("");
    setQueryParams({});
    setRequestBody("");
    setResponse(null);
    setError(null);
  }, [isSingle]);

  /**
   * Copy URL to clipboard
   */
  const handleCopyUrl = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(fullUrl);
      setCopied(true);
      toast.success("URL copied to clipboard");
      setTimeout(() => setCopied(false), UI.COPY_FEEDBACK_TIMEOUT_MS);
    } catch {
      toast.error("Failed to copy URL");
    }
  }, [fullUrl]);

  /**
   * Open URL in new tab
   */
  const handleOpenInNewTab = useCallback(() => {
    window.open(fullUrl, "_blank", "noopener,noreferrer");
  }, [fullUrl]);

  /**
   * Colour a response by what its status class means.
   *
   * Tokens rather than palette classes, so the hues track the theme and stay
   * legible in dark mode. A 4xx is the caller's mistake and a 5xx is the
   * server's, so they read as warning and error respectively.
   */
  const getStatusColor = (status: number): string => {
    if (status >= 200 && status < 300) return "text-success";
    if (status >= 300 && status < 400) return "text-muted-foreground";
    if (status >= 400 && status < 500) return "text-warning";
    if (status >= 500) return "text-destructive";
    return "text-muted-foreground";
  };

  /**
   * Check if the current action requires a request body
   */
  const actionRequiresBody = [
    "create",
    "update",
    "bulk-delete",
    "bulk-update",
  ].includes(action);

  /**
   * The request, as code you can leave with.
   *
   * Recomputed as the request is built rather than on send: the snippet is
   * most useful while you are still deciding what to ask for, and it costs
   * nothing to keep it honest.
   */
  const codeSnippets = useMemo(
    () =>
      generateCode({
        method,
        url: fullUrl,
        body: actionRequiresBody ? requestBody : undefined,
        collection: collectionSlug,
        isSingle,
        params: Object.fromEntries(
          Object.entries(queryParams).filter(([, v]) => v && v.trim())
        ),
      }),
    [
      method,
      fullUrl,
      actionRequiresBody,
      requestBody,
      collectionSlug,
      isSingle,
      queryParams,
    ]
  );

  /**
   * Check if entry ID is missing when required
   */
  const entryIdMissing =
    !isSingle && currentAction.requiresEntryId && !entryId.trim();

  return (
    // Fills the height it is given rather than demanding a minimum: the panes
    // below scroll on their own, so the page never grows past the panel and
    // the request bar and the response's status stay put.
    <div className="flex h-full min-h-0 flex-col gap-4">
      <RequestBar
        method={method}
        url={fullUrl}
        action={
          <Select
            value={action}
            onValueChange={v => setAction(v as EndpointAction)}
            disabled={isSingle}
          >
            <SelectTrigger className="h-full rounded-none border-0 px-4 text-sm shadow-none focus:ring-0">
              {/* The trigger renders its own content rather than echoing the
                  chosen item: the item carries a description for the menu, and
                  the default would drag that into the bar and wrap it. */}
              <SelectValue>
                <span className="flex items-baseline gap-2">
                  <span
                    className={cn(
                      "shrink-0 font-mono text-[10px] font-semibold",
                      METHOD_TONE[currentAction.method]
                    )}
                  >
                    {currentAction.method}
                  </span>
                  <span className="truncate text-sm">
                    {currentAction.label}
                  </span>
                </span>
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {ENDPOINT_ACTIONS.filter(a =>
                isSingle ? ["get", "update"].includes(a.value) : true
              ).map(a => (
                <SelectItem key={a.value} value={a.value}>
                  {/* The description rides in the menu, where there is room
                      for it: naming what an operation does is how someone
                      finds Duplicate or Bulk Update without reading docs. */}
                  <div className="flex items-baseline gap-2">
                    <span
                      className={cn(
                        "w-12 shrink-0 font-mono text-[10px] font-semibold",
                        METHOD_TONE[a.method]
                      )}
                    >
                      {a.method}
                    </span>
                    <span className="text-sm">{a.label}</span>
                    <span className="text-xs text-muted-foreground">
                      {a.description}
                    </span>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
        isLoading={isLoading}
        copied={copied}
        onSend={() => {
          if (!entryIdMissing) void executeRequest();
        }}
        onCancel={cancelRequest}
        onCopy={() => {
          void handleCopyUrl();
        }}
        onOpen={handleOpenInNewTab}
      />

      {/* Stacked on narrow screens, where two scroll panes side by side would
          leave neither usable, so the page scrolls there instead. */}
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-8 lg:grid-cols-12">
        {/* Request Builder Panel - 5 columns */}
        <Card className="lg:col-span-5 flex flex-col min-h-0 rounded-none border-border shadow-none bg-card overflow-hidden">
          <CardHeader className="p-6 pb-4" noBorder>
            <div className="flex items-center justify-between">
              <CardTitle className="text-base font-semibold tracking-tight text-foreground">
                Request configuration
              </CardTitle>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleReset}
                className="gap-2 text-sm font-medium text-muted-foreground hover:text-foreground"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Reset
              </Button>
            </div>
          </CardHeader>
          <CardContent className="flex-1 min-h-0 overflow-y-auto space-y-6 px-6 pb-6">
            {/* The base path and the full URL both used to be restated here; the
              bar above shows the real thing, so they were saying it a third
              time and only the bar can be trusted to stay correct. */}

            {/* Entry ID Input (conditional) */}
            {!isSingle && currentAction.requiresEntryId && (
              <div className="space-y-2">
                <Label className="text-sm font-medium text-foreground">
                  Entry ID <span className="text-destructive">*</span>
                </Label>
                <Input
                  value={entryId}
                  onChange={e => setEntryId(e.target.value)}
                  placeholder="Enter entry ID (e.g., abc123)"
                  className="font-mono text-xs"
                />
                {entryIdMissing && (
                  <p className="text-xs text-destructive">
                    Entry ID is required for this action
                  </p>
                )}
              </div>
            )}

            {/* A body only exists for the actions that carry one, so the tabs
              only exist then too — a single-tab tab bar is a control that
              cannot do anything. */}
            {actionRequiresBody ? (
              <Tabs
                defaultValue="body"
                className="flex-1 flex flex-col min-h-0 pt-2"
              >
                <TabsList className="w-full justify-start">
                  {/* Body first: on a write it is what you came to edit. */}
                  <TabsTrigger value="body">Body</TabsTrigger>
                  <TabsTrigger value="params">Parameters</TabsTrigger>
                </TabsList>

                <TabsContent value="body" className="mt-4 flex-1 min-h-0">
                  {/* A JSON editor rather than a textarea: this is the one
                    field you type code into, and it was the only one without
                    highlighting, bracket matching, or a line to point at when
                    the JSON is wrong. */}
                  <div className="flex h-full min-h-0 flex-col gap-2">
                    <Label className="text-sm font-medium text-foreground">
                      Request body (JSON)
                    </Label>
                    <div className="min-h-0 flex-1 border border-input">
                      <Suspense
                        fallback={
                          <div className="h-full w-full animate-pulse bg-muted/30" />
                        }
                      >
                        <CodeMirrorEditor
                          value={requestBody}
                          onChange={setRequestBody}
                          language="json"
                          theme={resolvedTheme === "dark" ? "dark" : "light"}
                          disabled={false}
                          readOnly={false}
                          minHeight={320}
                          editorOptions={{ tabSize: 2, lineNumbers: true }}
                          placeholder={getBodyPlaceholder()}
                        />
                      </Suspense>
                    </div>
                  </div>
                </TabsContent>

                <TabsContent value="params" className="mt-4">
                  <QueryBuilder
                    params={queryParams}
                    onChange={setQueryParams}
                    collectionSlug={collectionSlug}
                    isSingle={isSingle}
                  />
                </TabsContent>
              </Tabs>
            ) : (
              <div className="pt-2">
                <QueryBuilder
                  params={queryParams}
                  onChange={setQueryParams}
                  collectionSlug={collectionSlug}
                  isSingle={isSingle}
                />
              </div>
            )}
          </CardContent>
        </Card>

        {/* Response Panel - 7 columns */}
        <Card className="lg:col-span-7 flex flex-col min-h-0 rounded-none border-border shadow-none bg-card overflow-hidden">
          <CardHeader className="p-6 pb-4" noBorder>
            <div className="flex items-center justify-between gap-4">
              <CardTitle className="text-base font-semibold tracking-tight text-foreground">
                API response
              </CardTitle>
              {response && (
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">
                      Status
                    </span>
                    <span
                      className={cn(
                        "h-1.5 w-1.5 rounded-full",
                        statusDotTone(response.status)
                      )}
                    />
                    <span
                      className={cn(
                        "font-mono text-sm font-semibold",
                        getStatusColor(response.status)
                      )}
                    >
                      {response.status}
                    </span>
                  </div>
                  <div className="h-4 w-px bg-border" />
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">
                      Latency
                    </span>
                    <span className="font-mono text-sm font-semibold text-foreground">
                      {response.time}ms
                    </span>
                  </div>
                  <div className="h-4 w-px bg-border" />
                  {/* Size sits beside latency because they are the pair you
                      trade against each other when tuning depth and limit. */}
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">Size</span>
                    <span className="font-mono text-sm font-semibold text-foreground">
                      {formatBytes(response.size)}
                    </span>
                  </div>
                </div>
              )}
            </div>
          </CardHeader>
          <CardContent className="flex-1 min-h-0 p-0 overflow-hidden">
            <ResponseViewer
              data={response?.data}
              isLoading={isLoading}
              error={error}
              headers={response?.headers}
              raw={response?.raw}
              code={codeSnippets}
              filename={`${collectionSlug}-response`}
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

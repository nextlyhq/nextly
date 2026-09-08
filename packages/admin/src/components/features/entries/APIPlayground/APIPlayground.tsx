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
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  toast,
  useShortcuts,
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
import { useHydration } from "@admin/hooks/useHydration";
import { useMediaQuery } from "@admin/hooks/useMediaQuery";
import { usePersistedState } from "@admin/hooks/usePersistedState";
import { cn } from "@admin/lib/utils";

import { generateCode } from "./generate-code";
import type { PlaygroundField, WhereCondition } from "./query-fields";
import { formatWhere } from "./query-fields";
import { QueryBuilder } from "./QueryBuilder";
import { METHOD_SEMANTICS, RequestBar } from "./RequestBar";
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

/**
 * The request pane's share of the split, as a percentage.
 *
 * Two panes have ONE degree of freedom, so a single number describes the layout
 * and the response pane takes the remainder -- which means there is nothing to
 * keep consistent. Stored as a string because that is what the persistence hook
 * holds; the validator is what keeps it a number in range.
 */
const SPLIT_KEY = "nextly:admin:api-playground:split";
const SPLIT_DEFAULT = "40";
const isSplit = (value: string): value is string => {
  const share = Number(value);
  return Number.isFinite(share) && share >= 25 && share <= 75;
};

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
  /**
   * The collection's fields, so the parameter controls can offer them.
   *
   * The pages that render this already hold the schema, so passing it means
   * nobody has to recall a field name to build a request.
   */
  fields?: PlaygroundField[];
  /** Whether Draft/Published is enabled, which makes `status` filterable. */
  hasStatus?: boolean;
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
  fields,
  hasStatus = false,
}: APIPlaygroundProps) {
  // Structured endpoint state
  const [action, setAction] = useState<EndpointAction>(
    isSingle ? "get" : "list"
  );
  const [entryId, setEntryId] = useState("");
  const [queryParams, setQueryParams] = useState<QueryParams>({});
  // The where rows live here rather than in the builder: they are part of the
  // request, so Reset has to reach them, and the URL is derived from them.
  const [whereConditions, setWhereConditions] = useState<WhereCondition[]>([]);
  const [requestBody, setRequestBody] = useState("");

  // Response state
  const [response, setResponse] = useState<APIResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Copy state
  const [copied, setCopied] = useState(false);

  // The group is rendered only after hydration, which is what lets the stored
  // layout be the one it mounts with. `usePersistedState` reads storage in an
  // effect, and both effects land in the same flush, so the group mounts once
  // already holding the restored value rather than mounting on the default and
  // being corrected afterwards.
  const hydrated = useHydration();
  // `lg`, as a query rather than a class, because this CHOOSES a tree instead
  // of styling one. Rendering both and hiding one with CSS would put the query
  // builder's labelled fields in the document twice, and a screen reader would
  // read every one of them twice with no way to tell which is the hidden copy.
  const isWide = useMediaQuery("(min-width: 64rem)");
  const [split, setSplit] = usePersistedState(
    SPLIT_KEY,
    SPLIT_DEFAULT,
    isSplit
  );

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
   * The parameters as they go on the wire.
   *
   * `where` is derived from the rows here rather than stored beside them, so
   * there is only one thing to keep true. Everything downstream — the URL, the
   * request, the snippets — reads this instead of the raw state.
   */
  const effectiveParams = useMemo((): QueryParams => {
    const where = formatWhere(whereConditions);
    return where ? { ...queryParams, where } : queryParams;
  }, [queryParams, whereConditions]);

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
    Object.entries(effectiveParams).forEach(([key, value]) => {
      if (value && value.trim()) {
        params.set(key, value.trim());
      }
    });

    const queryString = params.toString();
    return queryString ? `${endpointPath}?${queryString}` : endpointPath;
  }, [endpointPath, effectiveParams]);

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
  /**
   * Whether the request is missing the entry ID its action needs.
   *
   * Above `executeRequest` so the send itself can refuse. The button used to
   * be the only thing that checked, which made the guard a property of one
   * control rather than of the request: ⌘↵ went straight through and sent the
   * collection's base path instead — a different request from the one the
   * disabled button was describing.
   */
  const entryIdMissing =
    !isSingle && currentAction.requiresEntryId && !entryId.trim();

  const executeRequest = useCallback(async () => {
    if (entryIdMissing) return;

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
  }, [method, fullUrl, requestBody, entryIdMissing]);

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
  useShortcuts(
    [
      {
        keys: "mod+Enter",
        description: "Send the request",
        run: () => void executeRequest(),
        // Sending is the whole point of the panel and the cursor is normally still in a parameter
        // field when the user reaches for it, so this one fires while typing.
        whenTyping: true,
      },
      {
        keys: "Escape",
        description: "Cancel the in-flight request",
        run: () => cancelRequest(),
        when: () => isLoading,
        // Left unprevented so the same press still closes an open menu or popover: Escape means
        // "back out of the nearest thing", and cancelling the request is only what it means when
        // nothing nearer has claimed it.
        preventDefault: false,
      },
    ],
    { name: "api-playground" }
  );

  /**
   * Reset the playground to initial state
   */
  const handleReset = useCallback(() => {
    setAction(isSingle ? "get" : "list");
    setEntryId("");
    setQueryParams({});
    setWhereConditions([]);
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
        action,
        entryId: entryId.trim() || undefined,
        params: Object.fromEntries(
          Object.entries(effectiveParams).filter(([, v]) => v && v.trim())
        ),
      }),
    [
      method,
      fullUrl,
      actionRequiresBody,
      requestBody,
      collectionSlug,
      isSingle,
      effectiveParams,
      action,
      entryId,
    ]
  );

  // Declared once and rendered by whichever branch is live below. Two
  // copies of a pane is how the two ROUTE files drifted, and the same trap
  // applies one level down.
  const requestPane = (
    <Card className="flex h-full flex-col min-h-0 rounded-lg border-border shadow-none bg-card overflow-hidden">
      <CardHeader className="p-6 pb-4" noBorder>
        {/* Wraps rather than clipping. The pane is draggable down to a quarter
            of the group, which against a wide sidebar is under 200px -- less
            than this title and Reset need side by side -- and the card clips to
            its own corner, so the overflow is not scrolled to, it is gone.
            Wrapping costs a line at widths where the alternative is a control
            nobody can reach. */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="min-w-0 text-base font-semibold tracking-tight text-foreground">
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
            <Label
              htmlFor="playground-entry-id"
              className="text-sm font-medium text-foreground"
            >
              Entry ID <span className="text-destructive">*</span>
            </Label>
            <Input
              id="playground-entry-id"
              value={entryId}
              onChange={e => setEntryId(e.target.value)}
              placeholder="Enter entry ID (e.g., abc123)"
              className="font-mono text-xs"
              aria-required
              aria-invalid={entryIdMissing || undefined}
              aria-describedby={
                entryIdMissing ? "playground-entry-id-error" : undefined
              }
            />
            {entryIdMissing && (
              <p
                id="playground-entry-id-error"
                className="text-xs text-destructive"
              >
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
                {/* `htmlFor` cannot reach it: CodeMirror owns a contenteditable
                    rather than a form control, so the label is bound by id and
                    the editor names itself with the same words. */}
                <Label
                  id="playground-request-body-label"
                  className="text-sm font-medium text-foreground"
                >
                  Request body (JSON)
                </Label>
                <div
                  role="group"
                  aria-labelledby="playground-request-body-label"
                  className="min-h-0 flex-1 rounded-md border border-input"
                >
                  <Suspense
                    fallback={
                      <div className="h-full w-full animate-pulse bg-muted/30" />
                    }
                  >
                    <CodeMirrorEditor
                      value={requestBody}
                      onChange={setRequestBody}
                      language="json"
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
                conditions={whereConditions}
                onConditionsChange={setWhereConditions}
                fields={fields}
                hasStatus={hasStatus}
                isSingle={isSingle}
              />
            </TabsContent>
          </Tabs>
        ) : (
          <div className="pt-2">
            <QueryBuilder
              params={queryParams}
              onChange={setQueryParams}
              conditions={whereConditions}
              onConditionsChange={setWhereConditions}
              fields={fields}
              hasStatus={hasStatus}
              isSingle={isSingle}
            />
          </div>
        )}
      </CardContent>
    </Card>
  );

  const responsePane = (
    <Card className="flex h-full flex-col min-h-0 rounded-lg border-border shadow-none bg-card overflow-hidden">
      <CardHeader className="p-6 pb-4" noBorder>
        <CardTitle className="text-base font-semibold tracking-tight text-foreground">
          API response
        </CardTitle>
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
          status={response?.status}
          time={response?.time}
          size={response?.size}
        />
      </CardContent>
    </Card>
  );

  return (
    // Fills the height it is given rather than demanding a minimum: the panes
    // below scroll on their own, so the page never grows past the panel and
    // the request bar and the response's status stay put.
    <div className="flex h-full min-h-0 flex-col gap-4">
      <RequestBar
        method={method}
        url={fullUrl}
        action={
          // Enabled for a single too: it has two actions, and the list below
          // offers both. Disabling the picker left `update` selectable in
          // theory and unreachable in practice, so a single's write endpoint
          // could not be tried here at all — while everything behind it, the
          // PATCH, the URL and the body tab, already handled it.
          <Select
            value={action}
            onValueChange={v => setAction(v as EndpointAction)}
          >
            <SelectTrigger className="h-full rounded-md border-0 px-4 text-sm shadow-none focus:ring-0">
              {/* The trigger renders its own content rather than echoing the
                  chosen item: the item carries a description for the menu, and
                  the default would drag that into the bar and wrap it. */}
              <SelectValue>
                <span className="flex items-baseline gap-2">
                  <span
                    className={cn(
                      "shrink-0 font-mono text-xs font-semibold",
                      METHOD_SEMANTICS[currentAction.method].tone
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
                        "w-12 shrink-0 font-mono text-xs font-semibold",
                        METHOD_SEMANTICS[a.method].tone
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
          void executeRequest();
        }}
        onCancel={cancelRequest}
        onCopy={() => {
          void handleCopyUrl();
        }}
        onOpen={handleOpenInNewTab}
      />

      {/* Declared once and rendered by whichever branch is live. Two copies of
          a pane is how the two ROUTE files drifted, and the same trap applies
          one level down. */}
      <>
        {!hydrated ? (
          /* Neither hook can answer before mount, and answering "stacked" is a
             guess that is wrong on most desktops: the stacked tree would paint,
             then be replaced by the splitter, shifting the layout and mounting
             both panes' editors twice. A skeleton commits to nothing and mounts
             nothing heavy. */
          <div
            data-testid="playground-pending"
            className="min-h-0 flex-1 animate-pulse rounded-lg border border-border bg-muted/30"
          />
        ) : isWide ? (
          <div className="flex min-h-0 flex-1">
            <ResizablePanelGroup
              orientation="horizontal"
              className="min-h-0 flex-1"
              defaultLayout={{
                request: Number(split),
                response: 100 - Number(split),
              }}
              onLayoutChanged={(layout, meta) => {
                // The group reports every layout it settles on, and the mount
                // pass arrives BEFORE the restored one takes effect -- so an
                // unconditional write saves the freshly measured default over
                // the layout being restored, and widths reset on every reload
                // while appearing to persist within a session.
                // `isUserInteraction` is true only for a drag or a resize key,
                // which is the one event that states an intent about widths.
                if (!meta.isUserInteraction) return;
                setSplit(String(Math.round(layout.request)));
              }}
            >
              <ResizablePanel id="request" minSize="25%">
                {requestPane}
              </ResizablePanel>
              <ResizableHandle
                withGrip
                className="mx-4"
                aria-label="Request and response"
              />
              <ResizablePanel id="response" minSize="30%">
                {responsePane}
              </ResizablePanel>
            </ResizablePanelGroup>
          </div>
        ) : (
          /* Stacked below `lg`, and until hydration: a splitter needs a
             pointer and a measured width, and neither exists on a narrow
             viewport or on the server. The two arms are exclusive so the panes
             are in the document once, whichever is chosen. */
          <div className="grid min-h-0 flex-1 grid-cols-1 gap-8">
            {requestPane}
            {responsePane}
          </div>
        )}
      </>
    </div>
  );
}

/**
 * The API Playground's page shell, for a collection or a single.
 *
 * One component rather than one per route. The two routes were hand-kept
 * copies of the same ~140 lines, and they drifted: a scroll-containment fix
 * reached the collection's copy and not the single's, so a single's panes
 * collapsed to their content and left the lower third of the page empty. That
 * is invisible in review, because each file reads correctly on its own and
 * nothing compares them.
 *
 * The differences between the two are small enough to be arguments -- which
 * schema hook to call, what to call the thing in prose, and which props the
 * playground needs -- so they are arguments.
 *
 * @module components/entries/APIPlayground/ApiPlaygroundPage
 */

import { Alert, AlertDescription, AlertTitle, Skeleton } from "@nextlyhq/ui";

import { AlertCircle } from "@admin/components/icons";
import { PageContainer } from "@admin/components/layout/page-container";
import { useCollection, useSingleSchema } from "@admin/hooks/queries";

import { APIPlayground } from "./APIPlayground";

/** Which of the two schema kinds this page is showing. */
export type ApiPlaygroundKind = "collection" | "single";

export interface ApiPlaygroundPageProps {
  kind: ApiPlaygroundKind;
  /** Absent when the route matched without one, which is worth saying rather than crashing. */
  slug?: string;
}

/** What each kind is called in prose, so the copy reads naturally either way. */
const NOUN: Record<ApiPlaygroundKind, string> = {
  collection: "collection",
  single: "single",
};

export function ApiPlaygroundPage({ kind, slug }: ApiPlaygroundPageProps) {
  const isSingle = kind === "single";
  const noun = NOUN[kind];

  // Both hooks are called unconditionally because hooks must be, and each is
  // disabled unless it is the one this page needs -- so the other issues no
  // request rather than being skipped.
  const collection = useCollection(slug ?? "", {
    enabled: !!slug && !isSingle,
  });
  const single = useSingleSchema(slug ?? "", {
    enabled: !!slug && isSingle,
  });

  const { data: schema, isLoading, error } = isSingle ? single : collection;

  if (!slug) {
    return (
      <div className="p-6">
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>
            {`A ${noun} slug is required. Please navigate to a ${noun} first.`}
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="p-6 space-y-6">
        {/* Breadcrumb skeleton */}
        <div className="flex items-center gap-2">
          <Skeleton className="h-4 w-4" />
          <Skeleton className="h-4 w-4" />
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-4 w-4" />
          <Skeleton className="h-4 w-32" />
        </div>

        {/* Header skeleton */}
        <div className="space-y-2">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-4 w-96" />
        </div>

        {/* Content skeleton */}
        <div className="grid grid-cols-2 gap-6">
          <Skeleton className="h-[500px]" />
          <Skeleton className="h-[500px]" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>
            {`Failed to load ${noun}: `}
            {error.message}
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  const label = schema?.label || slug;

  return (
    // Fills the content panel instead of growing past it, so the request and
    // response panes scroll on their own. Otherwise a long response stretches
    // the page and takes the response's own status line off-screen with it.
    <PageContainer className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="mb-8 shrink-0">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          API Playground
        </h1>
        {/* Muted foreground so this secondary subtitle meets contrast (a faint primary alpha did not). */}
        <p className="text-sm font-normal text-muted-foreground mt-1">
          Test API endpoints for the <strong>{label}</strong> {noun}. Build
          requests, execute them, and view responses.
        </p>
      </div>

      <div className="min-h-0 flex-1">
        <APIPlayground
          collectionSlug={slug}
          isSingle={isSingle}
          fields={schema?.fields}
          // Only a collection has a Draft/Published column to filter on, and a
          // single's schema carries no `status` to read.
          hasStatus={!isSingle && collection.data?.status === true}
        />
      </div>
    </PageContainer>
  );
}

"use client";

/**
 * What the collections and Singles landing pages show once they have picked
 * the entity to open, if any: nothing while the list or the server's answer
 * about what the user may do is still in flight, a redirect to the entity,
 * the failure when that answer could not be had, and otherwise the page's
 * own empty state.
 *
 * One place for both pages, because the rule is the same and subtle: an
 * empty list filtered through no answer reads exactly like an install with
 * nothing in it, so "nothing here yet" is claimed only once the answer is in.
 */

import { useEffect, type JSX } from "react";

import { PageContainer } from "@admin/components/layout/page-container";
import { SectionErrorFallback } from "@admin/components/shared/error-fallbacks";
import { useCurrentUserPermissions } from "@admin/hooks/useCurrentUserPermissions";
import { navigateTo } from "@admin/lib/navigation";

export function LandingOutcome({
  listLoading,
  target,
  subject,
  empty,
}: {
  /** Whether the page's own list is still loading. */
  listLoading: boolean;
  /** Where to send the user, when there is an entity to open. */
  target: string | undefined;
  subject: "collections" | "Singles";
  /** The page's empty state, once nothing readable is known to exist. */
  empty: JSX.Element;
}): JSX.Element {
  const { content, retry } = useCurrentUserPermissions();
  // The list is filtered through the server's answer about each entity, so
  // it is not settled until that answer is.
  const pending = listLoading || content.isLoading;

  useEffect(() => {
    if (!pending && target) navigateTo(target);
  }, [pending, target]);

  if (pending || target) {
    return <div className="h-32" aria-hidden="true" />;
  }

  if (!content.hasAnswer && content.error) {
    return (
      <PageContainer className="py-8">
        <SectionErrorFallback
          title="Couldn't check your access"
          description={`The admin couldn't load what you may do with ${subject}, so it can't tell which ones to show.`}
          error={content.error}
          reset={retry}
        />
      </PageContainer>
    );
  }

  return empty;
}

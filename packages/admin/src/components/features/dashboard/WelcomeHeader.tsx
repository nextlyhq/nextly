"use client";

import { useDashboardUser } from "@admin/hooks/useDashboardUser";

function getFirstName(name: string | undefined | null): string {
  if (!name) return "there";
  const first = name.split(" ")[0];
  return first || "there";
}

/**
 * Top-of-dashboard welcome strip, holding the page's one level-one heading.
 *
 * It renders in every state, from first paint: the heading is where a
 * screen-reader or keyboard user lands when they jump by heading, and every
 * card title (an `h2`) sits under it in the outline. So it does not step aside
 * for the sample-content card, and it does not wait for the signed-in user:
 * until they are known it reads "Welcome" with a placeholder where the name
 * goes, and the name fills in without moving anything.
 *
 * Copy is intentionally neutral — works for both first-time visitors and
 * returners, since the dashboard surfaces content + schemas + team
 * regardless of when you came back.
 */
export function WelcomeHeader() {
  const { user, isLoading: userLoading } = useDashboardUser();

  return (
    <div className="space-y-1 pb-4">
      <h1
        aria-busy={userLoading || undefined}
        className="text-xl font-semibold tracking-[-0.04em] text-foreground leading-tight"
      >
        {userLoading ? (
          <>
            Welcome
            {/* A span, not the shared Skeleton (a div, which a heading may not
                contain), with the same tokens. Hidden from assistive tech so the
                heading's name is "Welcome" until the user arrives. */}
            <span
              aria-hidden="true"
              className="ml-2 inline-block h-5 w-24 align-middle bg-primary/5 animate-pulse rounded-md motion-reduce:animate-none"
            />
          </>
        ) : (
          <>
            Welcome,{" "}
            {/* Same ink as the heading it sits in; the name is emphasis of the
                title, not an action. */}
            <span className="text-foreground">{getFirstName(user?.name)}</span>
          </>
        )}
      </h1>
      <p className="text-sm font-normal text-muted-foreground tracking-tight">
        Manage your content, schemas, and team from one place.
      </p>
    </div>
  );
}

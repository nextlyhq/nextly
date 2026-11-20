/**
 * The "Waiting for my review" view (R-11, D10): every part whose next step the reader may take and
 * that waits for them, across collections and Singles. Each row names its document (a link to it),
 * where it lives, its stage, whom it waits for and when it was submitted. The count is a floor
 * ("1000+") where the list read only so far.
 *
 * @module components/features/content/waiting/WaitingForMyReview
 * @experimental
 */

import { Button } from "@nextlyhq/ui";
import { useState, type JSX } from "react";

import { Link } from "@admin/components/ui/link";
import { useWaitingForMe } from "@admin/hooks/queries/useWaitingForMe";
import { apiErrorMessage } from "@admin/lib/api/parseApiError";

/** Rows on one page of the view. */
const PAGE_SIZE = 50;

/** When a part was submitted, as a short date in the reader's own locale. */
function submittedOn(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleDateString(undefined, {
        day: "numeric",
        month: "short",
        year: "numeric",
      });
}

export function WaitingForMyReview(): JSX.Element {
  // The page shown: every page of the waiting work is reachable, a page at a time.
  const [page, setPage] = useState(1);
  const { rows, total, totalCapped, hasNext, hasPrev, isLoading, error } =
    useWaitingForMe({ page, limit: PAGE_SIZE });

  return (
    <div className="space-y-4 p-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">
          Waiting for my review
        </h1>
        <p className="text-sm text-muted-foreground">
          Waiting for you or for one of your roles, where you can take the next
          step, across collections and Singles.
        </p>
      </div>

      {/* A list that could not be read says so, never that nothing waits. */}
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {apiErrorMessage(
            error,
            "What waits for your review couldn't be read."
          )}
        </p>
      ) : !isLoading && rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nothing waits for your review.
        </p>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            {total}
            {totalCapped ? "+" : ""} waiting
          </p>
          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full text-sm">
              <caption className="sr-only">Waiting for my review</caption>
              <thead className="bg-muted text-left text-muted-foreground">
                <tr>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Title
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Collection
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Review
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Waiting for
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Submitted
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map(row => (
                  <tr key={row.key} className="border-t border-border">
                    <td className="px-3 py-2">
                      <Link
                        href={row.href}
                        className="font-medium text-foreground underline-offset-4 hover:underline"
                      >
                        {row.title}
                      </Link>
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {row.where}
                    </td>
                    <td className="px-3 py-2">{row.stage}</td>
                    <td className="px-3 py-2">{row.waitingFor}</td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {submittedOn(row.submitted)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {hasPrev || hasNext ? (
            <nav
              aria-label="Waiting pages"
              className="flex items-center justify-between"
            >
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!hasPrev}
                onClick={() => setPage(current => Math.max(1, current - 1))}
              >
                Previous
              </Button>
              <span className="text-sm text-muted-foreground">Page {page}</span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!hasNext}
                onClick={() => setPage(current => current + 1)}
              >
                Next
              </Button>
            </nav>
          ) : null}
        </>
      )}
    </div>
  );
}

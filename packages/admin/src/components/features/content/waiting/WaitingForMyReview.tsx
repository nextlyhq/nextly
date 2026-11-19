/**
 * The "Waiting for my review" view (R-11, D10): every part whose next step the reader may take and
 * that waits for them, across collections and Singles. Each row names its document (a link to it),
 * where it lives, its stage, whom it waits for and when it was submitted. The count is a floor
 * ("1000+") where the list read only so far.
 *
 * @module components/features/content/waiting/WaitingForMyReview
 * @experimental
 */

import type { JSX } from "react";

import { Link } from "@admin/components/ui/link";
import { useWaitingForMe } from "@admin/hooks/queries/useWaitingForMe";

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
  const { rows, total, totalCapped, isLoading } = useWaitingForMe({
    page: 1,
    limit: PAGE_SIZE,
  });

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

      {!isLoading && rows.length === 0 ? (
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
        </>
      )}
    </div>
  );
}

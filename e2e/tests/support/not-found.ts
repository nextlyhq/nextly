import { CACHE_COMPONENTS } from "./cache-components";

/**
 * Whether a content route answered not found, as the playground under test
 * answers it.
 *
 * Without Cache Components the answer is a 404. With them, the page body sits
 * in a Suspense boundary under a static shell that is streamed before the
 * route knows the path holds nothing, so the status is 200 by then and the
 * answer is the not-found page, marked `noindex`. A page that failed while
 * rendering is neither: it is a 200 carrying the error, without the marker.
 */
export function answeredNotFound(page: {
  status: number;
  html: string;
}): boolean {
  if (!CACHE_COMPONENTS) return page.status === 404;
  return (
    page.status === 200 &&
    /<meta[^>]+name="robots"[^>]+content="noindex"/.test(page.html) &&
    /could not be found/.test(page.html)
  );
}

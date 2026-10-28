/**
 * Render a blocks page past its Suspense boundary, as the App Router does at
 * request time: the page must answer the boundary, and the body inside it is
 * what renders the document.
 *
 * It imports nothing but React, because the package's layering test holds
 * every file here that is not itself a test to the runtime allowlist.
 */
import { Suspense, type ReactElement } from "react";

export async function throughBoundary<P>(
  page: Promise<ReactElement>
): Promise<ReactElement<P>> {
  const boundary = (await page) as ReactElement<{ children: ReactElement }>;
  if (boundary.type !== Suspense) {
    throw new Error("The page did not answer a Suspense boundary.");
  }
  const body = boundary.props.children;
  const Body = body.type as (props: unknown) => Promise<ReactElement>;
  return (await Body(body.props)) as ReactElement<P>;
}

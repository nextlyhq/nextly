/**
 * Render a blocks page as the App Router does at request time: past its
 * Suspense boundary when it has one (Cache Components on), or as the page it
 * is (off).
 *
 * It imports nothing but React, because the package's layering test holds
 * every file here that is not itself a test to the runtime allowlist.
 */
import { Suspense, type ReactElement } from "react";

export async function throughBoundary<P>(
  page: Promise<ReactElement>
): Promise<ReactElement<P>> {
  const element = (await page) as ReactElement<{ children: ReactElement }>;
  if (element.type !== Suspense) return element as ReactElement<P>;
  const body = element.props.children;
  const Body = body.type as (props: unknown) => Promise<ReactElement>;
  return (await Body(body.props)) as ReactElement<P>;
}

"use client";

/**
 * A script the server writes into the admin's page, which the browser runs as
 * it reads the page, before the admin's own code has loaded: the theme's
 * pre-paint script and the startup request's early start.
 *
 * It is emitted only by the server and kept through hydration. A later client
 * render drops it, since React never runs a script it inserts, and by then
 * the admin's code does the same work itself.
 *
 * @module components/shared/inline-script
 */
import { useSyncExternalStore, type JSX } from "react";

/**
 * A value as JSON that is safe inside an inline `<script>`: `<` is escaped,
 * so a string such as `</script>` in a value cannot end the script and start
 * markup.
 */
export const scriptJson = (value: unknown): string =>
  JSON.stringify(value).replace(/</g, "\\u003c");

const neverChanges = () => () => {};
const onTheClient = () => false;
const onTheServer = () => true;

/**
 * Renders `source` as an inline script on the server and through hydration,
 * and nothing after. `nonce` is the one a `script-src` Content Security
 * Policy needs, where the page is rendered with one.
 */
export function InlineScript({
  source,
  nonce,
}: {
  source: string;
  nonce?: string;
}): JSX.Element | null {
  const serverOrHydrating = useSyncExternalStore(
    neverChanges,
    onTheClient,
    onTheServer
  );
  if (!serverOrHydrating) return null;
  return <script nonce={nonce} dangerouslySetInnerHTML={{ __html: source }} />;
}

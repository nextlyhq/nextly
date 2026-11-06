import Link from "next/link";
import { notFound } from "next/navigation";

/**
 * A site page that links to the admin, for the browser test of what a hidden
 * admin leaves behind.
 *
 * A real site often links to its admin from its own header, with `next/link`,
 * so the admin opens without a document load. Under Cache Components, going
 * Back from there shows the site page again while the admin stays mounted,
 * hidden, with its stylesheets. Neither the playground's site nor the
 * templates link to the admin, so this page is that site: ordinary elements a
 * stylesheet could reach, and the link.
 *
 * GATED like the builder harnesses: a route under `src/app/` is otherwise
 * reachable in `pnpm dev:app` and indistinguishable from product.
 */
export default function SiteHarnessPage() {
  if (process.env.NEXTLY_E2E_SITE_HARNESS !== "1") notFound();

  return (
    <main data-testid="site-harness">
      <h1>A site page</h1>
      <p>
        A paragraph of the site&apos;s own text, set in the site&apos;s own
        styles.
      </p>
      <ul>
        <li>A list item</li>
      </ul>
      <button type="button">A button</button>
      <Link href="/admin">Open the admin</Link>
    </main>
  );
}

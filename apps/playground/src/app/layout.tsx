import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";
import "./globals.css";

/**
 * The document shell, and nothing else.
 *
 * A server component, which is what keeps a public page's payload to what that
 * page actually needs. The admin's client runtime — theme, query cache, error
 * boundary, command palette — is mounted by the layouts of the surfaces that
 * use it, because a root layout reaches every URL in the app and a rendered
 * blocks page has no use for any of it.
 *
 * ## Why the faces are stylesheet imports
 *
 * The faces are imported as STYLESHEETS from packages in `node_modules`, rather
 * than fetched from fonts.googleapis.com by `next/font/google` while
 * `next build` runs — which made every build depend on reaching a third party
 * and fail behind a proxy, on a locked-down runner, or offline.
 *
 * A bare package import rather than `next/font/local` pointing INTO
 * `node_modules`: a literal path asserts where the package physically lives,
 * and that assertion is false under Yarn's Plug'n'Play linker (no
 * `node_modules` at all), under npm/Yarn workspace hoisting (the package moves
 * to the workspace root), and under pnpm's own symlinked store. An import asks
 * the resolver instead, which is correct under every layout.
 *
 * The trade is `next/font`'s metric-adjusted fallback, so text can shift
 * slightly as the face arrives. The families are bound to this app's `--font-*`
 * variables in `globals.css`, which is what every rule downstream reads.
 *
 * Importing the package root ships every subset the face offers — Latin, Latin
 * Extended, Cyrillic, Vietnamese — but each `@font-face` carries a
 * `unicode-range`, so a browser downloads only the subsets the page actually
 * uses. The deployed bundle is larger than a single hand-picked file; what a
 * reader fetches is not, and a page in Cyrillic now gets its face instead of a
 * fallback.
 *
 * @module app/layout
 */
export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      /**
       * suppressHydrationWarning is needed to prevent hydration errors caused by
       * browser extensions (e.g., Bitwarden, password managers) that inject
       * attributes like `bis_skin_checked` or `__processed_*` into DOM elements
       * before React hydrates. These attributes don't affect functionality but
       * would otherwise cause React hydration mismatch warnings.
       *
       * Applied to <html> tag to suppress warnings for entire component tree.
       *
       * @see https://react.dev/link/hydration-mismatch
       */
      suppressHydrationWarning
    >
      {/*
       * suppressHydrationWarning is also required on <body> because
       * `suppressHydrationWarning` on <html> only applies one level
       * deep. Browser extensions (Bitwarden, ColorZilla, Grammarly,
       * etc.) inject attributes onto <body> directly - e.g.
       * `cz-shortcut-listen="true"` - which would otherwise trigger
       * a separate React hydration warning here.
       *
       * @see https://react.dev/link/hydration-mismatch
       */}
      <body className="antialiased" suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}

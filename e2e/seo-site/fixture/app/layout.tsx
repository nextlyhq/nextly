/** The SEO site's root layout: nothing but the document. */
// Registers the "use cache" read function Nextly reads through under Cache
// Components, before any route reads, as the templates' layout does.
import "../nextly/cached-read";

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

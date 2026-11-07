import type { ReactNode } from "react";

// Registers the dev app's "use cache" read function and starts Nextly, for
// every route before any of them reads, during `next build` too: under Cache
// Components Nextly's cached reads go through that function, and
// `<SiteCode>` refuses to read without it.
import "../nextly/cached-read";

export const metadata = {
  title: "{{pluginName}} — dev playground",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

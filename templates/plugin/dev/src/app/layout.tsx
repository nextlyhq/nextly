import type { ReactNode } from "react";

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

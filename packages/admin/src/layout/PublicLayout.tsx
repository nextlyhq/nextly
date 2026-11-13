import type React from "react";

interface PublicLayoutProps {
  children: React.ReactNode;
}

export function PublicLayout({
  children,
}: PublicLayoutProps): React.JSX.Element {
  // The signed-out screen's one `main` landmark, as the signed-in shell has
  // its own: a reader that jumps to the main content lands on the form or
  // card, and a page without one reads as empty to anything that looks for it.
  return (
    <div className="flex min-h-screen items-center justify-center bg-background overflow-y-auto w-full">
      <main className="w-full py-12 px-6 flex flex-col items-center justify-center">
        <div className="w-full max-w-2xl">{children}</div>
      </main>
    </div>
  );
}

import type React from "react";

interface PublicLayoutProps {
  children: React.ReactNode;
}

export function PublicLayout({ children }: PublicLayoutProps) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background overflow-y-auto w-full">
      <div className="w-full py-12 px-6 flex flex-col items-center justify-center">
        <div className="w-full max-w-md">{children}</div>
      </div>
    </div>
  );
}

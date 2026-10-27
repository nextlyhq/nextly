"use client";

import type { JSX } from "react";

import { StatusPage } from "@admin/components/shared/status-page";

export function NotFoundPage(): JSX.Element {
  return (
    <StatusPage
      visual={
        // A decorative numeral, not type. The scale tops out at 60px, so
        // there is no step to map this onto.
        <span className="text-[120px] font-black leading-none tracking-tight text-foreground">
          404
        </span>
      }
      label="Page Not Found"
      title="Oops! This page doesn't exist"
      description="The page you're looking for may have been moved, deleted, or the URL might be incorrect."
    />
  );
}

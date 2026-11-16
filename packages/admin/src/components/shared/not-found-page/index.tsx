"use client";

import type { JSX } from "react";

import { StatusPage } from "@admin/components/shared/status-page";
import { useT } from "@admin/lib/i18n/I18nProvider";

export function NotFoundPage(): JSX.Element {
  // In the interface language, falling back to English where its catalog
  // has no entry.
  const t = useT();
  return (
    <StatusPage
      visual={
        // A decorative numeral, not type. The scale tops out at 60px, so
        // there is no step to map this onto.
        <span className="text-[120px] font-black leading-none tracking-tight text-foreground">
          404
        </span>
      }
      label={t("nextly.status.notFound.label")}
      title={t("nextly.status.notFound.title")}
      description={t("nextly.status.notFound.description")}
    />
  );
}

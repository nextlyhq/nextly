"use client";

/**
 * Static redirect for `/admin/components` → `/admin/builder/components`.
 *
 * Components are field-group templates with no content surface, so
 * unlike Collections / Singles there's nothing to land on per-record.
 * Sending the user into the Builder list is the closest equivalent —
 */

import { useEffect } from "react";

import { ROUTES } from "@admin/constants/routes";
import { navigateTo } from "@admin/lib/navigation";

export default function ComponentsLandingRedirect() {
  useEffect(() => {
    navigateTo(ROUTES.BUILDER_COMPONENTS);
  }, []);
  return <div className="h-32" aria-hidden="true" />;
}

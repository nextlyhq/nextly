"use client";

/**
 * Static redirect for `/admin/field-groups` to `/admin/builder/field-groups`.
 *
 * Field groups have no content surface, so unlike Collections and Singles
 * there is nothing to land on per record. The Builder list is the closest
 * equivalent, so the section icon goes straight there.
 */

import { useEffect, type JSX } from "react";

import { ROUTES } from "@admin/constants/routes";
import { navigateTo } from "@admin/lib/navigation";

export default function FieldGroupsLandingRedirect(): JSX.Element {
  useEffect(() => {
    navigateTo(ROUTES.BUILDER_FIELD_GROUPS);
  }, []);
  return <div className="h-32" aria-hidden="true" />;
}

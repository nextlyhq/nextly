"use client";

/**
 * The entity's built-in fields, above the outline, shown or hidden as the
 * person last chose.
 *
 * The choice lives in one localStorage preference shared with the settings
 * dialog's switch: the row's own Hide and that switch both write it, and a
 * window event tells the other when it changes. Hidden, the whole row goes;
 * the switch is the way to bring it back.
 */
import type { JSX } from "react";
import { useEffect, useState } from "react";

import { recallPreference } from "@admin/lib/device-memory/device-memory";

import { SystemFieldsRow } from "../builder-field-list/SystemFieldsRow";
import type { BuilderField } from "../types";

export function SystemFieldsContainer({
  systemFields,
}: {
  systemFields: readonly BuilderField[];
}): JSX.Element | null {
  const [showSystemFields, setShowSystemFields] = useState(true);

  useEffect(() => {
    // Through the device memory, which guards storage that throws.
    const stored = recallPreference("builder.showSystemInternals");
    setShowSystemFields(stored === null ? true : stored === "true");
  }, []);

  useEffect(() => {
    const onUpdate = (event: Event) => {
      setShowSystemFields((event as CustomEvent<boolean>).detail === true);
    };
    window.addEventListener("builder:show-system-fields", onUpdate);
    return () =>
      window.removeEventListener("builder:show-system-fields", onUpdate);
  }, []);

  if (!showSystemFields) return null;

  return (
    <SystemFieldsRow
      systemFields={systemFields}
      onSetVisible={setShowSystemFields}
    />
  );
}

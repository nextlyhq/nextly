/**
 * Names an email's owner with the installed plugins the admin knows, so a
 * plugin is called what the rail and panels call it.
 *
 * @module components/features/settings/EmailTemplateForm/useOwnerName
 */
import { useBranding } from "@admin/context/providers/BrandingProvider";
import type { EmailTemplateRecord } from "@admin/services/emailTemplateApi";

import { ownerName } from "./workbench-model";

/** A function naming a record's owner, bound to the admin's plugin list. */
export function useOwnerName(): (record: EmailTemplateRecord) => string {
  const { plugins } = useBranding();
  return record => ownerName(record, plugins);
}

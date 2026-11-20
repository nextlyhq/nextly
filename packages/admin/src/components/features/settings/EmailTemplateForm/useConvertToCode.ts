/**
 * Converting a saved written email to code: the update says only its new
 * format, and the server writes its HTML and plain text from the blocks it
 * has saved, so what the email becomes is what it sent. The workbench then
 * reloads it as a coded email.
 *
 * @module components/features/settings/EmailTemplateForm/useConvertToCode
 */
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { toast } from "@admin/components/ui";
import {
  emailTemplateKeys,
  useUpdateEmailTemplate,
} from "@admin/hooks/queries/useEmailTemplates";
import { getErrorMessage } from "@admin/lib/errors/error-types";
import type { EmailTemplateRecord } from "@admin/services/emailTemplateApi";

import type { WorkbenchMenu } from "./WorkbenchHeader";

export interface ConvertToCode {
  open: boolean;
  setOpen: (open: boolean) => void;
  isPending: boolean;
  convert: () => void;
  /** `base` with Convert to code added, when this email can be converted. */
  menu: (base: WorkbenchMenu) => WorkbenchMenu;
}

/**
 * The dialog's state and the conversion of `template`. Only a saved written
 * email the site owns can be converted: a coded one has nothing to convert,
 * and an owner's content isn't the site's to change.
 */
export function useConvertToCode(
  template: Pick<EmailTemplateRecord, "id" | "format"> | undefined,
  owns: boolean
): ConvertToCode {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();
  const { mutate, isPending } = useUpdateEmailTemplate();
  const id = template?.id;
  const convertible = Boolean(id) && owns && template?.format === "written";
  const convert = () => {
    if (!id) return;
    mutate(
      { id, data: { format: "code" } },
      {
        onSuccess: converted => {
          // The coded email the server answered with goes straight into the
          // workbench's copy before the dialog closes: never the blocks, not
          // while a refetch runs and not if it fails, so no edit is made to
          // what the server has already converted away.
          queryClient.setQueryData(emailTemplateKeys.detail(id), converted);
          setOpen(false);
          toast.success("Converted to code", {
            description: "The email now opens in the code editor.",
          });
        },
        onError: (error: Error) => {
          toast.error("Couldn't convert the email", {
            description: getErrorMessage(
              error,
              "An error occurred while converting the email."
            ),
          });
        },
      }
    );
  };
  return {
    open,
    setOpen,
    isPending,
    convert,
    menu: base =>
      convertible ? { ...base, onConvert: () => setOpen(true) } : base,
  };
}

/**
 * Converting a saved written email to code: the update says only its new
 * format, and the server writes its HTML and plain text from the blocks it
 * has saved, so what the email becomes is what it sent. The workbench then
 * reloads it as a coded email.
 *
 * @module components/features/settings/EmailTemplateForm/useConvertToCode
 */
import { useState } from "react";

import { toast } from "@admin/components/ui";
import { useUpdateEmailTemplate } from "@admin/hooks/queries/useEmailTemplates";
import { getErrorMessage } from "@admin/lib/errors/error-types";

export interface ConvertToCode {
  open: boolean;
  setOpen: (open: boolean) => void;
  isPending: boolean;
  convert: () => void;
}

/** The dialog's state and the conversion of the email with `id`. */
export function useConvertToCode(id: string | undefined): ConvertToCode {
  const [open, setOpen] = useState(false);
  const { mutate, isPending } = useUpdateEmailTemplate();
  const convert = () => {
    if (!id) return;
    mutate(
      { id, data: { format: "code" } },
      {
        onSuccess: () => {
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
  return { open, setOpen, isPending, convert };
}

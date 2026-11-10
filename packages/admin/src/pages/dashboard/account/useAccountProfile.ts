/**
 * The account page's profile form: the signed-in person's name and avatar as
 * they are being edited, whether they differ from what is saved, and the save.
 *
 * The edits start from the signed-in user as `/me` answers, and follow it
 * again after a save, so the form shows what was stored rather than what was
 * typed.
 *
 * @module pages/dashboard/account/useAccountProfile
 */
import { useEffect, useState } from "react";

import { toast } from "@admin/components/ui";
import { useUpdateOwnProfile } from "@admin/hooks/queries/useUpdateOwnProfile";
import type { DashboardUser } from "@admin/hooks/useDashboardUser";
import { useT } from "@admin/lib/i18n/I18nProvider";

/**
 * The longest name the users table holds on every dialect: its `name` column
 * is 255 characters wide on MySQL, which refuses a longer one.
 */
export const ACCOUNT_NAME_MAX = 255;

export interface AccountProfile {
  name: string;
  setName: (name: string) => void;
  /** The avatar's URL; an empty string is none. */
  image: string;
  setImage: (image: string) => void;
  /** The name as it would be saved is empty. */
  nameMissing: boolean;
  /** The name as it would be saved is longer than the table holds. */
  nameTooLong: boolean;
  /** Something differs from what is saved. */
  changed: boolean;
  saving: boolean;
  save: () => void;
}

export function useAccountProfile(user: DashboardUser | null): AccountProfile {
  const t = useT();
  const update = useUpdateOwnProfile();
  const savedName = user?.name ?? "";
  const savedImage = user?.avatar ?? "";
  const [name, setName] = useState(savedName);
  const [image, setImage] = useState(savedImage);

  // What is saved arrived, or changed after a save: the form starts from it.
  useEffect(() => {
    setName(savedName);
    setImage(savedImage);
  }, [savedName, savedImage]);

  const nameMissing = name.trim() === "";
  const nameTooLong = name.trim().length > ACCOUNT_NAME_MAX;
  const changed = name !== savedName || image !== savedImage;

  function save(): void {
    if (nameMissing || nameTooLong || !changed) return;
    // Only what was edited: a field resent unchanged would be checked again,
    // and one stored before today's limits would refuse the whole save.
    update.mutate(
      {
        ...(name !== savedName ? { name: name.trim() } : {}),
        ...(image !== savedImage ? { image } : {}),
      },
      {
        onSuccess: () => toast.success(t("nextly.account.saved")),
        onError: error =>
          toast.error(t("nextly.account.saveFailed"), {
            description: error.message,
          }),
      }
    );
  }

  return {
    name,
    setName,
    image,
    setImage,
    nameMissing,
    nameTooLong,
    changed,
    saving: update.isPending,
    save,
  };
}

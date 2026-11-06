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

export interface AccountProfile {
  name: string;
  setName: (name: string) => void;
  /** The avatar's URL; an empty string is none. */
  image: string;
  setImage: (image: string) => void;
  /** The name as it would be saved is empty. */
  nameMissing: boolean;
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
  const changed = name !== savedName || image !== savedImage;

  function save(): void {
    if (nameMissing || !changed) return;
    update.mutate(
      { name: name.trim(), image },
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
    changed,
    saving: update.isPending,
    save,
  };
}

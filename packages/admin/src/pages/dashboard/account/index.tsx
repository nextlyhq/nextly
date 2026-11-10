"use client";

/**
 * The signed-in person's own account page, at `/admin/account`.
 *
 * Every signed-in person may open it: it reads and writes only their own row,
 * through `/me`. Its card, the `profile` built-in, edits their name and avatar
 * and shows their email, which only an administrator changes. Around it is the
 * account place, where plugins add blocks and tabs.
 *
 * @module pages/dashboard/account
 */
import {
  Alert,
  AlertDescription,
  Button,
  FieldShell,
  Input,
  Spinner,
} from "@nextlyhq/ui";
import type { ReactElement } from "react";

import { AvatarUploader } from "@admin/components/features/user-management/avatar-uploader";
import { PageContainer } from "@admin/components/layout/page-container";
import { PlaceTabs, TargetSlot } from "@admin/components/shared/target-slot";
import { useCurrentUserPermissions } from "@admin/hooks/useCurrentUserPermissions";
import { useDashboardUser } from "@admin/hooks/useDashboardUser";
import { useT } from "@admin/lib/i18n/I18nProvider";

import { ACCOUNT_NAME_MAX, useAccountProfile } from "./useAccountProfile";

export default function AccountPage(): ReactElement {
  const t = useT();
  const { user, isLoading, error } = useDashboardUser();
  const profile = useAccountProfile(user);
  // The avatar is picked from the media library, which only a reader of media
  // can open; anyone else is not offered the picker that would fail, and can
  // still remove the avatar they have.
  const { hasPermission } = useCurrentUserPermissions();
  const mayPickAvatar = hasPermission("read-media");

  if (isLoading) {
    return (
      <PageContainer width="form">
        <Spinner size="md" />
      </PageContainer>
    );
  }
  if (!user || error) {
    return (
      <PageContainer width="form">
        <Alert variant="destructive">
          <AlertDescription>{t("nextly.account.loadFailed")}</AlertDescription>
        </Alert>
      </PageContainer>
    );
  }

  // What a plugin's block or tab on this page is told: whose account it is.
  const placeContext = { userId: user.id };

  return (
    <PageContainer width="form">
      <div className="mb-8">
        <h1 className="text-xl font-semibold tracking-tight">
          {t("nextly.account.title")}
        </h1>
        {/* Muted foreground, as the other pages' subtitles, for contrast. */}
        <p className="text-sm font-normal text-muted-foreground mt-1">
          {t("nextly.account.description")}
        </p>
      </div>

      {/* The page's own card is the `profile` built-in: plugins' blocks draw
          around it and their tabs beside it, in the order sent. */}
      <PlaceTabs
        place="account"
        context={placeContext}
        contentLabel={t("nextly.places.account.profile")}
      >
        <TargetSlot
          place="account"
          context={placeContext}
          builtIns={{
            profile: (
              <form
                id="account-profile-form"
                className="bg-card border border-border rounded-lg p-6 space-y-6"
                onSubmit={event => {
                  event.preventDefault();
                  profile.save();
                }}
              >
                <div className="flex items-center gap-4">
                  <AvatarUploader
                    value={profile.image}
                    onChange={profile.setImage}
                    fullName={profile.name || user.name}
                    disabled={profile.saving}
                    pickerDisabled={!mayPickAvatar}
                    className="border border-border"
                    // As the user edit page draws it: text-primary on the
                    // primary tint reads in both modes.
                    fallbackClassName="bg-primary/5 text-primary dark:bg-primary/20"
                  />
                  <p className="text-sm text-muted-foreground">{user.email}</p>
                </div>

                <FieldShell
                  label={t("nextly.account.name")}
                  error={
                    profile.nameMissing
                      ? t("nextly.account.nameRequired")
                      : profile.nameTooLong
                        ? t("nextly.account.nameTooLong", {
                            max: ACCOUNT_NAME_MAX,
                          })
                        : undefined
                  }
                >
                  {({ id, describedBy, invalid }) => (
                    <Input
                      id={id}
                      aria-describedby={describedBy}
                      aria-invalid={invalid}
                      value={profile.name}
                      onChange={event => profile.setName(event.target.value)}
                      disabled={profile.saving}
                      autoComplete="name"
                      maxLength={ACCOUNT_NAME_MAX}
                    />
                  )}
                </FieldShell>

                <FieldShell
                  label={t("nextly.account.email")}
                  description={t("nextly.account.emailHint")}
                >
                  {({ id, describedBy }) => (
                    <Input
                      id={id}
                      aria-describedby={describedBy}
                      value={user.email}
                      readOnly
                    />
                  )}
                </FieldShell>

                <div className="flex justify-end">
                  <Button
                    type="submit"
                    disabled={
                      profile.saving ||
                      profile.nameMissing ||
                      profile.nameTooLong ||
                      !profile.changed
                    }
                  >
                    {profile.saving
                      ? t("nextly.account.saving")
                      : t("nextly.account.save")}
                  </Button>
                </div>
              </form>
            ),
          }}
        />
      </PlaceTabs>
    </PageContainer>
  );
}

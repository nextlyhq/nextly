"use client";

import { Button } from "@nextlyhq/ui";
import { useState } from "react";
import { FormProvider } from "react-hook-form";

import { ArrowRight, Loader2 } from "@admin/components/icons";
import {
  AuthNewPasswordFields,
  type NewPasswordFormValues,
  useNewPasswordForm,
} from "@admin/components/shared/auth/AuthNewPasswordFields";
import { toast } from "@admin/components/ui";
import { useApi } from "@admin/hooks/useApi";
import { getCsrfToken } from "@admin/lib/api/csrf";
import { apiErrorMessage, isApiError } from "@admin/lib/api/parseApiError";

export interface SetInitialPasswordProps {
  /**
   * The single-purpose token the login response handed back.
   *
   * Absent for a login RESUMED from a provider: that one arrives by redirect
   * with its token in an HttpOnly cookie, which the browser sends on its own
   * and JavaScript cannot read. The endpoint already falls back to the cookie
   * when the body carries no token, so omitting the field is the whole of it.
   */
  pendingToken?: string;
  /**
   * Called once the password is set and a session has been issued.
   *
   * Carries the destination the SERVER chose, which is the sanitized `next`
   * the pending token was minted with. Dropping it sent an external login
   * that asked to land somewhere specific to the dashboard instead, after
   * the backend had gone to the trouble of preserving it.
   */
  onDone: (next?: string) => void;
  /**
   * Called when the pending credential this form holds is no longer usable.
   *
   * This view is the ONLY thing rendered while a password change is pending,
   * so a failure it cannot recover from is a dead end: the token is expired,
   * replayed, or for a flow the account has already left, and no password the
   * person types will be accepted. Reporting that as a toast alone left them
   * on a form that could only fail again, with the sign-in controls hidden
   * behind the very state this failure disproves — and the only way out was
   * to reload the page.
   */
  onCredentialRejected: () => void;
}

/**
 * Whether a failed submit ENDED the flow rather than asking for another try.
 *
 * The password itself being refused — too weak, previously used — is the
 * form's own business, and so is a transport or server fault: the token is
 * still good and the next attempt can succeed. A 401 is the other kind. Every
 * refusal the endpoint makes about the pending token collapses to
 * invalid-credentials by design, so the status is the whole signal and reading
 * the reason out of it would only reconstruct what the server deliberately
 * did not say.
 */
function endsTheFlow(error: unknown): boolean {
  return isApiError(error) && error.status === 401;
}

/**
 * Forced first-sign-in password change (ASVS 6.4.1). Shown when login returns
 * `password_change_required`: the account still holds an admin-set password, so
 * no session exists yet. Setting a new password exchanges the pending token for
 * a real session; on success the caller navigates into the app.
 */
export function SetInitialPassword({
  pendingToken,
  onDone,
  onCredentialRejected,
}: SetInitialPasswordProps) {
  const { api } = useApi();
  const [isLoading, setIsLoading] = useState(false);

  const form = useNewPasswordForm();

  async function onSubmit(values: NewPasswordFormValues) {
    setIsLoading(true);
    try {
      const csrfToken = await getCsrfToken();
      const result = await api.public.post<{ next?: string }>(
        "/auth/set-initial-password",
        {
          // OMITTED rather than sent empty when there is no token: the server
          // reads the cookie only when the field is absent, and an empty string
          // is a present-but-invalid token it would refuse.
          ...(pendingToken ? { pendingToken } : {}),
          newPassword: values.newPassword,
          csrfToken,
        }
      );
      onDone(result?.next);
    } catch (error: unknown) {
      const ended = endsTheFlow(error);
      toast.error("Could not set your password", {
        description: ended
          ? "This link is no longer valid. Please sign in again."
          : apiErrorMessage(error, "Something went wrong. Please try again."),
      });
      // AFTER the toast, so the reason is on screen before the form it
      // belongs to is replaced by the sign-in view.
      if (ended) onCredentialRejected();
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold tracking-tight text-foreground mb-1">
          Set a new password
        </h2>
        <p className="text-sm text-muted-foreground">
          Your account was set up with a temporary password. Choose your own to
          continue.
        </p>
      </div>

      <FormProvider {...form}>
        <form
          onSubmit={e => {
            void form.handleSubmit(onSubmit)(e);
          }}
          className="space-y-6"
        >
          <AuthNewPasswordFields />

          <Button
            size="md"
            type="submit"
            disabled={isLoading}
            className="w-full h-11 rounded-md shadow-none bg-primary text-primary-foreground hover:bg-primary/90 active:scale-[0.98] transition-all duration-100 mt-2"
          >
            {isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin ml-2" />
            ) : (
              <>
                Set Password &amp; Continue
                <ArrowRight className="h-4 w-4 ml-2" />
              </>
            )}
          </Button>
        </form>
      </FormProvider>
    </div>
  );
}

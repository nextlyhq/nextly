"use client";

import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Skeleton,
} from "@nextlyhq/ui";
import { type ReactNode, useCallback, useRef, useState, type JSX } from "react";

import { EmailSubpageLayout } from "@admin/components/features/email-hub/EmailSubpageLayout";
import { DomainStatusCard } from "@admin/components/features/email-hub/sending/DomainStatusCard";
import { SendTestDialog } from "@admin/components/features/email-hub/sending/SendTestDialog";
import { explainSetupFailure } from "@admin/components/features/email-hub/sending/setup-copy";
import {
  EMAIL_PROVIDER_FORM_ID,
  EmailProviderForm,
  emailCatalogState,
  isUnregisteredProviderType,
  type EmailProviderPayload,
} from "@admin/components/features/settings/EmailProviderForm";
import { AlertTriangle, Loader2, Send } from "@admin/components/icons";
import { PageContainer } from "@admin/components/layout/page-container";
import { PageErrorFallback } from "@admin/components/shared/error-fallbacks";
import { QueryErrorBoundary } from "@admin/components/shared/query-error-boundary";
import { toast } from "@admin/components/ui";
import { Link } from "@admin/components/ui/link";
import {
  EMAIL_PROVIDER_TEST_PERMISSIONS,
  holdsAny,
} from "@admin/constants/email-hub";
import { ROUTES } from "@admin/constants/routes";
import {
  useCheckProvider,
  useEmailProvider,
  useEmailProviderTypes,
  useUpdateEmailProvider,
} from "@admin/hooks/queries/useEmailProviders";
import { useHasPermission } from "@admin/hooks/useHasPermission";
import { useRouter } from "@admin/hooks/useRouter";
import { apiErrorMessage } from "@admin/lib/api/parseApiError";
import { getErrorMessage } from "@admin/lib/errors/error-types";
import { navigateTo } from "@admin/lib/navigation";
import { validateUUID } from "@admin/lib/validation";
import type {
  EmailProviderDescriptor,
  EmailProviderRecord,
  EmailSetupCategory,
} from "@admin/services/emailProviderApi";

type UpdateProvider = ReturnType<typeof useUpdateEmailProvider>["mutate"];

/** Saved, then back to the list; a refusal says what to fix. */
function saveProvider(
  updateProvider: UpdateProvider,
  providerId: string,
  payload: EmailProviderPayload
) {
  // The form has already dropped the credentials the user did not touch,
  // deciding from the descriptor's own `secret` flags and the stored value
  // rather than from a list of provider names kept here. The server merges
  // what remains over the stored configuration, so an omitted credential
  // keeps its value.
  updateProvider(
    { id: providerId, data: payload },
    {
      onSuccess: () => {
        toast.success("Provider updated", {
          description: `${payload.name} has been updated successfully.`,
        });
        navigateTo(ROUTES.EMAIL_SENDING);
      },
      onError: (error: Error) => {
        toast.error("Failed to update provider", {
          // apiErrorMessage, not getErrorMessage: a rule that lives only
          // in the provider's own parser -- SMTP's conditional
          // credentials, its transport-safety check, anything a plugin
          // enforces -- arrives as per-field reasons in `data.errors`
          // under a top-level "Validation failed." Reading only
          // `Error.message` shows the operator that sentence and nothing
          // they can act on.
          description:
            apiErrorMessage(error) ||
            "An error occurred while updating the provider.",
        });
      },
    }
  );
}

/** A save the provider refused at the check, kept so it can be saved anyway. */
interface RefusedSave {
  setup?: EmailSetupCategory;
}

/** What the check is asked about a saved provider's changed settings. */
function savedCheckInput(payload: EmailProviderPayload, providerId: string) {
  return {
    type: payload.type,
    configuration: payload.configuration,
    ...(payload.unsetConfiguration
      ? { unsetConfiguration: payload.unsetConfiguration }
      : {}),
    providerId,
  };
}

function checkFailed(error: Error) {
  toast.error("Failed to update provider", {
    description:
      apiErrorMessage(error) ||
      "An error occurred while checking the provider.",
  });
}

/** Submits the provider form as it stands, as its own button would. */
function submitProviderForm() {
  const form = document.getElementById(EMAIL_PROVIDER_FORM_ID);
  if (form instanceof HTMLFormElement) form.requestSubmit();
}

/**
 * Saving with a check first. A changed sign-in is checked with the provider
 * before it is saved, where the provider can be asked without sending. What
 * was not changed is checked with it: the masked secrets stand for the stored
 * ones, and the fields the edit clears are cleared. A check can refuse what
 * sending would accept, so a refusal can be saved anyway.
 */
function useCheckedSave(providerId: string | null) {
  const { mutate: updateProvider, isPending: isUpdating } =
    useUpdateEmailProvider();
  const { mutate: check, isPending: isChecking } = useCheckProvider();
  const [refused, setRefused] = useState<RefusedSave | null>(null);

  const save = useCallback(
    (payload: EmailProviderPayload) => {
      if (!providerId) return;
      setRefused(null);
      saveProvider(updateProvider, providerId, payload);
    },
    [providerId, updateProvider]
  );

  // Save anyway saves the form as it stands now, not as it was when the
  // check refused it: the person may have changed it since. It submits the
  // form with the check skipped once; Update Provider asks for the check.
  const skipCheck = useRef(false);

  const submit = useCallback(
    (payload: EmailProviderPayload) => {
      if (!providerId) return;
      if (skipCheck.current) {
        skipCheck.current = false;
        save(payload);
        return;
      }
      check(savedCheckInput(payload, providerId), {
        onSuccess: result =>
          result.checked && !result.success
            ? setRefused({ setup: result.setup })
            : save(payload),
        onError: checkFailed,
      });
    },
    [providerId, check, save]
  );

  const saveAnyway = useCallback(() => {
    skipCheck.current = true;
    submitProviderForm();
  }, []);

  const checkNext = useCallback(() => {
    skipCheck.current = false;
  }, []);

  return {
    submit,
    saveAnyway,
    checkNext,
    refused,
    isChecking,
    isPending: isUpdating || isChecking,
  };
}

function BackToProviders() {
  return (
    <div className="mt-4">
      <Link href={ROUTES.EMAIL_SENDING}>
        <Button variant="outline">Back to Providers</Button>
      </Link>
    </div>
  );
}

/** The page's chrome around a state that is not the form. */
function ProviderPageState({ children }: { children: ReactNode }) {
  return (
    <PageContainer width="form">
      <EmailSubpageLayout {...EMAIL_PROVIDER_PAGE}>
        {children}
      </EmailSubpageLayout>
    </PageContainer>
  );
}

function InvalidProviderId() {
  return (
    <ProviderPageState>
      <Alert variant="destructive">
        <AlertDescription>
          Invalid provider ID. Please go back and try again.
        </AlertDescription>
      </Alert>
      <BackToProviders />
    </ProviderPageState>
  );
}

function ProviderLoading() {
  return (
    <ProviderPageState>
      <div className="space-y-6">
        <Skeleton className="h-12 w-full rounded-md" />
        <Skeleton className="h-[500px] w-full rounded-lg" />
      </div>
    </ProviderPageState>
  );
}

function ProviderLoadFailed({
  error,
  onRetry,
}: {
  error: unknown;
  onRetry: () => void;
}) {
  return (
    <ProviderPageState>
      <Alert variant="destructive">
        <AlertDescription className="flex items-center justify-between">
          <span>
            {getErrorMessage(error, "Failed to load provider details.")}
          </span>
          <Button
            size="md"
            variant="outline"
            onClick={onRetry}
            className="ml-2"
          >
            Retry
          </Button>
        </AlertDescription>
      </Alert>
      <BackToProviders />
    </ProviderPageState>
  );
}

/** A refused check, said by what to check, with the save it held back. */
function RefusedSaveAlert({
  refused,
  providerLabel,
  disabled,
  onSaveAnyway,
}: {
  refused: RefusedSave;
  providerLabel: string;
  disabled: boolean;
  onSaveAnyway: () => void;
}) {
  const refusal = explainSetupFailure(refused.setup, providerLabel);
  return (
    <Alert variant="destructive" role="alert">
      <AlertTriangle className="h-4 w-4" />
      <AlertTitle>{refusal.title}</AlertTitle>
      <AlertDescription className="flex flex-col items-start gap-3">
        <span>{refusal.check} Nothing was saved.</span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled}
          onClick={onSaveAnyway}
        >
          Save anyway
        </Button>
      </AlertDescription>
    </Alert>
  );
}

function UpdateButtonLabel({
  pending,
  checking,
}: {
  pending: boolean;
  checking: boolean;
}) {
  if (!pending) return <>Update Provider</>;
  return (
    <>
      <Loader2 className="h-4 w-4 animate-spin" />
      {checking ? "Checking..." : "Updating..."}
    </>
  );
}

/**
 * Whether the stored provider can be edited here: the same question the form
 * answers before it disables every field, asked once from the shared predicate
 * so the button and the notice beside it can never disagree — an enabled
 * Update under a "settings cannot be edited" banner submits an empty
 * configuration and comes back with an unsupported-provider error.
 *
 * Gated on the catalog having settled, because an empty list mid-fetch makes
 * every type look unregistered. A failed catalog with NOTHING cached is its
 * own reason: the form renders a fatal alert instead of itself, so there is no
 * form for this button to submit. A catalog that merely failed to REFRESH is
 * not that reason: its cached descriptors are what the form renders and
 * disables itself from, so the same question is asked of them here.
 *
 * Loading counts as well as unavailable. The form renders only its skeleton
 * until the catalog settles, so the id the button submits to is not on the
 * page yet and pressing it does nothing at all.
 */
function cannotEditProvider(
  type: string | undefined,
  descriptors: EmailProviderDescriptor[] | undefined,
  loading: boolean,
  error: unknown
): boolean {
  const catalog = emailCatalogState({
    loading,
    failed: error !== null && error !== undefined,
    descriptors: descriptors ?? [],
  });
  return (
    catalog === "loading" ||
    catalog === "unavailable" ||
    isUnregisteredProviderType(type, descriptors ?? [])
  );
}

/** The provider id the route names, or null when it is not a valid one. */
function useRouteProviderId(): string | null {
  const { route } = useRouter();
  const raw = route?.params?.id;
  return validateUUID(typeof raw === "string" ? raw : null);
}

/** The page's header actions: Send a test, Cancel and Update. */
function EditActions({
  showTest,
  onTest,
  isPending,
  isChecking,
  cannotEdit,
  onUpdate,
}: {
  /** Pressed before the form submits, so the save is checked. */
  onUpdate: () => void;
  showTest: boolean;
  onTest: () => void;
  isPending: boolean;
  isChecking: boolean;
  cannotEdit: boolean;
}) {
  return (
    <>
      {/* The same Send a test as the provider's row: a real email, explained
          by what to check when it fails. */}
      {showTest && (
        <Button type="button" variant="outline" onClick={onTest}>
          <Send className="h-4 w-4" />
          Send a test
        </Button>
      )}
      <Link href={ROUTES.EMAIL_SENDING}>
        <Button type="button" variant="outline" disabled={isPending}>
          Cancel
        </Button>
      </Link>
      <Button
        type="submit"
        form={EMAIL_PROVIDER_FORM_ID}
        disabled={isPending || cannotEdit}
        onClick={onUpdate}
      >
        <UpdateButtonLabel pending={isPending} checking={isChecking} />
      </Button>
    </>
  );
}

/** The type's label from the catalog, or the stored type when it has none. */
function providerTypeLabel(
  descriptors: EmailProviderDescriptor[],
  type: string
): string {
  return descriptors.find(entry => entry.type === type)?.label ?? type;
}

/** The loaded provider, edited: checked before it is saved. */
function EditProvider({
  providerId,
  provider,
}: {
  providerId: string;
  provider: EmailProviderRecord;
}) {
  // The provider catalog. The stored record says which type this provider is;
  // the catalog says what that type's fields are, so both are needed before
  // the form can render anything editable.
  const {
    data,
    isLoading: descriptorsLoading,
    error: descriptorsError,
  } = useEmailProviderTypes();
  const descriptors = data ?? [];

  const { submit, saveAnyway, checkNext, refused, isChecking, isPending } =
    useCheckedSave(providerId);
  const hasPermission = useHasPermission();
  const canTest = holdsAny(hasPermission, EMAIL_PROVIDER_TEST_PERMISSIONS);
  const [testOpen, setTestOpen] = useState(false);

  const cannotEdit = cannotEditProvider(
    provider.type,
    data,
    descriptorsLoading,
    descriptorsError
  );
  const providerLabel = providerTypeLabel(descriptors, provider.type);

  return (
    <QueryErrorBoundary fallback={<PageErrorFallback />}>
      <PageContainer width="form">
        <EmailSubpageLayout
          {...EMAIL_PROVIDER_PAGE}
          actions={
            <EditActions
              showTest={canTest && !cannotEdit}
              onTest={() => setTestOpen(true)}
              isPending={isPending}
              isChecking={isChecking}
              cannotEdit={cannotEdit}
              onUpdate={checkNext}
            />
          }
        >
          <div className="space-y-6">
            {refused && (
              <RefusedSaveAlert
                refused={refused}
                providerLabel={providerLabel}
                disabled={isPending}
                onSaveAnyway={saveAnyway}
              />
            )}
            <EmailProviderForm
              mode="edit"
              provider={provider}
              descriptors={descriptors}
              descriptorsLoading={descriptorsLoading}
              descriptorsError={descriptorsError}
              isPending={isPending}
              onSubmit={submit}
            />
            {provider.domainStatus && (
              <DomainStatusCard status={provider.domainStatus} />
            )}
          </div>
          <SendTestDialog
            open={testOpen}
            onOpenChange={setTestOpen}
            provider={provider}
            providerName={provider.name}
            providerLabel={providerLabel}
          />
        </EmailSubpageLayout>
      </PageContainer>
    </QueryErrorBoundary>
  );
}

export default function EditEmailProviderPage(): JSX.Element {
  const providerId = useRouteProviderId();
  const {
    data: provider,
    isLoading,
    error,
    refetch,
  } = useEmailProvider(providerId ?? undefined);

  if (!providerId) return <InvalidProviderId />;
  if (isLoading) return <ProviderLoading />;
  if (error || !provider) {
    return (
      <ProviderLoadFailed
        error={error}
        onRetry={() => {
          void refetch();
        }}
      />
    );
  }
  return <EditProvider providerId={providerId} provider={provider} />;
}

/**
 * This page renders the Email hub's subpage chrome (Dashboard › Email ›
 * Sending › this page) in several branches — loading, error and the resolved
 * document — and its identity is the same in all of them. Stated once here so
 * the branches cannot drift apart.
 */
const EMAIL_PROVIDER_PAGE = {
  title: "Edit Email Provider",
  description: "Update the email provider configuration",
  crumb: "Edit Email Provider",
  parentCrumb: {
    label: "Sending",
    href: ROUTES.EMAIL_SENDING,
  },
} as const;

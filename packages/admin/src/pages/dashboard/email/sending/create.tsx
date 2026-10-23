"use client";

import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Skeleton,
  Switch,
} from "@nextlyhq/ui";
import { useCallback, useId, useState, type JSX } from "react";

import { EmailSubpageLayout } from "@admin/components/features/email-hub/EmailSubpageLayout";
import { SendTestPanel } from "@admin/components/features/email-hub/sending/SendTestPanel";
import {
  explainSetupFailure,
  LOG_PROVIDER_TYPE,
} from "@admin/components/features/email-hub/sending/setup-copy";
import {
  ChooseProvider,
  SetupStepper,
  type SetupStep,
} from "@admin/components/features/email-hub/sending/SetupSteps";
import {
  EMAIL_PROVIDER_FORM_ID,
  EmailProviderForm,
  emailCatalogState,
  type EmailProviderPayload,
} from "@admin/components/features/settings/EmailProviderForm";
import { AlertTriangle, Loader2 } from "@admin/components/icons";
import { PageContainer } from "@admin/components/layout/page-container";
import { PageErrorFallback } from "@admin/components/shared/error-fallbacks";
import { QueryErrorBoundary } from "@admin/components/shared/query-error-boundary";
import { toast } from "@admin/components/ui";
import { Link } from "@admin/components/ui/link";
import {
  EMAIL_PROVIDER_UPDATE_PERMISSIONS,
  holdsAny,
} from "@admin/constants/email-hub";
import { ROUTES } from "@admin/constants/routes";
import {
  useCheckProvider,
  useCreateEmailProvider,
  useEmailProviderTypes,
  useUpdateEmailProvider,
} from "@admin/hooks/queries/useEmailProviders";
import { useCurrentUserPermissions } from "@admin/hooks/useCurrentUserPermissions";
import { apiErrorMessage } from "@admin/lib/api/parseApiError";
import { navigateTo } from "@admin/lib/navigation";
import type {
  CheckProviderResult,
  EmailProviderDescriptor,
  EmailProviderRecord,
} from "@admin/services/emailProviderApi";

function saveFailed(error: Error) {
  toast.error("The provider couldn't be saved", {
    description:
      apiErrorMessage(error) || "An error occurred while saving the provider.",
  });
}

/**
 * What the check is asked: the settings, and for a provider already saved
 * its id and the fields the edit clears, so the check sees what saving would
 * store.
 */
function checkInput(
  type: string,
  payload: EmailProviderPayload,
  provider: EmailProviderRecord | null
) {
  if (!provider) return { type, configuration: payload.configuration };
  return {
    type,
    configuration: payload.configuration,
    providerId: provider.id,
    ...(payload.unsetConfiguration
      ? { unsetConfiguration: payload.unsetConfiguration }
      : {}),
  };
}

/** What Done asks for: on only with the permission, the default only when on. */
function finishChoice(
  canTurnOn: boolean,
  turnOn: boolean,
  makeDefault: boolean
) {
  const isActive = canTurnOn && turnOn;
  return { isActive, isDefault: isActive && makeDefault };
}

type Mutate<TInput> = (
  input: TInput,
  options: {
    onSuccess: (record: EmailProviderRecord) => void;
    onError: (error: Error) => void;
  }
) => void;

type UpdateMutate = ReturnType<typeof useUpdateEmailProvider>["mutate"];

/** Saved off and never the default: created the first time, edited after. */
function saveOff(
  payload: EmailProviderPayload,
  provider: EmailProviderRecord | null,
  mutate: {
    create: Mutate<
      EmailProviderPayload & { isActive: boolean; isDefault: boolean }
    >;
    update: UpdateMutate;
  },
  onSaved: (record: EmailProviderRecord) => void
) {
  const data = { ...payload, isActive: false, isDefault: false };
  const options = { onSuccess: onSaved, onError: saveFailed };
  if (provider) mutate.update({ id: provider.id, data }, options);
  else mutate.create(data, options);
}

/** Turns the provider on, and the default if asked, then back to the list. */
function applyChoice(
  update: UpdateMutate,
  provider: EmailProviderRecord,
  choice: { isActive: boolean; isDefault: boolean }
) {
  const outcome = choice.isDefault ? " and is the default" : "";
  update(
    { id: provider.id, data: choice },
    {
      onSuccess: () => {
        toast.success("Provider added", {
          description: `${provider.name} is on${outcome}.`,
        });
        navigateTo(ROUTES.EMAIL_SENDING);
      },
      onError: saveFailed,
    }
  );
}

/**
 * Whether the check refused these settings. Not checked means the provider
 * can't be asked without sending, so the test send in the next step is the
 * check.
 */
function refused(result: CheckProviderResult): boolean {
  return result.checked && !result.success;
}

/**
 * Turn on and make the default, as chosen at the last step. An accepted test
 * turns the provider on where the person may; every save starts the choice
 * again, since a test of the settings before it says nothing about these.
 */
function useTurnOnChoice(canTurnOn: boolean) {
  const [accepted, setAccepted] = useState(false);
  const [turnOn, setTurnOn] = useState(false);
  const [makeDefault, setMakeDefault] = useState(false);

  const tested = useCallback(
    (success: boolean) => {
      if (!success) return;
      setAccepted(true);
      setTurnOn(canTurnOn);
    },
    [canTurnOn]
  );

  const reset = useCallback(() => {
    setAccepted(false);
    setTurnOn(false);
    setMakeDefault(false);
  }, []);

  return {
    accepted,
    turnOn,
    setTurnOn,
    makeDefault,
    setMakeDefault,
    tested,
    reset,
  };
}

/**
 * Connect: the settings checked with the provider where it can be asked,
 * then saved off. A refused check saves nothing.
 */
function useConnect(
  type: string | null,
  provider: EmailProviderRecord | null,
  on: {
    saved: (record: EmailProviderRecord) => void;
    refused: (result: CheckProviderResult | null) => void;
  }
) {
  const { mutate: check, isPending: isChecking } = useCheckProvider();
  const { mutate: create, isPending: isCreating } = useCreateEmailProvider();
  const { mutate: update, isPending: isUpdating } = useUpdateEmailProvider();
  const { saved, refused: onRefused } = on;

  const connect = useCallback(
    (payload: EmailProviderPayload) => {
      if (!type) return;
      onRefused(null);
      const save = () => saveOff(payload, provider, { create, update }, saved);
      check(checkInput(type, payload, provider), {
        onSuccess: result => (refused(result) ? onRefused(result) : save()),
        onError: saveFailed,
      });
    },
    [type, provider, check, create, update, saved, onRefused]
  );

  return { connect, update, isChecking, isCreating, isUpdating };
}

/**
 * The guided setup's state and its three actions: connect (check, then save),
 * record a test's result, and finish.
 *
 * Saved OFF and never the default until the last step says otherwise.
 * Turning the provider on is an update, so a person who may add providers but
 * not edit them leaves it off.
 */
function useGuidedSetup() {
  const [step, setStep] = useState<SetupStep>(1);
  const [type, setType] = useState<string | null>(null);
  const [provider, setProvider] = useState<EmailProviderRecord | null>(null);
  const [checkFailure, setCheckFailure] = useState<CheckProviderResult | null>(
    null
  );
  const { hasPermission } = useCurrentUserPermissions();
  const canTurnOn = holdsAny(hasPermission, EMAIL_PROVIDER_UPDATE_PERMISSIONS);
  const choice = useTurnOnChoice(canTurnOn);
  const { reset } = choice;

  const saved = useCallback(
    (record: EmailProviderRecord) => {
      setProvider(record);
      reset();
      setStep(3);
    },
    [reset]
  );
  const { connect, update, isChecking, isCreating, isUpdating } = useConnect(
    type,
    provider,
    { saved, refused: setCheckFailure }
  );

  const { turnOn, makeDefault } = choice;
  const finish = useCallback(() => {
    const picked = finishChoice(canTurnOn, turnOn, makeDefault);
    if (provider && picked.isActive) applyChoice(update, provider, picked);
    else navigateTo(ROUTES.EMAIL_SENDING);
  }, [canTurnOn, turnOn, makeDefault, provider, update]);

  const changeSettings = useCallback(() => {
    setCheckFailure(null);
    setStep(2);
  }, []);

  return {
    ...choice,
    step,
    setStep,
    type,
    setType,
    provider,
    checkFailure,
    canTurnOn,
    connect,
    finish,
    changeSettings,
    isChecking,
    isUpdating,
    isSaving: isChecking || isCreating || isUpdating,
  };
}

type GuidedSetup = ReturnType<typeof useGuidedSetup>;

/** The catalog of provider types, loading, unavailable or ready to choose. */
function ProviderChoices({
  descriptors,
  loading,
  failed,
  value,
  onChange,
}: {
  descriptors: EmailProviderDescriptor[];
  loading: boolean;
  failed: boolean;
  value: string | null;
  onChange: (type: string) => void;
}) {
  const catalog = emailCatalogState({ loading, failed, descriptors });
  if (catalog === "loading") {
    return <Skeleton className="h-40 w-full rounded-lg" />;
  }
  if (catalog === "unavailable") {
    return (
      <Alert variant="destructive">
        <AlertTriangle className="h-4 w-4" />
        <AlertTitle>Provider types couldn&apos;t be loaded</AlertTitle>
        <AlertDescription>Reload the page to try again.</AlertDescription>
      </Alert>
    );
  }
  return (
    <ChooseProvider
      descriptors={descriptors}
      value={value}
      onChange={onChange}
    />
  );
}

function ChooseStep({
  setup,
  descriptors,
  loading,
  failed,
  gone,
}: {
  setup: GuidedSetup;
  descriptors: EmailProviderDescriptor[];
  loading: boolean;
  failed: boolean;
  /** The type chosen before is no longer installed. */
  gone: boolean;
}) {
  const chosen = descriptors.some(entry => entry.type === setup.type);
  return (
    <section aria-labelledby="choose-heading" className="space-y-4">
      <div>
        <h2 id="choose-heading" className="text-base font-semibold">
          Choose a provider
        </h2>
        <p className="text-sm text-muted-foreground">
          The service that hands this site&apos;s email to inboxes.
        </p>
      </div>
      {gone && (
        <Alert variant="warning" role="alert">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>That provider type is no longer installed</AlertTitle>
          <AlertDescription>Choose another to continue.</AlertDescription>
        </Alert>
      )}
      <ProviderChoices
        descriptors={descriptors}
        loading={loading}
        failed={failed}
        value={setup.type}
        onChange={setup.setType}
      />
      <div className="flex justify-between gap-2">
        <Link href={ROUTES.EMAIL_SENDING}>
          <Button type="button" variant="outline">
            Cancel
          </Button>
        </Link>
        <Button
          type="button"
          disabled={!chosen || setup.provider !== null}
          onClick={() => setup.setStep(2)}
        >
          Continue
        </Button>
      </div>
    </section>
  );
}

function ContinueLabel({
  saving,
  checking,
}: {
  saving: boolean;
  checking: boolean;
}) {
  if (!saving) return <>Continue</>;
  return (
    <>
      <Loader2 className="h-4 w-4 animate-spin" />
      {checking ? "Checking..." : "Saving..."}
    </>
  );
}

/** Whether Nextly checks these settings before saving, or the test is the check. */
function connectHint(
  descriptor: EmailProviderDescriptor | undefined,
  label: string
): string {
  return descriptor?.capabilities.connectionTest
    ? `Nextly checks these with ${label} before saving.`
    : `${label} can't be checked without sending, so the test in the next step is the check.`;
}

function ConnectStep({
  setup,
  type,
  label,
  descriptor,
  descriptors,
  loading,
  error,
}: {
  setup: GuidedSetup;
  type: string;
  label: string;
  descriptor: EmailProviderDescriptor | undefined;
  descriptors: EmailProviderDescriptor[];
  loading: boolean;
  error: Error | null;
}) {
  const failure = setup.checkFailure
    ? explainSetupFailure(setup.checkFailure.setup, label)
    : null;
  const provider = setup.provider;
  return (
    <section aria-labelledby="connect-heading" className="space-y-4">
      <div>
        <h2 id="connect-heading" className="text-base font-semibold">
          Connect {label}
        </h2>
        <p className="text-sm text-muted-foreground">
          {connectHint(descriptor, label)}
        </p>
      </div>
      {failure && (
        <Alert variant="destructive" role="alert">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>{failure.title}</AlertTitle>
          <AlertDescription>{failure.check}</AlertDescription>
        </Alert>
      )}
      <EmailProviderForm
        // A saved provider is edited rather than created again, so fixing a
        // setting never makes a second one.
        key={provider?.id ?? type}
        mode={provider ? "edit" : "create"}
        provider={provider ?? undefined}
        descriptors={descriptors}
        descriptorsLoading={loading}
        descriptorsError={error}
        isPending={setup.isSaving}
        onSubmit={setup.connect}
        fixedType={type}
        guided
      />
      <div className="flex justify-between gap-2">
        <Button
          type="button"
          variant="outline"
          disabled={setup.isSaving || provider !== null}
          onClick={() => setup.setStep(1)}
        >
          Back
        </Button>
        <Button
          type="submit"
          form={EMAIL_PROVIDER_FORM_ID}
          disabled={setup.isSaving}
        >
          <ContinueLabel saving={setup.isSaving} checking={setup.isChecking} />
        </Button>
      </div>
    </section>
  );
}

/** Turn on, and make it the default: applied only when the person presses Done. */
function TurnOnChoices({ setup, name }: { setup: GuidedSetup; name: string }) {
  const turnOnId = useId();
  const defaultId = useId();
  return (
    <div className="space-y-3 border-t border-border pt-4">
      {!setup.canTurnOn && (
        <p className="text-sm text-muted-foreground">
          Turning a provider on needs permission to edit providers. It is saved
          off; ask someone who can edit providers to turn it on.
        </p>
      )}
      <div className="flex items-start justify-between gap-4">
        <div>
          <label htmlFor={turnOnId} className="text-sm font-medium">
            Turn on
          </label>
          <p className="text-xs text-muted-foreground">
            Email can go through {name}: as the default, or when an email
            chooses it.
            {!setup.accepted &&
              " Turned on without an accepted test, it is trusted as it is."}
          </p>
        </div>
        <Switch
          id={turnOnId}
          checked={setup.turnOn}
          disabled={!setup.canTurnOn}
          onCheckedChange={next => {
            setup.setTurnOn(next);
            if (!next) setup.setMakeDefault(false);
          }}
        />
      </div>
      <div className="flex items-start justify-between gap-4">
        <div>
          <label htmlFor={defaultId} className="text-sm font-medium">
            Make it the default
          </label>
          <p className="text-xs text-muted-foreground">
            Every email without its own provider goes through it. Only a
            provider that is on can be the default.
          </p>
        </div>
        <Switch
          id={defaultId}
          checked={setup.makeDefault}
          disabled={!setup.turnOn}
          onCheckedChange={setup.setMakeDefault}
        />
      </div>
    </div>
  );
}

function DoneLabel({ updating }: { updating: boolean }) {
  if (!updating) return <>Done</>;
  return (
    <>
      <Loader2 className="h-4 w-4 animate-spin" />
      Saving...
    </>
  );
}

function TestStep({
  setup,
  provider,
  label,
}: {
  setup: GuidedSetup;
  provider: EmailProviderRecord;
  label: string;
}) {
  return (
    <section aria-labelledby="test-heading" className="space-y-4">
      <div>
        <h2 id="test-heading" className="text-base font-semibold">
          Send a test
        </h2>
        <p className="text-sm text-muted-foreground">
          {provider.type === LOG_PROVIDER_TYPE
            ? "Log doesn't deliver email, so the test is written to the server log."
            : `A real email through ${provider.name}. It stays off until ${label} accepts it.`}
        </p>
      </div>
      <SendTestPanel
        provider={provider}
        providerLabel={label}
        onResult={result => setup.tested(result.success)}
      />
      <TurnOnChoices setup={setup} name={provider.name} />
      <div className="flex justify-between gap-2">
        <Button
          type="button"
          variant="outline"
          disabled={setup.isSaving}
          onClick={setup.changeSettings}
        >
          Change settings
        </Button>
        <Button type="button" disabled={setup.isSaving} onClick={setup.finish}>
          <DoneLabel updating={setup.isUpdating} />
        </Button>
      </div>
    </section>
  );
}

/**
 * Adding a provider, in three steps: choose its type, connect it, and send a
 * real test.
 *
 * Connecting checks the settings with the provider before saving, where the
 * provider can be asked without sending, and says plainly what failed. The
 * provider is then saved OFF and never the default, and stays that way until
 * its test is accepted or the person turns it on in the last step: a provider
 * that has never sent anything is not trusted with the site's email. Going
 * back to Connect after saving edits the same provider, so fixing a setting
 * never means starting over.
 *
 * Turning it on is an update, so a person who may add providers but not edit
 * them can test one and leave it off for someone who can.
 */
/** The chosen type's catalog entry and label, and whether a refresh took it away. */
function useSetupCatalog(type: string | null) {
  const { data: descriptors = [], isLoading, error } = useEmailProviderTypes();
  const descriptor = descriptors.find(entry => entry.type === type);
  return {
    descriptors,
    isLoading,
    error: error ?? null,
    descriptor,
    label: descriptor?.label ?? type ?? "",
    // A catalog refresh can take away the type chosen in the first step; the
    // person is asked to choose again rather than shown another's fields.
    gone: !isLoading && descriptors.length > 0 && !descriptor,
  };
}

type ShownStep =
  | { step: 3; provider: EmailProviderRecord }
  | { step: 2; type: string }
  | { step: 1 };

/** The step to show: where the setup is, unless what it needs is missing. */
function shownStep(setup: GuidedSetup, gone: boolean): ShownStep {
  if (setup.step === 3 && setup.provider) {
    return { step: 3, provider: setup.provider };
  }
  if (setup.step === 2 && setup.type && !gone) {
    return { step: 2, type: setup.type };
  }
  return { step: 1 };
}

/** The step the setup is on, with what that step needs. */
function SetupBody({ setup }: { setup: GuidedSetup }) {
  const catalog = useSetupCatalog(setup.type);
  const shown = shownStep(setup, catalog.gone);
  if (shown.step === 3) {
    return (
      <TestStep setup={setup} provider={shown.provider} label={catalog.label} />
    );
  }
  if (shown.step === 2) {
    return (
      <ConnectStep
        setup={setup}
        type={shown.type}
        label={catalog.label}
        descriptor={catalog.descriptor}
        descriptors={catalog.descriptors}
        loading={catalog.isLoading}
        error={catalog.error}
      />
    );
  }
  return (
    <ChooseStep
      setup={setup}
      descriptors={catalog.descriptors}
      loading={catalog.isLoading}
      failed={catalog.error !== null}
      gone={setup.step === 2 && catalog.gone}
    />
  );
}

export default function CreateEmailProviderPage(): JSX.Element {
  const setup = useGuidedSetup();

  return (
    <QueryErrorBoundary fallback={<PageErrorFallback />}>
      <PageContainer width="form">
        <EmailSubpageLayout
          title="Add a provider"
          description="Choose how this site sends email, connect it, then send a real test. It stays off until the test is accepted."
          crumb="Add provider"
          parentCrumb={{ label: "Sending", href: ROUTES.EMAIL_SENDING }}
        >
          <div className="space-y-6">
            <SetupStepper current={setup.step} />
            <SetupBody setup={setup} />
          </div>
        </EmailSubpageLayout>
      </PageContainer>
    </QueryErrorBoundary>
  );
}

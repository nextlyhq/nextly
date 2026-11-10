/**
 * What the provider screens ask of the catalog and its form without drawing it.
 *
 * Kept apart from the form itself: the list page draws no form, and the create
 * and edit pages read these before theirs has loaded, so importing them from
 * the form's modules put the form, its generated schema and every provider's
 * fields into those pages' bundles.
 *
 * @module components/features/settings/EmailProviderForm/email-provider-catalog
 */

import type { EmailProviderDescriptor } from "@admin/services/emailProviderApi";

// ============================================================
// Form id used by external buttons (e.g. SettingsLayout.actions)
// to submit this form via the `form` attribute.
// ============================================================

export const EMAIL_PROVIDER_FORM_ID = "email-provider-form";

/**
 * Whether a stored provider's type is absent from the catalog this server
 * registered — its plugin was removed while the record survived.
 *
 * Exported because the page that renders the Update button is not the
 * component that renders the form, and both have to reach the same answer. A
 * page deciding it separately is how the form comes to say the settings cannot
 * be edited while the button beside it still submits them.
 *
 * Only meaningful once the catalog has settled: while it is loading, every
 * type looks unregistered. Callers gate on their own loading state, exactly as
 * the form does before it uses this.
 */
export function isUnregisteredProviderType(
  providerType: string | undefined,
  descriptors: EmailProviderDescriptor[]
): boolean {
  if (providerType === undefined) return false;
  return !descriptors.some(entry => entry.type === providerType);
}

/** What the provider catalog can be used for right now. */
export type EmailCatalogState = "loading" | "unavailable" | "stale" | "ready";

/**
 * Which of those four states the catalog is in.
 *
 * A failed request has two outcomes calling for opposite responses. With
 * nothing cached there is no catalog at all, and a surface built from it would
 * render an empty picker — which reads as "this installation has no provider
 * types" rather than "the list could not be loaded". With descriptors already
 * in hand the failure is a refresh that did not land: every one of them still
 * renders and still validates, so withdrawing the page would discard whatever
 * had been typed to fix nothing.
 *
 * The two are answered here rather than at each surface for the same reason
 * `isUnregisteredProviderType` is: the form and the page framing it must reach
 * one answer. A surface deciding separately is how an enabled Update comes to
 * sit under a notice saying the settings cannot be edited.
 *
 * Loading outranks failure so a retry in flight reads as loading rather than
 * as the error it has not yet cleared.
 */
export function emailCatalogState({
  loading,
  failed,
  descriptors,
}: {
  loading?: boolean;
  /** Whether the request for the catalog failed. */
  failed: boolean;
  /** Whatever descriptors are in hand, cached ones included. */
  descriptors: EmailProviderDescriptor[];
}): EmailCatalogState {
  if (loading === true) return "loading";
  if (!failed) return "ready";
  return descriptors.length > 0 ? "stale" : "unavailable";
}

/**
 * A `SelectItem` value that stands for "no selection".
 *
 * Radix refuses an item whose value is the empty string, because that is how it
 * spells "nothing chosen" internally — so an optional select rendered from
 * options alone has no interaction that can ever clear it, and a stored choice
 * becomes permanent however much machinery exists downstream to remove it.
 *
 * Derived from the descriptor's own options rather than fixed, so it cannot
 * collide with a real value a provider declares. A fixed sentinel would be a
 * value some provider is entitled to use, and the collision would present as a
 * choice that silently clears the field.
 */
export function clearSelectionValue(
  options: ReadonlyArray<{ value: string }> | undefined
): string {
  const taken = new Set((options ?? []).map(option => option.value));
  let candidate = "__nextly_none__";
  while (taken.has(candidate)) candidate += "_";
  return candidate;
}

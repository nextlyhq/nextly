"use client";

/**
 * The shareable-link wiring for a Single, as one decision rather than three
 * scattered through the form.
 *
 * It exists because the parts are only correct together. The locale has to be
 * RESOLVED before it can be minted against — on a localized Single opened in
 * its default language the editor's active locale is absent, and an absent
 * locale claim is not "the default language": it authorizes every locale, so a
 * link minted that way opens translations that have never been published. And
 * where it cannot be resolved the control has to be withheld, because minting
 * without a claim is that same grant and minting an empty one is refused by the
 * route.
 *
 * @module components/features/singles/useSinglePreviewLink
 */

import { previewLinkLocale } from "@admin/components/features/entries/EntryForm/entry-address";
import { usePreviewLink } from "@admin/hooks/usePreviewLink";
import type { UsePreviewLinkOptions } from "@admin/hooks/usePreviewLink";

export interface SinglePreviewLinkInput {
  /** The Single's slug, which is its identity — there is no id to wait for. */
  slug: string;
  /** Whether the Single carries translations. */
  localized: boolean;
  /** Whether the Single carries a Draft / Published lifecycle. */
  hasStatus: boolean;
  /** The language being edited; absent means the default one. */
  locale: string | undefined;
  /** The site's default language, once localization config has loaded. */
  defaultLocale: string | undefined;
}

export interface SinglePreviewLink {
  /** Whether to offer the control at all. */
  isAvailable: boolean;
  /** Mint and copy. */
  copy: () => void;
  /** Whether a mint is in flight. */
  isCopying: boolean;
}

export function useSinglePreviewLink({
  slug,
  localized,
  hasStatus,
  locale,
  defaultLocale,
}: SinglePreviewLinkInput): SinglePreviewLink {
  // The same resolver the entry editor uses, rather than a second rule written
  // here: two answers to "which language is this link for" drift, and the drift
  // is silent because both look correct.
  const linkLocale = previewLinkLocale({ localized, locale, defaultLocale });

  const target: UsePreviewLinkOptions = {
    single: slug,
    ...(linkLocale.kind === "scoped" ? { locale: linkLocale.locale } : {}),
  };

  const link = usePreviewLink(target);

  return {
    // A Single with no publish lifecycle has no pending state to show anyone,
    // so there is nothing to share and the control is not offered.
    isAvailable: hasStatus && linkLocale.kind !== "unresolved",
    copy: () => {
      link.mutate();
    },
    isCopying: link.isPending,
  };
}

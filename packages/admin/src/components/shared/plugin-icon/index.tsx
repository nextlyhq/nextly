import type React from "react";
import { useState } from "react";

import * as Icons from "@admin/components/icons";
import { resolvePluginIconFrom } from "@admin/lib/plugins/resolve-plugin-icon";
import { cn } from "@admin/lib/utils";
import type { PluginMetadata } from "@admin/types/branding";

type IconCandidate = Pick<PluginMetadata, "appearance"> | undefined;

interface PluginIconFromProps {
  /**
   * Appearance sources in precedence order; the first that declares an icon
   * wins. A caller with one source passes one. Callers with two — an installed
   * plugin and the catalogue entry describing it — must not decide the order
   * here: ask the module that owns the precedence rule for the list.
   */
  candidates: readonly IconCandidate[];
  /**
   * The lucide icon to use when the plugin declares none.
   *
   * Required rather than defaulted, because the right answer depends on the
   * surface: the sidebar shows a standalone plugin as the collections it
   * registers (`Database`), while the plugins table and detail page show it as
   * a package (`Package`). A default here would silently pick one.
   */
  fallback: string;
  className?: string;
  /** Alt text for the asset case. Decorative by default. */
  alt?: string;
}

interface PluginIconProps extends Omit<PluginIconFromProps, "candidates"> {
  /** The plugin whose icon to render. Only `appearance` is read. */
  plugin: Pick<PluginMetadata, "appearance">;
}

/**
 * Render a plugin's icon, whether it ships an image or names a lucide glyph.
 *
 * This exists so the discriminated union `resolvePluginIcon` returns is handled
 * in ONE place. Four call sites render a plugin icon; branching on the union at
 * each of them would rebuild, in a new shape, exactly the duplication the
 * shared resolver was introduced to remove.
 *
 * @module components/shared/plugin-icon
 */
export function PluginIconFrom({
  candidates,
  fallback,
  className,
  alt = "",
}: PluginIconFromProps): React.ReactElement {
  // A declared asset can still fail to arrive: a mistyped path, a deleted
  // file, or a Content-Security-Policy that blocks the origin. Without this the
  // surface keeps a broken-image glyph forever, which is worse than the plain
  // icon it replaced. On failure the component re-resolves with assets
  // disallowed, so it lands on whatever lucide name the plugin declared beside
  // the asset before reaching the caller's fallback.
  // The failed URL rather than a boolean. A boolean survives client-side
  // navigation between two plugin detail pages, because the router renders the
  // same component type without a key, so React keeps the state: one plugin's
  // broken logo would suppress the next plugin's working one. Keying on the
  // source means a different asset is always attempted.
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  // Assets are disallowed once the one this chain would pick has failed, which
  // drops that candidate to its lucide name and lets the next candidate answer.
  // Comparing against the chain's own choice rather than a single declared
  // asset keeps that true when more than one candidate ships an image.
  const declaredAsset = resolvePluginIconFrom(candidates, { fallback });
  const source = resolvePluginIconFrom(candidates, {
    fallback,
    allowAsset: !(
      declaredAsset.kind === "asset" && declaredAsset.src === failedSrc
    ),
  });

  if (source.kind === "asset") {
    // Decorative by default: the plugin's name is always rendered beside this,
    // so announcing the logo as well repeats it for a screen reader.
    // object-contain, because every caller sizes this with equal h-* and w-*
    // and the default object-fit of `fill` would squash a rectangular logo
    // into that square.
    return (
      <img
        src={source.src}
        alt={alt}
        onError={() => setFailedSrc(source.src)}
        className={cn("object-contain", className)}
      />
    );
  }

  const registry = Icons as unknown as Record<string, React.ElementType>;
  // An unknown lucide name resolves to nothing, so fall through to the
  // caller's fallback rather than rendering a hole. A plugin can name any
  // string here and the icon barrel only carries the icons this admin uses.
  const Named = registry[source.name] ?? registry[fallback];
  if (!Named) return <span className={className} aria-hidden="true" />;

  return <Named className={className} />;
}

/** The single-source case, which is every surface but the catalogue. */
export function PluginIcon({
  plugin,
  ...rest
}: PluginIconProps): React.ReactElement {
  return <PluginIconFrom candidates={[plugin]} {...rest} />;
}

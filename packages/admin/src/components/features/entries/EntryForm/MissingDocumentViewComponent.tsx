"use client";

/**
 * What a document view draws when its component is not registered in this
 * admin: a sentence, never an empty screen.
 *
 * A plugin's view component reaches a bundled admin through the generated
 * component map. When the map was not regenerated after the plugin was added,
 * the address resolves, the document loads, and the slot has nothing to draw —
 * which reads as a broken page with no way to tell why. So the host says it.
 *
 * Which sentence is the RUNNING server's call, not the bundle's: the admin's
 * own `NODE_ENV` was fixed when the package was built. The workspace answer
 * `devReload` is the server's, and only an explicit `true` counts as
 * development, so an author on a production site, or one whose answer has not
 * arrived yet, is never handed an instruction meant for a developer.
 */
import { useEffect } from "react";

import { useBranding } from "@admin/context/providers/BrandingProvider";

export function MissingDocumentViewComponent({
  path,
}: {
  /** The component path the view was declared with. */
  path: string;
}) {
  const development = useBranding().devReload === true;

  // The detail goes to the console in every environment: it names the
  // component, which a production screen does not, so whoever opens the
  // developer tools on a site reporting a blank screen can see why.
  useEffect(() => {
    console.error(
      `[nextly] The document view component "${path}" is not registered in the admin. ` +
        "Run `nextly generate:types` to regenerate the admin's component map, then rebuild."
    );
  }, [path]);

  return (
    <div className="flex h-full items-center justify-center p-6">
      <div
        role="alert"
        className="max-w-md rounded-md border border-border bg-card p-4 text-sm text-foreground"
      >
        {development ? (
          <>
            <p className="font-medium">
              This screen's component isn't in the admin's component map.
            </p>
            <code className="mt-1 block break-all text-xs text-muted-foreground">
              {path}
            </code>
            <p className="mt-2 text-muted-foreground">
              Run <code>nextly generate:types</code>, then reload.
            </p>
          </>
        ) : (
          <p className="font-medium">
            This screen isn't available. Ask your developer.
          </p>
        )}
      </div>
    </div>
  );
}

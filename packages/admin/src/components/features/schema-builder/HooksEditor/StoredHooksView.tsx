/**
 * A collection's stored hooks, for reading only.
 *
 * Stored hooks rewrite or refuse writes on the server, and the Builder does not
 * edit them: each is shown with what it does, when it runs, its settings and
 * whether it is on, in the order the server runs them. The view renders text
 * only, so nothing here can change a hook.
 *
 * @module components/features/schema-builder/HooksEditor/StoredHooksView
 */

import { Badge } from "@nextlyhq/ui";

import { summarizeStoredHooks } from "@admin/lib/builder/stored-hook-summary";

export interface StoredHooksViewProps {
  /**
   * The collection's stored `hooks` as the API returned them. Unknown entries
   * are parsed in the summary, since the API accepts any array.
   */
  hooks: readonly unknown[] | undefined;
}

export function StoredHooksView({
  hooks,
}: StoredHooksViewProps): React.ReactElement {
  const summaries = summarizeStoredHooks(hooks);
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Shown read-only. To change or turn off a stored hook, use the API.
      </p>
      {/* Bounded and scrollable, so a long list or a long setting value never
          pushes the dialog's tabs or footer off screen; focusable, so the
          region scrolls from the keyboard too. */}
      <div
        role="region"
        aria-label="Stored hooks"
        tabIndex={0}
        className="max-h-[50vh] overflow-y-auto pr-1"
      >
        <ol aria-label="Stored hooks, by when they run" className="space-y-3">
          {summaries.map((summary, index) => (
            // Two stored hooks may share an id; their position tells them apart.
            <li
              key={`${index}-${summary.hookId}`}
              className="rounded-md border border-border p-3 space-y-2"
            >
              <div className="flex items-center justify-between gap-2">
                <h4 className="text-sm font-medium">{summary.name}</h4>
                <Badge variant={summary.on ? "success" : "default"}>
                  {summary.on ? "On" : "Off"}
                </Badge>
              </div>
              <p className="text-sm">{summary.does}</p>
              <p className="text-xs text-muted-foreground">{summary.when}</p>
              {summary.settings.length > 0 && (
                <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
                  {summary.settings.map(setting => (
                    <div key={setting.label} className="contents">
                      <dt className="text-muted-foreground">{setting.label}</dt>
                      <dd className="break-all">{setting.value}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

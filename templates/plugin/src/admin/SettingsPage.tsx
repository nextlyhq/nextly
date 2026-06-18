/**
 * Example plugin settings page, rendered at `/admin/plugins/<slug>` and inside
 * a per-component error boundary (D53). Build your real settings UI here with
 * `@nextlyhq/ui` components.
 */
export function SettingsPage() {
  return (
    <div style={{ padding: 24 }}>
      <h1>{{ pluginName }}</h1>
      <p>Plugin settings go here. Edit `src/admin/SettingsPage.tsx`.</p>
    </div>
  );
}

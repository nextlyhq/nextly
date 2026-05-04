---
"@revnixhq/admin": minor
---

Convert the "Add Image Size" / "Edit Image Size" dialog into dedicated create and edit pages at `/admin/settings/image-sizes/create` and `/admin/settings/image-sizes/edit/[id]`. The list page now navigates to these pages instead of opening a modal, matching the pattern used by Email Providers, Email Templates, and API Keys. The form layout uses the shared `SettingsSection` / `SettingsRow` primitives so it visually matches `/admin/settings`. Existing `fetchImageSizes` / `createImageSize` / `updateImageSize` / `deleteImageSize` helpers are extracted to a service module.

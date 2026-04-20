# @revnixhq/adapter-sqlite

## 0.0.139

### Patch Changes

- [#1259](https://github.com/revnix/nextly-dev/pull/1259) [`76e96cf`](https://github.com/revnix/nextly-dev/commit/76e96cf12aed3af0cbcba2f3dafaa2f273f073c6) Thanks [@muzzamil-rx](https://github.com/muzzamil-rx)! - enhance email verification and activation flow with recent token handling

- Updated dependencies [[`76e96cf`](https://github.com/revnix/nextly-dev/commit/76e96cf12aed3af0cbcba2f3dafaa2f273f073c6)]:
  - @revnixhq/adapter-drizzle@0.0.139

## 0.0.138

### Patch Changes

- [#1249](https://github.com/revnix/nextly-dev/pull/1249) [`385b3ff`](https://github.com/revnix/nextly-dev/commit/385b3ffb44794c66cf6341e6fa860c19520c8f2f) Thanks [@faisalrevnix](https://github.com/faisalrevnix)! - **Media folder UX overhaul**
  - Add inline "New folder" creation in the move-to-folder dialog and in the
    media picker's upload tab — no need to leave the dialog to organize.
  - Add parent-folder selection to the create-folder dialog with auto-expand,
    so the pre-selected ancestor (when invoked from a folder's "New subfolder"
    action) is visible immediately.
  - Extract a shared `FolderTreePicker` used by Create/Move/Edit dialogs;
    removes ~150 LOC of duplicated recursive tree logic.
  - Add toast feedback on move-to-folder (success, partial-fail, all-fail).
  - Drop the folder color/icon feature; folders now render with the default
    folder icon. Removes the fields from TS types, Drizzle schemas, the
    media-folder service, and all hardcoded CREATE TABLE statements
    (sqlite-core-tables, migrate-fresh, test fixtures, original media_folders
    migrations). Deletes the `IconPicker` component. **Heads-up:** this
    retroactively edits the postgres `0005_media_folders` and mysql `0012`
    migration files — already-applied DBs will fail checksum validation;
    update the stored checksum or run a manual `ALTER TABLE media_folders
DROP COLUMN color, DROP COLUMN icon`.
  - Fix: dashboard now greets first-time admins with "Welcome, Admin"
    instead of "Welcome back, Admin".
  - Fix: move-to-folder showed a red error toast with the success message
    on actual successes — backend doesn't echo the updated row, and the
    `mediaFetchData` helper threw `result.message` as an Error. Consolidated
    to a single `mediaFetch` helper (envelope-only); callers unwrap `.data`
    inline. Eliminates the class of bug.

- [#1258](https://github.com/revnix/nextly-dev/pull/1258) [`d2919fa`](https://github.com/revnix/nextly-dev/commit/d2919fa99ce514fc935f13152e5df4ba2f56623d) Thanks [@faisalrevnix](https://github.com/faisalrevnix)! - **User avatar uploader on Create / Edit User pages**
  - Replace the free-text "Avatar URL" input on the Create and Edit user
    pages with an inline avatar control. A pencil icon on the avatar opens
    the existing `MediaPickerDialog` (pick from the media library or upload
    a new image via its Upload tab); an X button on the avatar clears it
    back to the initial-letter fallback.
  - Add a new `AvatarUploader` component
    (`packages/admin/src/components/features/user-management/avatar-uploader/`)
    with a controlled `value`/`onChange` contract. Covered by 8 unit tests.
  - Remove the now-redundant Avatar URL `<Input>` from the shared
    `UserFormFields` component; the `avatarUrl` field stays on the form
    schema and the API payload (`image`) is unchanged, so legacy users
    with URLs already stored continue to render.
  - Defer `MediaPickerDialog` mount until the pencil is clicked — its four
    TanStack Queries no longer fire on every Create/Edit user page load.
  - Remove the now-unused `FORM_AVATAR_SIZE` constant from
    `packages/admin/src/constants/forms.ts`.

- Updated dependencies [[`385b3ff`](https://github.com/revnix/nextly-dev/commit/385b3ffb44794c66cf6341e6fa860c19520c8f2f), [`d2919fa`](https://github.com/revnix/nextly-dev/commit/d2919fa99ce514fc935f13152e5df4ba2f56623d)]:
  - @revnixhq/adapter-drizzle@0.0.138

## 0.0.137

### Patch Changes

- [#1240](https://github.com/revnix/nextly-dev/pull/1240) [`029fc4d`](https://github.com/revnix/nextly-dev/commit/029fc4d8446972df1e2bd82a904d3e0c40e86d62) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Test the branch and then merge it into dev

- Updated dependencies [[`029fc4d`](https://github.com/revnix/nextly-dev/commit/029fc4d8446972df1e2bd82a904d3e0c40e86d62)]:
  - @revnixhq/adapter-drizzle@0.0.137

## 0.0.136

### Patch Changes

- Updated dependencies []:
  - @revnixhq/adapter-drizzle@0.0.136

## 0.0.135

### Patch Changes

- Updated dependencies []:
  - @revnixhq/adapter-drizzle@0.0.135

## 0.0.134

### Patch Changes

- Updated dependencies []:
  - @revnixhq/adapter-drizzle@0.0.134

## 0.0.133

### Patch Changes

- [#1233](https://github.com/revnix/nextly-dev/pull/1233) [`9e44b83`](https://github.com/revnix/nextly-dev/commit/9e44b83d50921c064f6473d173957326472b4169) Thanks [@muzzamilrevnix](https://github.com/muzzamilrevnix)! - Previously, there was an issue with pluralization. When a user added a word in singular form (for example, "post"), the system automatically converted it into an incorrect plural form like "postses", which was wrong.

  I fixed this issue by improving the pluralization logic. Now, if a user enters a word that is already plural or mistakenly uses a plural form in the singular field, the system will no longer attempt to incorrectly pluralize it. Instead, it will keep the word as it is, preventing invalid transformations like "postses".

  This ensures that both singular and plural forms are handled correctly and consistently.

- Updated dependencies [[`9e44b83`](https://github.com/revnix/nextly-dev/commit/9e44b83d50921c064f6473d173957326472b4169)]:
  - @revnixhq/adapter-drizzle@0.0.133

## 0.0.132

### Patch Changes

- [#1234](https://github.com/revnix/nextly-dev/pull/1234) [`80a5b70`](https://github.com/revnix/nextly-dev/commit/80a5b70f1eccb608dcc08d040da822089f4dcded) Thanks [@faisalrevnix](https://github.com/faisalrevnix)! - ---

  Fixed a security issue where weak passwords (e.g. "aaaaaaaaaa") could bypass validation during setup and account creation.

  Passwords are now required to include uppercase, lowercase, numeric, and special characters. This validation is enforced on both client and server to prevent bypassing API checks.

  Also removed duplicated password validation logic across setup, signup, and reset password flows by introducing shared utilities.

- Updated dependencies [[`80a5b70`](https://github.com/revnix/nextly-dev/commit/80a5b70f1eccb608dcc08d040da822089f4dcded)]:
  - @revnixhq/adapter-drizzle@0.0.132

## 0.0.131

### Patch Changes

- [#1231](https://github.com/revnix/nextly-dev/pull/1231) [`4eb43a3`](https://github.com/revnix/nextly-dev/commit/4eb43a33f68cee13f12fd15491fbc9d5ad9f81ca) Thanks [@faisalrevnix](https://github.com/faisalrevnix)! - version bump test

- Updated dependencies [[`4eb43a3`](https://github.com/revnix/nextly-dev/commit/4eb43a33f68cee13f12fd15491fbc9d5ad9f81ca)]:
  - @revnixhq/adapter-drizzle@0.0.131

## 0.0.130

### Patch Changes

- [#1229](https://github.com/revnix/nextly-dev/pull/1229) [`cf2d784`](https://github.com/revnix/nextly-dev/commit/cf2d784d12db74f25728f9fd6d571de96c6c8d55) Thanks [@faisalrevnix](https://github.com/faisalrevnix)! - Remove prepublishOnly scripts from all packages to fix storage package publish failures. Turbo build already runs with correct dependency ordering before changeset publish, making prepublishOnly redundant and causing race conditions where storage packages would attempt DTS generation before @revnixhq/nextly was fully built.

- Updated dependencies [[`cf2d784`](https://github.com/revnix/nextly-dev/commit/cf2d784d12db74f25728f9fd6d571de96c6c8d55)]:
  - @revnixhq/adapter-drizzle@0.0.130

## 0.0.130-alpha.2

### Patch Changes

- [`cf2d784`](https://github.com/revnix/nextly-dev/commit/cf2d784d12db74f25728f9fd6d571de96c6c8d55) Thanks [@faisalrevnix](https://github.com/faisalrevnix)! - Remove prepublishOnly scripts from all packages to fix storage package publish failures. Turbo build already runs with correct dependency ordering before changeset publish, making prepublishOnly redundant and causing race conditions where storage packages would attempt DTS generation before @revnixhq/nextly was fully built.

- Updated dependencies [[`cf2d784`](https://github.com/revnix/nextly-dev/commit/cf2d784d12db74f25728f9fd6d571de96c6c8d55)]:
  - @revnixhq/adapter-drizzle@0.0.130-alpha.2

## 0.0.130-alpha.1

### Patch Changes

- Updated dependencies []:
  - @revnixhq/adapter-drizzle@0.0.130-alpha.1

## 0.0.130-alpha.0

### Patch Changes

- Updated dependencies []:
  - @revnixhq/adapter-drizzle@0.0.130-alpha.0

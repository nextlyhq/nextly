---
"@nextlyhq/admin": patch
---

Fix faint borders and inconsistent width on the auth pages (login, register, setup, forgot/reset password, verify email). The card outline used the subtle border tier, which was nearly invisible on the flat full-page background, so it now uses the strong border tier and reads as a clearly defined card in both light and dark. Form fields were pinned to the subtle border token instead of the field border token, making them look washed out; they now use the standard visible field border. The register and setup cards had no width constraint and stretched wider than the others; they are now centered at the same width as login. The "email not verified" notice on login also dropped its hardcoded amber colors in favor of the warning token with legible text.

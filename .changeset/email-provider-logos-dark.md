---
"@nextlyhq/admin": patch
---

Make the email provider logos legible in dark mode. The SMTP, Resend, and SendLayer marks in the provider-type picker had their brand colors (black and near-black inks) baked into the SVGs, so they were invisible on dark surfaces. They now render as monochrome marks driven by `currentColor` and inherit a theme-aware foreground, so they read clearly in both light and dark. The SMTP mark also now scales to its box instead of overflowing.

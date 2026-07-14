---
"@nextlyhq/ui": patch
---

Control heights are now token-driven. The Button, Input, and Select size variants read from a `--control-height` scale (`--control-height`, plus `-sm`/`-md`/`-lg` derived from it via `calc()`) instead of hardcoded height utilities. The default values are unchanged (32/36/40/44px), so existing controls render identically; consumers can now retune control density from a single token.

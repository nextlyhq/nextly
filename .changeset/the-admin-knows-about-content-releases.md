---
"@nextlyhq/admin": patch
---

The permissions UI now knows about content releases.

Adding `content-releases` as a system resource in core left the admin's four
copies of that list behind, so the permission was filed under Collections in the
role editor, mapped as per-collection access by the capability builder, and
rendered under the wrong bucket on the permissions page. Nothing threw — a
miscategorised permission simply shows the wrong thing, which is why a
role-matrix entry that quietly changes what preset roles can reach is worth
fixing as a defect rather than as tidying.

Content releases now sit with the editorial surfaces in the permissions page's
display order, next to media, rather than after the delivery and integration
entries: it is a tool an editor reaches daily, not infrastructure.

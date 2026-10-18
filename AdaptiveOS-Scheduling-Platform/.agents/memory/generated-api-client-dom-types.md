---
name: Generated API client DOM types
description: TypeScript library declarations needed by generated fetch clients.
---

When Orval generates fetch-client code that enumerates `Headers.entries()`, the shared client TypeScript configuration needs `"dom.iterable"` alongside `"dom"` in its `lib` list.

**Why:** Generation can succeed while typechecking fails because the default DOM declarations do not type `Headers.entries()`.

**How to apply:** Recheck the DOM library list after changing code generation or shared API-client TypeScript settings.

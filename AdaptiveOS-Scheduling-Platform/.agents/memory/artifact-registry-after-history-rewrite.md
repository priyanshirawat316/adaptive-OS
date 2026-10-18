---
name: Artifact registry after local Git history changes
description: A registered app and its workflow can disappear independently of source files.
---

After a local history rewrite on 2026-10-18, AdaptiveOS disappeared from the artifact registry and its web workflow was removed while the source and artifact manifest remained. The cause is unconfirmed; do not assume the rewrite itself caused it.

**Rule:** After local branch or ref-history operations, verify that important artifacts remain registered and their managed workflows are running; source files alone do not prove that a preview is available.

**Why:** This workspace had a live source tree but a missing app registration.

**How to apply:** Include registry and workflow checks in post-rewrite verification before declaring the preview available.

---
name: Local agent dependency
description: The psutil requirement is for desktop agent installations, not this managed workspace.
---

The local observation agent depends on psutil. This managed Python workspace uses an externally managed interpreter, and its system-package index does not provide the attempted psutil package; agent tests use a psutil stub here.

**Why:** The intended agent target is the user's Windows desktop, not the Replit server runtime.

**How to apply:** Keep psutil in the desktop agent's requirements and verify the real collector on a desktop where that dependency can be installed.

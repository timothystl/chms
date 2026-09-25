# Contract validators

Pure, I/O-free `validateX` / `acceptX` functions for the versioned cross-product contracts whose
JSON Schemas live one directory up. They are shared code: Connect's producers
(`src/api-contracts.js`) validate their own output with them before responding, and Finance's
clients (`apps/finance/*-client.js`) validate what they receive. Keeping them here, rather than
inside either application, means neither app imports the other's source.

Rules for files in this directory:

- No imports outside this directory (and no Worker bindings, `fetch`, D1, or Node APIs).
- Closed-shape, fail-closed validation: unknown keys and malformed values are rejected.
- A breaking shape change is a new contract version (`-v2`), not an edit to a `-v1` validator.

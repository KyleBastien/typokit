// @typokit/core — Pre-computed Response Headers
//
// Shared header constants to avoid per-request object allocation.
// These frozen objects are safe to reuse across responses.

import type { TypoKitResponse } from "@typokit/types";

/** Pre-computed headers for JSON responses. Reuse instead of creating per-request. */
export const JSON_HEADERS: TypoKitResponse["headers"] = Object.freeze({
  "content-type": "application/json",
});

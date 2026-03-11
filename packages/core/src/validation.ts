// @typokit/core — Validator Resolution
//
// Walks the compiled route table at registration time and resolves
// string-based validator references from a RawValidatorMap into a
// route-keyed ValidatorMap for O(1) per-request lookup.

import type {
  CompiledRoute,
  CompiledRouteTable,
  HttpMethod,
  RawValidatorMap,
  RouteValidators,
  ValidatorMap,
} from "@typokit/types";

/**
 * Pre-resolve validator references into a route-keyed map.
 *
 * Walks every handler in the compiled route table and looks up each
 * validator string reference (params / query / body) in the raw map.
 * The result is keyed by the handler's `ref` so that request-time
 * validation needs only a single hash lookup.
 */
export function resolveValidatorMap(
  routeTable: CompiledRouteTable,
  rawMap: RawValidatorMap,
): ValidatorMap {
  const resolved: ValidatorMap = {};

  function walk(node: CompiledRoute): void {
    if (node.handlers) {
      for (const method in node.handlers) {
        const handler = node.handlers[method as HttpMethod];
        if (handler?.validators) {
          const v = handler.validators;
          const entry: RouteValidators = {};
          let hasAny = false;

          if (v.params) {
            const fn = rawMap[v.params];
            if (fn) {
              entry.params = fn;
              hasAny = true;
            }
          }
          if (v.query) {
            const fn = rawMap[v.query];
            if (fn) {
              entry.query = fn;
              hasAny = true;
            }
          }
          if (v.body) {
            const fn = rawMap[v.body];
            if (fn) {
              entry.body = fn;
              hasAny = true;
            }
          }

          if (hasAny) {
            resolved[handler.ref] = entry;
          }
        }
      }
    }

    if (node.children) {
      for (const key in node.children) {
        walk(node.children[key]);
      }
    }
    if (node.paramChild) walk(node.paramChild);
    if (node.wildcardChild) walk(node.wildcardChild);
  }

  walk(routeTable);
  return resolved;
}

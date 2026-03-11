// @typokit/testing — toMatchSchema custom matcher
// Adapters for Jest, Vitest, and Rstest

import type {
  ValidatorFn,
  RawValidatorMap,
  ValidationFieldError,
} from "@typokit/types";

// ─── Schema Registry ─────────────────────────────────────────

/** Global registry of compiled validators keyed by schema name */
let validatorRegistry: RawValidatorMap = {};

/**
 * Register compiled validators for use with toMatchSchema().
 * Call this in your test setup with validators from your build output.
 *
 * ```ts
 * import { registerSchemaValidators } from "@typokit/testing";
 * registerSchemaValidators({
 *   PublicUser: (input) => ({ success: true, data: input }),
 *   CreateUserInput: myTypiaValidator,
 * });
 * ```
 */
export function registerSchemaValidators(validators: RawValidatorMap): void {
  validatorRegistry = { ...validatorRegistry, ...validators };
}

/**
 * Get a validator by schema name. Throws if not registered.
 */
export function getSchemaValidator(schemaName: string): ValidatorFn {
  const validator = validatorRegistry[schemaName];
  if (!validator) {
    const available = Object.keys(validatorRegistry);
    throw new Error(
      `Schema "${schemaName}" not registered. ` +
        `Available schemas: ${available.length > 0 ? available.join(", ") : "(none)"}. ` +
        `Call registerSchemaValidators() in your test setup.`,
    );
  }
  return validator;
}

/** Clear all registered validators (for test isolation) */
export function clearSchemaValidators(): void {
  validatorRegistry = {};
}

// ─── Matcher Result ──────────────────────────────────────────

/** Result of a schema match operation */
export interface SchemaMatchResult {
  pass: boolean;
  message: string;
}

// ─── Core Matcher Logic ──────────────────────────────────────

/**
 * Format validation errors into a human-readable message.
 */
function formatErrors(errors: ValidationFieldError[]): string {
  return errors
    .map(
      (e) =>
        `  • ${e.path}: expected ${e.expected}, received ${JSON.stringify(e.actual)}`,
    )
    .join("\n");
}

/**
 * Core schema matching logic shared by all framework adapters.
 */
export function matchSchema(
  received: unknown,
  schemaName: string,
): SchemaMatchResult {
  const validator = getSchemaValidator(schemaName);
  const result = validator(received);

  if (result.success) {
    return {
      pass: true,
      message: `Expected value NOT to match schema "${schemaName}", but it did.`,
    };
  }

  const errorDetails =
    result.errors && result.errors.length > 0
      ? `\nField errors:\n${formatErrors(result.errors)}`
      : "";

  return {
    pass: false,
    message: `Expected value to match schema "${schemaName}", but validation failed.${errorDetails}`,
  };
}

// ─── Jest / Vitest / Rstest Adapter ──────────────────────────

/**
 * Custom matcher for Jest, Vitest, and Rstest expect() chains.
 *
 * All three frameworks share compatible matcher APIs:
 * - `this.isNot` indicates `.not.toMatchSchema()` usage
 * - Return `{ pass, message() }` object
 *
 * Usage:
 * ```ts
 * import { toMatchSchema, registerSchemaValidators } from "@typokit/testing";
 *
 * // For Jest:
 * expect.extend({ toMatchSchema });
 *
 * // For Vitest:
 * expect.extend({ toMatchSchema });
 *
 * // For Rstest:
 * expect.extend({ toMatchSchema });
 *
 * // Then in tests:
 * expect(responseBody).toMatchSchema("PublicUser");
 * ```
 */
export function toMatchSchema(
  this: { isNot?: boolean } | void,
  received: unknown,
  schemaName: string,
): { pass: boolean; message: () => string } {
  const result = matchSchema(received, schemaName);

  return {
    pass: result.pass,
    message: () => result.message,
  };
}

// ─── Type Augmentations ──────────────────────────────────────

/**
 * Type declaration for extending expect() in Jest, Vitest, and Rstest.
 *
 * Users should add to their test setup:
 * ```ts
 * declare module "expect" {
 *   interface AsymmetricMatchers {
 *     toMatchSchema(schemaName: string): void;
 *   }
 *   interface Matchers<R> {
 *     toMatchSchema(schemaName: string): R;
 *   }
 * }
 * ```
 */
export interface SchemaMatchers<R = unknown> {
  toMatchSchema(schemaName: string): R;
}

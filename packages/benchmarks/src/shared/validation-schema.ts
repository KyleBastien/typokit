/**
 * Validation schema for benchmark request body.
 * Moderately complex with nested object, string, number, enum, array, and optional fields.
 * Uses TypoKit's schema-first pattern with JSDoc annotations.
 */

/**
 * Nested author information for benchmark items.
 */
export interface BenchmarkAuthor {
  /** @minLength 1 */
  /** @maxLength 100 */
  readonly name: string;

  /** @format email */
  readonly email: string;
}

/**
 * Request body for creating or updating a benchmark item.
 * This is the validation schema used across all benchmark apps to test
 * validation overhead consistently.
 *
 * @table benchmark_items
 */
export interface CreateBenchmarkItemBody {
  /** @minLength 1 */
  /** @maxLength 255 */
  readonly title: string;

  /** @enum active, archived, draft */
  readonly status: "active" | "archived" | "draft";

  /** @minimum 1 */
  /** @maximum 10 */
  readonly priority: number;

  /** @minItems 0 */
  /** @maxItems 10 */
  readonly tags: readonly string[];

  readonly author: BenchmarkAuthor;

  /** @minLength 0 */
  /** @maxLength 2000 */
  readonly description?: string;
}

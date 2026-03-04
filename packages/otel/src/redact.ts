/**
 * Redacts sensitive fields from a data object based on glob-style patterns.
 * Patterns like "*.password" match any key named "password" at any depth.
 * Patterns like "authorization" match the exact key at root level.
 */
export function redactFields(
  data: Record<string, unknown>,
  patterns: string[],
): Record<string, unknown> {
  if (patterns.length === 0) return data;

  const fieldNames = new Set<string>();
  for (const pattern of patterns) {
    // "*.fieldName" → match fieldName at any depth
    if (pattern.startsWith("*.")) {
      fieldNames.add(pattern.slice(2));
    } else {
      // exact key name match at any depth
      fieldNames.add(pattern);
    }
  }

  return redactObject(data, fieldNames);
}

function redactObject(
  obj: Record<string, unknown>,
  fieldNames: Set<string>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(obj)) {
    const value = obj[key];
    if (fieldNames.has(key)) {
      result[key] = "[REDACTED]";
    } else if (isPlainObject(value)) {
      result[key] = redactObject(value as Record<string, unknown>, fieldNames);
    } else if (Array.isArray(value)) {
      result[key] = value.map((item) =>
        isPlainObject(item)
          ? redactObject(item as Record<string, unknown>, fieldNames)
          : item,
      );
    } else {
      result[key] = value;
    }
  }
  return result;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

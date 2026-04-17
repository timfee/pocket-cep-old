/**
 * @file Shared error utilities.
 *
 * TypeScript's catch blocks type errors as `unknown`. This helper
 * provides a safe, consistent way to extract a human-readable message
 * from any caught value — avoiding the `error instanceof Error ? ...`
 * pattern repeated across every try/catch in the codebase.
 */

/**
 * Extracts a human-readable message from an unknown caught value.
 * Returns the fallback string if the value isn't an Error instance.
 */
export function getErrorMessage(error: unknown, fallback = "Unknown error"): string {
  return error instanceof Error ? error.message : fallback;
}

/**
 * Agent utility functions
 */

/**
 * Wait until a condition is met or timeout occurs
 * Used for strict mode thinking completion
 */
export async function waitUntil(
  condition: () => boolean,
  timeoutMs: number
): Promise<boolean> {
  const start = Date.now();

  while (!condition()) {
    if (Date.now() - start >= timeoutMs) {
      return false; // Timeout
    }
    // Poll every 50ms
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  return true; // Condition met
}

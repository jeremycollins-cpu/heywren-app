/**
 * Sanitize a value for safe interpolation into PostgREST filter strings (.or() etc).
 * Strips characters that could alter filter logic: commas, parentheses, dots
 * that form operators, and backticks.
 */
export function sanitizeFilterValue(value: string): string {
  return value.replace(/[,()`.]/g, '')
}

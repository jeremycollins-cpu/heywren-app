/**
 * Validates a URL for safe use in href attributes.
 * Returns the URL if it uses http:// or https://, otherwise returns '#'.
 * Prevents javascript:, data:, and other dangerous protocol injections.
 */
export function safeHref(url: string | null | undefined): string {
  if (!url) return '#'
  const trimmed = url.trim()
  if (trimmed.startsWith('https://') || trimmed.startsWith('http://')) {
    return trimmed
  }
  return '#'
}

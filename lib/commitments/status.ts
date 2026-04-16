// Canonical definitions for commitment status groupings.
// Every feature that filters by status MUST use these constants
// so users see consistent numbers across the platform.

export const ACTIVE_STATUSES = ['open', 'pending', 'in_progress', 'overdue'] as const
export const COMPLETED_STATUSES = ['completed', 'likely_complete'] as const
export const EXCLUDED_STATUSES = ['cancelled', 'dropped'] as const

export function isActive(status: string): boolean {
  return (ACTIVE_STATUSES as readonly string[]).includes(status)
}

export function isCompleted(status: string): boolean {
  return (COMPLETED_STATUSES as readonly string[]).includes(status)
}

export function isExcluded(status: string): boolean {
  return (EXCLUDED_STATUSES as readonly string[]).includes(status)
}

export function followThroughRate(commitments: { status: string }[]): number {
  const relevant = commitments.filter(c => !isExcluded(c.status))
  if (relevant.length === 0) return 0
  const completed = relevant.filter(c => isCompleted(c.status)).length
  return Math.round((completed / relevant.length) * 100)
}

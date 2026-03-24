'use client'

interface AlertBannerProps {
  variant: 'error' | 'warning' | 'info' | 'success'
  message: string
  onDismiss?: () => void
}

const variants = {
  error: 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800 text-red-700 dark:text-red-300',
  warning: 'bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-800 text-yellow-700 dark:text-yellow-300',
  info: 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-300',
  success: 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800 text-green-700 dark:text-green-300',
}

const icons = {
  error: '⚠',
  warning: '⚠',
  info: 'ℹ',
  success: '✓',
}

export function AlertBanner({ variant, message, onDismiss }: AlertBannerProps) {
  return (
    <div
      className={`border rounded-brand p-4 flex items-center justify-between ${variants[variant]}`}
      role="alert"
    >
      <div className="flex items-center gap-2">
        <span aria-hidden="true">{icons[variant]}</span>
        <span className="text-sm font-medium">{message}</span>
      </div>
      {onDismiss && (
        <button
          onClick={onDismiss}
          className="text-sm font-medium opacity-70 hover:opacity-100 transition-opacity"
          aria-label="Dismiss alert"
        >
          Dismiss
        </button>
      )}
    </div>
  )
}

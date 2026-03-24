'use client'

interface StatCardProps {
  label: string
  value: string | number
  color?: string
  barPercent?: number
  status?: string
  statusColor?: string
}

export function StatCard({ label, value, color, barPercent, status, statusColor }: StatCardProps) {
  return (
    <div className="bg-white dark:bg-surface-dark-secondary border border-gray-200 dark:border-border-dark rounded-brand overflow-hidden">
      {barPercent !== undefined && color && (
        <div
          className="h-1"
          style={{ background: `linear-gradient(to right, ${color} ${barPercent}%, #e5e7eb ${barPercent}%)` }}
          role="progressbar"
          aria-valuenow={barPercent}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`${label}: ${value}`}
        />
      )}
      <div className="p-4 text-center">
        <div className="text-3xl font-bold" style={color ? { color } : undefined}>
          {value}
        </div>
        <div className="text-sm text-gray-500 dark:text-gray-400 mt-1">{label}</div>
        {status && (
          <span className={`inline-block mt-2 px-2 py-0.5 rounded text-xs font-medium ${statusColor || ''}`}>
            {status}
          </span>
        )}
      </div>
    </div>
  )
}

'use client'

interface PageHeaderProps {
  title: string
  titleSuffix?: React.ReactNode
  description?: string
}

export function PageHeader({ title, titleSuffix, description }: PageHeaderProps) {
  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
        {title}
        {titleSuffix && <> {titleSuffix}</>}
      </h1>
      {description && (
        <p className="text-gray-500 dark:text-gray-400 text-sm mt-1">{description}</p>
      )}
    </div>
  )
}

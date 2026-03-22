export default function AuthLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="flex min-h-screen bg-gradient-to-br from-indigo-50 via-white to-violet-50">
      <div className="flex flex-col items-center justify-center w-full px-4 py-12">
        <div className="w-full max-w-md">
          <div className="text-center mb-8">
            <h1 className="text-4xl font-bold bg-gradient-to-r from-indigo-600 to-violet-600 bg-clip-text text-transparent">
              HeyWren
            </h1>
            <p className="text-gray-600 mt-2">
              AI-powered follow-through for your team
            </p>
          </div>
          {children}
        </div>
      </div>
    </div>
  )
}

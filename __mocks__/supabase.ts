// Mock for @supabase/ssr createBrowserClient
// Returns a chainable query builder for all Supabase operations

type MockResponse = { data: any; error: any }

function createChainableBuilder(response: MockResponse = { data: null, error: null }) {
  const builder: any = {
    select: jest.fn().mockReturnThis(),
    insert: jest.fn().mockReturnThis(),
    update: jest.fn().mockReturnThis(),
    delete: jest.fn().mockReturnThis(),
    upsert: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    neq: jest.fn().mockReturnThis(),
    gt: jest.fn().mockReturnThis(),
    gte: jest.fn().mockReturnThis(),
    lt: jest.fn().mockReturnThis(),
    lte: jest.fn().mockReturnThis(),
    like: jest.fn().mockReturnThis(),
    ilike: jest.fn().mockReturnThis(),
    in: jest.fn().mockReturnThis(),
    is: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    range: jest.fn().mockReturnThis(),
    single: jest.fn().mockResolvedValue(response),
    maybeSingle: jest.fn().mockResolvedValue(response),
    then: jest.fn((resolve: (value: MockResponse) => void) => resolve(response)),
  }
  return builder
}

export function createMockSupabaseClient(overrides: Record<string, MockResponse> = {}) {
  const fromMock = jest.fn((table: string) => {
    const response = overrides[table] || { data: null, error: null }
    return createChainableBuilder(response)
  })

  return {
    from: fromMock,
    auth: {
      getUser: jest.fn().mockResolvedValue({ data: { user: null }, error: null }),
      getSession: jest.fn().mockResolvedValue({ data: { session: null }, error: null }),
      signInWithPassword: jest.fn().mockResolvedValue({ data: null, error: null }),
      signUp: jest.fn().mockResolvedValue({ data: null, error: null }),
      signOut: jest.fn().mockResolvedValue({ error: null }),
      onAuthStateChange: jest.fn(() => ({ data: { subscription: { unsubscribe: jest.fn() } } })),
    },
    storage: {
      from: jest.fn(() => ({
        upload: jest.fn().mockResolvedValue({ data: null, error: null }),
        download: jest.fn().mockResolvedValue({ data: null, error: null }),
        getPublicUrl: jest.fn(() => ({ data: { publicUrl: 'https://example.com/file.png' } })),
      })),
    },
  }
}

// Default mock for @supabase/ssr
const mockClient = createMockSupabaseClient()

export const createBrowserClient = jest.fn(() => mockClient)
export const createServerClient = jest.fn(() => mockClient)

export default mockClient

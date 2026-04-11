/**
 * Tests for the Dashboard page component.
 *
 * The dashboard uses a Zustand store (useDashboardStore) for state.
 * We mock the store to test different rendering states.
 */

import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'

// ─── Mock the Zustand store ─────────────────────────────────────────────────

const mockFetchDashboard = jest.fn()
const mockMarkDone = jest.fn()
const mockSnooze = jest.fn()
const mockDismiss = jest.fn()
const mockClearError = jest.fn()

let storeState: any = {}

jest.mock('@/lib/stores/dashboard-store', () => ({
  useDashboardStore: () => storeState,
}))

// ─── Mock react-hot-toast ───────────────────────────────────────────────────

jest.mock('react-hot-toast', () => ({
  __esModule: true,
  default: {
    success: jest.fn(),
    error: jest.fn(),
  },
}))

// ─── Mock celebration context ──────────────────────────────────────────────

jest.mock('@/lib/contexts/celebration-context', () => ({
  useCelebration: () => ({
    celebrating: false,
    celebrate: jest.fn(),
  }),
}))

// ─── Mock extracted components to simplify rendering ────────────────────────

jest.mock('@/components/ui/loading-skeleton', () => ({
  LoadingSkeleton: () => <div data-testid="loading-skeleton" className="animate-pulse">Loading...</div>,
}))

jest.mock('@/components/ui/empty-state', () => ({
  EmptyState: (props: any) => <div data-testid="empty-state">{props.title}</div>,
}))

jest.mock('@/components/ui/alert-banner', () => ({
  AlertBanner: (props: any) => <div data-testid="alert-banner">{props.message}</div>,
}))

jest.mock('@/components/ui/page-header', () => ({
  PageHeader: (props: any) => (
    <div data-testid="page-header">
      <span>{props.title}</span>
      {props.titleSuffix}
      {typeof props.description === 'string' && <span>{props.description}</span>}
    </div>
  ),
}))

jest.mock('@/components/ui/stat-card', () => ({
  StatCard: (props: any) => (
    <div data-testid="stat-card">
      <span>{props.label}</span>
      <span>{props.value}</span>
    </div>
  ),
}))

jest.mock('@/components/dashboard/hero-stats', () => ({
  HeroStats: () => <div data-testid="hero-stats">HeroStats</div>,
}))

jest.mock('@/components/dashboard/forecast-section', () => ({
  ForecastSection: () => <div data-testid="forecast-section">Wren&apos;s Forecast</div>,
}))

jest.mock('@/components/dashboard/mentions-section', () => ({
  MentionsSection: (props: any) => (
    <div data-testid="mentions-section">
      {props.mentions?.length > 0 && <span>Recent Mentions</span>}
    </div>
  ),
}))

jest.mock('@/components/dashboard/nudge-card', () => ({
  NudgeCard: (props: any) => <div data-testid="nudge-card">{props.commitment.title}</div>,
}))

jest.mock('@/components/dashboard/todays-focus', () => ({
  TodaysFocus: () => <div data-testid="todays-focus">TodaysFocus</div>,
}))

// ─── Mock global fetch for auto-backfill calls ────────────────────────────

global.fetch = jest.fn(() =>
  Promise.resolve({ ok: true, json: () => Promise.resolve({}) } as Response)
)

// ─── Import after mocks ────────────────────────────────────────────────────

import DashboardPage from '../page'

// ─── Helpers ────────────────────────────────────────────────────────────────

const now = new Date()
const todayStr = now.toISOString()
const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString()
const sixDaysAgo = new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000).toISOString()
const tenDaysAgo = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000).toISOString()

function setStore(overrides: Partial<typeof storeState> = {}) {
  storeState = {
    commitments: [],
    mentions: [],
    integrationCount: 0,
    expiredIntegrations: [],
    loading: false,
    error: null,
    fetchDashboard: mockFetchDashboard,
    markDone: mockMarkDone,
    snooze: mockSnooze,
    dismiss: mockDismiss,
    clearError: mockClearError,
    ...overrides,
  }
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('DashboardPage', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    setStore()
  })

  describe('Loading State', () => {
    it('shows loading skeleton when loading is true', () => {
      setStore({ loading: true })
      render(<DashboardPage />)
      expect(screen.getByTestId('loading-skeleton')).toBeInTheDocument()
    })
  })

  describe('Empty / Welcome State', () => {
    it('shows welcome state when no data exists', () => {
      setStore({ commitments: [], mentions: [], integrationCount: 0 })
      render(<DashboardPage />)
      expect(screen.getByText('Welcome to HeyWren')).toBeInTheDocument()
      expect(screen.getByText('Connect a tool to get started')).toBeInTheDocument()
      expect(screen.getByText('Connect Slack or Outlook')).toBeInTheDocument()
    })

    it('links to the integrations page from the empty state', () => {
      setStore({ commitments: [], mentions: [], integrationCount: 0 })
      render(<DashboardPage />)
      const link = screen.getByText('Connect Slack or Outlook')
      expect(link.closest('a')).toHaveAttribute('href', '/integrations')
    })
  })

  describe('Scanning State', () => {
    it('shows scanning state when integrations connected but no commitments', () => {
      setStore({ commitments: [], mentions: [], integrationCount: 1 })
      render(<DashboardPage />)
      expect(screen.getByText('Analyzing your conversations')).toBeInTheDocument()
    })
  })

  describe('Dashboard with Data', () => {
    it('shows the live header with integration count', () => {
      setStore({
        commitments: [
          { id: '1', title: 'Test', description: null, status: 'open', source: 'slack', source_ref: null, created_at: todayStr, updated_at: todayStr },
        ],
        mentions: [],
        integrationCount: 1,
      })
      render(<DashboardPage />)

      expect(screen.getByText("Here's what Wren found")).toBeInTheDocument()
      expect(screen.getByText('Live')).toBeInTheDocument()
      expect(screen.getByText('1 connected tool watching for commitments')).toBeInTheDocument()
    })

    it('shows stat cards with correct values', () => {
      setStore({
        commitments: [
          { id: '1', title: 'Old open', description: null, status: 'open', source: 'slack', source_ref: null, created_at: tenDaysAgo, updated_at: tenDaysAgo },
          { id: '2', title: 'Overdue', description: null, status: 'overdue', source: 'slack', source_ref: null, created_at: sixDaysAgo, updated_at: sixDaysAgo },
          { id: '3', title: 'Completed', description: null, status: 'completed', source: 'slack', source_ref: null, created_at: twoDaysAgo, updated_at: todayStr },
        ],
        mentions: [],
        integrationCount: 1,
      })
      render(<DashboardPage />)

      expect(screen.getByText('Active Items')).toBeInTheDocument()
      expect(screen.getByText('Urgent')).toBeInTheDocument()
      expect(screen.getByText('Overdue')).toBeInTheDocument()
      expect(screen.getByText('Avg Score')).toBeInTheDocument()
    })

    it('shows mentions section', () => {
      setStore({
        commitments: [
          { id: '1', title: 'Task', description: null, status: 'open', source: 'slack', source_ref: null, created_at: todayStr, updated_at: todayStr },
        ],
        mentions: [
          { id: 'm1', message_text: 'track this', user_id: 'U1', channel_id: 'C1', message_ts: '1.2', created_at: todayStr, commitments_found: 1 },
        ],
        integrationCount: 1,
      })
      render(<DashboardPage />)

      expect(screen.getByText('Recent Mentions')).toBeInTheDocument()
    })

    it('shows the forecast section', () => {
      setStore({
        commitments: [
          { id: '1', title: 'Open task', description: null, status: 'open', source: 'slack', source_ref: null, created_at: twoDaysAgo, updated_at: todayStr },
        ],
        mentions: [],
        integrationCount: 1,
      })
      render(<DashboardPage />)

      expect(screen.getByTestId('forecast-section')).toBeInTheDocument()
    })

    it('calls fetchDashboard on mount', () => {
      setStore()
      render(<DashboardPage />)
      expect(mockFetchDashboard).toHaveBeenCalled()
    })
  })

  describe('Error Handling', () => {
    it('shows error banner when error is set', () => {
      setStore({ error: 'Something went wrong', commitments: [{ id: '1', title: 'X', description: null, status: 'open', source: 'slack', source_ref: null, created_at: todayStr, updated_at: todayStr }], integrationCount: 1 })
      render(<DashboardPage />)
      expect(screen.getByTestId('alert-banner')).toBeInTheDocument()
      expect(screen.getByText('Something went wrong')).toBeInTheDocument()
    })
  })
})

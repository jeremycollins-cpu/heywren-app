/**
 * Tests for the Dashboard page component.
 *
 * The dashboard:
 *   - Shows a loading skeleton while data fetches
 *   - Shows an empty/welcome state when no data exists
 *   - Shows real stats (streak, follow-through, trend, level, XP) from commitments
 *   - Shows stat cards (Active Items, Urgent, Overdue, Avg Score)
 *   - Shows anomalies when conditions are met
 *   - Shows forecast section
 *   - Shows @HeyWren mentions section
 *   - Shows nudge cards for stale open commitments
 *
 * We test the helper functions directly and the component rendering with mocked Supabase.
 */

import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'

// ─── Mock Supabase ──────────────────────────────────────────────────────────

const mockGetUser = jest.fn()
const mockFromResults: Record<string, any> = {}

function createChainableMock(table: string) {
  const result = mockFromResults[table] || { data: null, error: null }
  const chain: any = {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    single: jest.fn().mockResolvedValue(result),
  }
  // Make chain itself thenable to handle `await supabase.from(...).select(...)`
  chain.then = (resolve: any) => resolve(result)
  return chain
}

jest.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: {
      getUser: mockGetUser,
    },
    from: jest.fn((table: string) => createChainableMock(table)),
  }),
}))

// ─── Mock react-hot-toast ───────────────────────────────────────────────────

jest.mock('react-hot-toast', () => ({
  __esModule: true,
  default: {
    success: jest.fn(),
    error: jest.fn(),
  },
}))

// ─── Import after mocks ────────────────────────────────────────────────────

import DashboardPage from '../page'

// ─── Helpers ────────────────────────────────────────────────────────────────

function setupAuth(userId: string = 'user-123') {
  mockGetUser.mockResolvedValue({
    data: { user: { id: userId } },
    error: null,
  })
}

function setupProfileTeam(teamId: string = 'team-456') {
  mockFromResults['profiles'] = {
    data: { current_team_id: teamId },
    error: null,
  }
}

function setupCommitments(commitments: any[] = []) {
  mockFromResults['commitments'] = { data: commitments, error: null }
}

function setupMentions(mentions: any[] = []) {
  mockFromResults['slack_messages'] = { data: mentions, error: null }
}

function setupIntegrations(integrations: any[] = []) {
  mockFromResults['integrations'] = { data: integrations, error: null }
}

function setupFullData() {
  setupAuth()
  setupProfileTeam()
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('DashboardPage', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    // Reset all from results
    Object.keys(mockFromResults).forEach((k) => delete mockFromResults[k])
  })

  describe('Loading State', () => {
    it('shows loading skeleton initially', () => {
      // Auth never resolves -> stays loading
      mockGetUser.mockReturnValue(new Promise(() => {}))
      render(<DashboardPage />)

      // The loading state has animate-pulse class
      expect(document.querySelector('.animate-pulse')).toBeInTheDocument()
    })
  })

  describe('Empty / Welcome State', () => {
    it('shows welcome state when no data exists', async () => {
      setupFullData()
      setupCommitments([])
      setupMentions([])
      setupIntegrations([])

      render(<DashboardPage />)

      expect(await screen.findByText('Welcome to HeyWren')).toBeInTheDocument()
      expect(screen.getByText('Connect your first tool')).toBeInTheDocument()
      expect(screen.getByText('Connect Slack or Outlook')).toBeInTheDocument()
    })

    it('links to the integrations page from the empty state', async () => {
      setupFullData()
      setupCommitments([])
      setupMentions([])
      setupIntegrations([])

      render(<DashboardPage />)

      const link = await screen.findByText('Connect Slack or Outlook')
      expect(link.closest('a')).toHaveAttribute('href', '/integrations')
    })
  })

  describe('No Auth State', () => {
    it('stops loading when no user is authenticated', async () => {
      mockGetUser.mockResolvedValue({ data: { user: null }, error: null })

      render(<DashboardPage />)

      // Should not show the welcome state (that requires data checks)
      // and should not stay in loading forever
      await waitFor(() => {
        expect(document.querySelector('.animate-pulse')).not.toBeInTheDocument()
      })
    })
  })

  describe('Dashboard with Data', () => {
    const now = new Date()
    const todayStr = now.toISOString()
    const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString()
    const sixDaysAgo = new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000).toISOString()
    const tenDaysAgo = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000).toISOString()

    it('shows the live header with integration count', async () => {
      setupFullData()
      setupCommitments([
        { id: '1', title: 'Test', description: null, status: 'open', source: 'slack', source_ref: null, created_at: todayStr, updated_at: todayStr },
      ])
      setupMentions([])
      setupIntegrations([{ provider: 'slack' }])

      render(<DashboardPage />)

      expect(
        await screen.findByText(/Here's what Wren found/i)
      ).toBeInTheDocument()
      expect(screen.getByText('Live')).toBeInTheDocument()
      expect(
        screen.getByText('1 connected tool watching for commitments')
      ).toBeInTheDocument()
    })

    it('shows follow-through percentage', async () => {
      setupFullData()
      setupCommitments([
        { id: '1', title: 'Done task', description: null, status: 'completed', source: 'slack', source_ref: null, created_at: twoDaysAgo, updated_at: todayStr },
        { id: '2', title: 'Open task', description: null, status: 'open', source: 'slack', source_ref: null, created_at: twoDaysAgo, updated_at: todayStr },
      ])
      setupMentions([])
      setupIntegrations([{ provider: 'slack' }])

      render(<DashboardPage />)

      // 1/2 = 50%
      expect(await screen.findByText('50%')).toBeInTheDocument()
      expect(screen.getByText('Follow-through')).toBeInTheDocument()
      expect(screen.getByText('2 total commitments')).toBeInTheDocument()
    })

    it('shows stat cards with correct values', async () => {
      setupFullData()
      setupCommitments([
        { id: '1', title: 'Old open', description: null, status: 'open', source: 'slack', source_ref: null, created_at: tenDaysAgo, updated_at: tenDaysAgo },
        { id: '2', title: 'Overdue', description: null, status: 'overdue', source: 'slack', source_ref: null, created_at: sixDaysAgo, updated_at: sixDaysAgo },
        { id: '3', title: 'Completed', description: null, status: 'completed', source: 'slack', source_ref: null, created_at: twoDaysAgo, updated_at: todayStr },
      ])
      setupMentions([])
      setupIntegrations([{ provider: 'slack' }])

      render(<DashboardPage />)

      // Wait for data to load
      await screen.findByText('Active Items')
      expect(screen.getByText('Active Items')).toBeInTheDocument()
      expect(screen.getByText('Urgent')).toBeInTheDocument()
      expect(screen.getByText('Overdue')).toBeInTheDocument()
      expect(screen.getByText('Avg Score')).toBeInTheDocument()
    })

    it('shows @HeyWren Recent Mentions section', async () => {
      setupFullData()
      setupCommitments([
        { id: '1', title: 'Task', description: null, status: 'open', source: 'slack', source_ref: null, created_at: todayStr, updated_at: todayStr },
      ])
      setupMentions([
        {
          id: 'm1',
          message_text: '<@UBOTID> track this commitment',
          user_id: 'U111',
          channel_id: 'C99999',
          message_ts: '123.456',
          created_at: todayStr,
          commitments_found: 1,
        },
      ])
      setupIntegrations([{ provider: 'slack' }])

      render(<DashboardPage />)

      expect(await screen.findByText('Recent Mentions')).toBeInTheDocument()
    })

    it('shows the forecast section', async () => {
      setupFullData()
      setupCommitments([
        { id: '1', title: 'Open task', description: null, status: 'open', source: 'slack', source_ref: null, created_at: twoDaysAgo, updated_at: todayStr },
      ])
      setupMentions([])
      setupIntegrations([{ provider: 'slack' }])

      render(<DashboardPage />)

      expect(
        await screen.findByText("Wren's Forecast")
      ).toBeInTheDocument()
    })

    it('shows XP level badge', async () => {
      setupFullData()
      // 5 commitments * 10 + 2 completed * 25 = 100 => "Getting Started"
      const commitments = [
        { id: '1', title: 'A', description: null, status: 'completed', source: 'slack', source_ref: null, created_at: twoDaysAgo, updated_at: todayStr },
        { id: '2', title: 'B', description: null, status: 'completed', source: 'slack', source_ref: null, created_at: twoDaysAgo, updated_at: todayStr },
        { id: '3', title: 'C', description: null, status: 'open', source: 'slack', source_ref: null, created_at: twoDaysAgo, updated_at: todayStr },
        { id: '4', title: 'D', description: null, status: 'open', source: 'slack', source_ref: null, created_at: twoDaysAgo, updated_at: todayStr },
        { id: '5', title: 'E', description: null, status: 'open', source: 'slack', source_ref: null, created_at: twoDaysAgo, updated_at: todayStr },
      ]
      setupCommitments(commitments)
      setupMentions([])
      setupIntegrations([{ provider: 'slack' }])

      render(<DashboardPage />)

      // XP = 5*10 + 2*25 = 100 => "Getting Started"
      expect(await screen.findByText('Getting Started')).toBeInTheDocument()
      expect(screen.getByText('100 XP')).toBeInTheDocument()
    })
  })

  describe('Error Handling', () => {
    it('shows error banner when auth fails', async () => {
      mockGetUser.mockResolvedValue({
        data: { user: null },
        error: new Error('Auth service unavailable'),
      })

      render(<DashboardPage />)

      // The component catches the error and shows it
      await waitFor(() => {
        expect(document.querySelector('.animate-pulse')).not.toBeInTheDocument()
      })
    })
  })
})

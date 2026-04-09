/**
 * Tests for the Sidebar component.
 *
 * The sidebar renders:
 *   - A logo linking to /
 *   - Main navigation links (Dashboard, Commitments, Relationships, etc.)
 *   - Admin section (Billing, Team Management, Settings) visible only to admins
 *   - A Help & Tips button
 *   - Mobile close button and backdrop
 */

import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'

// ─── Mock plan context ──────────────────────────────────────────────────────

jest.mock('@/lib/contexts/plan-context', () => ({
  usePlan: () => ({
    plan: 'basic',
    loading: false,
    teamId: 'team-123',
    canAccess: () => true,
    canAccessRoute: () => true,
    hasAccess: () => true,
    refresh: jest.fn(),
  }),
}))

// ─── Mock Supabase client ───────────────────────────────────────────────────

const mockGetUser = jest.fn()
const mockFrom = jest.fn()

jest.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: {
      getUser: mockGetUser,
    },
    from: mockFrom,
  }),
}))

// ─── Mock lucide-react icons ────────────────────────────────────────────────

jest.mock('lucide-react', () => {
  const React = require('react')
  const createIcon = (name: string) => {
    const Icon = React.forwardRef((props: any, ref: any) =>
      React.createElement('svg', { ...props, ref, 'data-testid': `icon-${name}` })
    )
    Icon.displayName = name
    return Icon
  }

  return {
    X: createIcon('X'),
    BarChart3: createIcon('BarChart3'),
    CheckCircle2: createIcon('CheckCircle2'),
    Zap: createIcon('Zap'),
    Settings: createIcon('Settings'),
    Users: createIcon('Users'),
    Brain: createIcon('Brain'),
    Calendar: createIcon('Calendar'),
    FileText: createIcon('FileText'),
    Edit: createIcon('Edit'),
    Briefcase: createIcon('Briefcase'),
    Hand: createIcon('Hand'),
    Trophy: createIcon('Trophy'),
    CreditCard: createIcon('CreditCard'),
    Lightbulb: createIcon('Lightbulb'),
    HelpCircle: createIcon('HelpCircle'),
    MailWarning: createIcon('MailWarning'),
    Lock: createIcon('Lock'),
    RefreshCw: createIcon('RefreshCw'),
    MessageSquareDashed: createIcon('MessageSquareDashed'),
    Hourglass: createIcon('Hourglass'),
    Mic: createIcon('Mic'),
    GraduationCap: createIcon('GraduationCap'),
    ChevronDown: createIcon('ChevronDown'),
    ChevronRight: createIcon('ChevronRight'),
    PanelLeftClose: createIcon('PanelLeftClose'),
    PanelLeftOpen: createIcon('PanelLeftOpen'),
    Shield: createIcon('Shield'),
    ListChecks: createIcon('ListChecks'),
    SlidersHorizontal: createIcon('SlidersHorizontal'),
    Star: createIcon('Star'),
    TrendingUp: createIcon('TrendingUp'),
    Network: createIcon('Network'),
    MailX: createIcon('MailX'),
    ListFilter: createIcon('ListFilter'),
    CalendarDays: createIcon('CalendarDays'),
    ShieldCheck: createIcon('ShieldCheck'),
    ShieldAlert: createIcon('ShieldAlert'),
    AtSign: createIcon('AtSign'),
    Inbox: createIcon('Inbox'),
  }
})

// ─── Mock useRealtime hook ────────────────────────────────────────────────

jest.mock('@/lib/hooks/use-realtime', () => ({
  useRealtime: () => {},
}))

// ─── Mock logo component ────────────────────────────────────────────────────

jest.mock('@/components/logo', () => ({
  WrenFullLogo: (props: any) => <div data-testid="wren-logo" {...props} />,
}))

// ─── Import after mocks ────────────────────────────────────────────────────

import Sidebar from '../sidebar'

// ─── Helpers ────────────────────────────────────────────────────────────────

function setupSupabaseMock(role: string = 'user') {
  mockGetUser.mockResolvedValue({
    data: { user: { id: 'user-123' } },
  })
  const mockChain = {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    single: jest.fn().mockResolvedValue({
      data: { role },
      error: null,
    }),
  }
  mockFrom.mockReturnValue(mockChain)
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('Sidebar', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    setupSupabaseMock('user')
  })

  describe('Rendering', () => {
    it('renders the Wren logo', () => {
      render(<Sidebar open={true} onToggle={jest.fn()} />)
      expect(screen.getByTestId('wren-logo')).toBeInTheDocument()
    })

    it('renders all navigation links (all sections expanded by default)', () => {
      render(<Sidebar open={true} onToggle={jest.fn()} />)

      // All section headers visible
      expect(screen.getByText('Overview')).toBeInTheDocument()
      expect(screen.getByText('Intelligence')).toBeInTheDocument()
      expect(screen.getByText('Action Queue')).toBeInTheDocument()
      expect(screen.getByText('Automation')).toBeInTheDocument()
      expect(screen.getByText('Community')).toBeInTheDocument()

      // All links visible since all sections are expanded
      expect(screen.getByText('Dashboard')).toBeInTheDocument()
      expect(screen.getByText('Commitments')).toBeInTheDocument()
      expect(screen.getByText('Coach')).toBeInTheDocument()
      expect(screen.getByText('Draft Queue')).toBeInTheDocument()
      expect(screen.getByText('Playbooks')).toBeInTheDocument()
      expect(screen.getByText('Ideas')).toBeInTheDocument()
    })

    it('renders the Help & Tips button', () => {
      render(<Sidebar open={true} onToggle={jest.fn()} />)
      expect(screen.getByText('Help & Tips')).toBeInTheDocument()
    })

    it('links have correct href attributes', () => {
      render(<Sidebar open={true} onToggle={jest.fn()} />)

      expect(screen.getByText('Dashboard').closest('a')).toHaveAttribute('href', '/')
      expect(screen.getByText('Commitments').closest('a')).toHaveAttribute('href', '/commitments')
      expect(screen.getByText('Coach').closest('a')).toHaveAttribute('href', '/coach')
      expect(screen.getByText('Draft Queue').closest('a')).toHaveAttribute('href', '/draft-queue')
      expect(screen.getByText('Integrations').closest('a')).toHaveAttribute('href', '/integrations')
      expect(screen.getByText('Ideas').closest('a')).toHaveAttribute('href', '/ideas')
    })
  })

  describe('Admin Section', () => {
    it('does not show admin links for regular users', async () => {
      setupSupabaseMock('user')
      render(<Sidebar open={true} onToggle={jest.fn()} />)

      // Admin links should not be present initially
      expect(screen.queryByText('Administration')).not.toBeInTheDocument()
      expect(screen.queryByText('Billing')).not.toBeInTheDocument()
    })

    it('shows admin links for admin users after role is fetched', async () => {
      setupSupabaseMock('admin')
      render(<Sidebar open={true} onToggle={jest.fn()} />)

      // Wait for async role fetch
      expect(await screen.findByText('Administration')).toBeInTheDocument()
      expect(await screen.findByText('Billing')).toBeInTheDocument()
      expect(await screen.findByText('Team Management')).toBeInTheDocument()
      expect(await screen.findByText('Settings')).toBeInTheDocument()
    })

    it('shows admin links for super_admin users', async () => {
      setupSupabaseMock('super_admin')
      render(<Sidebar open={true} onToggle={jest.fn()} />)

      expect(await screen.findByText('Administration')).toBeInTheDocument()
    })
  })

  describe('Mobile Behavior', () => {
    it('renders backdrop when open on mobile', () => {
      render(<Sidebar open={true} onToggle={jest.fn()} />)
      expect(screen.getByLabelText('Close sidebar')).toBeInTheDocument()
    })

    it('does not render backdrop when closed', () => {
      render(<Sidebar open={false} onToggle={jest.fn()} />)
      // The backdrop div should not be present when closed
      // (the sidebar itself is still in DOM but translated off-screen)
      expect(screen.queryAllByLabelText('Close sidebar')).toHaveLength(1) // only the button, no backdrop
    })

    it('calls onToggle when backdrop is clicked', () => {
      const onToggle = jest.fn()
      render(<Sidebar open={true} onToggle={onToggle} />)

      // The backdrop has aria-label="Close sidebar" - click the div (first match)
      const closeElements = screen.getAllByLabelText('Close sidebar')
      // The first one is the backdrop div
      fireEvent.click(closeElements[0])
      expect(onToggle).toHaveBeenCalledTimes(1)
    })

    it('calls onToggle when close button is clicked', () => {
      const onToggle = jest.fn()
      render(<Sidebar open={true} onToggle={onToggle} />)

      // The close button is the <button> with aria-label="Close sidebar"
      const buttons = screen.getAllByLabelText('Close sidebar')
      const closeButton = buttons.find((el) => el.tagName === 'BUTTON')
      if (closeButton) {
        fireEvent.click(closeButton)
        expect(onToggle).toHaveBeenCalled()
      }
    })
  })

  describe('Help Button', () => {
    it('calls onHelpClick when Help & Tips is clicked', () => {
      const onHelpClick = jest.fn()
      render(
        <Sidebar open={true} onToggle={jest.fn()} onHelpClick={onHelpClick} />
      )

      fireEvent.click(screen.getByText('Help & Tips'))
      expect(onHelpClick).toHaveBeenCalledTimes(1)
    })
  })
})

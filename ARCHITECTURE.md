# HeyWren Architecture

## System Overview

HeyWren is a full-stack AI-powered work observability platform built with modern web technologies. The system automatically detects commitments from Slack messages and generates smart reminders to help teams follow through.

## Technology Stack

### Frontend
- **Next.js 14** - React framework with App Router for server-side rendering
- **React 19** - UI component library
- **TypeScript** - Type-safe JavaScript
- **Tailwind CSS** - Utility-first CSS framework
- **Lucide Icons** - Beautiful icon library
- **React Hot Toast** - Toast notifications

### Backend
- **Next.js API Routes** - Server-side endpoints
- **Node.js** - JavaScript runtime

### Database
- **Supabase (PostgreSQL)** - Relational database
- **Row-Level Security** - Data isolation and security
- **Realtime Subscriptions** - Live updates capability

### Authentication
- **Supabase Auth** - Email/password and magic link authentication

### AI/ML
- **Anthropic Claude API** - Commitment detection and nudge generation
- **Claude Sonnet 4** - Fast, cost-effective model for processing

### Integrations
- **Slack API** - Message monitoring and notifications
- **Nango** - OAuth token management for integrations
- **Inngest** - Serverless job queue for background processing

### Deployment
- **Vercel** - Edge runtime and hosting platform

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                        User Browser                          │
│  ┌──────────────────────────────────────────────────────┐   │
│  │          Next.js Frontend (React 19)                 │   │
│  │  - Dashboard (Stats, Commitments, Nudges)           │   │
│  │  - Authentication Pages (Login, Signup)             │   │
│  │  - Management Pages (Team, Integrations, Settings)  │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                             ↓
┌─────────────────────────────────────────────────────────────┐
│                   Vercel Edge Runtime                        │
│  ┌──────────────────────────────────────────────────────┐   │
│  │         Next.js Server (App Router)                  │   │
│  │  ┌──────────────────────────────────────────────┐   │   │
│  │  │  API Routes                                  │   │   │
│  │  │  - /api/commitments/[id]                    │   │   │
│  │  │  - /api/nudges                              │   │   │
│  │  │  - /api/team/members                        │   │   │
│  │  │  - /api/integrations/slack/*                │   │   │
│  │  │  - /api/inngest                             │   │   │
│  │  └──────────────────────────────────────────────┘   │   │
│  │  ┌──────────────────────────────────────────────┐   │   │
│  │  │  Server Components                           │   │   │
│  │  │  - Authentication middleware                 │   │   │
│  │  │  - Database query handlers                   │   │   │
│  │  └──────────────────────────────────────────────┘   │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                             ↓
        ┌────────────────────┼────────────────────┐
        ↓                    ↓                    ↓
   ┌─────────────┐    ┌──────────────┐    ┌──────────────┐
   │  Supabase   │    │  Slack API   │    │  Inngest     │
   │  PostgreSQL │    │  Events &    │    │  Job Queue   │
   │  + RLS      │    │  Bot Tokens  │    │              │
   └─────────────┘    └──────────────┘    └──────────────┘
        ↓                    ↑
   Database           ┌──────────────────┐
   Tables:            │   Event Loop     │
   - profiles         │  (Cron Jobs)     │
   - teams            ├──────────────────┤
   - commitments      │ Functions:       │
   - nudges           │ • process-slack- │
   - activities       │   message        │
   - slack_messages   │ • send-nudges    │
   - integrations     │ • daily-digest   │
                      └──────────────────┘
                             ↓
                      ┌──────────────────┐
                      │ Anthropic Claude │
                      │ API              │
                      │ • Commitment     │
                      │   Detection      │
                      │ • Nudge Message  │
                      │   Generation     │
                      └──────────────────┘
```

## Data Flow

### Commitment Detection Flow

```
User posts in Slack
    ↓
Slack sends message event to webhook
    ↓
/api/integrations/slack/events validates & triggers Inngest
    ↓
Inngest process-slack-message function executes:
    ↓
1. Fetch full message content from Slack API
    ↓
2. Send message text to Claude for analysis
    ↓
3. Claude detects commitments & extracts:
   - Title
   - Description
   - Assignee
   - Due date
   - Priority (0-100)
    ↓
4. Create commitment records in Supabase
    ↓
5. Log activity in activities table
    ↓
Commitment now visible in dashboard
```

### Nudge Generation Flow

```
Inngest cron job triggers every hour
    ↓
Find commitments due within 24 hours
    ↓
Check for existing pending nudges (avoid duplicates)
    ↓
For each commitment:
    ↓
1. Fetch assignee information
    ↓
2. Generate personalized nudge message via Claude
    ↓
3. Create nudge record with status: 'pending'
    ↓
4. Send via Slack DM (or in-app notification)
    ↓
5. Update nudge status to 'sent'
    ↓
User receives reminder to follow through
```

## Database Schema

### Tables

```
profiles
├── id (PK, FK to auth.users)
├── display_name
├── email (UNIQUE)
├── role
├── company
├── team_size
├── avatar_url
└── timestamps

teams
├── id (PK)
├── name
├── slug (UNIQUE)
├── owner_id (FK to profiles)
├── slack_team_id
└── timestamps

team_members
├── id (PK)
├── team_id (FK)
├── user_id (FK)
├── role (enum: owner/admin/member)
└── joined_at

integrations
├── id (PK)
├── team_id (FK)
├── provider (enum: slack/outlook/google)
├── nango_connection_id
├── status (connected/disconnected/error)
├── config (JSONB)
└── timestamps

commitments
├── id (PK)
├── team_id (FK)
├── creator_id (FK)
├── assignee_id (FK, nullable)
├── title
├── description
├── source (enum: slack/email/meeting/manual)
├── source_ref (for linking back to source)
├── status (open/in_progress/completed/overdue/dropped)
├── priority_score (0-100)
├── due_date
├── created_at
├── updated_at
└── completed_at (nullable)

nudges
├── id (PK)
├── commitment_id (FK)
├── team_id (FK)
├── recipient_id (FK)
├── message
├── channel (slack/email/in_app)
├── status (pending/sent/dismissed)
├── sent_at (nullable)
├── dismissed_at (nullable)
└── created_at

activities
├── id (PK)
├── team_id (FK)
├── user_id (FK)
├── commitment_id (FK, nullable)
├── action (enum: created/updated/completed/nudged/commented)
├── metadata (JSONB)
└── created_at

slack_messages
├── id (PK)
├── team_id (FK)
├── slack_channel_id
├── slack_message_ts (UNIQUE with team_id)
├── sender_slack_id
├── content_hash
├── processed (boolean)
├── commitments_found (int)
└── created_at
```

### Row-Level Security

All tables have RLS policies enforcing:

```
Users can only see:
- Their own profile
- Profiles of team members in their teams
- Teams they own or are members of
- Team members in their teams
- Commitments in their teams
- Nudges sent to them
- Activities in their teams
- Slack messages from their teams
```

## API Routes

### Commitments
- `GET /api/commitments` - List with filters
- `POST /api/commitments` - Create new
- `GET /api/commitments/[id]` - Get single
- `PATCH /api/commitments/[id]` - Update
- `DELETE /api/commitments/[id]` - Delete

### Nudges
- `GET /api/nudges` - List pending/dismissed
- `PATCH /api/nudges` - Dismiss nudge

### Team Management
- `GET /api/team` - List user's teams
- `POST /api/team` - Create team
- `PATCH /api/team` - Update team
- `GET /api/team/members` - List members
- `POST /api/team/members` - Add member
- `PATCH /api/team/members` - Update role
- `DELETE /api/team/members` - Remove member

### Slack Integration
- `GET /api/integrations/slack/connect` - Initiate OAuth
- `GET /api/integrations/slack/callback` - Handle OAuth callback
- `POST /api/integrations/slack/events` - Webhook for events

### Background Jobs
- `GET/POST /api/inngest` - Inngest serve endpoint

## Component Structure

### Pages

```
app/
├── (auth)/
│   ├── login/
│   ├── signup/
│   ├── verify-email/
│   └── callback/ (OAuth)
├── (dashboard)/
│   ├── page.tsx (main dashboard)
│   ├── commitments/
│   │   ├── page.tsx (list)
│   │   ├── [id]/page.tsx (detail)
│   │   └── new/page.tsx (create)
│   ├── nudges/page.tsx
│   ├── team/page.tsx
│   ├── integrations/page.tsx
│   └── settings/page.tsx
└── layout.tsx
```

### Shared Components

```
components/
├── sidebar.tsx (navigation)
└── header.tsx (user info & settings)
```

## Background Jobs (Inngest)

### Process Slack Message
- **Trigger**: Slack message event webhook
- **Function**: `processSlackMessage`
- **Steps**:
  1. Fetch message from Slack API
  2. Validate not already processed
  3. Send to Claude for analysis
  4. Create commitment records
  5. Log activity

### Send Nudges
- **Trigger**: Hourly cron job
- **Function**: `sendNudges`
- **Steps**:
  1. Find commitments due within 24h
  2. Check for existing nudges
  3. Generate nudge message
  4. Send to Slack DM
  5. Update status

### Daily Digest
- **Trigger**: Daily at 9 AM
- **Function**: `dailyDigest`
- **Steps**:
  1. Collect activities from past 24h
  2. Summarize with Claude
  3. Calculate team stats
  4. Send to team members

## Security Considerations

### Authentication
- Supabase Auth handles sessions
- Middleware checks auth on protected routes
- JWT tokens validated server-side

### Authorization
- RLS policies enforce team isolation
- API routes verify team membership
- User can only access their own resources

### Data Protection
- All credentials stored as env variables
- Slack tokens encrypted in Nango
- Passwords hashed by Supabase Auth
- HTTPS enforced on all routes

### Input Validation
- Zod schemas validate all API inputs
- SQL injection prevented by Supabase queries
- Rate limiting ready (Vercel built-in)

## Performance Optimizations

### Frontend
- Server components for initial render
- Client components only when needed
- Image optimization via Next.js
- CSS-in-JS with Tailwind (minimal bundle)
- Error boundaries for resilience

### Backend
- Database indexes on common queries
- Pagination on list endpoints
- RLS filters at database level (no app-level filtering)
- Connection pooling via Supabase

### Scaling
- Inngest handles concurrent job processing
- Supabase scales horizontally
- Vercel auto-scales based on traffic
- Stateless API design for horizontal scaling

## Monitoring & Debugging

### Logging
- Server logs in terminal during dev
- Vercel logs for production
- Inngest function execution logs
- Database query logs in Supabase

### Error Handling
- Try-catch blocks with user feedback
- Toast notifications for errors
- Error boundaries in React
- Graceful fallbacks

## Future Extensions

### Possible Features
1. **Email Integration** - Detect commitments from emails
2. **Calendar Sync** - Pull meeting-based commitments
3. **Advanced Analytics** - Team trends and patterns
4. **Custom Workflows** - Automated actions on commitments
5. **Slack Reminders** - In-channel reminders
6. **API for Third Parties** - Webhook subscriptions
7. **Multi-workspace** - Support multiple Slack workspaces
8. **Mobile App** - React Native version

### Infrastructure Upgrades
1. Redis caching for frequently accessed data
2. Full-text search on commitments
3. WebSocket for real-time updates
4. CDN for static assets
5. Dedicated database connection pooling

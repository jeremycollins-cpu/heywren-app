# HeyWren - AI-Powered Follow-Through Platform

A production-ready Next.js 14 SaaS application that monitors Slack messages for commitments, detects them using Claude AI, and sends nudges to help teams follow through.

## Features

- **Slack Integration**: Automatically monitors Slack channels for commitments
- **AI-Powered Detection**: Uses Claude API to intelligently identify commitments from messages
- **Commitment Tracking**: Manage and track all commitments with status, priority, and due dates
- **Smart Nudges**: Automated reminders to help people follow through
- **Team Management**: Collaborate with your team on commitments
- **Real-time Updates**: Built with Next.js App Router and Supabase
- **Background Jobs**: Inngest integration for scheduled tasks and event processing

## Tech Stack

- **Framework**: Next.js 14 with App Router
- **Language**: TypeScript
- **Database**: Supabase (PostgreSQL)
- **Auth**: Supabase Auth with @supabase/ssr
- **AI**: Anthropic Claude API
- **Background Jobs**: Inngest
- **Integrations**: Slack API
- **Styling**: Tailwind CSS
- **Components**: Lucide React Icons

## Project Structure

```
heywren-app/
├── app/
│   ├── (auth)/                      # Auth routes (login, signup)
│   │   ├── layout.tsx
│   │   ├── login/page.tsx
│   │   └── signup/page.tsx
│   ├── (dashboard)/                 # Protected dashboard routes
│   │   ├── layout.tsx               # Dashboard layout with sidebar
│   │   ├── page.tsx                 # Dashboard home
│   │   ├── commitments/page.tsx      # Commitments list
│   │   └── integrations/page.tsx     # Integration management
│   ├── api/
│   │   ├── auth/callback/route.ts   # Supabase auth callback
│   │   ├── inngest/route.ts         # Inngest serve endpoint
│   │   └── integrations/
│   │       └── slack/
│   │           ├── events/route.ts  # Slack event webhook
│   │           └── connect/route.ts # Slack OAuth
│   ├── layout.tsx                   # Root layout
│   ├── globals.css                  # Global styles
│   └── page.tsx                     # Landing page
├── components/
│   ├── sidebar.tsx                  # Dashboard sidebar
│   └── header.tsx                   # Dashboard header
├── lib/
│   ├── supabase/
│   │   ├── client.ts                # Browser Supabase client
│   │   ├── server.ts                # Server Supabase client
│   │   └── middleware.ts            # Auth middleware
│   └── ai/
│       └── detect-commitments.ts    # Claude API integration
├── inngest/
│   ├── client.ts                    # Inngest client
│   └── functions/
│       ├── process-slack-message.ts # Process Slack messages
│       ├── send-nudges.ts           # Send nudge reminders
│       └── daily-digest.ts          # Daily summary
├── supabase/
│   └── migrations/
│       └── 001_initial_schema.sql   # Database schema
├── types/
│   └── index.ts                     # TypeScript types
├── middleware.ts                    # Next.js middleware
├── tsconfig.json
├── tailwind.config.ts
├── next.config.js
├── vercel.json
└── package.json
```

## Database Schema

The app includes 8 core tables:

1. **profiles** - User profiles linked to auth
2. **teams** - Team/workspace organization
3. **team_members** - Team membership with roles
4. **integrations** - Connected OAuth integrations (Slack, Outlook, etc)
5. **commitments** - Tracked commitments with status, priority, due dates
6. **nudges** - Reminder records for each commitment
7. **activities** - Audit log of all commitment changes
8. **slack_messages** - Cache of processed Slack messages

All tables include RLS (Row Level Security) policies for data privacy.

## Setup Instructions

### Prerequisites

- Node.js 18+
- npm 9+
- Supabase account and project
- Slack workspace with bot permissions
- Anthropic API key

### Local Development

1. Clone and install:
```bash
cd heywren-app
npm install --legacy-peer-deps
```

2. Create `.env.local`:
```bash
cp .env.local.example .env.local
```

3. Fill in environment variables:
```
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
SLACK_CLIENT_ID=your_slack_client_id
SLACK_CLIENT_SECRET=your_slack_client_secret
SLACK_BOT_TOKEN=xoxb-your-bot-token
ANTHROPIC_API_KEY=your_anthropic_key
INNGEST_SIGNING_KEY=your_signing_key
INNGEST_EVENT_KEY=your_event_key
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

4. Set up database:
   - Go to Supabase SQL editor
   - Run the migration from `supabase/migrations/001_initial_schema.sql`

5. Start dev server:
```bash
npm run dev
```

Open http://localhost:3000

### Build for Production

```bash
npm run build
npm start
```

## Environment Variables

### Supabase
- `NEXT_PUBLIC_SUPABASE_URL` - Your Supabase project URL
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` - Public anon key
- `SUPABASE_SERVICE_ROLE_KEY` - Service role key (server-only)

### Slack
- `SLACK_CLIENT_ID` - OAuth app client ID
- `SLACK_CLIENT_SECRET` - OAuth app secret
- `SLACK_BOT_TOKEN` - Bot user token for API calls

### AI & Automation
- `ANTHROPIC_API_KEY` - Anthropic API key for Claude
- `INNGEST_SIGNING_KEY` - Inngest signing key
- `INNGEST_EVENT_KEY` - Inngest event key

### App
- `NEXT_PUBLIC_APP_URL` - Your app's base URL for callbacks
- `NEXTAUTH_SECRET` - For session signing (if using NextAuth)

## API Endpoints

### Auth
- `GET /api/auth/callback` - Supabase auth callback

### Slack Integration
- `POST /api/integrations/slack/events` - Webhook for Slack events
- `GET /api/integrations/slack/connect` - Slack OAuth callback

### Background Jobs
- `POST /api/inngest` - Inngest event processor

## Features & Workflows

### Commitment Detection
1. Slack message posted in monitored channel
2. Webhook sent to `/api/integrations/slack/events`
3. Inngest triggers `process-slack-message` function
4. Claude API analyzes message for commitments
5. Commitments stored in database
6. Real-time updates to dashboard

### Nudge Sending
- Scheduled cron job at 9 AM weekdays
- Queries pending commitments
- Sends Slack messages to assignees
- Records nudge delivery

### Daily Digest
- Scheduled cron job at 8 AM daily
- Aggregates team commitment stats
- Could send summary email/Slack message

## Supabase Auth Flow

Uses `@supabase/ssr` package for proper auth handling:

- **Browser**: `createBrowserClient` for client-side operations
- **Server**: `createServerClient` with cookie handling
- **Middleware**: `createServerClient` for auth refresh

Session is automatically refreshed via Next.js middleware.

## Styling

The app uses Tailwind CSS with HeyWren brand colors:
- Primary: Indigo (#4f46e5)
- Secondary: Violet (#7c3aed)
- Accent colors defined in `tailwind.config.ts`

## Deployment

### Vercel

The app is optimized for Vercel deployment:

1. Connect your GitHub repo
2. Add environment variables in Vercel settings
3. Deploy with `npm run build`
4. Inngest middleware handles background jobs

See `vercel.json` for build configuration.

### Database

Set up Supabase project and run the SQL migration to create all tables and RLS policies.

## Type Safety

Full TypeScript support with:
- Strict mode enabled
- Path aliases (`@/*`)
- Generated types for Supabase tables
- Component prop types

## Development

```bash
# Start dev server
npm run dev

# Type check
npm run type-check

# Build for production
npm run build

# Start production server
npm start

# Lint code
npm run lint
```

## Security

- RLS policies enforce data privacy
- Server-side auth token handling
- API keys never exposed to client
- CSRF protection via Next.js
- Secure cookie handling with Supabase SSR

## Performance

- Image optimization with Next.js
- Code splitting and lazy loading
- Static generation where possible
- Optimized Tailwind CSS
- Middleware for fast auth checks

## Support

For issues and questions:
1. Check Supabase docs at https://supabase.com/docs
2. See Slack API docs at https://api.slack.com
3. Review Inngest docs at https://www.inngest.com/docs
4. Check Claude API docs at https://docs.anthropic.com

## License

MIT

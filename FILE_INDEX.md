# HeyWren - Complete File Index

## Quick Start

1. **Start here**: Read `SETUP.md`
2. **Understand the system**: Read `ARCHITECTURE.md`
3. **Deploy**: Follow `DEPLOYMENT.md`

## Documentation (Read These First)

| File | Purpose |
|------|---------|
| `README.md` | Project overview and features |
| `SETUP.md` | Complete local development setup guide |
| `DEPLOYMENT.md` | Production deployment instructions |
| `ARCHITECTURE.md` | System design and technical details |
| `BUILD_SUMMARY.txt` | Project statistics and overview |
| `FILE_INDEX.md` | This file - complete file listing |

## Configuration Files

| File | Purpose |
|------|---------|
| `package.json` | NPM dependencies and scripts |
| `tsconfig.json` | TypeScript compiler options |
| `next.config.js` | Next.js configuration |
| `tailwind.config.ts` | Tailwind CSS configuration |
| `postcss.config.js` | PostCSS configuration |
| `.env.example` | Environment variables template |
| `.eslintrc.json` | ESLint linting rules |
| `.gitignore` | Git ignore patterns |
| `vercel.json` | Vercel deployment configuration |
| `middleware.ts` | Next.js authentication middleware |

## Database

| File | Purpose |
|------|---------|
| `supabase/migrations/001_initial_schema.sql` | Complete database schema (8 tables, 25+ indexes, RLS policies) |

## Frontend - Authentication Pages

| File | Purpose |
|------|---------|
| `app/auth/layout.tsx` | Centered auth page layout |
| `app/auth/login/page.tsx` | Login page (email/password or magic link) |
| `app/auth/signup/page.tsx` | Signup page (creates user + profile + team) |
| `app/auth/verify-email/page.tsx` | Email verification page |
| `app/auth/callback/route.ts` | OAuth callback handler |

## Frontend - Dashboard Pages

| File | Purpose |
|------|---------|
| `app/(dashboard)/layout.tsx` | Dashboard layout with sidebar and header |
| `app/(dashboard)/page.tsx` | Main dashboard (stats, commitments, nudges) |
| `app/(dashboard)/commitments/page.tsx` | Commitments list with filters |
| `app/(dashboard)/commitments/[id]/page.tsx` | Commitment detail page (edit, delete, quick actions) |
| `app/(dashboard)/commitments/new/page.tsx` | Create new commitment form |
| `app/(dashboard)/nudges/page.tsx` | Nudges inbox (pending and dismissed) |
| `app/(dashboard)/team/page.tsx` | Team management (add/remove members) |
| `app/(dashboard)/integrations/page.tsx` | Integration controls (Slack connection) |
| `app/(dashboard)/settings/page.tsx` | Account settings (profile, logout) |

## Frontend - Shared Components

| File | Purpose |
|------|---------|
| `app/layout.tsx` | Root layout (Toaster, fonts) |
| `app/globals.css` | Global styles, Tailwind directives, component styles |
| `components/sidebar.tsx` | Navigation sidebar with menu items and logout |
| `components/header.tsx` | Header with user profile and settings link |

## Backend - API Routes

### Commitment Management
| File | Purpose |
|------|---------|
| `app/api/commitments/route.ts` | List commitments (GET), Create commitment (POST) |
| `app/api/commitments/[id]/route.ts` | Get/Update/Delete single commitment |

### Nudge Management
| File | Purpose |
|------|---------|
| `app/api/nudges/route.ts` | List nudges (GET), Dismiss nudge (PATCH) |

### Team Management
| File | Purpose |
|------|---------|
| `app/api/team/route.ts` | List/Create/Update teams |
| `app/api/team/members/route.ts` | Get/Add/Update/Remove team members |

### Slack Integration
| File | Purpose |
|------|---------|
| `app/api/integrations/slack/connect/route.ts` | Initiate Slack OAuth flow |
| `app/api/integrations/slack/callback/route.ts` | Handle Slack OAuth callback, save tokens |
| `app/api/integrations/slack/events/route.ts` | Webhook for Slack events, trigger Inngest jobs |

### Background Jobs
| File | Purpose |
|------|---------|
| `app/api/inngest/route.ts` | Inngest serve endpoint (GET/POST/PUT) |

## Libraries - Types & Utilities

| File | Purpose |
|------|---------|
| `lib/types.ts` | TypeScript type definitions (12+ types) |
| `lib/utils.ts` | Utility functions (date formatting, slugs, etc.) |

## Libraries - Supabase Integration

| File | Purpose |
|------|---------|
| `lib/supabase/server.ts` | Server-side Supabase client and helpers |
| `lib/supabase/client.ts` | Client-side Supabase client setup |

## Libraries - Slack Integration

| File | Purpose |
|------|---------|
| `lib/slack/client.ts` | Slack Web API wrapper (get user, send DM, etc.) |

## Libraries - Nango OAuth

| File | Purpose |
|------|---------|
| `lib/nango/client.ts` | Nango API wrapper for token management |

## Libraries - AI Integration

| File | Purpose |
|------|---------|
| `lib/ai/detect-commitments.ts` | Claude API integration (commitment detection, nudge generation) |

## Background Jobs - Inngest Functions

| File | Purpose |
|------|---------|
| `inngest/client.ts` | Inngest client configuration |
| `inngest/functions/process-slack-message.ts` | Process Slack events, detect commitments, create records |
| `inngest/functions/send-nudges.ts` | Hourly job: generate and send nudge reminders |
| `inngest/functions/daily-digest.ts` | Daily job: send team activity summary |

## How Files Work Together

### User Registration Flow
```
Login/Signup → auth/signup/page.tsx
           → createClientSupabaseClient() (lib/supabase/client.ts)
           → Supabase Auth + Insert profiles + Create team
           → Redirect to dashboard
```

### Slack Integration Flow
```
User clicks "Connect Slack" → integrations/page.tsx
                            → /api/integrations/slack/connect (request OAuth URL)
                            → Slack OAuth popup
                            → /api/integrations/slack/callback (handle callback)
                            → Save integration + tokens
                            → Update database
```

### Commitment Detection Flow
```
Slack message posted → /api/integrations/slack/events (webhook)
                    → Trigger Inngest event
                    → process-slack-message.ts function runs
                    → Fetch message from Slack API
                    → Send to Claude via lib/ai/detect-commitments.ts
                    → Claude analyzes and returns commitments
                    → Create commitment records in database
                    → Log activity
```

### Nudge Generation Flow
```
Inngest cron trigger (hourly) → send-nudges.ts function
                              → Query commitments due soon
                              → Generate messages via Claude
                              → Create nudge records
                              → Send to Slack DM
                              → Update status
```

## File Organization Principles

- **Page files** in `app/(dashboard)/` are server components by default
- **Client components** marked with `'use client'` only where needed
- **API routes** validate auth and check team membership
- **Database queries** use Supabase server client for RLS
- **External APIs** have dedicated client files (Slack, Nango, Claude)
- **Types** defined in `lib/types.ts` for reuse

## Key Relationships

- Every page requires authentication (middleware.ts)
- All DB queries check team membership (RLS policies)
- All API routes validate user auth and team access
- Slack integration uses Nango for secure token storage
- Background jobs use Inngest for reliability and retry logic
- UI components use toast notifications for feedback

## Environment Variables

See `.env.example` for all required variables:
- `NEXT_PUBLIC_SUPABASE_URL` - Supabase project URL
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` - Supabase anon key
- `SUPABASE_SERVICE_ROLE_KEY` - Service role key for admin operations
- `SLACK_CLIENT_ID` - Slack OAuth client ID
- `SLACK_CLIENT_SECRET` - Slack OAuth secret
- `SLACK_BOT_TOKEN` - Slack bot token for API calls
- `ANTHROPIC_API_KEY` - Claude API key
- `NANGO_SECRET_KEY` - Nango secret for OAuth token management
- `INNGEST_SIGNING_KEY` - Inngest signing key
- `INNGEST_EVENT_KEY` - Inngest event key
- `NEXT_PUBLIC_APP_URL` - App URL for callbacks

## Development Workflow

1. **Setup**: Follow SETUP.md
2. **Code**: Edit files in appropriate directories
3. **Test**: Use `npm run dev` to test locally
4. **Type Check**: Run `npm run type-check`
5. **Deploy**: Push to GitHub, Vercel auto-deploys

## Adding New Features

1. **New Page**: Create in `app/(dashboard)/`
2. **New API**: Create in `app/api/`
3. **New DB Table**: Add migration in `supabase/migrations/`
4. **New Background Job**: Create in `inngest/functions/`
5. **New Type**: Add to `lib/types.ts`
6. **New Utility**: Add to `lib/utils.ts`
7. **New Component**: Create in `components/`

## Testing Checklist

- [ ] Authentication (login, signup, logout)
- [ ] Commitment CRUD operations
- [ ] Commitment filtering and sorting
- [ ] Slack integration (connect, detect commitments)
- [ ] Nudge generation and dismissal
- [ ] Team management (add members)
- [ ] Settings page
- [ ] Dashboard stats and activity feed

## Deployment Checklist

- [ ] All environment variables set in Vercel
- [ ] Database migrations applied
- [ ] Slack app credentials configured
- [ ] Anthropic API key valid
- [ ] Inngest account created
- [ ] Nango configured
- [ ] Test all features
- [ ] Monitor logs
- [ ] Set up error tracking
- [ ] Configure backups

---

**Total Files**: 50+ (code + docs + config)
**Total Code**: ~15,000+ lines
**Database Tables**: 8 with RLS
**API Endpoints**: 10+
**Dashboard Pages**: 7

Everything you need to build, deploy, and scale HeyWren!

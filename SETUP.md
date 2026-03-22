# HeyWren Setup Guide

## Pre-Requirements

1. **Supabase Account** (https://supabase.com)
   - Create a new project
   - Note your project URL and keys
   
2. **Slack Workspace**
   - Must have admin access to create apps
   - Or have permissions to install apps

3. **Anthropic Account** (https://console.anthropic.com)
   - Get API key for Claude

4. **Inngest Account** (https://app.inngest.com)
   - Optional: for better background job monitoring
   - Can work without it for local development

## Step 1: Clone & Install

```bash
git clone <repo>
cd heywren-app
npm install --legacy-peer-deps
cp .env.local.example .env.local
```

## Step 2: Set Up Supabase

1. Go to https://supabase.com and create a new project
2. Wait for project to be provisioned
3. Go to Project Settings → API Keys
4. Copy:
   - Project URL → `NEXT_PUBLIC_SUPABASE_URL`
   - Anon Public Key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - Service Role Secret → `SUPABASE_SERVICE_ROLE_KEY`

## Step 3: Initialize Database Schema

1. Go to Supabase SQL Editor
2. Click "New Query"
3. Copy the contents of `supabase/migrations/001_initial_schema.sql`
4. Paste and run
5. Wait for completion

## Step 4: Configure Slack Integration

### Create Slack App

1. Go to https://api.slack.com/apps
2. Click "Create New App"
3. Choose "From scratch"
4. Name: "HeyWren"
5. Pick your workspace

### Get Credentials

1. Go to "OAuth & Permissions"
2. Under "Scopes", add these Bot Token Scopes:
   - `chat:write`
   - `channels:read`
   - `users:read`
   - `team:read`
   - `emoji:read`

3. Copy "Bot User OAuth Token" → `SLACK_BOT_TOKEN`

### Get OAuth Credentials

1. Go to "Basic Information"
2. Under "App Credentials":
   - Copy Client ID → `SLACK_CLIENT_ID`
   - Copy Client Secret → `SLACK_CLIENT_SECRET`

### Configure Event Subscriptions

1. Go to "Event Subscriptions"
2. Turn "Enable Events" ON
3. For "Request URL", enter: `https://your-domain.com/api/integrations/slack/events`
   (Use ngrok for local testing: `https://your-ngrok-url.ngrok.io/api/integrations/slack/events`)
4. Click "Subscribe to bot events"
5. Add: `message.channels`
6. Click "Save Changes"

### Configure Redirect URLs

1. Go to "OAuth & Permissions"
2. Scroll to "Redirect URLs"
3. Add: `https://your-domain.com/api/integrations/slack/connect`
4. Save

## Step 5: Set Environment Variables

Edit `.env.local`:

```bash
# Supabase (from Step 2)
NEXT_PUBLIC_SUPABASE_URL=https://xxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyxx...
SUPABASE_SERVICE_ROLE_KEY=eyxx...

# Slack (from Step 4)
SLACK_CLIENT_ID=12345...
SLACK_CLIENT_SECRET=abcd...
SLACK_BOT_TOKEN=xoxb-...

# Anthropic (get from https://console.anthropic.com)
ANTHROPIC_API_KEY=sk-ant-...

# Inngest (optional, for production)
INNGEST_SIGNING_KEY=signkey-...
INNGEST_EVENT_KEY=eventkey-...

# Your app URL
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

## Step 6: Test Locally

```bash
npm run dev
```

Open http://localhost:3000

1. Sign up for an account
2. Go to `/dashboard/integrations`
3. Click "Connect Slack"
4. Authorize the app
5. Try posting a message in Slack that mentions a commitment

### Local Slack Testing

For local development, use ngrok to expose your localhost:

```bash
# Install ngrok from https://ngrok.com
ngrok http 3000

# Copy the HTTPS URL and update Slack event webhook URL
# Example: https://abc123.ngrok.io/api/integrations/slack/events
```

## Step 7: Deploy

### Option A: Vercel (Recommended)

1. Push code to GitHub
2. Go to https://vercel.com
3. Import your repository
4. Add all environment variables from `.env.local`
5. Click Deploy

### Option B: Self-Hosted

1. Build: `npm run build`
2. Start: `npm start`
3. Make sure all environment variables are set
4. Use a production database (not for testing)

## Troubleshooting

### Slack connection fails

- Check that `SLACK_CLIENT_ID` and `SLACK_CLIENT_SECRET` are correct
- Verify redirect URL matches in Slack app settings
- Check that event webhook URL is accessible from internet

### Database errors

- Verify Supabase service role key is correct
- Check that migrations ran successfully in SQL editor
- Verify RLS policies are enabled

### Claude not detecting commitments

- Check `ANTHROPIC_API_KEY` is valid
- Verify messages are being processed in Inngest dashboard
- Check logs for API errors

### Inngest not triggering

- For local dev, Inngest won't work unless configured
- For production, make sure `INNGEST_SIGNING_KEY` and `INNGEST_EVENT_KEY` are set
- Check Inngest dashboard at https://app.inngest.com

## What's Next

1. **Customize the UI** - Update colors and branding
2. **Add more integrations** - Outlook, Google Calendar, etc
3. **Set up email** - For digest and nudges
4. **Configure team roles** - Admin, manager, member
5. **Analytics** - Track commitment completion rates

## Documentation

- Supabase: https://supabase.com/docs
- Slack API: https://api.slack.com/docs
- Next.js: https://nextjs.org/docs
- Claude API: https://docs.anthropic.com
- Inngest: https://www.inngest.com/docs

## Support

Check the README.md for architecture and feature details.

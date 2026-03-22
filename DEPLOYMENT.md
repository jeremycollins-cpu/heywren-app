# HeyWren Deployment Guide

## Pre-Deployment Checklist

- [ ] All environment variables configured
- [ ] Database migrations applied
- [ ] Slack app configured
- [ ] Anthropic API key valid
- [ ] Inngest account created
- [ ] Nango credentials configured

## Environment Setup

### 1. Supabase Setup

Create a Supabase project and get your credentials:

```bash
# In Supabase dashboard
- Project URL (NEXT_PUBLIC_SUPABASE_URL)
- Anon Public Key (NEXT_PUBLIC_SUPABASE_ANON_KEY)
- Service Role Key (SUPABASE_SERVICE_ROLE_KEY)
```

Run migrations:

```bash
supabase db push
```

### 2. Slack App Configuration

1. Go to https://api.slack.com/apps
2. Create New App or select existing
3. Configure OAuth & Permissions:
   - Scopes: `app_mentions:read`, `channels:history`, `channels:read`, `chat:write`, `team:read`, `users:read`, `users:read.email`
   - Redirect URLs: `https://yourdomain.com/api/integrations/slack/callback`
4. Enable Event Subscriptions:
   - Request URL: `https://yourdomain.com/api/integrations/slack/events`
   - Subscribe to: `message.channels`, `app_mention`
5. Enable Socket Mode (for development)
6. Get credentials:
   - Client ID (SLACK_CLIENT_ID)
   - Client Secret (SLACK_CLIENT_SECRET)
   - Bot Token (SLACK_BOT_TOKEN)

### 3. Anthropic API

1. Get API key from https://console.anthropic.com
2. Set as `ANTHROPIC_API_KEY`

### 4. Inngest Configuration

1. Create account at https://inngest.com
2. Create application
3. Get credentials:
   - Signing Key (INNGEST_SIGNING_KEY)
   - Event Key (INNGEST_EVENT_KEY)

### 5. Nango Setup

1. Create account at https://nango.dev
2. Set up Slack integration
3. Get Secret Key (NANGO_SECRET_KEY)

## Vercel Deployment

### Step 1: Prepare Repository

```bash
git init
git add .
git commit -m "Initial HeyWren commit"
git remote add origin <your-repo-url>
git push -u origin main
```

### Step 2: Create Vercel Project

1. Go to https://vercel.com
2. Import GitHub repository
3. Configure project:
   - Framework: Next.js
   - Build Command: `npm run build`
   - Output Directory: `.next`

### Step 3: Add Environment Variables

In Vercel project settings, add all variables from `.env.example`:

```
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
SLACK_CLIENT_ID=...
SLACK_CLIENT_SECRET=...
SLACK_BOT_TOKEN=...
AZURE_CLIENT_ID=...
AZURE_CLIENT_SECRET=...
NANGO_SECRET_KEY=...
INNGEST_SIGNING_KEY=...
INNGEST_EVENT_KEY=...
ANTHROPIC_API_KEY=...
NEXT_PUBLIC_APP_URL=https://<your-domain>.vercel.app
```

### Step 4: Deploy

```bash
git push origin main
```

Vercel will automatically build and deploy.

## Post-Deployment

### 1. Update URLs

Update all OAuth callbacks and webhooks:

- Slack: `https://<your-domain>.vercel.app/api/integrations/slack/callback`
- Inngest: Configure webhook in Inngest dashboard

### 2. Test Integration

1. Go to Dashboard > Integrations
2. Click Connect Slack
3. Authorize the app
4. Test by posting a message with a commitment

### 3. Monitor

- Check Vercel deployment logs
- Monitor Inngest function execution
- Verify Slack messages are being processed

## Scaling Considerations

### Database

- Supabase automatically scales with your needs
- Consider setting up backups
- Monitor query performance with Supabase dashboard

### Background Jobs

- Inngest handles scaling automatically
- Monitor job execution in Inngest dashboard
- Adjust retry policies as needed

### Storage

- Slack message cache (slack_messages table) may grow large
- Consider archiving old messages periodically
- Use database indexes for performance

## Troubleshooting

### Slack Integration Not Working

1. Check bot is in workspace
2. Verify event subscription is confirmed
3. Check SLACK_BOT_TOKEN is valid
4. Look at Slack app activity log

### Commitments Not Being Created

1. Check Anthropic API key is valid
2. Review Inngest function logs
3. Verify Slack messages are being received
4. Check database RLS policies

### High Latency

1. Check database query performance
2. Optimize API endpoints
3. Enable Vercel Edge Functions for caching
4. Consider database caching strategies

## Monitoring

### Key Metrics to Track

- API response times
- Slack event processing success rate
- Inngest function execution time
- Database query performance
- User engagement with nudges

### Logging

All errors are logged with detailed context. Set up error tracking:

```bash
# Option 1: Vercel Analytics (built-in)
# Option 2: Sentry integration
# Option 3: Custom logging service
```

## Maintenance

### Regular Tasks

- Review and update dependencies monthly
- Monitor Supabase performance
- Check Slack app rate limits
- Review Anthropic API usage

### Database Maintenance

```bash
# Backup database
supabase db dump > backup.sql

# Archive old data
DELETE FROM slack_messages WHERE created_at < NOW() - INTERVAL '90 days'
```

## Rollback Plan

If deployment fails:

1. Revert to previous commit
2. Deploy previous version
3. Investigate issue
4. Test thoroughly before re-deploying

```bash
git revert <commit-hash>
git push origin main
```

## Support

For issues with:

- **Supabase**: https://supabase.com/docs
- **Slack API**: https://api.slack.com/docs
- **Inngest**: https://inngest.com/docs
- **Anthropic**: https://docs.anthropic.com
- **Vercel**: https://vercel.com/support

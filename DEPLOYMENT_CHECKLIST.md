# HeyWren Deployment Checklist

## Pre-Deployment ✓

- [x] Source code complete and compiled
- [x] TypeScript types validated (zero errors)
- [x] Build successful with no warnings
- [x] All dependencies compatible
- [x] Database schema created (migration file included)
- [x] Environment variables documented

## Before Going Live

### 1. Supabase Setup
- [ ] Create Supabase project
- [ ] Get project URL and keys
- [ ] Run database migration SQL
- [ ] Enable RLS policies
- [ ] Set up custom domain (if using custom auth domain)

### 2. Slack App Configuration
- [ ] Create app at https://api.slack.com/apps
- [ ] Set bot token scopes (chat:write, channels:read, users:read, team:read)
- [ ] Configure event subscriptions (message.channels)
- [ ] Set redirect URIs for OAuth
- [ ] Get Client ID and Client Secret

### 3. Third-Party Services
- [ ] Get Anthropic API key from console.anthropic.com
- [ ] Get Inngest signing/event keys from app.inngest.com
- [ ] (Optional) Set up email service for digests/nudges

### 4. Environment Variables
- [ ] Copy `.env.production.example` to `.env.production`
- [ ] Fill in all required values
- [ ] Store securely (Vercel, GitHub Secrets, etc)
- [ ] Never commit `.env` files

### 5. Code Review
- [ ] Review security: no hardcoded secrets
- [ ] Check error handling in API routes
- [ ] Verify RLS policies are enabled
- [ ] Review API rate limiting needs

### 6. Testing Checklist

#### Authentication
- [ ] Signup flow works
- [ ] Login flow works
- [ ] Session persistence across page reloads
- [ ] Logout works properly
- [ ] Unauthorized access redirects to login

#### Dashboard
- [ ] Dashboard loads with stats
- [ ] Stats update correctly
- [ ] Recent commitments display
- [ ] Sidebar navigation works
- [ ] Mobile responsive design

#### Slack Integration
- [ ] Slack OAuth flow completes
- [ ] Integration stores successfully
- [ ] Can disconnect and reconnect
- [ ] Messages are processed
- [ ] Commitments appear in dashboard

#### Commitment Management
- [ ] Create commitment (manual)
- [ ] View commitment list
- [ ] Filter by status
- [ ] Mark as complete
- [ ] Delete commitment

#### AI Detection
- [ ] Claude API responds properly
- [ ] Commitments are detected from Slack
- [ ] Confidence scores calculated
- [ ] Invalid responses handled gracefully

#### Background Jobs
- [ ] Inngest jobs process messages
- [ ] Nudges schedule correctly
- [ ] Daily digest runs
- [ ] Job errors logged properly

### 7. Performance Checks
- [ ] First Load JS < 200KB
- [ ] Images optimized
- [ ] CSS minified
- [ ] JavaScript code-split
- [ ] No console errors

### 8. Security Checks
- [ ] No API keys in frontend
- [ ] HTTPS enforced
- [ ] CSRF tokens validated
- [ ] SQL injection prevented (Supabase)
- [ ] RLS policies enforced
- [ ] Rate limiting configured

### 9. Monitoring Setup
- [ ] Error logging configured (Sentry/etc)
- [ ] Analytics tracking working
- [ ] Uptime monitoring enabled
- [ ] Database backups configured
- [ ] Logs accessible

## Deployment Options

### Option A: Vercel (Recommended)

1. Push code to GitHub
2. Connect repo to Vercel dashboard
3. Add environment variables
4. Configure build settings:
   - Build command: `npm run build`
   - Install command: `npm install --legacy-peer-deps`
   - Output directory: `.next`
5. Deploy
6. Configure custom domain (if needed)
7. Enable auto-deployment from main branch

### Option B: Self-Hosted (Docker)

1. Create Dockerfile:
```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package* .
RUN npm install --legacy-peer-deps
COPY . .
RUN npm run build
EXPOSE 3000
CMD ["npm", "start"]
```

2. Build and push image
3. Deploy to cloud provider
4. Set environment variables
5. Configure reverse proxy
6. Enable HTTPS

### Option C: Railway/Render/Fly.io

1. Connect GitHub repo
2. Set environment variables
3. Configure build command: `npm run build`
4. Configure start command: `npm start`
5. Deploy

## Post-Deployment

### Immediate (Day 1)
- [ ] Verify all pages load
- [ ] Test authentication flow
- [ ] Verify Slack integration works
- [ ] Check database is accessible
- [ ] Monitor error logs

### First Week
- [ ] Test commitment detection end-to-end
- [ ] Verify nudges send properly
- [ ] Test team collaboration
- [ ] Monitor performance metrics
- [ ] Gather user feedback

### First Month
- [ ] Review analytics data
- [ ] Optimize based on usage
- [ ] Set up automated backups
- [ ] Monitor API costs
- [ ] Plan feature updates

## Monitoring & Maintenance

### Daily
- [ ] Check error logs
- [ ] Monitor API usage
- [ ] Verify background jobs ran

### Weekly
- [ ] Review performance metrics
- [ ] Check database size
- [ ] Review user feedback
- [ ] Update dependencies if needed

### Monthly
- [ ] Database optimization
- [ ] Security audit
- [ ] Cost review
- [ ] Capacity planning

## Scaling Checklist

When ready to scale:
- [ ] Enable database connection pooling
- [ ] Set up CDN for static assets
- [ ] Configure caching headers
- [ ] Implement rate limiting
- [ ] Add API metrics/monitoring
- [ ] Scale compute resources
- [ ] Set up load balancing

## Rollback Plan

If deployment fails:
1. Revert to previous working commit
2. Check error logs for cause
3. Fix issue in development
4. Test thoroughly
5. Deploy again

If database migration fails:
1. Restore from backup
2. Review migration for errors
3. Fix and test locally
4. Apply carefully in production

## Support

### Documentation
- See README.md for architecture
- See SETUP.md for configuration
- See this file for deployment

### Getting Help
- Check Supabase docs: https://supabase.com/docs
- Check Next.js docs: https://nextjs.org/docs
- Check Slack API docs: https://api.slack.com/docs
- Check Anthropic docs: https://docs.anthropic.com

## Final Verification

Before marking as "live":

- [ ] All pages respond with 2xx status
- [ ] No console errors in production
- [ ] Database queries complete < 500ms
- [ ] API responses < 1s
- [ ] Images load properly
- [ ] Forms submit correctly
- [ ] Emails send (if applicable)
- [ ] Slack integration works
- [ ] Analytics tracking works
- [ ] Error logging works

---

**Status**: Ready for deployment
**Version**: 1.0.0
**Last Updated**: 2026-03-21

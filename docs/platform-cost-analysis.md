# HeyWren Platform Cost & Scalability Analysis

**Date:** April 2026
**Scope:** Per-user cost modeling, margin analysis, and scalability projections across all three pricing tiers.

---

## 1. Revenue Per User Per Month

| Plan  | Price/User/Month | Max Team Size |
|-------|----------------:|:-------------:|
| Basic | $5              | 5             |
| Pro   | $10             | 25            |
| Team  | $20             | 100           |

All plans include a 14-day free trial (trial users get Pro-level access).

---

## 2. Cost Breakdown by Service

### 2.1 Anthropic Claude API (Primary Cost Driver)

All AI features use **Claude Haiku 4.5** (`claude-haiku-4-5-20251001`).

**Current Haiku pricing:**
- Input: $0.80 / 1M tokens
- Output: $4.00 / 1M tokens
- Prompt caching (write): $1.00 / 1M tokens
- Prompt caching (read): $0.08 / 1M tokens

**AI call inventory per user (monthly estimates based on typical usage):**

| Feature | Trigger | Calls/User/Month | Avg Input Tokens | Avg Output Tokens | Est. Cost/Call | Monthly Cost/User |
|---------|---------|------------------:|-----------------:|------------------:|---------------:|------------------:|
| **Commitment Detection — Tier 2 (triage)** | Every Slack/email msg passing regex | ~300 | ~200 | ~20 | $0.00024 | $0.072 |
| **Commitment Detection — Tier 3 (extract)** | ~20-30% of triaged messages | ~75 | ~800 | ~400 | $0.0022 | $0.165 |
| **Commitment Detection — Batch mode** | Slack backfill / Outlook sync | ~8 batch calls | ~3,000 | ~1,500 | $0.0084 | $0.067 |
| **Completion Detection** | Messages matching completion regex | ~50 | ~600 | ~200 | $0.0013 | $0.065 |
| **Email Classification — Triage** | Emails passing automated filter | ~100 | ~250 | ~20 | $0.00028 | $0.028 |
| **Email Classification — Analysis** | ~30% of triaged emails | ~30 | ~600 | ~300 | $0.0017 | $0.051 |
| **Draft Generation** | Daily for overdue commitments (Pro+) | ~15 | ~400 | ~300 | $0.0015 | $0.023 |
| **Coaching Insights** | On-demand, ~2x/month (Pro+) | ~2 | ~2,000 | ~1,500 | $0.0076 | $0.015 |
| **Theme Generation** | On-demand, ~2x/month (Pro+) | ~2 | ~3,000 | ~1,000 | $0.0064 | $0.013 |
| **Hey Wren (meeting triggers)** | Per meeting with triggers (Pro+) | ~4 | ~1,000 | ~500 | $0.0028 | $0.011 |
| **Wren Chat** | Interactive chat sessions | ~20 msgs | ~1,500 | ~200 | $0.002 | $0.040 |
| **Meeting Transcript Processing** | Per meeting transcript (Pro+) | ~8 | ~2,000 | ~800 | $0.0048 | $0.038 |

**Estimated Claude API cost per user per month:**

| Plan  | Features Included | Est. API Cost/User/Month |
|-------|-------------------|-------------------------:|
| Basic | Commitment detection, completion, basic chat | **$0.25 - $0.40** |
| Pro   | + Drafts, coaching, themes, meetings, Hey Wren, email classification | **$0.45 - $0.75** |
| Team  | Same AI features as Pro (Team adds dashboards/admin, not more AI) | **$0.45 - $0.75** |

**Key cost optimizations already in place:**
1. **3-tier pipeline**: Regex pre-filter eliminates ~70-80% of messages before any API call
2. **Haiku model**: Cheapest available model (~10x cheaper than Sonnet, ~60x cheaper than Opus)
3. **Prompt caching**: System prompts cached via `cache_control: { type: 'ephemeral' }` — reduces repeated input costs by ~90% for cached portions
4. **Batch processing**: Multiple messages analyzed in single API calls (commitment detection, email classification, draft generation)
5. **Tool use for structured output**: Eliminates JSON parsing failures and retry costs
6. **Token budgets**: `max_tokens` capped tightly per feature (64-2048 range)

### 2.2 Supabase (Database + Auth)

**Supabase Pro plan: ~$25/month base** (includes 8GB database, 250K MAU auth, 50GB bandwidth).

Per-user storage estimate:
- Commitments: ~2KB/commitment x ~30/month = ~60KB/month
- Meeting transcripts: ~50KB/transcript x ~8/month = ~400KB/month (Pro+)
- Slack message cache: ~1KB/msg x ~500/month = ~500KB/month
- Email records: ~2KB/email x ~100/month = ~200KB/month
- Activity logs, scores, edges: ~100KB/month
- **Total: ~1.3MB/user/month**

At 1,000 users with 12 months retention: ~15.6GB — within Supabase Pro limits. Beyond that, ~$0.125/GB additional storage.

| Scale | Est. Supabase Cost | Per-User Amortized |
|------:|-------------------:|-------------------:|
| 100 users | $25/mo (Pro base) | $0.25 |
| 500 users | $25-40/mo | $0.05-0.08 |
| 1,000 users | $40-60/mo | $0.04-0.06 |
| 5,000 users | $80-150/mo | $0.02-0.03 |
| 10,000 users | $150-300/mo | $0.015-0.03 |

### 2.3 Vercel (Hosting + Serverless Functions)

**Vercel Pro: $20/month base** (includes 1TB bandwidth, 1M function invocations).

Per-user function invocations:
- Page loads: ~100/month
- API calls (dashboard, chat, integrations): ~500/month
- Webhook handlers (Slack events, Stripe, Zoom): ~200/month
- **Total: ~800 invocations/user/month**

| Scale | Est. Vercel Cost | Per-User Amortized |
|------:|-------------------:|-------------------:|
| 100 users | $20/mo (Pro base) | $0.20 |
| 500 users | $20-30/mo | $0.04-0.06 |
| 1,000 users | $30-50/mo | $0.03-0.05 |
| 5,000 users | $50-150/mo | $0.01-0.03 |
| 10,000 users | $150-400/mo | $0.015-0.04 |

### 2.4 Inngest (Background Jobs)

**24 registered functions**, with the following cron schedules:

| Frequency | Functions | Per-User Executions/Month |
|-----------|-----------|-------------------------:|
| Every 30 min | Platform recording sync | ~1,440 (shared) |
| Every hour | Welcome drip, Outlook backlog drain | ~720 (shared) |
| 4x daily | Missed email scan, Outlook sync | ~120 per user |
| Daily | Daily digest, Draft generation, Re-engagement, Stale detection | ~30 per user |
| Weekly | Scores, Nudges, Weekly recap, Manager briefing, Response patterns, Alerts | ~6 per user |
| Monthly | Sentiment aggregation | ~1 per user |
| Event-driven | Slack message, Meeting transcript, Slack mention, Completion detection | ~500 per user |

**Inngest Pro: $50/month** (includes 50K steps). At scale:

| Scale | Est. Steps/Month | Est. Inngest Cost | Per-User |
|------:|-----------------:|------------------:|---------:|
| 100 users | ~70K | $50-75/mo | $0.50-0.75 |
| 500 users | ~350K | $150-250/mo | $0.30-0.50 |
| 1,000 users | ~700K | $250-400/mo | $0.25-0.40 |
| 5,000 users | ~3.5M | $500-1,000/mo | $0.10-0.20 |

### 2.5 Resend (Transactional Email)

**6 email types**: welcome drip, nudge fallback, weekly recap, daily digest, achievement, manager briefing, re-engagement.

Estimated emails per user per month:
- Daily digest: ~20 (weekdays)
- Weekly recap: ~4
- Nudge emails: ~4
- Achievement emails: ~1
- Welcome drip (first month only): ~3
- **Total: ~30 emails/user/month**

**Resend pricing**: Free tier = 3,000/month. Pro = $20/mo for 50K emails, then $0.40/1K.

| Scale | Emails/Month | Est. Resend Cost | Per-User |
|------:|-------------:|-----------------:|---------:|
| 100 users | 3,000 | $0 (free tier) | $0.00 |
| 500 users | 15,000 | $20/mo | $0.04 |
| 1,000 users | 30,000 | $20/mo | $0.02 |
| 5,000 users | 150,000 | $60/mo | $0.012 |
| 10,000 users | 300,000 | $120/mo | $0.012 |

### 2.6 Stripe (Payment Processing)

**Standard rate: 2.9% + $0.30 per transaction** (monthly subscription).

| Plan | Price | Stripe Fee/User/Month | Net Revenue |
|------|------:|----------------------:|------------:|
| Basic | $5.00 | $0.45 (8.9%) | $4.55 |
| Pro | $10.00 | $0.59 (5.9%) | $9.41 |
| Team | $20.00 | $0.88 (4.4%) | $19.12 |

Annual billing (recommended to push) reduces Stripe overhead significantly:
| Plan | Annual Price | Stripe Fee/Year | Effective Monthly Fee | Net Revenue/Mo |
|------|------------:|----------------:|----------------------:|---------------:|
| Basic | $50 | $1.75 (3.5%) | $0.15 | $4.85 |
| Pro | $100 | $3.20 (3.2%) | $0.27 | $9.73 |
| Team | $200 | $6.10 (3.1%) | $0.51 | $19.49 |

### 2.7 Nango (Integration Auth Orchestration)

Manages OAuth token refresh for Slack, Outlook, Zoom, Google Meet.

**Nango Starter: ~$20/month** for up to 2,500 connections.

| Scale | Connections | Est. Nango Cost | Per-User |
|------:|------------:|----------------:|---------:|
| 100 users | ~200 | $20/mo | $0.20 |
| 500 users | ~1,000 | $20/mo | $0.04 |
| 1,000 users | ~2,500 | $20-50/mo | $0.02-0.05 |
| 5,000 users | ~12,500 | $100-200/mo | $0.02-0.04 |

---

## 3. Total Cost Per User Per Month

### At 500 Users (Current Beta Scale)

| Cost Category | Basic | Pro | Team |
|---------------|------:|----:|-----:|
| Claude API | $0.35 | $0.60 | $0.60 |
| Supabase (amortized) | $0.07 | $0.07 | $0.07 |
| Vercel (amortized) | $0.05 | $0.05 | $0.05 |
| Inngest (amortized) | $0.40 | $0.40 | $0.40 |
| Resend | $0.04 | $0.04 | $0.04 |
| Stripe (monthly billing) | $0.45 | $0.59 | $0.88 |
| Nango (amortized) | $0.04 | $0.04 | $0.04 |
| **Total COGS/User** | **$1.40** | **$1.79** | **$2.08** |
| **Revenue/User** | **$5.00** | **$10.00** | **$20.00** |
| **Gross Margin** | **$3.60 (72%)** | **$8.21 (82%)** | **$17.92 (90%)** |

### At 5,000 Users (Growth Target)

| Cost Category | Basic | Pro | Team |
|---------------|------:|----:|-----:|
| Claude API | $0.30 | $0.55 | $0.55 |
| Supabase (amortized) | $0.025 | $0.025 | $0.025 |
| Vercel (amortized) | $0.02 | $0.02 | $0.02 |
| Inngest (amortized) | $0.15 | $0.15 | $0.15 |
| Resend | $0.012 | $0.012 | $0.012 |
| Stripe (monthly billing) | $0.45 | $0.59 | $0.88 |
| Nango (amortized) | $0.03 | $0.03 | $0.03 |
| **Total COGS/User** | **$0.99** | **$1.38** | **$1.67** |
| **Revenue/User** | **$5.00** | **$10.00** | **$20.00** |
| **Gross Margin** | **$4.01 (80%)** | **$8.62 (86%)** | **$18.33 (92%)** |

### At 50,000 Users (Scale)

| Cost Category | Basic | Pro | Team |
|---------------|------:|----:|-----:|
| Claude API | $0.25 | $0.50 | $0.50 |
| Supabase (amortized) | $0.01 | $0.01 | $0.01 |
| Vercel (amortized) | $0.01 | $0.01 | $0.01 |
| Inngest (amortized) | $0.08 | $0.08 | $0.08 |
| Resend | $0.01 | $0.01 | $0.01 |
| Stripe (annual billing) | $0.15 | $0.27 | $0.51 |
| Nango (amortized) | $0.01 | $0.01 | $0.01 |
| **Total COGS/User** | **$0.52** | **$0.89** | **$1.13** |
| **Revenue/User** | **$5.00** | **$10.00** | **$20.00** |
| **Gross Margin** | **$4.48 (90%)** | **$9.11 (91%)** | **$18.87 (94%)** |

---

## 4. Margin Summary

| Metric | 500 Users | 5,000 Users | 50,000 Users |
|--------|-----------|-------------|--------------|
| **Blended COGS/user** (assuming 30% Basic, 50% Pro, 20% Team) | ~$1.73 | ~$1.24 | ~$0.79 |
| **Blended ARPU** | ~$11.00 | ~$11.00 | ~$11.00 |
| **Blended Gross Margin** | **~84%** | **~89%** | **~93%** |

---

## 5. Biggest Cost Risk: Claude API Token Usage

The Claude API represents **40-60% of per-user variable costs**. Key risk factors:

### 5.1 Power Users
A user with 3x normal Slack volume (~1,500 messages/month) could generate ~$1.50-2.00/month in API costs. This is still well within margin for Pro ($10) and Team ($20), but compresses Basic margins to ~60%.

### 5.2 Meeting Transcript Volume
Meeting transcripts are the most token-heavy feature (~2,000-5,000 input tokens each). A heavy user processing 20+ meetings/month could add ~$0.15/month. Minimal risk since this is Pro+ only ($10+).

### 5.3 Wren Chat Usage
Chat is the most unpredictable cost — context-heavy system prompts (~1,500 tokens) on every message. 20 messages/month = ~$0.04, but a power user sending 100+ messages could reach ~$0.20. Still negligible against $10+ plans.

### 5.4 API Price Reductions
Anthropic has historically reduced API pricing. Haiku pricing has already dropped significantly. Each future price reduction directly improves margins. This is a tailwind, not a risk.

---

## 6. Scalability Considerations

### 6.1 What Scales Well
- **Vercel serverless**: Auto-scales with zero infrastructure management
- **Supabase PostgreSQL**: Scales linearly with good indexing (already well-indexed)
- **Claude API**: No infrastructure to manage, pay-per-use
- **Resend**: Linear cost scaling, very cheap per email

### 6.2 Potential Bottlenecks
- **Inngest step limits**: At 10K+ users, background job volume could hit plan limits. Consider batching more aggressively (process 50 users per cron run instead of 1-per-function).
- **Supabase connection pooling**: Serverless functions + Supabase can hit connection limits at scale. Consider Supabase connection pooling (pgBouncer) at 2K+ concurrent users.
- **Slack API rate limits**: Slack's tier-based rate limits (1-100 req/min depending on method) could bottleneck backfill operations for large teams. Already mitigated by batch processing.

### 6.3 Cost Optimization Opportunities (Not Yet Implemented)
1. **Anthropic Batch API**: For non-real-time jobs (daily drafts, email scans, weekly coaching), use the Batch API at **50% discount**. Could save ~$0.10-0.20/user/month.
2. **Haiku prompt caching hit rate**: Monitor cache hit rates. If system prompts are being re-cached too frequently, consolidate function invocations to improve cache reuse.
3. **Slack message deduplication**: Ensure edited messages don't trigger duplicate AI analysis.
4. **Tiered storage**: Archive commitments older than 6 months to cheaper storage; they're rarely accessed after that.
5. **Annual billing push**: Moving users from monthly to annual reduces Stripe fees from ~6% to ~3% of revenue.

---

## 7. Pricing Model Assessment

### Current pricing supports high margins at all scales:

| Question | Answer |
|----------|--------|
| Does Basic ($5) cover costs? | Yes. Even at 500 users, gross margin is 72%. At scale, 90%. |
| Does Pro ($10) support high margins? | Yes. 82-91% gross margin across all scales. Strong. |
| Does Team ($20) support high margins? | Yes. 90-94% gross margin. Excellent. |
| Is there room to lower prices? | Pro could go to $8 and still maintain 75%+ margins at scale. Basic is tighter — $5 is the floor. |
| Should prices increase? | Not necessary for margin. Consider increasing Team to $25 if adding more AI-heavy team features (team-wide analytics, cross-team insights). |
| Biggest margin risk? | Basic plan power users at small scale. At 100 users a Basic-heavy user mix could push blended margins below 70%. |

### Recommendations:
1. **Push Pro as default**: Pro has the best margin/value ratio. The feature set justifies $10 and margins are excellent.
2. **Consider Basic at $6-7**: The $5 price point is tight at small scale. $7/user maintains psychological affordability while improving early-stage margins by ~15 percentage points.
3. **Annual billing discount (15-20%)**: Push annual plans aggressively — saves on Stripe fees and improves cash flow.
4. **Team plan minimum seats**: Consider a minimum of 5 seats ($100/month minimum) for Team tier to cover the fixed cost overhead of team features.
5. **Implement Anthropic Batch API**: For non-real-time workloads, this is the single highest-impact cost optimization available — estimated 15-25% reduction in total Claude API spend.

---

## 8. Summary

HeyWren's cost structure is **SaaS-healthy** with strong unit economics across all tiers. The combination of aggressive AI cost optimization (3-tier filtering, Haiku model, prompt caching, batching) and a serverless infrastructure stack means costs scale sub-linearly while revenue scales linearly. At the current beta scale (~500 users), blended gross margins are already ~84%, improving to ~93% at 50K users. The pricing model is well-calibrated and supports the high-margin target.

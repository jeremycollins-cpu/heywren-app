# HeyWren Platform Cost & Scalability Analysis

**Date:** April 2026 (Updated: new two-tier pricing model)
**Scope:** Per-user cost modeling, margin analysis, and scalability projections.

---

## 1. Revenue Per User Per Month

| Plan  | Monthly Price | Annual Price (per month) | Min Users | Max Team Size |
|-------|-------------:|-------------------------:|:---------:|:-------------:|
| Pro   | $25          | $20                      | 1         | 25            |
| Team  | $25          | $20                      | 5         | 100           |
| Enterprise | Custom  | Custom                   | Custom    | Unlimited     |

All plans include a 14-day free trial. Pro and Team are the same per-user price — Team requires a 5-user minimum and unlocks team-level features (dashboards, playbooks, handoff, admin controls). Enterprise is sales-led, not self-serve.

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
| Pro   | All AI features: commitment detection, completion, drafts, coaching, themes, meetings, Hey Wren, email classification, chat | **$0.45 - $0.75** |
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

| Billing | Price/User/Mo | Stripe Fee/User/Month | Net Revenue |
|---------|-------------:|----------------------:|------------:|
| Monthly | $25.00 | $1.03 (4.1%) | $23.97 |
| Annual | $20.00 ($240/yr) | $0.61 (3.1%) | $19.39 |

Annual billing is significantly more efficient for both Stripe fees and cash flow.

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

Both Pro and Team have identical per-user costs (same AI features). Team just requires a 5-user minimum and unlocks team-management features that have negligible marginal cost.

### At 500 Users (Current Beta Scale) — Monthly Billing

| Cost Category | Cost/User |
|---------------|----------:|
| Claude API | $0.60 |
| Supabase (amortized) | $0.07 |
| Vercel (amortized) | $0.05 |
| Inngest (amortized) | $0.40 |
| Resend | $0.04 |
| Stripe (monthly @ $25) | $1.03 |
| Nango (amortized) | $0.04 |
| **Total COGS/User** | **$2.23** |
| **Revenue/User (monthly)** | **$25.00** |
| **Gross Margin** | **$22.77 (91%)** |

### At 5,000 Users (Growth Target) — Mixed Billing (60% annual, 40% monthly)

| Cost Category | Cost/User |
|---------------|----------:|
| Claude API | $0.55 |
| Supabase (amortized) | $0.025 |
| Vercel (amortized) | $0.02 |
| Inngest (amortized) | $0.15 |
| Resend | $0.012 |
| Stripe (blended) | $0.78 |
| Nango (amortized) | $0.03 |
| **Total COGS/User** | **$1.57** |
| **Blended ARPU** | **$22.00** |
| **Gross Margin** | **$20.43 (93%)** |

### At 50,000 Users (Scale) — Mostly Annual (80% annual, 20% monthly)

| Cost Category | Cost/User |
|---------------|----------:|
| Claude API | $0.50 |
| Supabase (amortized) | $0.01 |
| Vercel (amortized) | $0.01 |
| Inngest (amortized) | $0.08 |
| Resend | $0.01 |
| Stripe (blended) | $0.69 |
| Nango (amortized) | $0.01 |
| **Total COGS/User** | **$1.31** |
| **Blended ARPU** | **$21.00** |
| **Gross Margin** | **$19.69 (94%)** |

---

## 4. Margin Summary

| Metric | 500 Users | 5,000 Users | 50,000 Users |
|--------|-----------|-------------|--------------|
| **COGS/user** | ~$2.23 | ~$1.57 | ~$1.31 |
| **Blended ARPU** | ~$25.00 | ~$22.00 | ~$21.00 |
| **Gross Margin** | **~91%** | **~93%** | **~94%** |

---

## 5. Biggest Cost Risk: Claude API Token Usage

The Claude API represents **40-60% of per-user variable costs**. Key risk factors:

### 5.1 Power Users
A user with 3x normal Slack volume (~1,500 messages/month) could generate ~$1.50-2.00/month in API costs. At $25/user, this still yields 92%+ margin. No risk at this price point.

### 5.2 Meeting Transcript Volume
Meeting transcripts are the most token-heavy feature (~2,000-5,000 input tokens each). A heavy user processing 20+ meetings/month could add ~$0.15/month. Negligible against $25 ARPU.

### 5.3 Wren Chat Usage
Chat is the most unpredictable cost — context-heavy system prompts (~1,500 tokens) on every message. 20 messages/month = ~$0.04, but a power user sending 100+ messages could reach ~$0.20. Still negligible against $25 ARPU.

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

## 7. Pricing Model Assessment (Updated — Two-Tier Model)

### New structure: Pro ($25/$20) + Team ($25/$20 with 5-seat min) + Enterprise (custom)

| Question | Answer |
|----------|--------|
| Does $25/mo (monthly) support high margins? | Yes. 91%+ gross margin even at beta scale. COGS is ~$2.23/user. |
| Does $20/mo (annual) still support high margins? | Yes. 93-94% gross margin at scale. Annual billing also reduces Stripe fees. |
| Is the 5-user minimum for Team worth it? | Yes. Guarantees $100/mo minimum revenue per team, covering any fixed overhead. Team features (dashboards, playbooks) are low marginal cost. |
| Is there room to lower prices later? | Significant room. Could drop to $15/mo annual and still maintain 85%+ margins at scale. Useful for competitive pressure or market expansion. |
| What about legacy Basic ($5) users? | They are automatically treated as Pro in the new model. These users got a massive upgrade — consider a migration email celebrating the change. |
| Biggest margin risk? | Nearly none. At $20-25/user, even extreme power users (3x Slack volume + heavy chat) only cost ~$2.50/month. Margins stay above 88%. |

### Key advantages of the new model:
1. **Simplified pricing**: Two self-serve plans reduces decision paralysis. Same price for Pro and Team — the upgrade trigger is team size (5+), not cost.
2. **Higher ARPU**: $25 (monthly) / $20 (annual) vs. old blended ~$11. Revenue per user more than doubles.
3. **Massive margins**: 91-94% gross margins across all scales. No tier has margin pressure.
4. **Annual push**: 20% discount ($25 -> $20) is compelling. At 80% annual adoption, blended ARPU is ~$21 with lower Stripe overhead.
5. **Enterprise upside**: Custom pricing for large orgs opens high-ACV deals without cannibalizing self-serve.

### Remaining optimization opportunities:
1. **Anthropic Batch API**: For non-real-time workloads (daily drafts, email scans), use the Batch API at 50% discount. Estimated ~$0.10-0.15/user/month savings.
2. **Monitor prompt caching hit rates**: Maximize cache reuse to keep input costs minimal.
3. **Team minimum enforcement**: Ensure Stripe checkout enforces the 5-seat minimum for Team plans (quantity >= 5).

---

## 8. Summary

HeyWren's cost structure is **exceptional** with the new two-tier pricing model. At $25/mo (monthly) or $20/mo (annual), per-user COGS of ~$1.30-2.23 yields **91-94% gross margins** across all scales. The combination of aggressive AI cost optimization (3-tier filtering, Haiku model, prompt caching, batching) and a serverless infrastructure stack means costs scale sub-linearly while revenue scales linearly.

The simplified Pro/Team/Enterprise structure eliminates the low-margin Basic tier entirely, more than doubles ARPU, and reduces pricing complexity. There is substantial headroom to absorb future feature additions, API cost increases, or competitive price reductions while maintaining 85%+ margins.

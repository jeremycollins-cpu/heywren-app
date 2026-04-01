# HeyWren Mobile App — Implementation Plan

## Overview

Convert HeyWren from a Next.js web app to a cross-platform mobile app (iOS + Android) using React Native with Expo. The existing web app remains **completely untouched** — the mobile app is a new client that shares the same Supabase backend and API routes.

---

## Architecture

```
┌─────────────────────┐    ┌─────────────────────┐
│   Web App (Next.js) │    │  Mobile App (Expo)   │
│   Vercel hosted      │    │  iOS + Android       │
└────────┬────────────┘    └────────┬────────────┘
         │                          │
         │    ┌─────────────────┐   │
         └───►│  Shared Backend  │◄──┘
              │                 │
              │  • Supabase DB  │
              │  • API Routes   │
              │  • Inngest Jobs │
              │  • Stripe       │
              └─────────────────┘
```

### Key Principles

1. **Web app is never modified** — mobile is additive only
2. **Backend additions are new endpoints/tables** — existing ones stay untouched
3. **Shared types** — `lib/types.ts` is copied (or symlinked) to mobile project
4. **Shared Supabase client** — `@supabase/supabase-js` works in React Native
5. **API-first** — mobile calls the same `/api/*` routes the web app uses

---

## Tech Stack (Mobile)

| Layer | Technology |
|---|---|
| Framework | React Native 0.76+ with Expo SDK 52 |
| Language | TypeScript (shared tsconfig base) |
| Navigation | Expo Router (file-based, mirrors Next.js App Router) |
| Styling | NativeWind v4 (Tailwind CSS for React Native) |
| State Management | Zustand (same stores as web) |
| Database Client | @supabase/supabase-js |
| Auth | Supabase Auth + expo-secure-store for token persistence |
| Push Notifications | expo-notifications + Supabase Edge Function for dispatch |
| Icons | lucide-react-native |
| Date Utilities | date-fns (same as web) |
| Validation | zod (same as web) |
| Build/Deploy | EAS Build + EAS Submit |
| OTA Updates | EAS Update |

---

## Project Structure

```
mobile/
├── app/                          # Expo Router screens (file-based routing)
│   ├── (auth)/                   # Auth group
│   │   ├── login.tsx
│   │   ├── signup.tsx
│   │   └── forgot-password.tsx
│   ├── (tabs)/                   # Main tab navigator
│   │   ├── _layout.tsx           # Tab bar config
│   │   ├── index.tsx             # Dashboard (Home tab)
│   │   ├── commitments/
│   │   │   ├── index.tsx         # Commitment list
│   │   │   └── [id].tsx          # Commitment detail
│   │   ├── team/
│   │   │   ├── index.tsx         # Team dashboard
│   │   │   └── members.tsx       # Team members
│   │   └── settings/
│   │       ├── index.tsx         # Settings menu
│   │       ├── integrations.tsx  # Integration management
│   │       ├── notifications.tsx # Push notification prefs
│   │       ├── billing.tsx       # Subscription management
│   │       └── profile.tsx       # Profile editing
│   ├── onboarding/               # First-time setup
│   │   ├── welcome.tsx
│   │   ├── connect-slack.tsx
│   │   └── invite-team.tsx
│   ├── commitment/
│   │   ├── create.tsx            # Create commitment
│   │   └── edit/[id].tsx         # Edit commitment
│   ├── briefing.tsx              # Daily briefing view
│   ├── coach.tsx                 # AI coaching
│   └── _layout.tsx               # Root layout with auth guard
├── components/
│   ├── ui/                       # Base UI components
│   │   ├── Button.tsx
│   │   ├── Card.tsx
│   │   ├── Input.tsx
│   │   ├── Badge.tsx
│   │   ├── Avatar.tsx
│   │   ├── BottomSheet.tsx
│   │   ├── SwipeableRow.tsx
│   │   └── LoadingSkeleton.tsx
│   ├── commitments/
│   │   ├── CommitmentCard.tsx
│   │   ├── CommitmentList.tsx
│   │   ├── StatusBadge.tsx
│   │   ├── PriorityIndicator.tsx
│   │   └── CommitmentFilters.tsx
│   ├── dashboard/
│   │   ├── StatsRow.tsx
│   │   ├── RecentActivity.tsx
│   │   └── QuickActions.tsx
│   └── team/
│       ├── MemberRow.tsx
│       ├── TeamHealthScore.tsx
│       └── TeamSelector.tsx
├── lib/
│   ├── supabase.ts               # Supabase client (React Native version)
│   ├── auth.ts                   # Auth helpers with secure storage
│   ├── notifications.ts          # Push notification setup
│   ├── api.ts                    # API client for Next.js backend
│   ├── types.ts                  # Copied from web app's lib/types.ts
│   └── stores/                   # Zustand stores (adapted from web)
│       └── dashboard-store.ts
├── hooks/
│   ├── useAuth.ts
│   ├── useCommitments.ts
│   ├── useTeam.ts
│   ├── useNotifications.ts
│   └── useRealtime.ts
├── assets/
│   ├── icon.png                  # App icon (1024x1024)
│   ├── splash.png                # Splash screen
│   └── adaptive-icon.png         # Android adaptive icon
├── app.json                      # Expo config
├── eas.json                      # EAS Build config
├── tailwind.config.ts            # NativeWind config
├── tsconfig.json
├── package.json
└── babel.config.js
```

---

## Phased Implementation

### Phase 1: Foundation & Auth
**Goal**: Bootable app with authentication and basic navigation

#### 1.1 Project Scaffolding
- [ ] Initialize Expo project with `npx create-expo-app mobile --template tabs`
- [ ] Configure TypeScript, ESLint, Prettier
- [ ] Install core dependencies: `@supabase/supabase-js`, `zustand`, `date-fns`, `zod`
- [ ] Set up NativeWind v4 with Tailwind config matching web app's brand colors
- [ ] Configure Expo Router file-based navigation
- [ ] Copy `lib/types.ts` from web app

#### 1.2 Supabase Client Setup
- [ ] Create React Native Supabase client using `expo-secure-store` for token persistence
- [ ] Configure auth state listener for session management
- [ ] Set up environment variables via `app.json` extra config

```typescript
// mobile/lib/supabase.ts
import { createClient } from '@supabase/supabase-js'
import * as SecureStore from 'expo-secure-store'

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: {
      getItem: (key) => SecureStore.getItemAsync(key),
      setItem: (key, value) => SecureStore.setItemAsync(key, value),
      removeItem: (key) => SecureStore.deleteItemAsync(key),
    },
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
})
```

#### 1.3 Authentication Screens
- [ ] Login screen (email + password)
- [ ] Sign up screen with team creation
- [ ] Forgot password screen
- [ ] Auth state management with `useAuth` hook
- [ ] Protected route wrapper (redirect to login if unauthenticated)
- [ ] Deep link handling for magic links / email verification

#### 1.4 Tab Navigation Shell
- [ ] Bottom tab bar with 4 tabs: Home, Commitments, Team, Settings
- [ ] Tab icons using `lucide-react-native`
- [ ] Stack navigator per tab for drill-down screens
- [ ] Header with team selector

**Deliverable**: App that launches, authenticates, and shows empty tab screens connected to Supabase.

---

### Phase 2: Core Screens
**Goal**: Full commitment management and dashboard

#### 2.1 Dashboard (Home Tab)
- [ ] Stats row: open commitments, overdue, completed this week, health score
- [ ] Recent commitments list (tappable → detail view)
- [ ] Recent activity feed
- [ ] Quick action buttons: "Add Commitment", "View Briefing"
- [ ] Pull-to-refresh

**Data source**: Direct Supabase queries (same tables the web app reads)

#### 2.2 Commitment List Screen
- [ ] List view with `CommitmentCard` components
- [ ] Filter bar: status (open/overdue/completed/all), source, priority
- [ ] Sort options: due date, priority, created date
- [ ] Search bar
- [ ] Swipe-to-complete gesture
- [ ] Empty state for no commitments
- [ ] Infinite scroll / pagination

#### 2.3 Commitment Detail Screen
- [ ] Full commitment view: title, description, status, priority, due date, source
- [ ] Metadata: urgency, tone, type, stakeholders, original quote
- [ ] Status update buttons (mark complete, mark in-progress, drop)
- [ ] Activity timeline for this commitment
- [ ] Source link (open in Slack / email if available)
- [ ] Edit capability

#### 2.4 Create / Edit Commitment
- [ ] Form with: title, description, due date (date picker), priority, assignee
- [ ] Assignee picker from team members
- [ ] Validation with Zod schemas
- [ ] Optimistic UI updates via Zustand

#### 2.5 Real-time Updates
- [ ] Supabase real-time subscriptions for commitment changes
- [ ] Live status updates when teammates modify commitments
- [ ] Activity feed real-time append

**Deliverable**: Fully functional commitment management — view, create, edit, complete, filter.

---

### Phase 3: Team & Integrations
**Goal**: Team management and Slack connection from mobile

#### 3.1 Team Dashboard
- [ ] Team health score visualization
- [ ] Member list with individual stats
- [ ] Team commitment breakdown (open/overdue/completed)
- [ ] Weekly trend chart (simple bar chart using `react-native-svg`)

#### 3.2 Team Management
- [ ] View team members and roles
- [ ] Invite member (email invite via existing `/api/invites` endpoint)
- [ ] Role management (for owners/admins)
- [ ] Team selector for multi-team users

#### 3.3 Integration Connection
- [ ] Slack OAuth flow via `expo-auth-session` + `expo-web-browser`
- [ ] Integration status display (connected/disconnected/error)
- [ ] Channel selection for connected Slack workspaces
- [ ] Disconnect integration option
- [ ] Note: Outlook/Google/Zoom OAuth flows follow same pattern

```typescript
// Slack OAuth flow on mobile
import * as WebBrowser from 'expo-web-browser'
import * as AuthSession from 'expo-auth-session'

const redirectUri = AuthSession.makeRedirectUri({ scheme: 'heywren' })
// Opens Slack OAuth in system browser, redirects back to app via deep link
```

#### 3.4 Settings Screen
- [ ] Profile editing (display name, avatar)
- [ ] Notification preferences
- [ ] Subscription/billing info (read-only, link to web for changes)
- [ ] Connected integrations overview
- [ ] Sign out
- [ ] App version info

**Deliverable**: Team collaboration features and Slack integration working on mobile.

---

### Phase 4: Push Notifications
**Goal**: Native push notifications for nudges and alerts

#### 4.1 Backend Changes (Additive Only)

**New Supabase migration** (`035_mobile_device_tokens.sql`):
```sql
-- New table — does NOT modify any existing tables
CREATE TABLE device_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  team_id UUID REFERENCES teams(id) ON DELETE CASCADE NOT NULL,
  expo_push_token TEXT NOT NULL,
  platform TEXT NOT NULL CHECK (platform IN ('ios', 'android')),
  device_name TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, expo_push_token)
);

-- RLS: users can only manage their own tokens
ALTER TABLE device_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own device tokens"
  ON device_tokens FOR ALL
  USING (auth.uid() = user_id);
```

**New API endpoint** (`/api/notifications/register-device`):
- Accepts `{ expo_push_token, platform, device_name }`
- Inserts/updates `device_tokens` table
- No changes to existing endpoints

**Update to Inngest `send-nudges` function** (additive):
- After sending Slack/email nudge, ALSO send push notification
- Uses `expo-server-sdk` to send via Expo Push Service
- Existing Slack/email delivery is untouched — push is an additional channel

#### 4.2 Mobile Push Setup
- [ ] Register for push notifications with `expo-notifications`
- [ ] Send Expo push token to `/api/notifications/register-device`
- [ ] Handle foreground notifications (in-app banner)
- [ ] Handle background notifications (system tray)
- [ ] Handle notification tap → navigate to relevant commitment
- [ ] Notification preferences screen (which types to receive)
- [ ] Badge count management

#### 4.3 Notification Types
| Notification | Trigger | Deep Link |
|---|---|---|
| Nudge reminder | Inngest `send-nudges` | → Commitment detail |
| Commitment overdue | Inngest `detect-stale-commitments` | → Commitment detail |
| New commitment detected | Inngest `process-slack-message` | → Commitment detail |
| Team member completed | Real-time subscription | → Activity feed |
| Daily briefing ready | Inngest `daily-digest` | → Briefing screen |

**Deliverable**: Push notifications for nudges and key events, with deep linking.

---

### Phase 5: Advanced Features
**Goal**: Feature parity with web app's secondary screens

#### 5.1 Daily Briefing
- [ ] Morning briefing view: today's commitments, overdue items, recent activity
- [ ] Swipe through briefing cards
- [ ] Mark items as complete directly from briefing

#### 5.2 AI Coach
- [ ] Chat-style interface for AI coaching
- [ ] Calls existing `/api/coach` endpoint
- [ ] Suggested actions based on commitment patterns

#### 5.3 Meetings
- [ ] Meeting transcript list
- [ ] Transcript detail with extracted commitments
- [ ] Link to recording (open in native app)

#### 5.4 Missed Chats / Missed Emails
- [ ] List of Slack mentions / emails with potential commitments
- [ ] Accept or dismiss detected commitments
- [ ] Bulk actions

#### 5.5 Weekly Digest
- [ ] Weekly goal summary
- [ ] Completion trends
- [ ] Team comparison

**Deliverable**: Near-complete feature parity with the web app.

---

### Phase 6: Polish & Native Experience
**Goal**: App store readiness

#### 6.1 Offline Support
- [ ] Cache recent commitments locally with `expo-sqlite` or MMKV
- [ ] Queue mutations when offline, sync when reconnected
- [ ] Offline indicator in header
- [ ] Graceful degradation for AI features (require connectivity)

#### 6.2 Biometric Authentication
- [ ] Face ID / Touch ID via `expo-local-authentication`
- [ ] Optional lock screen after app backgrounded
- [ ] Biometric gate for sensitive actions

#### 6.3 Native Gestures & Haptics
- [ ] Swipe-to-complete on commitment cards
- [ ] Pull-to-refresh on all list screens
- [ ] Haptic feedback on status changes (`expo-haptics`)
- [ ] Long-press context menus

#### 6.4 Deep Linking & Universal Links
- [ ] `heywren://` custom scheme for OAuth callbacks
- [ ] Universal links (`app.heywren.com`) for shared commitment URLs
- [ ] Handle links from Slack nudge messages → open commitment in app

#### 6.5 App Store Assets
- [ ] App icon (1024x1024) matching HeyWren brand
- [ ] Splash screen with logo
- [ ] App Store screenshots (6.7", 6.5", 5.5" for iOS; phone + tablet for Android)
- [ ] App Store description and keywords
- [ ] Privacy policy URL
- [ ] Support URL

#### 6.6 Performance
- [ ] Lazy load screens with `React.lazy` / `expo-router` lazy
- [ ] Image optimization with `expo-image`
- [ ] List virtualization with `FlashList`
- [ ] Memory profiling and leak detection
- [ ] Startup time optimization

**Deliverable**: Polished, performant app ready for store submission.

---

## Backend Changes Summary

All changes are **additive** — nothing existing is modified or removed.

| Change | Type | Files Affected |
|---|---|---|
| `device_tokens` table | New migration | `supabase/migrations/035_mobile_device_tokens.sql` |
| Device token registration endpoint | New API route | `app/api/notifications/register-device/route.ts` |
| Push notification delivery | Addition to existing | `inngest/functions/send-nudges.ts` (adds push alongside Slack/email) |
| Push for daily digest | Addition to existing | `inngest/functions/daily-digest.ts` (adds push alongside email) |
| `expo-server-sdk` dependency | New dependency | `package.json` |
| `NudgeChannel` type update | Type addition | `lib/types.ts` (add `'push'` to union) |

---

## Accounts & Services Required (Manual Setup)

| Service | Purpose | Cost |
|---|---|---|
| Apple Developer Account | iOS App Store distribution | $99/year |
| Google Play Console | Android Play Store distribution | $25 one-time |
| Expo Account (EAS) | Cloud builds, OTA updates, push service | Free tier available, Pro $99/month |
| APNs Key | iOS push notifications (configured via Expo) | Included with Apple Developer |
| FCM Key | Android push notifications (configured via Expo) | Free (Firebase) |

---

## Shared Code Reuse Inventory

Code that can be **directly reused** from the web app (copy or symlink):

| File | Reusable? | Notes |
|---|---|---|
| `lib/types.ts` | 100% | All types are platform-agnostic |
| `lib/plans.ts` | 100% | Plan definitions are pure data |
| `lib/utils.ts` | ~80% | Date/string utils reusable; any DOM utils need removal |
| `lib/stores/dashboard-store.ts` | ~90% | Zustand stores port directly; remove any `window` references |
| `lib/hooks/` (data hooks) | ~70% | Supabase query hooks reusable; UI hooks need rewrite |
| `lib/team/` (score calculations) | 100% | Pure business logic |
| `lib/auth/` (role checks) | 100% | Pure logic |

Code that must be **rewritten** for mobile:

| Area | Reason |
|---|---|
| All UI components | HTML → React Native Views |
| Navigation | Next.js App Router → Expo Router |
| Auth middleware | SSR middleware → client-side auth guard |
| Styling | Tailwind classes → NativeWind (similar syntax, different runtime) |
| File-based routing | Different directory conventions |
| Supabase client init | Cookie storage → SecureStore |

---

## Risk Mitigation

| Risk | Mitigation |
|---|---|
| Breaking the web app | Mobile is a separate `/mobile` directory with its own `package.json`. No web files are modified except additive backend changes. |
| OAuth flows on mobile | Use `expo-web-browser` for OAuth — opens system browser, handles redirect back via deep link. Well-documented pattern. |
| Push notification reliability | Expo Push Service handles APNs/FCM abstraction. Fallback to email/Slack nudges (already working). |
| App store rejection | Follow Apple/Google guidelines. No web-view-only screens. Use native navigation patterns. |
| Supabase RLS compatibility | Mobile uses same `supabase-js` client with same auth tokens. RLS policies apply identically. |
| Build/deploy complexity | EAS Build handles native compilation. EAS Submit automates store uploads. |

---

## Testing Strategy

| Level | Tool | Scope |
|---|---|---|
| Unit tests | Jest + React Native Testing Library | Components, hooks, stores |
| Integration tests | Detox or Maestro | Auth flows, commitment CRUD, navigation |
| E2E tests | Maestro (recommended) | Full user journeys on simulators |
| Manual testing | TestFlight (iOS) + Internal Testing (Android) | Real device testing before release |
| Backend tests | Existing Jest tests | Verify new endpoints don't break existing ones |

---

## Estimated Build Order

```
Phase 1 (Foundation)  ███░░░░░░░░░░░░░  Auth + navigation shell
Phase 2 (Core)        ██████░░░░░░░░░░  Dashboard + commitments
Phase 3 (Team)        █████████░░░░░░░  Team features + Slack
Phase 4 (Push)        ███████████░░░░░  Push notifications
Phase 5 (Advanced)    █████████████░░░  Briefings, coach, meetings
Phase 6 (Polish)      ████████████████  Offline, biometrics, store
```

Each phase is independently shippable — you can release to TestFlight/Internal Testing after Phase 2 for early feedback.

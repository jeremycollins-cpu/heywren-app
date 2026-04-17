import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowLeft, Key, ShieldCheck, AlertTriangle, CheckCircle2 } from 'lucide-react'

export const metadata: Metadata = {
  title: 'Finding your Anthropic Admin API key · HeyWren',
  description:
    'Step-by-step guide for IT admins: where to create an Anthropic Admin API key in the Anthropic Console and connect it to HeyWren.',
  robots: { index: false, follow: false },
}

function Step({
  n,
  title,
  children,
}: {
  n: number
  title: string
  children: React.ReactNode
}) {
  return (
    <li className="flex gap-4">
      <div className="shrink-0 w-8 h-8 rounded-full bg-indigo-600 text-white font-semibold text-sm flex items-center justify-center">
        {n}
      </div>
      <div className="flex-1 pt-0.5 space-y-2 text-gray-700 dark:text-gray-200 leading-relaxed">
        <h3 className="font-semibold text-gray-900 dark:text-white text-base">{title}</h3>
        {children}
      </div>
    </li>
  )
}

function Callout({
  tone,
  icon: Icon,
  children,
}: {
  tone: 'info' | 'warn' | 'ok'
  icon: typeof ShieldCheck
  children: React.ReactNode
}) {
  const styles = {
    info: 'bg-indigo-50 dark:bg-indigo-900/20 border-indigo-200 dark:border-indigo-800 text-indigo-900 dark:text-indigo-100',
    warn: 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800 text-amber-900 dark:text-amber-100',
    ok: 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800 text-emerald-900 dark:text-emerald-100',
  }[tone]
  return (
    <div className={`rounded-lg border p-3 text-sm flex gap-2.5 ${styles}`}>
      <Icon size={16} className="shrink-0 mt-0.5" />
      <div className="space-y-1">{children}</div>
    </div>
  )
}

export default function AdminApiKeyGuidePage() {
  return (
    <main id="main-content" className="min-h-screen bg-surface-secondary dark:bg-surface-dark">
      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-10 space-y-8">
        <div>
          <Link
            href="/team-management/ai-usage"
            className="inline-flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 mb-3"
          >
            <ArrowLeft size={12} />
            Back to Team AI Usage
          </Link>
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-lg bg-indigo-100 dark:bg-indigo-900 flex items-center justify-center">
              <Key size={20} className="text-indigo-600 dark:text-indigo-300" />
            </div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
              Finding your Anthropic Admin API key
            </h1>
          </div>
          <p className="text-sm text-gray-600 dark:text-gray-300 leading-relaxed">
            A step-by-step guide for your IT admin. Connecting an Admin API key lets HeyWren pull
            authoritative daily Claude Code totals — sessions, tokens by model, cost, lines of
            code, commits, PRs, and tool acceptance — directly from Anthropic.
          </p>
        </div>

        <Callout tone="warn" icon={AlertTriangle}>
          <p>
            <strong>Two prerequisites before you start.</strong> Admin API keys are only available
            on <strong>Team or Enterprise plans</strong>, and only the Anthropic org&apos;s{' '}
            <strong>Primary Owner</strong> can create them. If neither is true, the Admin Keys
            page won&apos;t appear in the Console.
          </p>
        </Callout>

        <ol className="space-y-6">
          <Step n={1} title="Sign in as the Primary Owner">
            <p>
              Go to{' '}
              <a
                href="https://console.anthropic.com"
                target="_blank"
                rel="noopener noreferrer"
                className="text-indigo-600 dark:text-indigo-400 underline"
              >
                console.anthropic.com
              </a>{' '}
              and sign in with the account that owns your Anthropic organization.
            </p>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              If your profile shows &quot;Member&quot; or &quot;Developer,&quot; you don&apos;t
              have permission — ask the Primary Owner to do this step, or have them temporarily
              promote you.
            </p>
          </Step>

          <Step n={2} title="Confirm your org is on a Team or Enterprise plan">
            <p>
              Open <strong>Settings → Plans &amp; Billing</strong>. You should see{' '}
              <strong>Team</strong> or <strong>Enterprise</strong>. If it says{' '}
              <em>Build</em> or <em>Scale (Pro)</em>, Admin keys aren&apos;t available until you
              upgrade.
            </p>
          </Step>

          <Step n={3} title="Open the Admin Keys page">
            <p>
              Go directly to{' '}
              <a
                href="https://console.anthropic.com/settings/admin-keys"
                target="_blank"
                rel="noopener noreferrer"
                className="text-indigo-600 dark:text-indigo-400 underline break-all"
              >
                console.anthropic.com/settings/admin-keys
              </a>
              .
            </p>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Or navigate manually: profile menu (top right) → <strong>Settings</strong> →{' '}
              <strong>Admin Keys</strong> in the left sidebar. This sits below &quot;API Keys&quot;
              — they are different pages.
            </p>
          </Step>

          <Step n={4} title="Click “Create Admin Key”">
            <p>
              Give the key a descriptive name like <code className="px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-xs">HeyWren usage sync</code>.
            </p>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              There is no scope picker — an Admin key grants org-wide read/write on the Admin API.
              HeyWren only calls the read-only usage and cost endpoints.
            </p>
          </Step>

          <Step n={5} title="Copy the key immediately">
            <p>
              The key starts with{' '}
              <code className="px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-xs">
                sk-ant-admin…
              </code>
              . Anthropic shows the full value <strong>only once</strong>.
            </p>
            <Callout tone="warn" icon={AlertTriangle}>
              <p>
                If you close the dialog before copying, the key is gone — delete it and create a
                new one.
              </p>
            </Callout>
          </Step>

          <Step n={6} title="Paste it into HeyWren">
            <p>
              In HeyWren, go to{' '}
              <Link
                href="/team-management/ai-usage"
                className="text-indigo-600 dark:text-indigo-400 underline"
              >
                Team Management → Team AI Usage
              </Link>
              , click <strong>Connect</strong>, paste the key, and hit <strong>Save</strong>.
            </p>
            <Callout tone="ok" icon={CheckCircle2}>
              <p>
                HeyWren validates the key with Anthropic before storing it, then encrypts it with
                AES-256-GCM at rest. Only the last 8 characters of its fingerprint are ever shown
                back to you.
              </p>
            </Callout>
          </Step>
        </ol>

        <section className="space-y-3 pt-4 border-t border-gray-200 dark:border-gray-700">
          <h2 className="font-semibold text-gray-900 dark:text-white">Common gotchas</h2>
          <dl className="space-y-3 text-sm text-gray-700 dark:text-gray-200">
            <div>
              <dt className="font-medium text-gray-900 dark:text-white">
                &quot;I don&apos;t see an Admin Keys section.&quot;
              </dt>
              <dd className="text-gray-600 dark:text-gray-300 mt-0.5">
                Either you&apos;re signed in with a role below Primary Owner, or the org is on a
                plan that doesn&apos;t include Admin API access. Both are fixable by the current
                Primary Owner in the Console.
              </dd>
            </div>
            <div>
              <dt className="font-medium text-gray-900 dark:text-white">
                Confusing it with a regular API key.
              </dt>
              <dd className="text-gray-600 dark:text-gray-300 mt-0.5">
                The <strong>API Keys</strong> page (keys starting with{' '}
                <code className="px-1 rounded bg-gray-100 dark:bg-gray-800 text-xs">
                  sk-ant-api…
                </code>
                ) is for Claude inference calls — those won&apos;t work here. You need a key from
                the <strong>Admin Keys</strong> page that starts with{' '}
                <code className="px-1 rounded bg-gray-100 dark:bg-gray-800 text-xs">
                  sk-ant-admin…
                </code>
                .
              </dd>
            </div>
            <div>
              <dt className="font-medium text-gray-900 dark:text-white">
                You belong to multiple Anthropic orgs.
              </dt>
              <dd className="text-gray-600 dark:text-gray-300 mt-0.5">
                Check the org switcher in the top-left of the Console before creating the key.
                It&apos;s scoped to whichever org is selected.
              </dd>
            </div>
          </dl>
        </section>

        <section className="space-y-2 pt-4 border-t border-gray-200 dark:border-gray-700">
          <h2 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2">
            <ShieldCheck size={16} className="text-emerald-600" />
            What HeyWren does with the key
          </h2>
          <ul className="text-sm text-gray-700 dark:text-gray-200 space-y-1.5 list-disc pl-5 leading-relaxed">
            <li>
              Once a day, calls Anthropic&apos;s Admin usage and cost endpoints for the previous
              7 days.
            </li>
            <li>
              Merges per-user daily totals into the Team AI Usage dashboard, attributed by the
              email on each Claude Code session.
            </li>
            <li>
              Never reads prompts, Claude&apos;s responses, file contents, or tool arguments —
              those endpoints don&apos;t exist on the Admin API.
            </li>
            <li>
              Can be disconnected at any time from the Team AI Usage page; historical rollups
              already in the database stay.
            </li>
          </ul>
        </section>
      </div>
    </main>
  )
}

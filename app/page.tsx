import Link from 'next/link'

const valueProps = [
  {
    icon: (
      <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09ZM18.259 8.715 18 9.75l-.259-1.035a3.375 3.375 0 0 0-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 0 0 2.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 0 0 2.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 0 0-2.455 2.456Z" />
      </svg>
    ),
    title: 'AI Detection',
    description: 'HeyWren reads the room so you don\'t have to. It picks up on promises, to-dos, and commitments made in Slack automatically.',
  },
  {
    icon: (
      <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 0 0 5.454-1.31A8.967 8.967 0 0 1 18 9.75V9A6 6 0 0 0 6 9v.75a8.967 8.967 0 0 1-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 0 1-5.714 0m5.714 0a3 3 0 1 1-5.714 0" />
      </svg>
    ),
    title: 'Smart Nudges',
    description: 'Gentle, well-timed reminders land in your DMs before deadlines slip. No nagging, no noise -- just the right nudge at the right time.',
  },
  {
    icon: (
      <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 0 0 3.741-.479 3 3 0 0 0-4.682-2.72m.94 3.198.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0 1 12 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 0 1 6 18.719m12 0a5.971 5.971 0 0 0-.941-3.197m0 0A5.995 5.995 0 0 0 12 12.75a5.995 5.995 0 0 0-5.058 2.772m0 0a3 3 0 0 0-4.681 2.72 8.986 8.986 0 0 0 3.74.477m.94-3.197a5.971 5.971 0 0 0-.94 3.197M15 6.75a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm6 3a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Zm-13.5 0a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Z" />
      </svg>
    ),
    title: 'Team Visibility',
    description: 'See who\'s on track and what\'s at risk across your team. A shared dashboard keeps everyone accountable without micromanagement.',
  },
]

const steps = [
  { number: '1', title: 'Connect', description: 'Add HeyWren to your Slack workspace in under two minutes. No config needed.' },
  { number: '2', title: 'Detect', description: 'Our AI quietly identifies commitments, action items, and promises in your conversations.' },
  { number: '3', title: 'Follow through', description: 'Get timely nudges and track completion across your team from one dashboard.' },
]

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-[var(--surface-secondary)]">
      {/* ── Navigation ──────────────────────────────────────────────────── */}
      <nav className="sticky top-0 z-50 backdrop-blur-lg bg-white/80 dark:bg-[#0f0d2e]/80 border-b border-[var(--border-primary)]">
        <div className="max-w-6xl mx-auto flex items-center justify-between px-6 py-4">
          <span className="text-xl font-extrabold bg-gradient-to-r from-indigo-600 to-violet-600 bg-clip-text text-transparent">
            HeyWren
          </span>
          <div className="flex items-center gap-4">
            <Link
              href="/login"
              className="text-sm font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
            >
              Log in
            </Link>
            <Link
              href="/signup"
              className="btn-primary text-sm px-5 py-2"
            >
              Get started free
            </Link>
          </div>
        </div>
      </nav>

      {/* ── Hero ────────────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden pt-24 pb-32 px-6">
        {/* Background decoration */}
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10">
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[900px] h-[600px] rounded-full bg-gradient-to-br from-indigo-500/10 to-violet-500/10 blur-3xl" />
        </div>

        <div className="max-w-3xl mx-auto text-center">
          <h1 className="text-5xl sm:text-6xl font-extrabold leading-tight tracking-tight text-[var(--text-primary)]">
            Nothing falls through{' '}
            <span className="bg-gradient-to-r from-indigo-600 to-violet-600 bg-clip-text text-transparent">
              the cracks
            </span>
          </h1>
          <p className="mt-6 text-lg sm:text-xl text-[var(--text-secondary)] max-w-2xl mx-auto leading-relaxed">
            HeyWren monitors your Slack conversations for commitments and action items, then nudges your team to follow through -- so promises turn into results.
          </p>
          <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link
              href="/signup"
              className="btn-primary text-base px-8 py-3.5 rounded-xl"
            >
              Start for free
              <svg className="w-4 h-4 ml-1" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
              </svg>
            </Link>
            <span className="text-sm text-[var(--text-tertiary)]">Free for teams up to 10 &middot; No credit card required</span>
          </div>
        </div>
      </section>

      {/* ── Value propositions ──────────────────────────────────────────── */}
      <section className="py-24 px-6">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-center text-3xl sm:text-4xl font-bold text-[var(--text-primary)]">
            Built for teams that ship
          </h2>
          <p className="mt-4 text-center text-[var(--text-secondary)] max-w-xl mx-auto">
            Stop chasing updates in threads. Let AI handle the follow-through.
          </p>

          <div className="mt-16 grid gap-8 sm:grid-cols-3">
            {valueProps.map((prop) => (
              <div
                key={prop.title}
                className="group relative rounded-2xl border border-[var(--border-primary)] bg-[var(--surface-primary)] p-8 transition-all duration-300 hover:shadow-lg hover:border-indigo-300 dark:hover:border-indigo-700"
              >
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-violet-500 text-white shadow-md">
                  {prop.icon}
                </div>
                <h3 className="mt-6 text-lg font-semibold text-[var(--text-primary)]">{prop.title}</h3>
                <p className="mt-3 text-sm leading-relaxed text-[var(--text-secondary)]">{prop.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── How it works ───────────────────────────────────────────────── */}
      <section className="py-24 px-6 bg-[var(--surface-tertiary)]/50">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-center text-3xl sm:text-4xl font-bold text-[var(--text-primary)]">
            How it works
          </h2>
          <p className="mt-4 text-center text-[var(--text-secondary)] max-w-lg mx-auto">
            Three steps. Two minutes to set up. Zero things forgotten.
          </p>

          <div className="mt-16 grid gap-10 sm:grid-cols-3">
            {steps.map((step) => (
              <div key={step.number} className="text-center">
                <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-indigo-600 to-violet-600 text-white text-xl font-bold shadow-lg">
                  {step.number}
                </div>
                <h3 className="mt-5 text-lg font-semibold text-[var(--text-primary)]">{step.title}</h3>
                <p className="mt-2 text-sm text-[var(--text-secondary)] leading-relaxed">{step.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Social proof placeholder ───────────────────────────────────── */}
      <section className="py-24 px-6">
        <div className="max-w-4xl mx-auto text-center">
          <p className="text-sm font-semibold uppercase tracking-widest text-indigo-500">
            Trusted by teams everywhere
          </p>
          <div className="mt-10 grid grid-cols-2 sm:grid-cols-4 gap-8 items-center opacity-40">
            {['Company A', 'Company B', 'Company C', 'Company D'].map((name) => (
              <div
                key={name}
                className="h-10 flex items-center justify-center text-lg font-bold text-[var(--text-tertiary)]"
              >
                {name}
              </div>
            ))}
          </div>
          <blockquote className="mt-16 max-w-2xl mx-auto">
            <p className="text-xl italic text-[var(--text-secondary)] leading-relaxed">
              &ldquo;We used to lose track of half the things we agreed on in Slack. HeyWren changed that overnight.&rdquo;
            </p>
            <footer className="mt-4 text-sm text-[var(--text-tertiary)]">
              -- Engineering Lead, Series B startup
            </footer>
          </blockquote>
        </div>
      </section>

      {/* ── CTA footer ─────────────────────────────────────────────────── */}
      <section className="py-24 px-6">
        <div className="max-w-3xl mx-auto text-center rounded-3xl bg-gradient-to-br from-indigo-600 to-violet-600 p-12 sm:p-16 shadow-xl">
          <h2 className="text-3xl sm:text-4xl font-bold text-white">
            Ready to stop dropping the ball?
          </h2>
          <p className="mt-4 text-indigo-100 text-lg max-w-lg mx-auto">
            Set up HeyWren in two minutes and never let a commitment slip again.
          </p>
          <Link
            href="/signup"
            className="mt-8 inline-flex items-center gap-2 rounded-xl bg-white px-8 py-3.5 text-base font-semibold text-indigo-700 shadow-lg transition-all duration-300 hover:shadow-xl hover:-translate-y-0.5"
          >
            Get started free
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
            </svg>
          </Link>
        </div>
      </section>

      {/* ── Footer ─────────────────────────────────────────────────────── */}
      <footer className="border-t border-[var(--border-primary)] py-10 px-6">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-[var(--text-tertiary)]">
          <span className="font-semibold bg-gradient-to-r from-indigo-600 to-violet-600 bg-clip-text text-transparent">
            HeyWren
          </span>
          <span>&copy; {new Date().getFullYear()} HeyWren. All rights reserved.</span>
        </div>
      </footer>
    </div>
  )
}

import Image from 'next/image'
import { ArrowRight, ExternalLink } from 'lucide-react'
import { NEXEZ_BUYER_PLUGIN } from '../../lib/nexez-buyer-plugin'
import { appUrl } from '../../lib/site'

export function ChatGPTLaunchAnnouncement() {
  return (
    <aside aria-label="Nexez Buyer launch" className="relative border-b border-border bg-[var(--signal)]/5">
      <div className="mx-auto flex max-w-7xl flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
        <div className="flex items-center gap-3">
          <Image src="/icon.svg" alt="" width={32} height={32} className="size-8 shrink-0 rounded-lg" />
          <p className="text-sm leading-6">
            <span className="font-semibold">Nexez Buyer is live on ChatGPT.</span>
            <span className="block text-muted-foreground lg:ml-2 lg:inline">Find and compare offers in a conversation.</span>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
          <a
            href={NEXEZ_BUYER_PLUGIN.directoryUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-11 items-center gap-2 font-semibold text-[var(--signal)] hover:underline"
          >
            Try in ChatGPT
            <ExternalLink aria-hidden="true" className="size-3.5" />
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
          <a href={appUrl('/create')} className="inline-flex min-h-11 items-center gap-2 text-foreground hover:underline">
            List your business
            <ArrowRight aria-hidden="true" className="size-3.5" />
          </a>
        </div>
      </div>
    </aside>
  )
}

export function ChatGPTInstallCard() {
  return (
    <section id="chatgpt" aria-labelledby="chatgpt-install-title" className="scroll-mt-24 border-b border-border">
      <div className="mx-auto max-w-7xl px-5 py-12 md:py-16">
        <div className="grid gap-8 rounded-2xl border border-[var(--signal)]/30 bg-[var(--signal)]/5 p-6 md:p-8 lg:grid-cols-[1.15fr_0.85fr] lg:gap-12">
          <div>
            <div className="flex items-center gap-3">
              <Image src="/icon.svg" alt="" width={48} height={48} className="size-12 rounded-xl" />
              <div>
                <p className="text-sm font-semibold">{NEXEZ_BUYER_PLUGIN.name}</p>
                <p className="mt-1 text-xs text-muted-foreground">Live on ChatGPT · v{NEXEZ_BUYER_PLUGIN.version}</p>
              </div>
            </div>
            <h2 id="chatgpt-install-title" className="mt-6 text-balance text-3xl font-semibold tracking-[-0.045em] md:text-4xl">
              Find your next offer. In ChatGPT.
            </h2>
            <p className="mt-4 max-w-xl text-sm leading-6 text-muted-foreground md:text-base">
              Find public products and services from Nexez merchants, compare offers, and check whether your budget
              and timeline fit before taking the next step. No code or API keys needed to install.
            </p>
            <div className="mt-6 flex flex-col items-start gap-3 sm:flex-row sm:items-center">
              <a
                href={NEXEZ_BUYER_PLUGIN.directoryUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="btn-primary min-h-11 px-5"
              >
                Install Nexez Buyer
                <ExternalLink aria-hidden="true" className="size-4" />
                <span className="sr-only"> (opens in a new tab)</span>
              </a>
              <a href={appUrl('/create')} className="btn-secondary min-h-11 px-5">
                List your business
                <ArrowRight aria-hidden="true" className="size-4" />
              </a>
            </div>
          </div>
          <div className="rounded-xl border border-border bg-[var(--bg)] p-5 md:p-6">
            <h3 className="text-base font-semibold">Start with one conversation</h3>
            <ol className="mt-5 space-y-4 text-sm leading-6 text-muted-foreground">
              <li><span className="font-semibold text-foreground">1. Open the listing.</span> Follow the install steps in ChatGPT. Sign in if prompted.</li>
              <li><span className="font-semibold text-foreground">2. Tell Nexez Buyer what you need.</span> Include your budget, location, and timeline.</li>
              <li><span className="font-semibold text-foreground">3. Compare and check fit.</span> Review the available offers and any missing requirements.</li>
            </ol>
            <p className="mt-5 border-t border-border pt-4 text-xs leading-5 text-muted-foreground">
              {NEXEZ_BUYER_PLUGIN.safetyNote} Checking an offer does not guarantee availability or seller acceptance.
            </p>
          </div>
        </div>
      </div>
    </section>
  )
}

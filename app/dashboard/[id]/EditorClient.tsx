'use client'

import { useEffect, useState } from 'react'
import { FileText, Gauge, Layers3, Loader2, PencilLine, Rocket, Save, Workflow } from 'lucide-react'
import { ErrorBoundary } from '../../../components/ErrorBoundary'
import { hasPendingDraft } from '../../../lib/draft'
import { freshnessLabel, isStale } from '../../../lib/freshness'
import { usePageEditor } from '../../../components/editor/usePageEditor'
import { EditorInitial } from '../../../components/editor/types'
import { Field, textareaClass } from '../../../components/editor/Field'
import { EditorToolbar } from '../../../components/editor/EditorToolbar'
import { ReadinessAside } from '../../../components/editor/ReadinessAside'
import { EditorFields } from '../../../components/editor/EditorFields'
import { VisualBuilderSection } from '../../../components/editor/VisualBuilderSection'
import { CalendlyBookingsCard } from '../../../components/editor/CalendlyBookingsCard'
import { OutboundActivityCard } from '../../../components/editor/OutboundActivityCard'
import { IntegrationsHealthPanel } from '../../../components/editor/IntegrationsHealthPanel'
import { AvailabilityCard } from '../../../components/editor/AvailabilityCard'
import { ReanalysisPreview } from '../../../components/editor/ReanalysisPreview'
import { PublishCelebration } from '../../../components/editor/PublishCelebration'
import { SurfaceHeader } from '../../../components/dashboard/SurfacePrimitives'
import {
  SettingRow,
  SettingsNav,
  SettingsSection,
  SettingsSwitch,
  StatusPill,
} from '../../../components/settings/SettingsPrimitives'
import { appUrl } from '../../../lib/site'
import { TemplateLineageCard } from '../../../components/editor/TemplateLineageCard'

const EDITOR_SECTIONS = [
  { id: 'basics', label: 'Listing basics', icon: FileText },
  { id: 'offers', label: 'Offers & pricing', icon: Layers3 },
  { id: 'operations', label: 'Operations', icon: Workflow },
  { id: 'agent-readiness', label: 'Agent readiness', icon: Gauge },
  { id: 'publishing', label: 'Publishing', icon: Rocket },
] as const

export function EditorClient({ initial }: { initial: EditorInitial }) {
  const e = usePageEditor(initial)
  const page = e.page as any
  const [activeSection, setActiveSection] = useState<(typeof EDITOR_SECTIONS)[number]['id']>('basics')

  useEffect(() => {
    const sectionIds = EDITOR_SECTIONS.map((section) => section.id)
    const syncFromHash = () => {
      const next = window.location.hash.slice(1)
      if (sectionIds.includes(next as (typeof sectionIds)[number])) {
        setActiveSection(next as (typeof EDITOR_SECTIONS)[number]['id'])
      } else if (!next) {
        setActiveSection('basics')
      }
    }

    syncFromHash()
    window.addEventListener('hashchange', syncFromHash)
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0]
        if (visible?.target.id) {
          setActiveSection(visible.target.id as (typeof EDITOR_SECTIONS)[number]['id'])
        }
      },
      { rootMargin: '-18% 0px -68% 0px', threshold: [0, 0.15, 0.5] },
    )

    for (const sectionId of sectionIds) {
      const element = document.getElementById(sectionId)
      if (element) observer.observe(element)
    }

    return () => {
      window.removeEventListener('hashchange', syncFromHash)
      observer.disconnect()
    }
  }, [])

  return (
    <main className="nx-listing-settings nx-platform-surface min-h-screen bg-[var(--bg)] text-[var(--fg)]" data-testid="listing-editor-screen">
      <ErrorBoundary>
        <div className="mx-auto max-w-[1180px] px-4 py-6 sm:px-7 sm:py-9">
          <PublishCelebration />
          <SurfaceHeader
            eyebrow="Listing editor"
            icon={PencilLine}
            title={e.name || 'Edit listing'}
            description="Organize the facts, offers, operations, and publishing controls that buyers and agents rely on."
            actions={<EditorToolbar e={e} />}
            footer={(
              <>
                <StatusPill label={e.isPublished ? 'Published listing' : 'Draft listing'} tone={e.isPublished ? 'ready' : 'attention'} />
                <StatusPill label={`${e.score}% readiness`} tone={e.score >= 80 ? 'ready' : e.score >= 60 ? 'attention' : 'neutral'} />
                <StatusPill label={`${page?.versions?.length ?? 0} saved version${page?.versions?.length === 1 ? '' : 's'}`} />
                {hasPendingDraft(page) ? <StatusPill label="Draft staged" tone="attention" /> : null}
              </>
            )}
          />

          <div className="mt-8 grid min-w-0 grid-cols-[minmax(0,1fr)] items-start gap-8 lg:grid-cols-[220px_minmax(0,1fr)]">
            <aside className="sticky top-16 z-30 min-w-0 max-w-full lg:top-24">
              <SettingsNav
                items={EDITOR_SECTIONS}
                activeId={activeSection}
                onNavigate={(sectionId) => setActiveSection(sectionId as (typeof EDITOR_SECTIONS)[number]['id'])}
                ariaLabel="Edit listing sections"
              />
              <ReadinessAside e={e} />
            </aside>

            <form onSubmit={e.handleSubmit} className="grid min-w-0 gap-8">
              <SettingsSection
                id="basics"
                active={activeSection === 'basics'}
                title="Listing basics"
                hint="The identity, audience, contact path, and availability agents use to understand this listing."
                icon={FileText}
              >
                <div className="space-y-6 p-5 sm:p-6">
                  {initial.commerceTemplateLineage ? (
                    <TemplateLineageCard lineage={initial.commerceTemplateLineage} />
                  ) : null}
                  {page && isStale(page) && page.website_url ? (
                    <div className="rounded-[var(--radius)] border border-[var(--amber)]/30 bg-[var(--amber)]/5 p-3 text-sm">
                      <span className="text-[var(--amber)]">
                        Freshness: {freshnessLabel(page)}. Your live business may have changed, re-sync to keep agent data accurate.
                      </span>{' '}
                      <a href={`/dashboard/${e.id}/settings`} className="font-medium text-[var(--settings-emphasis)] hover:underline">
                        Re-sync in Settings →
                      </a>
                    </div>
                  ) : null}
                  {e.restoredVersion ? (
                    <div className="rounded-[var(--radius)] border border-[var(--amber)]/40 bg-[var(--amber)]/10 p-3 text-sm">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <span className="font-medium text-[var(--amber)]">
                          Restored from version saved {new Date(e.restoredVersion.timestamp).toLocaleString()}
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            e.setRestoredVersion(null)
                            e.setMessage('Restored state discarded. You can continue editing or reload the page.')
                          }}
                          className="settings-emphasis-action rounded-[var(--radius)] px-3 py-1.5 text-xs"
                        >
                          Discard restore
                        </button>
                      </div>
                      <p className="mt-1 text-xs text-[var(--amber)]/80">Review the listing, then save to make this the current version.</p>
                    </div>
                  ) : null}
                  <EditorFields e={e} />
                </div>
              </SettingsSection>

              <SettingsSection
                id="offers"
                active={activeSection === 'offers'}
                title="Offers & pricing"
                hint="Build the services and products agents can compare, recommend, and hand off for purchase."
                icon={Layers3}
              >
                <div className="p-5 sm:p-6"><VisualBuilderSection e={e} /></div>
              </SettingsSection>

              <SettingsSection
                id="operations"
                active={activeSection === 'operations'}
                title="Operations"
                hint="Review the booking, webhook, integration, and availability signals attached to this listing."
                icon={Workflow}
              >
                <div className="space-y-4 p-5 sm:p-6">
                  <CalendlyBookingsCard e={e} />
                  <OutboundActivityCard e={e} />
                  <IntegrationsHealthPanel e={e} />
                  <AvailabilityCard e={e} />
                  {!e.recentCalendlyBookings.length && !e.recentOutboundFires.length ? (
                    <p className="rounded-[var(--radius)] border border-dashed border-[var(--line)] p-4 text-sm leading-6 text-[var(--fg-muted)]">
                      Operational activity will appear here as bookings, imports, and webhook deliveries arrive.
                    </p>
                  ) : null}
                </div>
              </SettingsSection>

              <SettingsSection
                id="agent-readiness"
                active={activeSection === 'agent-readiness'}
                title="Agent readiness"
                hint="Preview incoming website changes before applying them to the structured listing agents consume."
                icon={Gauge}
                status={<StatusPill label={`${e.score}% ready`} tone={e.score >= 80 ? 'ready' : e.score >= 60 ? 'attention' : 'neutral'} />}
              >
                <div className="space-y-4 p-5 sm:p-6">
                  <p className="text-sm leading-6 text-[var(--fg-muted)]">
                    Re-analyze from the masthead to compare your website with the current listing. Nothing changes until you review and apply the preview.
                  </p>
                  <ReanalysisPreview e={e} />
                </div>
              </SettingsSection>

              <SettingsSection
                id="publishing"
                active={activeSection === 'publishing'}
                title="Publishing"
                hint="Control FAQs, visibility, live saves, staged drafts, previews, and team approval handoffs."
                icon={Rocket}
                status={<StatusPill label={e.isPublished ? 'Live' : 'Private'} tone={e.isPublished ? 'ready' : 'neutral'} />}
              >
                <div className="space-y-6 p-5 sm:p-6">
                  <Field label="FAQs, one per line: question | answer">
                    <textarea value={e.faqs} onChange={(event) => e.setFaqs(event.target.value)} className={textareaClass} />
                  </Field>

                  <details className="rounded-[var(--radius)] border border-[var(--line-soft)] bg-[var(--fill-1)] p-4">
                    <summary className="cursor-pointer text-sm font-medium text-[var(--fg-muted)] hover:text-[var(--fg)]">Raw text format (advanced)</summary>
                    <div className="mt-4 space-y-4">
                      <Field label="Products (raw text)">
                        <textarea value={e.products} onChange={(event) => e.setProducts(event.target.value)} className={textareaClass} />
                      </Field>
                      <Field label="Services (raw text)">
                        <textarea value={e.services} onChange={(event) => e.setServices(event.target.value)} className={textareaClass} />
                      </Field>
                    </div>
                  </details>

                  <SettingRow
                    label="Listing visibility"
                    description="Published listings are visible to crawlers and compatible agents. Drafts remain private."
                    className="!px-0 !py-0"
                  >
                    <SettingsSwitch
                      checked={e.isPublished}
                      onCheckedChange={e.setIsPublished}
                      label="Listing visibility"
                      checkedLabel="Published"
                      uncheckedLabel="Draft"
                    />
                  </SettingRow>

                  <div className={`rounded-[var(--radius)] border p-4 text-sm leading-6 ${
                    page?.website_verified_at || page?.custom_domain_verified || initial.shopifyConnection
                      ? 'border-[var(--ready)]/30 bg-[var(--ready)]/[0.07] text-[var(--fg-muted)]'
                      : 'border-[var(--amber)]/30 bg-[var(--amber)]/[0.07] text-[var(--amber)]'
                  }`}>
                    <p className="font-medium text-[var(--fg)]">
                      {page?.website_verified_at || page?.custom_domain_verified || initial.shopifyConnection
                        ? 'Business verification signal confirmed'
                        : 'Check business verification before expecting Launch'}
                    </p>
                    <p className="mt-1 text-xs leading-5">
                      Launch starts only after campaign access, email confirmation, a published listing, and one verified business identity method are all confirmed.
                    </p>
                    {!page?.website_verified_at && !page?.custom_domain_verified && !initial.shopifyConnection ? (
                      <a
                        href={`/dashboard/${e.id}/settings#agent-experience`}
                        className="mt-2 inline-flex text-xs font-medium underline underline-offset-4"
                      >
                        Review or add website verification
                      </a>
                    ) : null}
                  </div>

                  {e.message ? (
                    <p role="status" className="rounded-[var(--radius)] border border-[var(--line-soft)] bg-[var(--fill-1)] p-3 text-sm text-[var(--fg-muted)]">{e.message}</p>
                  ) : null}

                  {page?.team_collaboration?.approvals?.some((approval: any) => approval.status === 'pending') ? (
                    <div className="rounded-[var(--radius)] border border-[var(--amber)]/30 bg-[var(--amber)]/5 p-3 text-sm text-[var(--amber)]">
                      Team approvals are pending. Use Save as draft to keep edits private while they are reviewed. Save changes updates the live listing.
                    </div>
                  ) : null}

                  <button
                    type="submit"
                    disabled={
                      e.saving
                      || !e.slugValidation.ok
                      || e.slugAvailability.result?.available === false
                    }
                    className="btn-primary min-h-12 w-full px-5 py-3 disabled:opacity-60"
                  >
                    {e.saving ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Save className="size-4" aria-hidden="true" />}
                    {e.saving ? 'Saving…' : 'Save changes'}
                  </button>

                  <div className="rounded-[var(--radius)] border border-[var(--line-soft)] bg-[var(--fill-1)] p-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <p className="text-sm font-medium text-[var(--fg)]">Staged publishing</p>
                        <p className="mt-1 text-sm leading-6 text-[var(--fg-muted)]">Save privately, preview the result, then publish it to the live listing.</p>
                      </div>
                      <button type="button" disabled={e.saving} onClick={e.handleSaveDraft} className="settings-emphasis-action min-h-11 rounded-[var(--radius)] px-4 text-sm font-medium">
                        Save as draft
                      </button>
                    </div>
                    {hasPendingDraft(page) ? (
                      <div className="mt-4 flex flex-col gap-3 rounded-[var(--radius)] border border-[var(--amber)]/30 bg-[var(--amber)]/5 p-3 sm:flex-row sm:items-center sm:justify-between">
                        <span className="text-sm text-[var(--amber)]">
                          Draft staged{page?.draft_updated_at ? ` ${new Date(page.draft_updated_at).toLocaleString()}` : ''}, not live yet.
                        </span>
                        <span className="flex flex-wrap gap-2">
                          <a href={appUrl(`/${e.slug}?preview=1`)} target="_blank" rel="noreferrer" className="settings-emphasis-action inline-flex min-h-10 items-center rounded-[var(--radius)] px-3 text-xs font-medium">
                            Preview draft ↗
                          </a>
                          <button type="button" disabled={e.saving} onClick={e.handlePublishDraft} className="inline-flex min-h-10 items-center rounded-[var(--radius)] border border-[var(--ready)]/40 px-3 text-xs font-medium text-[var(--ready)] hover:bg-[var(--ready)]/10 disabled:opacity-50">
                            Publish draft → live
                          </button>
                        </span>
                      </div>
                    ) : null}
                  </div>
                </div>
              </SettingsSection>
            </form>
          </div>
        </div>
      </ErrorBoundary>
    </main>
  )
}

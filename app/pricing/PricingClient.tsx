'use client'

import React from 'react'
import { Check, Minus, Star } from 'lucide-react'
import {
  FEATURE_LABELS,
  PLAN_FEATURES,
  PLAN_FEATURE_MATRIX,
  billingPlans,
  type BillingPlan,
  type PlanLimit,
} from '../../lib/billing'
import { pricingFaqs } from '../../lib/marketing-content'
import { appUrl } from '../../lib/site'

const LIMIT_ROWS: Array<{ key: PlanLimit; label: string }> = [
  { key: 'publishedListings', label: 'Published listings' },
  { key: 'storefronts', label: 'Storefronts' },
  { key: 'customDomains', label: 'Active custom domains' },
  { key: 'teamSeats', label: 'Team seats' },
]

function formatPlanLimit(plan: BillingPlan, key: PlanLimit) {
  const value = plan.limits[key]
  return Number.isFinite(value) ? value.toLocaleString() : 'Custom'
}

export default function PricingClient() {
  const tiers = billingPlans

  return (
    <main className="min-h-screen">
      <div className="mx-auto max-w-7xl px-6 py-16">
        {/* Hero */}
        <div className="text-center mb-12">
          <div className="eyebrow justify-center">Plans &amp; pricing</div>
          <h1 className="display mt-4">Simple, transparent pricing.</h1>
          <p className="lede mx-auto mt-4 text-center">
            Start on Free with no time limit. Eligible verified businesses with a live listing can receive 180 complimentary days of Launch access while the campaign is available.
          </p>
          <p className="mx-auto mt-3 max-w-3xl text-sm text-[#9CA3AF]">
            Every plan includes discovery and commerce when your business is operationally ready. Upgrade for intelligence, automation, collaboration, capacity, support, and lower fees.
          </p>
          <div className="mt-4 text-sm" style={{ color: 'var(--ready)' }}>No card required. No automatic promotional renewal.</div>
        </div>

        {/* Main Pricing Tiers */}
        <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-5 mb-16">
          {tiers.map((plan, planIndex) => {
            const isPopular = plan.id === 'pro'
            const isEnterprise = plan.id === 'enterprise'
            const priceDisplay = isEnterprise ? 'Custom' : plan.price
            const cadence = isEnterprise ? '' : `/${plan.cadence}`
            const commissionLabel = isEnterprise ? 'Typically 1–2%' : `${plan.commissionPercent}%`
            // Plans are cumulative - make that legible (each builds on the one before).
            const previousPlanName = !isEnterprise && planIndex > 0 ? tiers[planIndex - 1].name : null

            return (
              <div
                key={plan.id}
                style={isPopular ? {
                  borderColor: 'var(--signal)',
                  background: 'color-mix(in srgb, var(--signal) 8%, transparent)',
                } : undefined}
                className={`glass lift relative rounded-3xl p-6 flex flex-col ${
                  isPopular ? 'prism scale-[1.02]' : ''
                }`}
              >
                {isPopular && (
                  <div
                    className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full px-3 py-0.5 text-xs font-semibold"
                    style={{ background: 'var(--prism)', color: '#0b0b12' }}
                  >
                    Most Popular
                  </div>
                )}

                <div>
                  <div className="flex items-center justify-between">
                    <h2 className="text-2xl font-semibold">{plan.name}</h2>
                    {isPopular && <Star className="size-5" style={{ color: 'var(--signal)' }} />}
                  </div>
                  <p className="mt-1 text-sm text-[#9CA3AF]">{plan.blurb}</p>

                  <div className="mt-6">
                    <span className="text-5xl font-semibold tracking-tight">{priceDisplay}</span>
                    <span className="ml-1 text-[#9CA3AF]">{cadence}</span>
                  </div>
                  <div className="mt-2 text-sm text-[#9CA3AF]">
                    <span className="font-medium text-white">{commissionLabel}</span> Nexez commission
                  </div>
                </div>

                <ul className="mt-8 flex-1 space-y-3 text-sm">
                  {previousPlanName && (
                    <li className="flex items-start gap-2 font-medium text-white">
                      <Check className="mt-0.5 size-4 shrink-0" style={{ color: 'var(--ready)' }} />
                      <span>Everything in {previousPlanName}, plus:</span>
                    </li>
                  )}
                  {plan.features.map((feature, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <Check className="mt-0.5 size-4 shrink-0" style={{ color: 'var(--ready)' }} />
                      <span>{feature}</span>
                    </li>
                  ))}
                  {isEnterprise && (
                    <li className="flex items-start gap-2 text-[#9CA3AF]">
                      <Check className="mt-0.5 size-4 shrink-0" style={{ color: 'var(--ready)' }} />
                      <span>Everything in Scale + custom terms</span>
                    </li>
                  )}
                </ul>

                <a
                  href={isEnterprise ? '/support' : appUrl(`/onboard?plan=${plan.id}`)}
                  className={`mt-8 w-full ${isPopular ? 'btn-primary' : 'btn-secondary'}`}
                >
                  {isEnterprise ? 'Contact sales' : plan.id === 'free' ? 'Start Free' : 'Start 7-day trial'}
                </a>

                {!isEnterprise && (
                  <p className="mt-2 text-center text-[10px] text-zinc-500">
                    {plan.id === 'free' ? 'No expiry · no card required' : '7-day trial · no credit card'}
                  </p>
                )}
              </div>
            )
          })}
        </div>

        <section className="glass mb-16 overflow-hidden rounded-3xl" aria-labelledby="plan-comparison-title">
          <div className="border-b border-white/10 p-6 md:p-8">
            <h2 id="plan-comparison-title" className="text-2xl font-semibold">Complete plan comparison</h2>
            <p className="mt-2 text-sm text-[#9CA3AF]">One allocation contract drives these rows, dashboard gates, API decisions, and database limits.</p>
          </div>
          <div className="overflow-x-auto" role="region" aria-label="Complete plan comparison table" tabIndex={0}>
            <table className="w-full min-w-[860px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-white/10 text-left">
                  <th scope="col" className="sticky left-0 z-10 bg-[#11151d] px-6 py-4 font-medium text-[#9CA3AF]">Capability</th>
                  {billingPlans.map((plan) => <th key={plan.id} scope="col" className="px-4 py-4 text-center font-semibold">{plan.name}</th>)}
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-white/[0.06]">
                  <th scope="row" className="sticky left-0 bg-[#11151d] px-6 py-3 text-left font-medium">Discovery &amp; commerce readiness</th>
                  {billingPlans.map((plan) => (
                    <td key={plan.id} className="px-4 py-3 text-center">
                      <Check className="mx-auto size-4 text-[var(--ready)]" aria-hidden="true" /><span className="sr-only">Included</span>
                    </td>
                  ))}
                </tr>
                <tr className="border-b border-white/[0.06]">
                  <th scope="row" className="sticky left-0 bg-[#11151d] px-6 py-3 text-left font-medium">Installed Shopify App Store connector</th>
                  {billingPlans.map((plan) => (
                    <td key={plan.id} className="px-4 py-3 text-center">
                      <Check className="mx-auto size-4 text-[var(--ready)]" aria-hidden="true" /><span className="sr-only">Included</span>
                    </td>
                  ))}
                </tr>
                {LIMIT_ROWS.map((row) => (
                  <tr key={row.key} className="border-b border-white/[0.06]">
                    <th scope="row" className="sticky left-0 bg-[#11151d] px-6 py-3 text-left font-medium">{row.label}</th>
                    {billingPlans.map((plan) => <td key={plan.id} className="px-4 py-3 text-center text-[#D1D5DB]">{formatPlanLimit(plan, row.key)}</td>)}
                  </tr>
                ))}
                {PLAN_FEATURES.map((feature) => (
                  <tr key={feature} className="border-b border-white/[0.06]">
                    <th scope="row" className="sticky left-0 bg-[#11151d] px-6 py-3 text-left font-medium">{FEATURE_LABELS[feature]}</th>
                    {billingPlans.map((plan) => {
                      const included = PLAN_FEATURE_MATRIX[plan.id][feature]
                      return (
                        <td key={plan.id} className="px-4 py-3 text-center">
                          {included ? <Check className="mx-auto size-4 text-[var(--ready)]" aria-hidden="true" /> : <Minus className="mx-auto size-4 text-zinc-600" aria-hidden="true" />}
                          <span className="sr-only">{included ? 'Included' : 'Not included'}</span>
                        </td>
                      )
                    })}
                  </tr>
                ))}
                <tr>
                  <th scope="row" className="sticky left-0 bg-[#11151d] px-6 py-3 text-left font-medium">Nexez settlement commission</th>
                  {billingPlans.map((plan) => <td key={plan.id} className="px-4 py-3 text-center font-medium">{plan.id === 'enterprise' ? '2% default; 1–2% negotiated' : `${plan.commissionPercent}%`}</td>)}
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <div className="glass mb-16 rounded-3xl p-8 md:p-12">
          <div className="grid items-center gap-8 md:grid-cols-2">
            <div>
              <div className="chip mx-0" style={{ color: 'var(--signal)' }}>Agent-ready checkout on every plan</div>
              <h2 className="mt-4 text-3xl font-semibold tracking-tight">Start selling before you subscribe.</h2>
              <p className="mt-3 text-sm text-[#9CA3AF]">
                Every published merchant gets an agent-readable sales surface and can sell through Nexez. Paid plans raise
                limits and reduce platform fees as sales grow.
              </p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-black/10 p-6">
              <div className="text-lg font-semibold">Start free.</div>
              <p className="mt-2 text-sm text-[#9CA3AF]">
                Nexez earns <span className="font-medium text-white">9% only when a transaction is completed through Nexez.</span>
              </p>
              <ul className="mt-5 space-y-3 text-sm text-[#9CA3AF]">
                <li className="flex gap-2"><Check className="mt-0.5 size-4 shrink-0 text-[var(--ready)]" /> Agent-readable publishing and checkout are available on Free</li>
                <li className="flex gap-2"><Check className="mt-0.5 size-4 shrink-0 text-[var(--ready)]" /> Upgrade for tools, scale, and better economics</li>
              </ul>
            </div>
          </div>
        </div>

        {/* Platform Fees Section */}
        <div className="glass prism rounded-3xl p-8 md:p-12">
          <div className="text-center">
            <div className="chip ready mx-auto">We only make money when you do</div>
            <h2 className="display mt-4">Transparent platform fees</h2>
            <p className="lede mx-auto mt-3 text-center">
              Lower platform fees as your sales grow.
            </p>
          </div>

          {/* Commission ladder - rendered from the billing catalog (single source
              of truth) so the advertised rate always matches what's actually charged. */}
          <div className="mt-10 grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
            {billingPlans.map((plan) => (
              <div key={plan.id} className="glass rounded-2xl p-5">
                <div className="text-sm font-medium" style={{ color: 'var(--ready)' }}>{plan.name}</div>
                <div className="mt-2 text-3xl font-semibold">{plan.id === 'enterprise' ? '1–2%' : `${plan.commissionPercent}%`}</div>
                <p className="mt-2 text-xs text-[#9CA3AF]">
                  {plan.id === 'enterprise'
                    ? 'Custom commercial terms based on volume and requirements.'
                    : `$100 sale through Nexez → $${plan.commissionPercent} to Nexez, $${100 - plan.commissionPercent} before payment processing.`}
                </p>
              </div>
            ))}
          </div>
          <p className="mt-4 text-center text-xs text-zinc-500">The transaction fee steps down as your plan goes up - higher tiers keep more of every sale.</p>

          <p className="mx-auto mt-8 max-w-3xl text-center text-sm text-[#9CA3AF]">
            Nexez commission applies only to sales completed through Nexez. Card-processing fees are separate.
            External-provider handoffs have no Nexez transaction fee unless separately agreed.
          </p>
        </div>

        {/* Trust & FAQ */}
        <div className="mt-16 grid gap-8 md:grid-cols-2">
          <div>
            <h2 className="font-semibold">Trusted by growing businesses</h2>
            <ul className="mt-4 space-y-2 text-sm text-[#9CA3AF]">
              <li>• Secure payments powered by Stripe</li>
              <li>• Free plan with no time limit</li>
              <li>• Cancel or downgrade anytime</li>
              <li>• Promotional Launch access never auto-charges</li>
            </ul>
          </div>
          <div>
            <h2 className="font-semibold">Common questions</h2>
            <div className="mt-4 space-y-4 text-sm">
              {pricingFaqs.map((faq) => (
                <div key={faq.question}>
                  <div className="font-medium">{faq.question}</div>
                  <div className="text-[#9CA3AF]">{faq.answer}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-12 text-center">
          <a href={appUrl('/onboard?plan=free')} className="btn-primary">
            Start Free
          </a>
          <p className="mt-2 text-xs text-zinc-500">Eligible verified businesses can receive complimentary Launch access while the campaign is available.</p>
        </div>
      </div>
    </main>
  )
}

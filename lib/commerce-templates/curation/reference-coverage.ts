import { candidate, score, type CommerceCurationCandidate } from './types'

/**
 * Reference-only launch coverage for buyer categories outside the canonical
 * 63-candidate architecture corpus. These records improve deterministic
 * simulator understanding; they never activate templates or supply merchant
 * facts, inventory, pricing, availability, or booking.
 */
export const commerceReferenceCoverageCandidates: CommerceCurationCandidate[] = [
  candidate(
    64,
    'events.custom-celebration-cake',
    'Custom Celebration Cake',
    'events-hospitality',
    'quote-required',
    'retain',
    'Custom food production with structural feasibility, servings, design, dietary constraints, delivery, setup, and deadline-sensitive quoting.',
    [
      'QUOTE_REQUIRED',
      'CONFIGURABLE',
      'UNIT_PRICING',
      'CAPACITY_LIMITED',
      'CUSTOM_INTAKE',
      'CUSTOMER_ASSETS',
      'DELIVERY',
      'SCHEDULED',
      'SERVICE_AREA',
      'ADD_ONS',
      'DEPOSIT',
    ],
    [
      'customer-requirements',
      'quantity-pricing',
      'conditional-fulfillment',
      'capacity-constraints',
      'structured-modifiers',
      'deposit-schedule',
    ],
    score(5, 5, 5, 5, 5, 5, 5, 4, 5, 5),
    {
      identityTerms: ['cake', 'cakes', 'baker', 'bakery', 'patisserie'],
      buyerDetails: [
        'event date and delivery window',
        'venue and setup access',
        'serving count',
        'cake height and tier structure',
        'flavor and dietary requirements',
        'design references and installation requirements',
      ],
    },
  ),
]

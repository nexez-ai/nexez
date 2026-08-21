# Nexez Commerce Library — 63-Candidate Curation Matrix

**Status:** Provisional curation v1 — **not canon**  
**Machine-readable source:** `lib/commerce-templates/curation/`  
**Runtime activation source:** `lib/commerce-templates/registry.ts`

## Purpose

This document turns the Commerce Intelligence charter's first-pass 63-candidate collection into an inspectable roadmap instrument. It does **not** create 63 active Commerce Templates, publish example merchants, or establish merchant facts.

The governing curation question is:

> **What does this template teach Nexez about commerce that the other templates do not?**

The active runtime registry remains intentionally limited to the seven proven pilot Commerce Templates. Every other entry below is a selection hypothesis that must earn later promotion through full canonical definition, merchant-truth design, transaction fixtures, buyer guardrails, and executable benchmark coverage.

## Scoring rubric

Every candidate is scored 1–5 on ten dimensions from the strategy charter:

1. customer familiarity;
2. agentic advantage;
3. merchant clonability;
4. commerce uniqueness;
5. transaction likelihood;
6. intent diversity;
7. schema stress;
8. primitive discovery;
9. cross-service adjacency;
10. operational distinctiveness.

The machine-readable records are the single source of truth for these dimension scores. `commerceCurationSelectionScore()` derives a 10–50 total on demand; this report intentionally does not duplicate those derived totals.

Scores are curation judgments, not marketplace rankings, merchant quality scores, or buyer relevance signals.

## Status semantics

- **pilot-active** — already exists as a versioned active Commerce Template and participates in the executable benchmark.
- **retain** — strong candidate to keep in the v1 learning set, but not active runtime truth.
- **overlap-review** — teaches useful mechanics but should be compared carefully against nearby candidates before canonical promotion.
- **replacement-review** — currently contributes too little distinct commercial information and should be challenged by a more informative replacement.

First-pass status counts:

| Status | Count |
|---|---:|
| pilot-active | 7 |
| retain | 49 |
| overlap-review | 5 |
| replacement-review | 2 |
| **Total** | **63** |

## Review queue

### Replacement review

| Candidate | Why challenge it |
|---|---|
| Interior Detail | Considerable mechanic overlap with the active Mobile Auto Detailing pilot; a replacement should add a more distinct transaction primitive. |
| Mobile Nail Service | Repeats familiar mobile appointment/configuration mechanics already exercised elsewhere with limited additional schema stress. |

### Overlap review

| Candidate | Review question |
|---|---|
| Deep Cleaning | Does its modifier density teach enough beyond recurring/move-out cleaning to justify a separate canonical template? |
| Hair Styling | Does provider expertise + hair configuration add enough beyond other appointment/personal-care models? |
| Commercial Cleaning | Should it remain distinct from Recurring Janitorial Service, or should one become the canonical B2B facility-cleaning pattern? |
| Property Turnover Service | Is this best represented as its own complex-project template or later as compound commerce across cleaning/repair/inspection? |
| Commercial Landscaping | Does it add enough beyond Lawn Care Subscription + contracted-service mechanics to earn a separate canonical slot? |

A simple baseline can still be valuable. Barber Appointment is intentionally retained even with relatively low schema stress because the library benefits from a clean fixed-price/provider-location appointment baseline. **Redundancy, not simplicity, is the main reason to challenge a candidate.**

## Candidate inventory

| # | Candidate | Semantic ID | Archetype | Status |
|---:|---|---|---|---|
| 1 | Recurring Home Cleaning | `home.recurring-home-cleaning` | recurring-service | pilot-active |
| 2 | Deep Cleaning | `home.deep-cleaning` | configurable-appointment | overlap-review |
| 3 | Move-Out Cleaning | `home.move-out-cleaning` | configurable-appointment | retain |
| 4 | Emergency Plumbing | `home.emergency-plumbing` | urgent-on-demand | retain |
| 5 | Handyman Visit | `home.handyman-visit` | quote-required | retain |
| 6 | Lawn Care Subscription | `home.lawn-care-subscription` | recurring-service | retain |
| 7 | Interior Painting | `home.interior-painting` | complex-project | retain |
| 8 | Appliance Repair | `home.appliance-repair` | consultation-first | retain |
| 9 | Moving Service | `home.moving-service` | complex-project | retain |
| 10 | Mobile Auto Detailing | `automotive.mobile-auto-detailing` | mobile-service | pilot-active |
| 11 | Interior Detail | `automotive.interior-detail` | configurable-appointment | replacement-review |
| 12 | Ceramic Coating | `automotive.ceramic-coating` | package-program | retain |
| 13 | Mobile Brake Service | `automotive.mobile-brake-service` | mobile-service | retain |
| 14 | Vehicle Diagnostic | `automotive.vehicle-diagnostic` | consultation-first | retain |
| 15 | Pre-Purchase Inspection | `automotive.pre-purchase-inspection` | fixed-appointment | retain |
| 16 | Window Tinting | `automotive.window-tinting` | configurable-appointment | retain |
| 17 | Fleet Detailing Contract | `automotive.fleet-detailing-contract` | contracted-service | retain |
| 18 | Mobile Tire Service | `automotive.mobile-tire-service` | urgent-on-demand | retain |
| 19 | Event Photography | `events.event-photography` | package-program | pilot-active |
| 20 | Wedding Videography | `events.wedding-videography` | package-program | retain |
| 21 | Private Chef | `events.private-chef` | quote-required | pilot-active |
| 22 | Event Catering | `events.event-catering` | unit-priced-service | retain |
| 23 | DJ Service | `events.dj-service` | fixed-appointment | retain |
| 24 | Event Planning | `events.event-planning` | complex-project | retain |
| 25 | Party Rentals | `events.party-rentals` | inventory-rental | retain |
| 26 | Proposal Setup | `events.proposal-setup` | configurable-appointment | retain |
| 27 | Corporate Event Production | `events.corporate-event-production` | complex-project | retain |
| 28 | Barber Appointment | `personal.barber-appointment` | fixed-appointment | retain |
| 29 | Hair Styling | `personal.hair-styling` | configurable-appointment | overlap-review |
| 30 | Mobile Makeup Artist | `personal.mobile-makeup-artist` | mobile-service | retain |
| 31 | Bridal Beauty Package | `personal.bridal-beauty-package` | package-program | retain |
| 32 | Massage Session | `personal.massage-session` | fixed-appointment | retain |
| 33 | Personal Training | `personal.personal-training` | recurring-service | retain |
| 34 | Private Yoga Instruction | `personal.private-yoga-instruction` | recurring-service | retain |
| 35 | Nutrition Coaching | `personal.nutrition-coaching` | package-program | retain |
| 36 | Mobile Nail Service | `personal.mobile-nail-service` | mobile-service | replacement-review |
| 37 | Business Strategy Session | `professional.business-strategy-session` | consultation-first | pilot-active |
| 38 | Monthly Bookkeeping | `professional.monthly-bookkeeping` | contracted-service | retain |
| 39 | Tax Preparation | `professional.tax-preparation` | package-program | retain |
| 40 | Brand Identity Package | `professional.brand-identity-package` | package-program | retain |
| 41 | Web Design Project | `professional.web-design-project` | complex-project | pilot-active |
| 42 | Video Production | `professional.video-production` | complex-project | retain |
| 43 | Copywriting Package | `professional.copywriting-package` | package-program | retain |
| 44 | Managed IT Support | `professional.managed-it-support` | contracted-service | retain |
| 45 | AI Automation Implementation | `professional.ai-automation-implementation` | complex-project | retain |
| 46 | Private Tutoring | `education.private-tutoring` | fixed-appointment | pilot-active |
| 47 | Test Prep Program | `education.test-prep-program` | package-program | retain |
| 48 | Music Lessons | `education.music-lessons` | recurring-service | retain |
| 49 | Language Lessons | `education.language-lessons` | recurring-service | retain |
| 50 | College Admissions Consulting | `education.college-admissions-consulting` | complex-project | retain |
| 51 | Dog Walking | `pet.dog-walking` | recurring-service | retain |
| 52 | Pet Sitting | `pet.pet-sitting` | package-program | retain |
| 53 | Mobile Pet Grooming | `pet.mobile-pet-grooming` | mobile-service | retain |
| 54 | Dog Training | `pet.dog-training` | package-program | retain |
| 55 | Commercial Cleaning | `commercial.commercial-cleaning` | contracted-service | overlap-review |
| 56 | Recurring Janitorial Service | `commercial.recurring-janitorial-service` | contracted-service | retain |
| 57 | Pressure Washing | `commercial.pressure-washing` | mobile-service | retain |
| 58 | Junk Removal | `commercial.junk-removal` | unit-priced-service | retain |
| 59 | Laundry Pickup & Delivery | `commercial.laundry-pickup-delivery` | delivery-service | retain |
| 60 | Pest Control | `commercial.pest-control` | recurring-service | retain |
| 61 | Property Turnover Service | `commercial.property-turnover-service` | complex-project | overlap-review |
| 62 | Commercial Landscaping | `commercial.commercial-landscaping` | contracted-service | overlap-review |
| 63 | Locksmith Service | `commercial.locksmith-service` | urgent-on-demand | retain |

The machine-readable files are authoritative for scores, tags, and gap signals; this table is a review surface.

## Launch coverage extensions

The canonical 63 records above remain the stable evidence corpus for capability counts, schema-gap analysis, and architecture autopsies. The public simulator may use an additive reference-coverage layer for buyer categories that are not yet represented in that corpus. This layer exists to preserve an understood service category while marketplace supply is thin; it does **not** activate a Commerce Template or establish a merchant, price, inventory, availability, service area, or booking path.

| # | Reference coverage | Semantic ID | Archetype | Buyer identity aliases |
|---:|---|---|---|---|
| 64 | Custom Celebration Cake | `events.custom-celebration-cake` | quote-required | cake, cakes, baker, bakery, patisserie |

Reference coverage records live separately from `commerceCurationCandidates` and are composed into `commerceReferenceCandidates` only for deterministic, explicitly labelled simulations. Promotion into the canonical architecture corpus or active runtime registry requires its own review.

## Measured capability hypotheses

These counts are calculated from the 63 curation records. They describe **how many candidate scenarios appear to exercise a capability**, not production feature completeness.

| Capability | Candidates |
|---|---:|
| CUSTOM_INTAKE | 52 |
| SCHEDULED | 45 |
| SERVICE_AREA | 36 |
| MOBILE | 34 |
| CONFIGURABLE | 24 |
| RECURRING | 19 |
| ADD_ONS | 18 |
| REMOTE | 16 |
| AVAILABILITY | 15 |
| DEPOSIT | 15 |
| CUSTOMER_ASSETS | 14 |
| CAPACITY_LIMITED | 14 |
| QUOTE_REQUIRED | 13 |
| SUBSCRIPTION | 11 |
| PROJECT_SCOPE | 10 |
| MILESTONE | 10 |
| FIXED_PRICE | 8 |
| CONTRACT | 8 |
| SLA | 7 |
| UNIT_PRICING | 7 |
| TRAVEL_FEE | 6 |
| INVENTORY | 6 |
| MULTI_PROVIDER | 5 |
| NEGOTIABLE | 5 |
| REVISION_LIMITS | 5 |
| URGENT | 4 |
| LICENSING | 4 |
| DELIVERY | 3 |
| MINIMUMS | 2 |

Capability frequency is evidence for the next schema audit, not permission to expand the schema automatically.

## Measured gap-signal hypotheses

Gap signals deliberately live outside the production `CommerceCapability` enum. They are questions for the capability/schema audit.

| Gap signal | Candidates |
|---|---:|
| customer-requirements | 31 |
| recurrence-terms | 19 |
| conditional-fulfillment | 16 |
| structured-modifiers | 13 |
| milestones | 13 |
| capacity-constraints | 13 |
| document-requirements | 13 |
| inventory-resource | 12 |
| regulated-qualification | 10 |
| quantity-pricing | 7 |
| contract-terms | 7 |
| inspection-first | 6 |
| minimum-charge | 5 |
| distance-travel-fee | 5 |
| multi-unit-booking | 5 |
| usage-rights | 5 |
| qualification-fit | 5 |
| multi-provider-orchestration | 4 |
| deposit-schedule | 2 |
| usage-pricing | 2 |
| route-optimization | 1 |

A signal appearing once is particularly weak evidence for a universal primitive. For example, `route-optimization` currently appears only in Laundry Pickup & Delivery; it should remain a curation observation until broader evidence justifies promotion.

## Promotion gate for non-pilot candidates

A curation candidate does **not** become a canonical active Commerce Template merely by being retained here. A later promotion should supply, at minimum:

- full `CommerceTemplate` definition and version;
- documented commercial reasoning and merchant-fact boundaries;
- deterministic buyer routing evidence;
- seller matching / template-intelligence behavior;
- canonical buyer eval scenarios and `mustNot` guardrails;
- benchmark-only configuration/pricing fixtures where applicable;
- reference-buyer provenance behavior;
- exact-head CI + E2E proof;
- evidence that any proposed schema primitive is broadly justified rather than category-specific convenience.

The active registry should expand incrementally so regressions identify which new commercial pattern exposed the problem.

## Next workstream

The next logical artifact is `COMMERCE_SCHEMA_GAP_ANALYSIS.md`: inspect the real Nexez offer, intake, checkout, negotiation, scheduling, and agent surfaces against the measured capability/gap frequencies above and classify each concept as:

1. already first-class;
2. representable but weakly structured;
3. missing but broadly useful;
4. category-specific and not yet justified.

That analysis should determine which primitives, if any, deserve implementation before the first post-pilot template is promoted.

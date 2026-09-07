import type { LearnArticle } from '../learn-content'

export const reviewsRatingsAndAiAgents: LearnArticle = {
  slug: 'reviews-ratings-and-ai-agents',
  metaTitle: 'Review Schema: The Rule Most Sites Break',
  metaDescription:
    'Google forbids local businesses from marking up their own reviews, and invites product sellers to submit theirs. Same signal, two opposite regimes.',
  title: 'Reviews, ratings, and the rule most business sites break',
  dek: 'Reviews are the signal small businesses obsess over most, and the one where the rules invert depending on what you sell. If you are a plumber or a clinic, marking up your own testimonials makes your page ineligible. If you sell products, Google explicitly invites you to submit your own reviews. Almost nobody knows which side they are on.',
  category: 'Agent readiness',
  publishedAt: '2026-09-05',
  updatedAt: '2026-09-05',
  readMinutes: 11,
  blocks: [
    {
      type: 'p',
      text: 'Somewhere on most small business websites there is a testimonials section, and underneath it, added by a plugin or a well-meaning developer, a block of JSON-LD claiming a 4.9 star average from 47 reviews. It is meant to put gold stars in search results. What it actually does, per Google’s own documentation, is make that page ineligible for the star feature it was added to earn.',
    },
    {
      type: 'p',
      text: 'The rule is unambiguous and it is quoted here rather than paraphrased, because the number of sites breaking it suggests almost nobody has read it: "If the entity that\'s being reviewed controls the reviews about itself, their pages" are ineligible for the star review feature. Local business ratings, Google adds, must be sourced directly from users, and must not rely on human editors to create, curate, or compile ratings information.',
    },
    {
      type: 'p',
      text: 'Then, one product line over, the same company runs a program that asks merchants to submit their own product reviews directly. Both things are true at once, and which one applies to you depends entirely on whether you sell a thing or do a job. This guide covers both regimes, where your reviews actually live if you cannot mark them up yourself, and the recency clause that turns a review from an asset into a depreciating one.',
    },
    { type: 'h2', text: 'The rule almost every small business site breaks' },
    {
      type: 'p',
      text: 'Four constraints sit on review markup, and the first is the one that bites:',
    },
    {
      type: 'ul',
      items: [
        'You cannot mark up reviews about yourself that you control. This is the self-serving review policy, and it is why the testimonials block with a rating attached earns nothing. The page is not penalized into oblivion, it is simply ineligible, which is worse in a quiet way: the markup sits there looking like work that was done.',
        'Ratings must come from users, not editors. Google names the failure explicitly: no human editors creating, curating, or compiling ratings information. A hand-picked selection of your nicest feedback, averaged by you, is exactly what that describes.',
        'Undisclosed incentivized reviews are prohibited, meaning anything written in exchange for money, a discount, a voucher or a free product without clear and prominent disclosure. The disclosure requirement is the part people miss; the incentive itself is not automatically disqualifying.',
        'Marked-up review content has to be visible on the page it is marked up on. Schema describing reviews a visitor cannot see is not eligible, which rules out the common pattern of injecting aggregate ratings sitewide from a database.',
      ],
    },
    {
      type: 'p',
      text: 'The required properties are worth knowing too, because half-complete markup fails silently. A Review needs an author (under 100 characters), an itemReviewed, and a reviewRating carrying a ratingValue. An AggregateRating needs an itemReviewed, a ratingValue, and either a ratingCount or a reviewCount. Templates for the types you can legitimately use are in the [JSON-LD guide](/learn/json-ld-for-ai-agents).',
    },
    {
      type: 'callout',
      tone: 'amber',
      title: 'What to do with the markup you already have',
      text: 'Remove the self-referential aggregateRating from your own pages. Not because a penalty is coming, but because it is doing nothing, it looks like a shortcut to anyone technical who inspects your source, and it is occupying the space where a legitimate signal should be. Keep the testimonials themselves. Real quotes from named customers are read by agents as prose whether or not they carry schema, and prose is not what the policy restricts.',
    },
    { type: 'h2', text: 'Where your reviews actually live' },
    {
      type: 'p',
      text: 'If you cannot publish your own ratings, the obvious question is where an agent gets them. Google documents four sources for local listings, and only one of them is your website:',
    },
    {
      type: 'table',
      headers: ['Source', 'What it contributes', 'Your leverage'],
      rows: [
        ['Crawled public web', 'Facts from your official site', 'Total, and it is the cheapest to fix'],
        ['Licensed third-party data', 'Directory and aggregator records', 'Indirect, via those platforms'],
        ['User contributions', 'Reviews, photos, videos, corrections', 'Earned, never authored'],
        ['Google’s own interactions', 'What Google observes about the place', 'None, and it is the one you cannot argue with'],
      ],
    },
    {
      type: 'p',
      text: 'Reviews sit squarely in the third row. They are user contributions, which is the entire logic behind the self-serving prohibition: a review is evidence precisely because you did not write it. The moment you can author it, it stops being worth anything to the system reading it, and the policy is just that fact written down.',
    },
    {
      type: 'p',
      text: 'Google then runs its own layer on top, analyzing reviews on a place and compiling a summary highlighting common sentiment and tips. Which means the thing a customer hears when they ask an assistant about you is not your rating. It is a paragraph synthesized from what other people said, and nobody at your business approved the wording. [Where the recommendation actually comes from](/learn/ai-search-local-businesses) covers the wider sourcing picture.',
    },
    {
      type: 'cta',
      title: 'See what an agent can actually read about you',
      text: 'The free Nexez scanner fetches your site the way an agent does and scores what comes back: crawler access, server-rendered content, structured data, and machine-readable offers. About a minute, no signup.',
      href: '/scan',
      label: 'Scan your site free',
    },
    { type: 'h2', text: 'The recency clause nobody reads' },
    {
      type: 'p',
      text: 'Google refreshes those review summaries based on reviews from the past year. Read that as a depreciation schedule. Two hundred five-star reviews collected in 2023, with nothing since, do not produce a glowing summary in 2026; they produce a thin one, assembled from whatever trickle arrived recently, which is disproportionately the people annoyed enough to bother.',
    },
    {
      type: 'p',
      text: 'This reframes the job. A lifetime star average is a vanity number. A steady arrival rate is the actual asset, because it is what keeps the summary current, representative, and favorable. A business collecting four reviews a month indefinitely beats a business that collected two hundred once, and the second business usually thinks it is winning.',
    },
    { type: 'h2', text: 'If you sell products, the rules invert' },
    {
      type: 'p',
      text: 'Everything above governs businesses being reviewed as businesses. Product reviews run on a completely separate track, and on that track Google asks you to submit your own. The requirements are specific enough to plan against:',
    },
    {
      type: 'ol',
      items: [
        'A minimum of 50 reviews across all of your products before ratings can show on Shopping or Ads. This is an account-level floor, not a per-product one, which is friendlier to a long tail than most people assume.',
        'Two submission routes: a supported reviews aggregator that pushes them for you, or direct submission through Merchant Center if you do not use one.',
        'Unique product identifiers on every review, GTIN preferred, or brand plus MPN. This is the step that fails most often, and it fails silently.',
        'Monthly uploads with updated reviews to stay eligible. Same recency logic as the local side, expressed as a cadence requirement rather than a summary window.',
        'The domain on your review data must match your registered Merchant Center account, and expect two to four weeks before anything appears.',
      ],
    },
    {
      type: 'p',
      text: 'The reason for the inversion is worth understanding rather than memorizing. A product is a thing that exists independently of you, sold by many parties, and identified by a GTIN, so a review attaches to the product rather than to the seller and can be pooled across merchants. A service is inseparable from the business performing it, so a review of the service is a review of you, and letting you author it would be circular. [Product feeds for AI agents](/learn/product-feeds-for-ai-agents) covers the surrounding catalog work.',
    },
    { type: 'h2', text: 'What to actually do' },
    {
      type: 'ol',
      items: [
        'Audit what you are currently publishing. Search your own source for aggregateRating and check whether the thing being rated is you. If it is, remove it.',
        'Fix your Business Profile first, since it is the row in that table where user contributions land and the only one you can meaningfully influence without doing someone else’s work.',
        'Build a review arrival habit rather than a review campaign. Ask at the point the job is finished and the customer is pleased, every time, without an incentive attached. The disclosure rules make incentives more trouble than they are worth at small scale.',
        'If you sell products, count your reviews against the 50 floor and check whether your identifiers are actually on them. If you are under the floor, that is the whole project; nothing else in the program matters yet.',
        'Leave your testimonials up, unmarked. They are read as prose, they persuade humans, and they cost nothing.',
      ],
    },
    { type: 'h2', text: 'What reviews cannot do for you' },
    {
      type: 'p',
      text: 'Reviews decide whether you make the shortlist. They do not decide what happens next, and the gap between those two things is where most of the loss actually occurs. An agent that has been convinced you are the right plumber still has to find out whether you can come on Tuesday, and if the answer to that lives nowhere it can reach, a perfect rating buys you a place on a list you then fall off.',
    },
    {
      type: 'p',
      text: 'That second step is a different problem with a different fix, covered in [when Google’s AI calls your business](/learn/when-ai-agents-call-your-business). Worth holding both in mind, because the review work is slow and compounding while the availability work is fast and structural, and teams routinely spend a year on the first while the second stays broken.',
    },
    {
      type: 'cta',
      title: 'The half reviews cannot cover',
      text: 'Nexez publishes your business as agent-legible, agent-transactable listings from a single source: JSON-LD, llms.txt, agent.json, OpenAPI, a per-merchant MCP server, and ACP plus UCP feeds, with real Stripe checkout and Calendly-backed scheduling. Reviews get you shortlisted; this is what happens after. Start on Free with no card; paid plans include a 7-day trial.',
      href: '/how-it-works',
      label: 'See how it works',
    },
  ],
  faqs: [
    {
      question: 'Can I add review schema to my own website?',
      answer:
        'Not for reviews about your own business that you control. Google’s documentation states that when the entity being reviewed controls the reviews about itself, those pages are ineligible for the star review feature, and that local business ratings must be sourced directly from users rather than created, curated or compiled by human editors. The testimonials themselves can stay; it is the rating markup that earns nothing.',
    },
    {
      question: 'Why does Google let product sellers submit reviews but not service businesses?',
      answer:
        'Because a product exists independently of whoever sells it and is identified by a GTIN, so a review attaches to the product and can be pooled across merchants. A service is inseparable from the business performing it, so a review of the service is a review of you, and authoring it yourself would be circular. That is why Product Ratings has a submission process and local business review markup has a prohibition.',
    },
    {
      question: 'How many reviews do I need for product ratings to show?',
      answer:
        'A minimum of 50 across all of your products, which is an account-level floor rather than a per-product one, so a long tail of lightly reviewed items still counts toward it. You submit either through a supported reviews aggregator or directly through Merchant Center, every review needs a unique product identifier such as a GTIN or brand plus MPN, uploads must continue monthly, and expect two to four weeks before ratings appear.',
    },
    {
      question: 'Do old reviews still help me?',
      answer:
        'Less than most people assume. Google refreshes its review summaries based on reviews from the past year, so a large historic average with no recent arrivals produces a thin, unrepresentative summary rather than a glowing one. Treat a steady arrival rate as the asset and the lifetime average as a vanity number, because the summary a customer actually hears is assembled from the recent window.',
    },
    {
      question: 'Can I offer a discount in exchange for a review?',
      answer:
        'Only with clear and prominent disclosure. Google prohibits fake or undisclosed incentivized reviews, defined as those written in exchange for a benefit such as money, discounts, vouchers or free products that do not clearly disclose the incentivization. The incentive is not automatically disqualifying, the concealment is, and at small-business scale the disclosure overhead usually outweighs the benefit.',
    },
    {
      question: 'Where do AI assistants get reviews about my business?',
      answer:
        'Not from your website. Google documents four sources for local listings: crawled public web content including your official site, licensed third-party data, user contributions, and Google’s own interactions with the place. Reviews are user contributions, and Google then compiles them into a summary highlighting common sentiment and tips, which is what a customer hears rather than your rating number.',
    },
    {
      question: 'Will good reviews get an agent to book me?',
      answer:
        'They get you shortlisted, which is not the same thing. An agent convinced you are the right choice still has to establish whether you are available and what the job costs, and if that information is not reachable it moves on to a business it can actually transact with. Review work is slow and compounding; availability is fast and structural, and the second is where most of the loss happens.',
    },
  ],
}

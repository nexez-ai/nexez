import type { LearnArticle } from '../learn-content'

export const pricingForAiAgents: LearnArticle = {
  slug: 'pricing-for-ai-agents',
  metaTitle: 'Pricing for AI Agents: The Quote Problem',
  metaDescription:
    'A price you do not publish still gets established. You only get to choose whether you are the source, and whether your four copies of it agree.',
  title: 'Pricing for AI agents, and the quote problem',
  dek: 'Price is the field that decides whether you are comparable at all, and it is the one most small businesses deliberately withhold. That withholding does not remove you from the comparison. It removes you from the source of the number being compared.',
  category: 'Agentic commerce',
  publishedAt: '2026-09-07',
  updatedAt: '2026-09-07',
  readMinutes: 11,
  blocks: [
    {
      type: 'p',
      text: 'Two things are true about price in 2026 and they pull in opposite directions. Agents compare on it, relentlessly, because it is the one attribute that is unambiguous across vendors. And a large share of businesses, especially service businesses, refuse to publish one, on the entirely reasonable grounds that the real answer depends on the job.',
    },
    {
      type: 'p',
      text: 'The resolution is uncomfortable. Withholding a price does not take you out of the comparison. It takes you out of the position of being the source. Google will reconcile a product price across four separate surfaces and disapprove you when they disagree, and for a service business with no feed at all its automated systems will simply call you and ask what things cost. Either way a number gets established. The only variable is whether it is yours.',
    },
    { type: 'h2', text: 'Four places your price exists' },
    {
      type: 'p',
      text: 'If you sell products, your price is not one value. It is four copies of a value, and Google checks them against each other by crawling your product landing pages and your checkout process, then comparing what it finds against your data source and your structured data.',
    },
    {
      type: 'table',
      headers: ['Where', 'What it is', 'How it breaks'],
      rows: [
        ['Merchant Center feed', 'The price attribute you submit', 'Stale after a sale ends'],
        ['Landing page', 'The most prominent price shown', 'Location-based dynamic pricing'],
        ['Structured data', 'The Product markup on that page', 'Never updated when the page was'],
        ['Checkout', 'What the buyer is finally charged', 'Fees appear only at the last step'],
      ],
    },
    {
      type: 'p',
      text: 'The consequence of disagreement is more severe than most merchants expect. Products hit with a price mismatch get a preemptive disapproval, which removes them from Shopping ads and from free listings, so the penalty is not confined to the paid surface. Accounts get warned and then suspended, and once you have fixed things a review takes about seven business days, during which you are still absent.',
    },
    { type: 'h2', text: 'Google crawls your checkout' },
    {
      type: 'p',
      text: 'This is the part that surprises people, so it is worth stating plainly: the crawl does not stop at the product page. Google walks the checkout flow, including pre-selected variants, and the specific thing it is looking for is whether the price at checkout is higher than the price on the landing page.',
    },
    {
      type: 'p',
      text: 'That makes the classic conversion tactic a policy violation. Service fees, handling fees, carrier fees, state fees: they either go into the shipping attribute or into the base product price, and if they go into the base price they have to be visible that way on the landing page too, not itemized for the first time at checkout. The rule is not really about tax accounting. It is a no-surprises rule with a crawler behind it.',
    },
    {
      type: 'callout',
      tone: 'amber',
      title: 'Why agents make this existential rather than annoying',
      text: 'A human who reaches checkout and finds an unexpected $14 fee is irritated and usually completes the purchase anyway, because they have already invested the effort. An agent comparing three vendors has no sunk cost, no irritation, and no loyalty. It re-ranks and moves. The fee that used to cost you a fraction of your conversion rate now costs you the entire comparison, and it does so silently, because nobody abandons a cart you never saw them reach.',
    },
    { type: 'h2', text: 'What "call for a quote" actually does' },
    {
      type: 'p',
      text: 'Service businesses have no feed, so none of the above applies mechanically. What applies instead is simpler and harsher: an agent asked to compare three providers will compare the ones that gave it something to compare.',
    },
    {
      type: 'p',
      text: 'And the number gets sourced anyway. Google documents that its automated systems call businesses to verify pricing and availability, and at I/O it said Search would surface latest pricing and availability for local services with links to finish booking. So the choice was never between publishing a price and keeping it private. It is between publishing a price and having one collected from you by phone, or inferred from a directory, or simply skipped in favor of the competitor who answered.',
    },
    {
      type: 'p',
      text: 'The honest objection to publishing is that the real price genuinely varies. The answer is that a range is a price. So is a starting-at. So is a fixed fee for the diagnostic visit that establishes the real number. All three are comparable; "it depends" is not, and an agent cannot relay it to the person waiting. The phone side of this is covered in [when Google’s AI calls your business](/learn/when-ai-agents-call-your-business).',
    },
    {
      type: 'cta',
      title: 'See what an agent reads on your pages',
      text: 'The free Nexez scanner fetches your site the way an agent does and scores what comes back: crawler access, server-rendered content, structured data, and machine-readable offers. About a minute, no signup.',
      href: '/scan',
      label: 'Scan your site free',
    },
    { type: 'h2', text: 'Making a price actionable rather than decorative' },
    {
      type: 'p',
      text: 'A decorative price is a number on a page. An actionable price is one an agent can put into a comparison without guessing. The difference is four things, and only the first is the number:',
    },
    {
      type: 'ol',
      items: [
        'A currency and a unit. "$180" is ambiguous across per hour, per visit, per room and per month, and the unit is where service pricing loses agents most often.',
        'What is included at that price, stated positively. An agent constructing a comparison needs the boundary of the offer, not a list of exclusions buried in terms.',
        'What moves it, stated as a condition rather than a disclaimer. "Add $60 after 6pm and at weekends" is machine-readable in a way that "surcharges may apply" is not.',
        'Structured data carrying the same number as the page. Google explicitly names unaligned structured data as a cause of mismatch, and it is the copy most likely to be stale because nobody looks at it. Templates are in the [JSON-LD guide](/learn/json-ld-for-ai-agents).',
      ],
    },
    { type: 'h2', text: 'The freshness problem, which is the actual failure mode' },
    {
      type: 'p',
      text: 'The named causes of price mismatch are mundane and they are all timing: a feed that did not update when a sale ended, prices that vary by location, structured data left behind by a page edit, a variant preselection that shows one price and charges another. None of these is a pricing strategy problem. They are synchronization problems, and they are why Google recommends the Inventory API or the Content API for anything that changes often rather than a scheduled feed, plus Automatic Item Updates to absorb small discrepancies.',
    },
    {
      type: 'p',
      text: 'Which points at the structural fix rather than the checklist. Four copies of a number, updated by four different processes on four different schedules, will disagree eventually. The businesses that do not have this problem are the ones where the four copies are generated from one source, so there is nothing to fall out of sync. [Product feeds for AI agents](/learn/product-feeds-for-ai-agents) covers the catalog side of the same argument.',
    },
    { type: 'h2', text: 'What to do' },
    {
      type: 'ol',
      items: [
        'Buy something from yourself. Walk your own checkout on a live product and compare the final total against the landing page. This takes four minutes and it is the check nobody runs.',
        'Look at your Product structured data and confirm the price in it matches the page it is on. It is the copy most likely to be silently wrong.',
        'If you sell services, publish a range, a starting-at, or a fixed diagnostic fee. Pick whichever is true. Any of them makes you comparable.',
        'State the conditions that move the price as conditions, with numbers, near the price itself.',
        'If prices change often, move off scheduled feeds and onto an API, because the mismatch window is exactly the gap between your site updating and your feed catching up.',
      ],
    },
    {
      type: 'p',
      text: 'The thread running through all of this is that price stopped being a marketing decision and became a data integrity one. It used to be that a vague price cost you some enquiries and a surprise fee cost you some carts. Both were survivable because humans are forgiving, curious, and already halfway through. Agents are none of those things, and they are increasingly the first reader. The number has to be true in four places, or present at all, before any of the persuasion you spent money on gets a chance to work.',
    },
    {
      type: 'cta',
      title: 'One price, everywhere it needs to be',
      text: 'Nexez publishes your business as agent-legible, agent-transactable listings from a single source: JSON-LD, llms.txt, agent.json, OpenAPI, a per-merchant MCP server, and ACP plus UCP feeds, with real Stripe checkout and Calendly-backed scheduling. The four copies cannot disagree, because there is only one. Start on Free with no card; paid plans include a 7-day trial.',
      href: '/how-it-works',
      label: 'See how it works',
    },
  ],
  faqs: [
    {
      question: 'Does Google really check my checkout page prices?',
      answer:
        'Yes. Google crawls product landing pages and the checkout process, including pre-selected variants, and compares what it finds against your data source and your structured data. The specific violation is checkout prices being higher than landing page prices, and the consequence is an account warning or suspension rather than a quiet ranking adjustment.',
    },
    {
      question: 'Where do I put shipping, handling and service fees?',
      answer:
        'Either bundled into the shipping attribute or incorporated into the base product price. If they are in the base price they must appear that way on the landing page as well, not itemized for the first time at checkout. Google treats fees that only materialize at the final step as a price inconsistency, which makes the common practice of revealing charges late a policy problem rather than a conversion tactic.',
    },
    {
      question: 'What happens if my feed price and my site price disagree?',
      answer:
        'The product receives a preemptive disapproval, which removes it from Shopping ads and from free listings, so both the paid and unpaid surfaces are affected. The account is warned with a deadline and can be suspended if it is not fixed. After you correct it, a review takes roughly seven business days, during which the products remain absent.',
    },
    {
      question: 'I run a service business and my prices genuinely vary. What should I publish?',
      answer:
        'A range, a starting-at figure, or a fixed price for the diagnostic visit that establishes the real number. All three are comparable, which is the only property that matters here. "Contact us for a quote" is not a private price, it is an abstention from every comparison that happens without a phone call, and Google documents that its automated systems call businesses to verify pricing anyway.',
    },
    {
      question: 'Why do agents punish surprise fees more than humans do?',
      answer:
        'Because they have no sunk cost. A person who reaches checkout has already invested time and usually completes the purchase despite an unexpected charge. An agent comparing vendors simply re-ranks and moves on, and you never see the abandonment because there was no cart. The fee that cost you a slice of conversion now costs you the whole comparison, silently.',
    },
    {
      question: 'How often do I need to update prices?',
      answer:
        'Fast enough that your site and your product data change together. Google names stale feeds after a sale ends as a common cause of mismatch and recommends the Inventory API or Content API rather than scheduled feeds for anything that changes frequently, plus Automatic Item Updates to absorb minor discrepancies. The exposure window is precisely the gap between your site updating and your feed catching up.',
    },
    {
      question: 'Does structured data pricing matter if my feed is correct?',
      answer:
        'Yes, and it is the copy most likely to be wrong. Google names unaligned structured data as a cause of price mismatch, and markup is rarely re-checked when a page is edited because nobody looks at it. Verify it matches the visible page price with the Rich Results Test rather than assuming a plugin kept it current.',
    },
  ],
}

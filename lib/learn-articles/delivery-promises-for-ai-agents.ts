import type { LearnArticle } from '../learn-content'

export const deliveryPromisesForAiAgents: LearnArticle = {
  slug: 'delivery-promises-for-ai-agents',
  metaTitle: 'Delivery Dates AI Agents Can Actually Use',
  metaDescription:
    'Ships in 1 to 2 days is not a delivery promise. An agent asked whether something arrives before Friday has to do arithmetic, from fields you publish.',
  title: 'Delivery dates an AI agent can actually use',
  dek: 'Almost every product page states a delivery expectation, and almost none of them states it in a form a machine can compute with. The difference matters more than it sounds, because a shopper reads "ships in 1 to 2 days" and forms a rough expectation, while an agent asked whether something arrives before Friday has to produce a date. It will either do the arithmetic from fields you published, or it will guess, or it will quietly recommend a competitor who made the sum easy.',
  cardSummary:
    'A delivery date is a computation, not a property. Here are the four operands an agent needs from you.',
  category: 'Agentic commerce',
  publishedAt: '2026-09-21',
  updatedAt: '2026-09-21',
  readMinutes: 10,
  blocks: [
    {
      type: 'p',
      text: 'Most of what a merchant publishes is a state. Your price is a number. Your hours are a schedule. Your return window is a count of days. Those sit still, and stating them clearly is mostly a matter of stating them at all.',
    },
    {
      type: 'p',
      text: 'A delivery date is not like that. It is the output of a small calculation that has to be run fresh at the moment somebody asks, using the current time, the buyer’s location, and four separate facts about how you operate. Publish the answer instead of the operands and it is stale within hours. Publish nothing and the agent has to invent something, which it will do with more confidence than you would like.',
    },
    { type: 'h2', text: 'A delivery date is a computation, not a property' },
    {
      type: 'p',
      text: 'Schema.org models this properly, which is unusual and helpful. Shipping information hangs off an offer as OfferShippingDetails, and the timing half of it lives in a ShippingDeliveryTime object carrying four properties that are exactly the four operands:',
    },
    {
      type: 'table',
      headers: ['Property', 'What it contributes', 'Shape'],
      rows: [
        ['cutoffTime', 'Whether today still counts', 'ISO 8601 time with offset'],
        ['handlingTime', 'How long before it leaves you', 'minValue, maxValue, unitCode DAY'],
        ['transitTime', 'How long the carrier takes', 'minValue, maxValue, unitCode DAY'],
        ['businessDays', 'Which days any of this happens on', 'Opening hours markup'],
      ],
    },
    {
      type: 'p',
      text: 'Give an agent those four and today’s date and it can answer the question a buyer actually asked. Give it a sentence on a page and it is reading tea leaves. The rest of OfferShippingDetails carries the cost side, shippingRate as a monetary amount and shippingDestination as a defined region, so the same block answers what it costs and where you will send it.',
    },
    {
      type: 'code',
      language: 'json',
      content: `{
  "@type": "OfferShippingDetails",
  "shippingRate": { "@type": "MonetaryAmount", "value": 0, "currency": "USD" },
  "shippingDestination": { "@type": "DefinedRegion", "addressCountry": "US" },
  "deliveryTime": {
    "@type": "ShippingDeliveryTime",
    "cutoffTime": "16:00:00-05:00",
    "handlingTime": { "@type": "QuantitativeValue", "minValue": 0, "maxValue": 1, "unitCode": "DAY" },
    "transitTime": { "@type": "QuantitativeValue", "minValue": 2, "maxValue": 4, "unitCode": "DAY" }
  }
}`,
    },
    {
      type: 'p',
      text: 'Note that none of this is marked required. Google lists the shipping properties as recommended, which is the same structural reason so few merchants publish a [return policy](/learn/return-policies-for-ai-agents) either. Nothing is withheld from you for leaving it blank, so it stays blank, and the absence only shows up as answers you never hear about.',
    },
    { type: 'h2', text: 'Handling time is counted in business days, which makes businessDays load-bearing' },
    {
      type: 'p',
      text: 'This is the part that quietly breaks. The specification for handlingTime says that by common convention it means business days, counting only days when the business normally operates. So handlingTime of one to two days is not a duration. It is a duration in a unit you have not defined.',
    },
    {
      type: 'callout',
      tone: 'amber',
      title: 'A handling time without operating days is an ambiguous number',
      text: 'If you ship Monday to Friday and someone orders Friday evening, a handling time of one to two business days means Monday or Tuesday, not Saturday or Sunday. An agent that does not know your operating days will either assume seven-day operation and promise a date you will miss, or assume five and quote you as slower than you are. Both are your fault rather than its, and both are fixed by publishing businessDays alongside the number.',
    },
    {
      type: 'p',
      text: 'The fix is small and almost nobody does it: businessDays is expressed through the same opening hours markup you may already publish for a storefront, so for many businesses this is a matter of pointing an existing fact at a second use rather than producing a new one.',
    },
    { type: 'h2', text: 'The cutoff time is the field that earns its keep in Q4' },
    {
      type: 'p',
      text: 'cutoffTime is the order deadline after which you stop processing for the day, and the specification states the consequence plainly: for orders placed after the cutoff, one day is added to the delivery estimate. It is written as an ISO 8601 time including the offset, so a 4pm Eastern cutoff is 16:00:00-05:00, and the offset is not optional decoration. Without it, a merchant on the east coast and an agent computing in UTC disagree by five hours in exactly the window where the answer flips.',
    },
    {
      type: 'callout',
      tone: 'signal',
      title: 'Nine weeks to peak, and this is the highest-leverage field on the list',
      text: 'Order-by dates are the most consequential machine-readable fact of the fourth quarter, and they are almost universally published as a banner image or a line of marketing copy that no agent will ever parse. A buyer asking an assistant whether something arrives before a specific date is asking the single question your cutoff time answers. Publishing it now, with the offset, is a couple of hours of work against the period when getting it right is worth the most.',
    },
    {
      type: 'cta',
      title: 'See which of your facts an agent can actually read',
      text: 'The free Nexez scanner fetches your site the way an agent does and scores what comes back: crawler access, server-rendered content, structured data, and machine-readable offers. About a minute, no signup.',
      href: '/scan',
      label: 'Scan your site free',
    },
    { type: 'h2', text: 'Saying you do not ship somewhere beats saying nothing' },
    {
      type: 'p',
      text: 'OfferShippingDetails carries a doesNotShip boolean, described as indicating when shipping to a particular destination is not available. It looks like a field for admitting a limitation. It is closer to a filter you get to apply on your own behalf.',
    },
    {
      type: 'p',
      text: 'The reason is asymmetric cost. An agent that does not know you exclude a region may recommend you to a buyer there, who then spends time on a checkout that cannot complete, and you spend time on a support message. Nobody gains from that exchange. Stating the exclusion removes you from a set of results you were never going to convert, which is the cheapest kind of qualification there is.',
    },
    { type: 'h2', text: 'Three places the numbers live, and which one wins' },
    {
      type: 'p',
      text: 'If you sell products, your shipping data exists in more than one place, and the precedence is worth knowing before you spend an afternoon editing the copy that loses.',
    },
    {
      type: 'ul',
      items: [
        'Account-level settings in Merchant Center, which apply broadly across your products.',
        'The shipping attribute in your product feed, which Google documents as overriding account-level settings for the matching location when the price sub-attribute is submitted.',
        'On-site structured data on the product page, which is the copy an agent reading your site directly will find, and which nothing in your feed corrects.',
      ],
    },
    {
      type: 'p',
      text: 'That third line is where the drift happens. Merchants update the feed because a disapproval forced them to and leave the page markup carrying last year’s numbers, and the page is what a crawler sees. [Product feeds for AI agents](/learn/product-feeds-for-ai-agents) covers why consistency between those expressions is a hard requirement rather than a tidiness preference.',
    },
    { type: 'h2', text: 'The conservative number is the profitable one' },
    {
      type: 'p',
      text: 'Everywhere else in retail the instinct is to make the claim as attractive as it can honestly be. Delivery is the place to invert that, and the reason is what happens to the number after you publish it.',
    },
    {
      type: 'p',
      text: 'When an assistant tells a buyer the item arrives Thursday, the buyer does not hear an estimate derived from a range you published. They hear a commitment, made by a neutral party, on your behalf. A missed date on an ordinary purchase is an annoyance. A missed date on a gift is a refund, a support thread and a review, and the review outlasts the order by years, which [reviews and ratings](/learn/reviews-ratings-and-ai-agents) covers in its own right.',
    },
    {
      type: 'p',
      text: 'So publish the maxValue you actually hit rather than the one you hit on a good week. A range you beat is a pleasant surprise that costs you nothing. A range you miss is a refund with a permanent record attached, and the agent will have quoted the optimistic end of it.',
    },
    { type: 'h2', text: 'What to do, in order' },
    {
      type: 'ol',
      items: [
        'Find your real numbers before writing any markup. Pull the last ninety days of orders and measure the actual gap between order and dispatch, and dispatch and delivery. Most merchants discover their published handling time was set years ago by someone guessing.',
        'Publish businessDays first, because every day count above it is ambiguous without it. For a storefront this is the opening hours you already have.',
        'Set cutoffTime with the UTC offset included. A time without an offset is a time in an unspecified zone, and this field is only useful near the boundary.',
        'State handlingTime and transitTime as separate ranges rather than collapsing them into one total. They change for different reasons, and an agent can only reason about a late carrier if it knows which half is which.',
        'Set doesNotShip for regions you genuinely exclude, rather than leaving an agent to find out at checkout.',
        'Reconcile the three copies: account settings, the feed attribute, and the markup on the page. Check the page last, because it is the one that silently keeps old numbers.',
        'Use the maxValue you hit reliably, not the one you hit occasionally, and revisit it after peak with real data rather than with optimism.',
      ],
    },
    {
      type: 'p',
      text: 'The whole job is perhaps an afternoon, and the reason it is worth an afternoon is that it converts a sentence nobody can compute with into four numbers anybody can. A buyer asking whether something arrives in time is a buyer with their wallet already out. The only thing standing between that question and your answer is whether you published the operands.',
    },
    {
      type: 'cta',
      title: 'Publish the operands once, in every format a machine reads',
      text: 'Nexez publishes your business as agent-legible, agent-transactable listings from a single source: JSON-LD, llms.txt, agent.json, OpenAPI, a per-merchant MCP server, and ACP plus UCP feeds, with real Stripe checkout and Calendly-backed scheduling. One set of facts, updated in one place, with no stale copies left behind. Start on Free with no card; paid plans include a 7-day trial.',
      href: '/how-it-works',
      label: 'See how it works',
    },
  ],
  faqs: [
    {
      question: 'Why is "ships in 1 to 2 days" not enough for an AI agent?',
      answer:
        'Because a buyer asks when something will arrive, not how long it takes to leave you. Producing a date requires the order cutoff, the handling time, the transit time and the days you actually operate, combined with the current time and the destination. A sentence on a page supplies at most one of those, so an agent either guesses the rest or recommends a merchant whose numbers were easier to compute with.',
    },
    {
      question: 'What exactly does cutoffTime do?',
      answer:
        'It is the time of day after which you stop processing orders, and the specification states that orders placed after it get one day added to the delivery estimate. It is written as an ISO 8601 time including the UTC offset, so a 4pm Eastern cutoff is 16:00:00-05:00. The offset matters: without it, the field is a time in an unspecified zone, and the only moments it changes an answer are exactly the ones near the boundary.',
    },
    {
      question: 'Is handling time counted in calendar days or business days?',
      answer:
        'Business days. The specification says that by common convention handlingTime counts only days when the business normally operates. That makes businessDays load-bearing rather than optional, because a handling time of one to two days means something different for a five-day operation than a seven-day one, and an agent with no operating days to work from has to assume one.',
    },
    {
      question: 'Is shipping structured data required?',
      answer:
        'Google lists the OfferShippingDetails properties as recommended rather than required, which is precisely why so few merchants publish them. Nothing is withheld for leaving them blank. The cost is invisible: it appears as questions about arrival dates that got answered with someone else’s numbers.',
    },
    {
      question: 'My feed and my product page disagree about shipping. Which one wins?',
      answer:
        'It depends who is asking. Google documents that the shipping attribute in your feed overrides account-level Merchant Center settings for the matching location when the price sub-attribute is submitted. But an agent reading your site directly sees the markup on the page, which no feed correction touches. Treat all three as copies that must agree, and check the page last, since it is the one that silently keeps old numbers.',
    },
    {
      question: 'Should I publish an optimistic delivery range or a conservative one?',
      answer:
        'Conservative, which inverts the usual retail instinct. Once an assistant quotes a date to a buyer, they hear a commitment made by a neutral party rather than an estimate you offered. Beating a published range costs you nothing and reads as good service. Missing one produces a refund, a support thread and a review that outlives the order.',
    },
    {
      question: 'What is doesNotShip for?',
      answer:
        'It is a boolean indicating that shipping to a particular destination is not available, and it is better understood as qualification than as admission. Without it an agent may recommend you to a buyer in a region you exclude, who reaches a checkout that cannot complete. Stating the exclusion removes you only from results you were never going to convert.',
    },
  ],
}

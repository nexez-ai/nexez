import type { LearnArticle } from '../learn-content'

export const returnPoliciesForAiAgents: LearnArticle = {
  slug: 'return-policies-for-ai-agents',
  metaTitle: 'How AI Agents Read Your Return Policy',
  metaDescription:
    'Publish nothing and Google infers a return policy for you. The typed fields agents actually read, and the events you owe after the sale.',
  title: 'How AI agents read your return policy',
  dek: 'Returns are filed under after-sales, which is why almost nobody treats them as a discovery problem. In an agentic purchase the order reverses: the agent asks whether the item can come back before it decides to buy, and it reads the answer from typed fields rather than from your returns page. Most merchants have never written those fields, and a surprising number have a policy published anyway, by Google, on their behalf.',
  cardSummary:
    'Publish nothing and Google infers a return policy for you. Here are the fields agents actually read.',
  category: 'Agentic commerce',
  publishedAt: '2026-09-17',
  updatedAt: '2026-09-17',
  readMinutes: 11,
  blocks: [
    {
      type: 'p',
      text: 'A human shopper reads your return policy after something goes wrong. An agent reads it before deciding whether to put the item in the cart at all, because returnability is a filterable attribute in exactly the way that price and availability are. Ask an assistant for running shoes you can send back if they do not fit and you have handed it a constraint, and it will satisfy that constraint using whatever data it can actually parse.',
    },
    {
      type: 'p',
      text: 'This is not a speculative reading of where things are going. Google describes its Universal Commerce Protocol as covering the whole shopping journey, from discovery and buying through to post-purchase support, and the Agentic Commerce Protocol carries refunds in its order webhooks rather than leaving them outside the spec. The people building these rails treat the return as part of the transaction. Most merchants still treat it as a page in the footer.',
    },
    {
      type: 'p',
      text: 'The gap between those two views is where this guide lives. Your return policy exists as three separate objects, and they are maintained by different people, updated at different times, and read by different consumers.',
    },
    {
      type: 'table',
      headers: ['Object', 'Who reads it', 'How it goes wrong'],
      rows: [
        ['Your returns page', 'Humans, and a model summarising you', 'Written in prose that resists parsing'],
        ['Typed policy data', 'Agents, Shopping surfaces, Search', 'Never written at all, so it is inferred'],
        ['Order events after the sale', 'The agent that placed the order', 'Emitted for shipping, forgotten for refunds'],
      ],
    },
    { type: 'h2', text: 'If you publish nothing, Google writes one for you' },
    {
      type: 'p',
      text: 'Start here, because it is the fact that changes how merchants feel about the rest of it. Google does not treat a missing return policy as a blank. Its documentation explains that a listing annotated with the phrase "For most items" means Google was able to determine your return policy without you uploading it.',
    },
    {
      type: 'p',
      text: 'Read that again. The policy shown next to your products, which an agent may read and repeat to a buyer as though you had said it, can be Google’s inference from your site rather than your statement of your own terms. You do not get to opt out of having a return policy in this channel. You only get to choose whether it is yours.',
    },
    {
      type: 'callout',
      tone: 'amber',
      title: 'Check what is currently attributed to you',
      text: 'Look at your own Shopping listings and free listings for a returns annotation, and specifically for the words "For most items". If it is there and you never uploaded a policy, an inference is being shown in your name. That inference was drawn at some point in the past from a page you may since have rewritten.',
    },
    { type: 'h2', text: 'The enumerations are the policy' },
    {
      type: 'p',
      text: '"Thirty-day hassle-free returns" is a sentence. What a machine consumes is a typed record with a small set of permitted values, and the translation between the two is where merchants lose information they meant to convey. The structure is MerchantReturnPolicy, and it is unusually forgiving: you satisfy the requirement either by giving a country and a category, or by giving a link to your policy page and nothing else.',
    },
    {
      type: 'table',
      headers: ['Property', 'Status', 'What it holds'],
      rows: [
        ['applicableCountry', 'Required with category', 'ISO country codes, up to 50'],
        ['returnPolicyCategory', 'Required with country', 'One of three values, below'],
        ['merchantReturnLink', 'The alternative to both', 'A URL, if you provide nothing else'],
        ['merchantReturnDays', 'Required for a finite window', 'An integer'],
        ['returnFees', 'Recommended', 'Who pays to send it back'],
        ['returnMethod', 'Recommended', 'ReturnByMail, ReturnInStore, ReturnAtKiosk'],
        ['refundType', 'Recommended', 'FullRefund, ExchangeRefund, StoreCreditRefund'],
        ['restockingFee', 'Recommended', 'An amount or a percentage'],
      ],
    },
    {
      type: 'p',
      text: 'The category has exactly three permitted values, and choosing between them is the single most consequential decision in the whole record:',
    },
    {
      type: 'ul',
      items: [
        'MerchantReturnFiniteReturnWindow, which then requires merchantReturnDays as an integer. This is almost everyone.',
        'MerchantReturnUnlimitedWindow, for a lifetime or no-deadline policy.',
        'MerchantReturnNotPermitted, which is a complete and legitimate answer rather than an admission of failure.',
      ],
    },
    {
      type: 'p',
      text: 'That third value deserves defending, because merchants avoid it out of a sense that saying no will cost them placement. It will cost you the buyers who needed returns, which is the point: those are the buyers who would otherwise have returned the item. Stating MerchantReturnNotPermitted plainly is better for you than leaving the field empty and letting an inference promise something you do not offer, and it is better for the buyer than a surprise at the end.',
    },
    {
      type: 'code',
      language: 'json',
      content: `{
  "@context": "https://schema.org",
  "@type": "MerchantReturnPolicy",
  "applicableCountry": "US",
  "returnPolicyCategory": "https://schema.org/MerchantReturnFiniteReturnWindow",
  "merchantReturnDays": 30,
  "returnMethod": "https://schema.org/ReturnByMail",
  "returnFees": "https://schema.org/FreeReturn",
  "refundType": "https://schema.org/FullRefund"
}`,
    },
    {
      type: 'p',
      text: 'Note that the enumeration values are full schema.org URLs, not bare strings. Writing "FreeReturn" where the parser expects the URL is the most common way this markup silently fails validation, and the same trap catches people in [JSON-LD generally](/learn/json-ld-for-ai-agents).',
    },
    { type: 'h2', text: 'Where it goes, and the nesting people get wrong' },
    {
      type: 'p',
      text: 'There are two placements and they are not interchangeable. Your standard, business-wide policy nests under Organization using the hasMerchantReturnPolicy property. A policy that applies to one product nests under that product’s Offer, and supports a smaller subset of properties.',
    },
    {
      type: 'p',
      text: 'The organization-level placement inherits a rule worth remembering from [how agents identify your business](/learn/how-agents-identify-your-business): Organization markup belongs on one page describing your company, not injected sitewide by a plugin. A return policy repeated on four hundred pages is not four hundred times more convincing. It is four hundred opportunities for one of them to fall out of date.',
    },
    {
      type: 'cta',
      title: 'See what an agent can actually read on your site',
      text: 'The free Nexez scanner fetches your site the way an agent does and scores what comes back: crawler access, server-rendered content, structured data, and machine-readable offers. About a minute, no signup.',
      href: '/scan',
      label: 'Scan your site free',
    },
    { type: 'h2', text: 'Free returns became a filter, not a nicety' },
    {
      type: 'p',
      text: 'Who pays for the return trip is expressed in returnFees, with three values: FreeReturn, ReturnFeesCustomerResponsibility, and ReturnShippingFees, the last of which then requires returnShippingFeesAmount so the number is stated rather than discovered. Once that is a typed field, it is something an agent can sort and filter on, which changes it from a marketing line into a selection criterion.',
    },
    {
      type: 'p',
      text: 'The part almost nobody uses is the split between two different reasons for a return. The schema carries customerRemorseReturnFees and itemDefectReturnFees as separate properties, each with its own label source and shipping amount. That lets you say the thing most merchants actually believe but cannot express on a returns page without sounding grudging: if the item arrived broken we pay, and if you simply changed your mind you pay.',
    },
    {
      type: 'callout',
      tone: 'signal',
      title: 'The seasonal override is the September job',
      text: 'If you extend your window for the holidays, returnPolicySeasonalOverride carries a startDate, an endDate and its own merchantReturnDays. Setting it now means the extended window is machine-readable while people are shopping, instead of being a banner on your homepage that no agent will ever parse. Set the end date deliberately, because the override expires on its own and the standard policy resumes.',
    },
    { type: 'h2', text: 'After the sale it stops being a document and becomes an event' },
    {
      type: 'p',
      text: 'Everything above is the pre-purchase half. The post-purchase half is a different discipline, and merchants who nail the markup often miss it completely, because it is engineering work rather than content work.',
    },
    {
      type: 'p',
      text: 'Under the Agentic Commerce Protocol, you are the merchant of record. The buyer sees your name on their statement, and the documentation is direct about what follows: your platform is responsible for handling refunds and chargebacks, because you accepted the payment. There is no intermediary absorbing that. [How AI agents pay](/learn/how-ai-agents-pay) covers the custody question underneath it.',
    },
    {
      type: 'p',
      text: 'What is easy to miss is that the obligation is not only financial. You emit order_created when the order is placed and order_updated for every subsequent change, both carrying a valid HMAC signature, and the spec asks you to notify the agent when a refund or chargeback status changes so that order state stays synchronized on both sides. A refund you process quietly in your own dashboard leaves the agent holding a stale order.',
    },
    {
      type: 'p',
      text: 'The order status values are worth knowing precisely, because there are six of them and one thing is conspicuously absent:',
    },
    {
      type: 'table',
      headers: ['Status', 'What it means'],
      rows: [
        ['created', 'The order exists'],
        ['manual_review', 'Held for a human to look at'],
        ['confirmed', 'Accepted and being worked'],
        ['canceled', 'Stopped before fulfilment'],
        ['shipped', 'Handed to the carrier'],
        ['fulfilled', 'Delivered'],
      ],
    },
    {
      type: 'p',
      text: 'There is no returned status. The return is not modelled as a stage of the order’s life; it surfaces as a refund attached to an order update. That is a reasonable design given that a refund is the part with money attached, but it means the return journey your customer experiences has no direct representation in the protocol, and anything you want the agent to be able to tell them has to ride on the refund event or on your own support surface.',
    },
    { type: 'h2', text: 'What to do, in order' },
    {
      type: 'ol',
      items: [
        'Look at your live listings for a returns annotation reading "For most items". If it is there, an inference is standing in for your policy and step two is urgent rather than optional.',
        'Write the typed record: applicableCountry plus returnPolicyCategory, and merchantReturnDays if the window is finite. Use the full schema.org URLs for every enumerated value.',
        'Nest the standard policy under Organization with hasMerchantReturnPolicy, on the single page that describes your company, and add product-level policies only where a product genuinely differs.',
        'Split remorse from defect using customerRemorseReturnFees and itemDefectReturnFees rather than flattening both into one grudging number.',
        'Make your returns page and your typed record say the same thing. A model summarising you will read the prose; an agent filtering will read the fields. Disagreement between them is worse than either one being modest.',
        'If you are integrated for agentic checkout, confirm your order_updated webhook actually fires on refunds and not only on shipping. This is the single most common gap, and it is invisible until a customer asks an agent where their money went.',
        'Set the seasonal override now if you extend for the holidays, with a deliberate end date.',
      ],
    },
    {
      type: 'p',
      text: 'None of this is expensive. The typed record is perhaps forty lines of JSON-LD, the webhook is a callback you probably already emit for shipping, and the whole job is smaller than the returns page most merchants have already written. What makes it worth doing is that it is one of the few remaining places where stating a fact clearly is still a competitive advantage, because so few of your competitors have stated it at all.',
    },
    {
      type: 'cta',
      title: 'Publish the facts once, in every format an agent reads',
      text: 'Nexez publishes your business as agent-legible, agent-transactable listings from a single source: JSON-LD, llms.txt, agent.json, OpenAPI, a per-merchant MCP server, and ACP plus UCP feeds, with real Stripe checkout and Calendly-backed scheduling. One set of facts, no copies to keep in sync. Start on Free with no card; paid plans include a 7-day trial.',
      href: '/how-it-works',
      label: 'See how it works',
    },
  ],
  faqs: [
    {
      question: 'Do I have to offer returns to be listed by AI shopping surfaces?',
      answer:
        'No. What matters is that your policy is stated in a form a machine can read. MerchantReturnNotPermitted is a permitted value of returnPolicyCategory and a complete answer. The cost of using it is losing buyers who required returns, which is a smaller cost than it sounds, because those are the buyers most likely to have returned the item.',
    },
    {
      question: 'What does "For most items" mean on my Google listing?',
      answer:
        'Google documents that annotation as meaning it was able to determine your return policy without you uploading one. In other words it is an inference drawn from your site rather than a policy you stated. If you see it and never submitted a policy, the terms being shown in your name are not under your control, and uploading a policy replaces the guess with your own statement.',
    },
    {
      question: 'Should the markup go on Organization or on the product?',
      answer:
        'Both, for different jobs. Your standard business-wide policy nests under Organization using hasMerchantReturnPolicy, and belongs on the single page describing your company rather than sitewide. A product that genuinely differs, such as a final-sale clearance item, carries its own policy nested under that product’s Offer, which supports a smaller subset of the properties.',
    },
    {
      question: 'Why does my return policy markup fail validation?',
      answer:
        'The most common cause is writing bare strings where the enumerated values are full schema.org URLs, so FreeReturn instead of https://schema.org/FreeReturn. The second most common is choosing MerchantReturnFiniteReturnWindow without supplying merchantReturnDays, which becomes required as soon as you pick a finite window.',
    },
    {
      question: 'Can I charge for some returns but not others?',
      answer:
        'Yes, and the schema is built for exactly that. customerRemorseReturnFees and itemDefectReturnFees are separate properties with their own label sources and shipping amounts, so you can state that a defective item comes back at your expense and a change of mind comes back at the buyer’s. Expressing it in fields reads as policy rather than as reluctance.',
    },
    {
      question: 'Who handles the refund when an agent placed the order?',
      answer:
        'You do. Under the Agentic Commerce Protocol you are the merchant of record, the buyer sees your name on their statement, and the documentation states that your platform is responsible for refunds and chargebacks because you accepted the payment directly. The agent is a channel, not an intermediary standing between you and the money.',
    },
    {
      question: 'Does the protocol track returns the way it tracks shipping?',
      answer:
        'Not as a status. The six order statuses are created, manual_review, confirmed, canceled, shipped and fulfilled, with no returned among them. A return surfaces as a refund carried on an order_updated event, which is why merchants who wired that webhook for shipping alone leave agents holding stale orders after a refund.',
    },
  ],
}

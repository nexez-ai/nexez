import type { LearnArticle } from '../learn-content'

export const formsAgentsCanFill: LearnArticle = {
  slug: 'forms-agents-can-fill',
  metaTitle: 'Designing Forms an AI Agent Can Fill',
  metaDescription:
    'The accessibility work you may already owe is the same work an agent needs. Two WCAG criteria, one attribute, and the tokens almost nobody uses.',
  title: 'The form is where agents give up',
  dek: 'Reading your site is forgiving. An agent that misreads a price can check another source, compare, hedge. Filling in your form is not forgiving, because it is the one place the agent stops consuming and starts producing, committing real values on behalf of a real person from nothing but the labels you wrote. Most checkout and booking forms were never designed for that, and the fix turns out to be work many businesses already owe for entirely different reasons.',
  cardSummary:
    'The accessibility work you may already owe is the same work an agent needs to fill your checkout.',
  category: 'Agent readiness',
  publishedAt: '2026-09-25',
  updatedAt: '2026-09-25',
  readMinutes: 11,
  blocks: [
    {
      type: 'p',
      text: 'The [operable gate](/learn/what-stops-agents-completing-tasks) is where agent readiness stops being about markup and starts being about whether a task can actually finish. Within that gate, one obstacle accounts for more abandoned tasks than the rest combined, and it is the form.',
    },
    {
      type: 'p',
      text: 'The reason is structural rather than cosmetic. Everywhere else on your site the agent is reading, and reading has recovery: a misread price can be checked against a feed, a confusing sentence can be reread, an ambiguous page can be compared against another. At the form, the agent has to write. This is the wall [service businesses hit when an agent tries to book](/learn/ai-agents-book-service-businesses), and the same wall stands in front of every checkout. It has to decide that the box labelled Name wants a full name rather than a first name, that the second address block is for billing rather than a second shipping address, and that the field it just filled was accepted. Every one of those is an inference, and a wrong inference becomes an order with the wrong address on it.',
    },
    { type: 'h2', text: 'Filling a form is the only thing an agent does blind' },
    {
      type: 'p',
      text: 'Put it in the terms a merchant already understands. A human filling your checkout brings an enormous amount of context: they know their own name, they can see that two address blocks mean shipping and billing because of the headings and the layout, and when something turns red they read the sentence next to it. None of that is in your HTML. It is in the person.',
    },
    {
      type: 'p',
      text: 'An agent has only what is in the page. If the purpose of a field is expressed by visual proximity to a heading, it is not expressed at all. If the error is expressed by a red border, it is not expressed at all. This is not a new problem and it is not an AI problem, which is the useful part.',
    },
    { type: 'h2', text: 'You may already owe this work, and you may already have paid for it' },
    {
      type: 'p',
      text: 'Two accessibility requirements, written years before agentic commerce existed, describe almost exactly what an agent needs. Not approximately. Exactly.',
    },
    {
      type: 'table',
      headers: ['Criterion', 'Level', 'What it requires'],
      rows: [
        ['1.3.5 Identify Input Purpose', 'AA', 'The purpose of each input collecting user information can be programmatically determined'],
        ['3.3.1 Error Identification', 'A', 'The item in error is identified and the error is described to the user in text'],
      ],
    },
    {
      type: 'p',
      text: 'Read those as an engineer rather than as a compliance officer. Programmatically determined means a machine can tell what the field is for without looking at it. Described in text means a machine can tell what went wrong without interpreting a colour. That is the entire agent brief, written by the W3C, for a completely different constituency.',
    },
    {
      type: 'callout',
      tone: 'signal',
      title: 'This is the rare case where two obligations collapse into one',
      text: 'If your team has done accessibility work properly, a large part of your agent-readiness work is already shipped and nobody told you. If your team skipped it, you are now being asked to pay for the same thing twice, by two different departments, for two different reasons. Either way the cheapest path is to treat them as a single piece of work rather than two backlogs.',
    },
    {
      type: 'p',
      text: 'The understanding document for 1.3.5 says the benefit is that browsers can auto-fill personal information for people with language, memory and executive function disabilities. An agent filling your checkout is doing the same operation, for a different reason, using the same signals.',
    },
    { type: 'h2', text: 'The vocabulary you are probably not using' },
    {
      type: 'p',
      text: 'The mechanism both constituencies rely on is the autocomplete attribute, and it is not a boolean. It carries a fixed vocabulary of tokens, and the tokens are specific enough to remove essentially all the guesswork from a standard checkout.',
    },
    {
      type: 'table',
      headers: ['What you are asking for', 'Token'],
      rows: [
        ['Full name, or its parts', 'name, given-name, family-name'],
        ['Email address', 'email'],
        ['Telephone number', 'tel'],
        ['Street address, as one field or lines', 'street-address, address-line1, address-line2'],
        ['Town or city', 'address-level2'],
        ['State, province or region', 'address-level1'],
        ['Postcode or ZIP', 'postal-code'],
        ['Country', 'country, country-name'],
        ['Company', 'organization'],
        ['Card details', 'cc-name, cc-number, cc-exp, cc-csc'],
      ],
    },
    {
      type: 'p',
      text: 'The names are worth dwelling on, because address-level1 and address-level2 look like jargon and are in fact the fix for a real problem. County, province, prefecture, state and region are the same slot in different countries, and a form that labels it State is unfillable in half the world. The token says which slot it is regardless of what your label calls it.',
    },
    { type: 'h2', text: 'The tokens that matter most in a checkout are the ones nobody sets' },
    {
      type: 'p',
      text: 'Here is the part that is specific to commerce and almost universally missed. The vocabulary includes prefixes: shipping and billing. The specification is direct about what they mean, that the field identified by the tokens after the prefix is part of the shipping, or the billing, address or contact information.',
    },
    {
      type: 'p',
      text: 'Now picture your checkout. Two address blocks, visually distinct, each with a heading a person reads in half a second. In the HTML, without prefixes, they are two identical sets of fields with identical tokens. There is no signal at all about which is which beyond position, and position is exactly the kind of inference you do not want an agent making about where your parcel goes.',
    },
    {
      type: 'code',
      language: 'html',
      content: `<!-- Ambiguous: two identical address blocks -->
<input autocomplete="street-address">
<input autocomplete="postal-code">

<!-- Unambiguous, and it costs two words -->
<input autocomplete="shipping street-address">
<input autocomplete="shipping postal-code">

<input autocomplete="billing street-address">
<input autocomplete="billing postal-code">`,
    },
    {
      type: 'p',
      text: 'There is also a section prefix for grouping fields that belong together, a token beginning with the eight characters section- followed by a name of your choosing, where every control sharing that token forms a named group. That is the tool for forms with repeated blocks that are not shipping and billing: two passengers, three attendees, a gift recipient alongside the buyer.',
    },
    {
      type: 'cta',
      title: 'See what an agent can actually complete on your site',
      text: 'The free Nexez scanner fetches your site the way an agent does and scores what comes back: crawler access, server-rendered content, structured data, and machine-readable offers. About a minute, no signup.',
      href: '/scan',
      label: 'Scan your site free',
    },
    { type: 'h2', text: 'What your error state has to say out loud' },
    {
      type: 'p',
      text: 'Half of form operability is filling it. The other half is recovering when the form says no, and this is where most implementations fail hardest, because visual design has spent twenty years making rejection quiet and tasteful.',
    },
    {
      type: 'p',
      text: 'A red border is not an error message. A shake animation is not an error message. A red asterisk that appeared next to a field is not an error message. Criterion 3.3.1 is a Level A requirement, the lowest bar there is, and it asks for two things: the item in error is identified, and the error is described to the user in text. An agent needs the same two things, for the same reason a screen reader does, which is that neither of them can see your border.',
    },
    {
      type: 'p',
      text: 'The practical shape is a text message saying which field and what is wrong with it, placed next to that field and programmatically associated with it, rather than a single line at the top saying that something went wrong. An agent handed "please check your details" has learned nothing and will either resubmit the identical values or stop.',
    },
    { type: 'h2', text: 'Things that look helpful and are not' },
    {
      type: 'ul',
      items: [
        'A placeholder used instead of a label. It disappears the moment anything is typed, it is not a reliable accessible name, and it leaves the field unlabelled for anything that is not looking at the pixels.',
        'A custom dropdown built from divs. It looks better than a select and it is invisible as a control unless someone did the accessibility work on it, which is usually the work that got cut.',
        'A date field that only accepts clicks on a calendar widget. Typed input is how a machine supplies a date, and how a lot of humans prefer to.',
        'autocomplete="off" applied broadly. It has a legitimate narrow use, and the specification is clear that it means the browser is not permitted to enter a value, which is occasionally what you want and usually not what you meant.',
        'A multi-step wizard holding all its state in the client. Anything that interrupts the sequence loses everything, and agents are unusually good at interrupting sequences.',
        'A required field that is not marked required in the markup, so its absence is discovered only at submission.',
      ],
    },
    {
      type: 'callout',
      tone: 'amber',
      title: 'The pattern underneath all six',
      text: 'Every one of these substitutes an appearance for a declaration. The control looks like a dropdown, the text looks like a label, the border looks like an error. For a person that is usually enough, because people are good at reading appearances. Anything operating on the document rather than the render needs the thing itself, and it will fail silently when it gets a picture of the thing instead.',
    },
    { type: 'h2', text: 'The twenty-minute audit' },
    {
      type: 'ol',
      items: [
        'Open your checkout or booking form and view source. For each input, ask whether a stranger reading only that element could say what it wants. If the answer depends on a heading three elements up the tree, that field is guessable rather than declared.',
        'Add autocomplete tokens to every field that collects a standard fact about the buyer. This is a single attribute per input and it is the highest return change on the list.',
        'Add shipping and billing prefixes anywhere you collect two addresses. If you collect two addresses and have never done this, this is the single most valuable ten minutes in the article.',
        'Submit the form deliberately wrong and read what comes back as text only. Turn off your stylesheet if that is easier. If the page no longer tells you which field failed and why, neither does your error handling.',
        'Replace placeholder-only labels with real ones. You will improve your conversion rate for humans at the same time, which is a rare two-for-one.',
        'Run the flow with an actual assistant and watch where it stops. As in the [previous piece](/learn/what-stops-agents-completing-tasks), the handback point is the answer, and it is usually a field whose purpose you thought was obvious.',
      ],
    },
    {
      type: 'p',
      text: 'One honest limit. There is a point past which a form is not worth optimising, because the interaction is genuinely too complex to express as a page, and the right answer is to give an agent a described endpoint rather than a better set of boxes. That is what [a merchant MCP server](/learn/what-is-an-mcp-server) is for, and knowing when you have crossed that line is worth more than another round of attribute tuning.',
    },
    {
      type: 'p',
      text: 'For most businesses that line is a long way off, and the intervening work is an afternoon of attributes that also satisfies an accessibility obligation many of them already carry. It is the least glamorous item in this whole library and it is the one standing directly between a buyer who wanted to pay you and an order that never arrived.',
    },
    {
      type: 'cta',
      title: 'Skip the form problem entirely',
      text: 'Nexez publishes your business as agent-legible, agent-transactable listings from a single source: JSON-LD, llms.txt, agent.json, OpenAPI, a per-merchant MCP server, and ACP plus UCP feeds, with real Stripe checkout and Calendly-backed scheduling behind them. An agent completes the action through a described interface rather than by guessing at your input fields. Start on Free with no card; paid plans include a 7-day trial.',
      href: '/how-it-works',
      label: 'See how it works',
    },
  ],
  faqs: [
    {
      question: 'What is the single highest-value change I can make to my checkout for AI agents?',
      answer:
        'Add autocomplete tokens to every field collecting a standard fact about the buyer, and add shipping or billing prefixes if you collect two addresses. It is one attribute per input, it requires no redesign, and it converts fields whose purpose was inferred from layout into fields whose purpose is declared in the markup.',
    },
    {
      question: 'Is this the same as accessibility work?',
      answer:
        'Largely, yes, which is the useful part. WCAG 1.3.5 Identify Input Purpose is a Level AA criterion requiring that the purpose of each input collecting user information can be programmatically determined, and the sufficient technique is the autocomplete attribute. WCAG 3.3.1 Error Identification is Level A and requires the item in error to be identified and the error described in text. Both describe what an agent needs, for a different reason.',
    },
    {
      question: 'What do address-level1 and address-level2 mean?',
      answer:
        'They are the administrative divisions of an address without committing to one country’s vocabulary. address-level1 is the broader division, the state, province or region; address-level2 is the narrower one, usually the town or city. The point of the abstraction is that a field labelled State is meaningless in most of the world, while the token says which slot it is regardless of your label.',
    },
    {
      question: 'Why do shipping and billing prefixes matter so much?',
      answer:
        'Because without them a checkout with two address blocks presents two identical sets of fields carrying identical tokens, and nothing in the document says which is which. A person resolves it instantly from the headings. Anything reading the document rather than the rendering has to infer from position, and that is the worst possible thing to leave to inference given what it decides.',
    },
    {
      question: 'Is a red border enough to signal a form error?',
      answer:
        'No, and it fails the lowest conformance level there is. WCAG 3.3.1 is Level A and requires that the item in error is identified and the error is described to the user in text. A colour change conveys neither to a screen reader nor to an agent. The workable shape is a text message naming the field and the problem, placed near it and programmatically associated with it.',
    },
    {
      question: 'Should I use autocomplete="off" for security?',
      answer:
        'Rarely, and narrowly. The specification states it means the browser is not permitted to automatically enter or select a value, which is genuinely appropriate for a few fields such as a one-time code. Applied across a whole form it disables the mechanism that both assistive technology and agents rely on, usually to solve a problem that was never actually about autofill.',
    },
    {
      question: 'When should I stop improving the form and build an API instead?',
      answer:
        'When the interaction is genuinely too complex to express as a page, which for most businesses is a long way off. Attribute work is an afternoon and helps humans too. If you are past that point, a described interface such as a merchant MCP server lets an agent complete the action without interpreting an interface at all, which is a different and larger piece of work.',
    },
  ],
}

import type { LearnArticle } from '../learn-content'

export const howAgentsIdentifyYourBusiness: LearnArticle = {
  slug: 'how-agents-identify-your-business',
  metaTitle: 'How Agents Know Which Business You Are',
  metaDescription:
    'Before an agent can recommend you it has to decide you are one business, not three. Google publishes fields for exactly that, and almost nobody fills them in.',
  title: 'How agents know which business you are',
  dek: 'Agents do not look businesses up, they resolve them. Before an assistant can say your name it has to decide that the thing on your website, the thing on your Google profile, the thing on a directory and the thing a customer just described are all the same entity. Most hard-to-diagnose visibility problems live inside that step.',
  category: 'Agent readiness',
  publishedAt: '2026-09-10',
  updatedAt: '2026-09-10',
  readMinutes: 11,
  blocks: [
    {
      type: 'p',
      text: 'There is a step before discovery that almost nobody works on. Ask an assistant for a physiotherapist in Austin and it does not simply retrieve a list. It has to first decide which records refer to the same real business: your website, your Google profile, two directory entries, an old listing at your previous address, and the clinic with a similar name three suburbs over. Only once it has resolved those into entities can it rank them, and [where the recommendation actually comes from](/learn/ai-search-local-businesses) covers what it is drawing on while it does.',
    },
    {
      type: 'p',
      text: 'That resolution step is where a surprising share of unexplained visibility problems live. A business that is well marked up, well reviewed and genuinely good can still be quietly losing, because from the outside it looks like three half-businesses rather than one whole one, and a machine asked to recommend something will pick the entity it is most confident about.',
    },
    {
      type: 'p',
      text: 'The useful news is that this is unusually tractable. Google publishes fields whose stated purpose is disambiguating you from other organizations, publishes rules for what counts as one business, and suppresses records that break those rules. Almost none of it is widely used. This guide covers what an agent has to work out, the fields that answer it, and the rules that decide whether your records survive.',
    },
    { type: 'h2', text: 'The three questions before the ranking question' },
    {
      type: 'p',
      text: 'Every resolution problem an agent faces reduces to three questions, and each has a different fix:',
    },
    {
      type: 'ol',
      items: [
        'Is this one business or several? The failure looks like a clinic with three locations being treated as three unrelated clinics, or worse, one location being treated as three because of duplicate records.',
        'Is this business the same as that one? Your site, your profile, your directory entries and your social accounts have to be linkable to each other, or each is a fragment with a fraction of the evidence.',
        'Which one does this customer mean? A question about hours or availability is about a specific location, and an agent that cannot tell your locations apart will answer confidently with the wrong one.',
      ],
    },
    {
      type: 'p',
      text: 'Note that none of these is about being good, cheap or well reviewed. They all run before that. A perfectly optimized page attached to an entity a machine cannot pin down is competing with one hand tied.',
    },
    { type: 'h2', text: 'The fields built for this, which almost nobody fills in' },
    {
      type: 'p',
      text: 'Google\'s Organization structured data carries a set of company identifiers, and the documentation is unusually blunt about why they exist: they are used behind the scenes to disambiguate your organization from other organizations. That is the entire resolution problem, named, with a form to fill in.',
    },
    {
      type: 'table',
      headers: ['Property', 'What it is', 'Who realistically has one'],
      rows: [
        ['sameAs', 'URLs of your profiles elsewhere', 'Everyone, and it is the free win'],
        ['naics', 'North American industry classification code', 'Anyone, it is a lookup'],
        ['duns', 'Dun and Bradstreet number', 'Most registered businesses'],
        ['leiCode', 'Legal Entity Identifier, ISO 17442', 'Businesses in regulated finance'],
        ['globalLocationNumber', 'GS1 Global Location Number', 'Anyone already in retail supply chains'],
        ['taxID / vatID', 'Tax registration identifiers', 'Everyone, though not always worth publishing'],
        ['iso6523Code', 'A wrapper carrying one of the above', 'Use with 0060 DUNS, 0088 GLN, 0199 LEI'],
      ],
    },
    {
      type: 'p',
      text: 'The one that matters most for a small business is the plainest. sameAs takes multiple URLs, and it is how you assert that the Facebook page, the Yelp listing, the LinkedIn company and the industry directory entry are you. Without it a machine has to infer that from matching names and addresses, which is exactly the inference that fails for common names, recent movers and anyone with a franchise nearby.',
    },
    {
      type: 'callout',
      tone: 'ready',
      title: 'The unglamorous highest-value hour',
      text: 'List every place your business appears online: profiles, directories, social accounts, association memberships, the chamber of commerce page nobody has looked at since 2019. Put the live ones in sameAs. Fix or remove the dead ones. This is tedious and it is the closest thing to a free lunch in the entire readiness stack, because you are handing a machine the answer to a question it would otherwise have to guess.',
    },
    { type: 'h2', text: 'Organization markup goes on one page, not every page' },
    {
      type: 'p',
      text: 'This one catches people who did everything else right. Google recommends placing organization information on your home page, or a single page that describes your organization such as an about page. Not on every page. A great many plugins and themes inject an Organization block sitewide by default, which is the opposite of the guidance.',
    },
    {
      type: 'p',
      text: 'There are also no required properties on Organization. Google says to add the properties that apply to you rather than filling every field, which is a licence to be selective and a reason not to invent values you do not have. Per-page markup describing the specific thing on that page, covered in the [JSON-LD guide](/learn/json-ld-for-ai-agents), is a different job and still belongs on every relevant page.',
    },
    { type: 'h2', text: 'One profile per location, and the four exceptions' },
    {
      type: 'p',
      text: 'On the Google Business Profile side the rule is simple: one profile per business location. Your profile is supposed to reflect how the business is consistently represented and recognized in the real world, across signage, stationery and branding. That phrase is doing a lot of work, and it is the standard your edge cases get judged against.',
    },
    {
      type: 'p',
      text: 'Four things legitimately get their own profile:',
    },
    {
      type: 'ul',
      items: [
        'Departments inside a business, university, hospital or government institution, provided they have genuinely distinct names and categories. A pharmacy counter inside a supermarket qualifies; your sales team does not.',
        'Individual practitioners such as doctors and lawyers in public-facing roles, which is why a three-partner firm can legitimately show four records.',
        'Service-area businesses with separate locations, staffing and service areas. Separate staffing is the part people skip.',
        'Chain locations with consistent branding, which is the ordinary multi-location case.',
      ],
    },
    {
      type: 'p',
      text: 'If you travel to customers rather than running a storefront, you get one service-area profile, and the service area may not extend beyond roughly two hours of driving time from your base. Delivery-only food brands are required to hide the address. Both rules exist to stop one business claiming presence it does not have, and both are enforced.',
    },
    { type: 'h2', text: 'Your business name is an identifier, not a billboard' },
    {
      type: 'p',
      text: 'The single most common self-inflicted identity wound is keyword stuffing the name field. Google prohibits marketing taglines, store codes, trademark symbols, phone numbers, URLs and location information in the business name, and its own examples of violations are instructive: not "Burger King" with a registered symbol, and not "Holiday Inn (I-93 at Exit 2)".',
    },
    {
      type: 'p',
      text: 'The exception is real-world proof. If your signage and business cards genuinely carry the special characters or the legal suffix, you may use them. The test is what is on the door, not what you would like to rank for.',
    },
    {
      type: 'p',
      text: 'The reason to care is not the risk of a slap. It is that a name padded with a location and a service keyword is a worse identifier than a plain one. It matches your signage less well, it matches your other listings less well, and every mismatch is one more reason for a resolver to treat the record as a separate, weaker entity.',
    },
    {
      type: 'cta',
      title: 'See what an agent can actually pin down about you',
      text: 'The free Nexez scanner fetches your site the way an agent does and scores what comes back: crawler access, server-rendered content, structured data, and machine-readable offers. About a minute, no signup.',
      href: '/scan',
      label: 'Scan your site free',
    },
    { type: 'h2', text: 'Duplicates are not clutter, they are suppression' },
    {
      type: 'p',
      text: 'Most owners treat a stray duplicate listing as untidy. It is worse than that. When Google marks a profile as a duplicate it does not show on Search or Maps at all. The record still exists, still looks fine when you visit it, and is invisible to the surfaces that matter.',
    },
    {
      type: 'p',
      text: 'Three things create them: an existing verified profile for the same business, multiple profiles sharing one address, and multiple profiles representing one business that offers different services. The third is the trap for anyone who created a second listing to promote a second service line.',
    },
    {
      type: 'ul',
      items: [
        'If someone else controls the profile, request ownership. They have three days to respond.',
        'If it is unverified and sitting on Maps, claim it.',
        'If you created it, remove it from your account.',
        'If two genuinely distinct businesses were wrongly merged, appeal with evidence that they are distinct.',
        'If several records really are the same business, request a merge through Maps rather than leaving them to compete.',
      ],
    },
    {
      type: 'callout',
      tone: 'amber',
      title: 'Why this is getting more expensive, not less',
      text: 'When a human saw two listings for your clinic they picked one and moved on, and you lost nothing. An agent resolving entities does not pick one at random. It weighs evidence, and split evidence means two low-confidence records instead of one strong one, which is exactly the condition under which a model hedges or names your competitor instead. Fragmentation used to be untidy. It is now a ranking input.',
    },
    { type: 'h2', text: 'What to do, in order' },
    {
      type: 'ol',
      items: [
        'Search your own business name and address on Maps and find every record that refers to you. Resolve each one: claim, merge, or remove. Do this before anything else, because a suppressed duplicate cannot be fixed by better markup.',
        'Strip your business name back to what is on your signage. If a location or a keyword is in there, take it out.',
        'Add sameAs to your Organization markup with every live profile you own, and put that markup on one page rather than sitewide.',
        'Add the identifiers you actually have. A NAICS code is a lookup and takes two minutes; a DUNS number you probably already possess. Skip the ones that do not apply.',
        'Make your name, address, phone and hours identical everywhere, character for character. Consistency is what a resolver is measuring when it has nothing better to go on, and it is the only one of these that never stops mattering.',
      ],
    },
    {
      type: 'p',
      text: 'The framing worth keeping is that identity is infrastructure rather than marketing. Nobody will ever compliment your sameAs block, and no customer will notice that your three locations resolve cleanly. What you get instead is that everything else you do actually accrues to you: the [reviews](/learn/reviews-ratings-and-ai-agents) land on one entity, the pages cite one business, and the agent answering a question about you is confident enough to name you rather than hedging toward whoever it could pin down. The [readiness study](/learn/agent-readiness-study-2026) has the numbers on how rare that currently is.',
    },
    {
      type: 'cta',
      title: 'One identity, published everywhere it is read',
      text: 'Nexez publishes your business as agent-legible, agent-transactable listings from a single source: JSON-LD, llms.txt, agent.json, OpenAPI, a per-merchant MCP server, and ACP plus UCP feeds, with real Stripe checkout and Calendly-backed scheduling. One entity, one set of facts, no fragments to reconcile. Start on Free with no card; paid plans include a 7-day trial.',
      href: '/how-it-works',
      label: 'See how it works',
    },
  ],
  faqs: [
    {
      question: 'What is sameAs and why does it matter for AI agents?',
      answer:
        'It is a property in Organization structured data holding URLs of your profiles on other sites, and you can provide several. It matters because it lets you assert that your social accounts, directory entries and review profiles are you, rather than leaving a machine to infer it from matching names and addresses. That inference is exactly what fails for common business names, recent movers and anyone with a franchise nearby.',
    },
    {
      question: 'Should Organization markup go on every page of my site?',
      answer:
        'No. Google recommends placing it on your home page or a single page describing your organization, such as an about page. Many plugins inject it sitewide by default, which runs against the guidance. Per-page markup describing the specific service, product or FAQ on that page is a separate job and does belong on every relevant page.',
    },
    {
      question: 'Can I have more than one Google Business Profile?',
      answer:
        'Only in four documented cases: departments with genuinely distinct names and categories inside a larger institution, individual public-facing practitioners such as doctors and lawyers, service-area businesses with separate locations and staffing and service areas, and chain locations with consistent branding. Creating a second profile to promote a second service line is not one of them, and is a common cause of duplicates.',
    },
    {
      question: 'Why can I see my listing but customers cannot?',
      answer:
        'The most likely explanation is that Google has marked it as a duplicate, in which case it will not show on Search or Maps while still appearing normal to you. Duplicates arise from an existing verified profile for the same business, several profiles sharing one address, or several profiles for one business offering different services. Resolve by claiming, merging or removing rather than by adding more markup.',
    },
    {
      question: 'Can I put my city or service in my business name?',
      answer:
        'No. Google prohibits marketing taglines, store codes, trademark symbols, phone numbers, URLs and location information in the name field, and its own examples of violations include a brand with a registered symbol and a hotel with a highway exit in brackets. The exception is genuine real-world proof such as signage or business cards. Beyond the policy risk, a padded name is a worse identifier because it matches your other records less closely.',
    },
    {
      question: 'How far can a service-area business claim to cover?',
      answer:
        'Google states that service areas may not extend beyond approximately two hours of driving time from the business location, and that a business travelling to customers rather than operating a storefront gets one service-area profile rather than one per town. Delivery-only food brands are additionally required to hide their address, so customers are not sent to a kitchen that does not serve walk-ins.',
    },
    {
      question: 'Do the company identifier fields like DUNS or NAICS actually do anything?',
      answer:
        'Google documents them as being used behind the scenes to disambiguate your organization from other organizations, which is the resolution problem stated plainly. They will not produce a visible rich result, so they get skipped, but that is the wrong test. Add the ones you genuinely have, particularly a NAICS code, which is a two-minute lookup, and skip the ones that do not apply to you.',
    },
  ],
}

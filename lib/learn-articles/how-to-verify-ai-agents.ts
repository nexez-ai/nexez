import type { LearnArticle } from '../learn-content'

export const howToVerifyAiAgents: LearnArticle = {
  slug: 'how-to-verify-ai-agents',
  metaTitle: 'How to Verify an AI Agent Is Who It Says',
  metaDescription:
    'User agent strings are typed by hand and OpenAI publishes no IP ranges for its agent. Signed requests replace both, and the directory is public.',
  title: 'How to verify an AI agent is who it says it is',
  dek: 'Every allowlist published in the last two years rests on two things a stranger can forge or a vendor can change without telling you: a user agent string and an IP range. Both have now run out of road for the traffic that matters most. The replacement is a signature you can check, and it is already arriving at your origin.',
  cardSummary:
    'The user agent string is typed by hand and the IP list is disappearing. Signed requests replace both.',
  category: 'Agent readiness',
  publishedAt: '2026-09-15',
  updatedAt: '2026-09-15',
  readMinutes: 10,
  blocks: [
    {
      type: 'p',
      text: 'Every piece of advice about AI bots, including [ours](/learn/which-ai-crawlers-to-allow), has told you to write rules against the user agent string and then verify against a published IP range. That advice was correct in the sense that it was the best available. It was never good. The string is a field an attacker types, and the IP list is a file a vendor maintains at its own convenience.',
    },
    {
      type: 'p',
      text: 'That approach has now failed outright for the single most valuable class of traffic. OpenAI’s own allowlisting guidance for its agent does not publish IP ranges at all, and does not name a user agent string to match on. If your access policy is built on those two inputs, you have no supported way to recognise an agent that is standing in your checkout on behalf of a real customer.',
    },
    {
      type: 'p',
      text: 'What replaced it is a cryptographic signature on the request itself, with a public key directory you can open in a browser right now. This guide covers what the signature carries, what you can check yourself, the part almost nobody has noticed yet, and what is honestly worth doing this week.',
    },
    { type: 'h2', text: 'Why the allowlist you already published is a guess' },
    {
      type: 'p',
      text: 'Two mechanisms carried the whole industry until recently, and it is worth being precise about how each one breaks, because the failures are not symmetrical.',
    },
    {
      type: 'table',
      headers: ['Mechanism', 'How it fails', 'Who it fails for'],
      rows: [
        ['User agent string', 'It is a request header. Anyone can send any value.', 'Blockers catch honest bots and miss dishonest ones'],
        ['Published IP ranges', 'Shared infrastructure, rotation, and no obligation to publish', 'Allowlisters, silently, when the file changes'],
        ['Reverse DNS', 'Works where offered, but not every operator offers it', 'Anyone verifying an operator that skipped it'],
        ['No published ranges at all', 'Nothing to verify against in the first place', 'Anyone trying to recognise the ChatGPT agent'],
      ],
    },
    {
      type: 'p',
      text: 'The last row is the one that changed the calculus. Crawlers mostly still publish ranges. Agents, which run inside a cloud browser on behalf of a person who is mid-task, largely do not, because the whole point of that infrastructure is that it is elastic. An agent doing your customer’s shopping is exactly the request you least want to refuse, and exactly the one your existing rules cannot place.',
    },
    { type: 'h2', text: 'What a signed request actually carries' },
    {
      type: 'p',
      text: 'Web Bot Auth applies HTTP Message Signatures, RFC 9421, to bot and agent traffic. Three headers arrive together:',
    },
    {
      type: 'ul',
      items: [
        'Signature, the signature bytes themselves.',
        'Signature-Input, the metadata describing what was signed and under which parameters.',
        'Signature-Agent, a URL identifying who is claiming to send this. OpenAI sets it to https://chatgpt.com.',
      ],
    },
    {
      type: 'p',
      text: 'The architecture draft is specific about the parameters, and the specifics are what make this worth more than the string it replaces. The keyid must be a base64url JWK SHA-256 thumbprint, so the key identifies itself rather than being a label someone chose. The tag must be the literal value web-bot-auth, which is how a verifier knows the signature is asserting bot identity rather than something else. The request authority must be among the signed components, so a signature captured against one host cannot be replayed against yours. And created and expires are carried in Signature-Input, so a signature lifted off the wire stops working shortly afterwards.',
    },
    {
      type: 'callout',
      tone: 'signal',
      title: 'The property that matters is unforgeability, not novelty',
      text: 'A user agent string is an assertion. A signature is proof, because producing it requires a private key the claimed sender holds and you never see. That is the entire difference, and it is the reason this is worth changing your posture over rather than filing under things to watch.',
    },
    { type: 'h2', text: 'The directory is the part you can check yourself' },
    {
      type: 'p',
      text: 'A signing operator publishes its public keys as a JSON Web Key Set at a well-known path on its own domain: /.well-known/http-message-signatures-directory. A verifier reads the Signature-Agent URL, fetches that path on it, finds the key whose thumbprint matches keyid, and checks the signature. Cloudflare supports the Ed25519 algorithm for this, and accepts every valid Ed25519 key it finds in an operator’s directory.',
    },
    {
      type: 'p',
      text: 'This is unusually easy to satisfy yourself about, which is rare in this field. OpenAI documents its directory location openly, and you can fetch it the same way a verifier would:',
    },
    {
      type: 'code',
      language: 'text',
      content: `curl -s https://chatgpt.com/.well-known/http-message-signatures-directory

# Returns a JSON Web Key Set. Each key in it can sign requests
# that arrive at your origin carrying Signature-Agent: https://chatgpt.com`,
    },
    {
      type: 'p',
      text: 'There is no registration, no partnership and no account required to look. The trust model is deliberately the same one the web already uses for certificates: the claim is anchored to a domain, and the domain publishes the material that proves it.',
    },
    { type: 'h2', text: 'The agent card nobody has read yet' },
    {
      type: 'p',
      text: 'The second draft in this family is the one with the most operational value and the least attention. Alongside the key directory, an operator can publish a signature agent card: a JSON document describing what the agent is and how it intends to behave. It borrows OAuth client metadata for the identity half, client_id, client_name, client_uri, logo_uri, contacts, jwks_uri, and adds a web_bot_auth object for the behaviour half.',
    },
    {
      type: 'table',
      headers: ['Field', 'What the operator is declaring', 'Why you care'],
      rows: [
        ['rfc9309-product-token', 'The exact token to use in robots.txt', 'Your robots.txt stops being a guess at spelling'],
        ['trigger', 'Fetcher or crawler', 'The only distinction that changes the money'],
        ['purpose', 'What the data is for', 'Training versus answering is now declared, not inferred'],
        ['rfc9309-compliance', 'Which robots.txt directives it honours', 'Tells you whether your file is even read'],
        ['rate-expectation', 'Expected volume and burstiness', 'Capacity planning instead of surprise'],
        ['ips_uri', 'Where its IP list lives, if it has one', 'The old method, now discoverable rather than hunted'],
        ['known-urls', 'Predictable endpoints it will hit', 'Useful for log triage'],
      ],
    },
    {
      type: 'p',
      text: 'Read that table again with the robots.txt file you currently publish in mind. Every line in that file is a product token you found in a blog post, copied, and hoped was current. The card is the operator stating it directly, next to the key that proves the operator is who it says. The guessing game that has defined crawler management since 1994 has a lookup now.',
    },
    {
      type: 'cta',
      title: 'See what actually reaches your site',
      text: 'The free Nexez scanner fetches your site the way an agent does and scores what comes back: crawler access, server-rendered content, structured data, and machine-readable offers. About a minute, no signup.',
      href: '/scan',
      label: 'Scan your site free',
    },
    { type: 'h2', text: 'Fetcher or crawler is the distinction that pays' },
    {
      type: 'p',
      text: 'If you take one operational idea from this, take the trigger field. A crawler is collecting at its own initiative, for training or for an index. A fetcher is retrieving this page, right now, because a person asked a question and is waiting. Those two deserve opposite default treatment, and until now you had no reliable way to tell them apart, which is why so many sites ended up blocking both or neither.',
    },
    {
      type: 'p',
      text: 'Blocking a crawler costs you presence in an answer you might have been cited in. Blocking a fetcher costs you a customer who is standing at your door with their wallet out, and it costs you silently, because nobody files a support ticket about a shop they could not get into. [Which crawlers to allow](/learn/which-ai-crawlers-to-allow) works through the roster and the policy; the card is what finally makes that policy enforceable against something other than a string.',
    },
    {
      type: 'callout',
      tone: 'amber',
      title: 'This is the same question the September 15 deadline asks',
      text: 'Cloudflare’s default-block change turns on whether an operator separates training collection from other collection. The purpose and trigger fields are that separation, written by the operator in a machine-readable form, signed, next to their key. The policy fight and the protocol are converging on the same declaration.',
    },
    { type: 'h2', text: 'What to actually do this week' },
    {
      type: 'p',
      text: 'The honest answer for most businesses is that you are not going to implement RFC 9421 verification, and you should not. Your edge provider either does this or does not, and that is the decision in front of you.',
    },
    {
      type: 'ol',
      items: [
        'Find out whether your CDN verifies signatures today. If you are on Cloudflare, validation happens at the edge automatically and verified traffic is marked as such, with cf.bot_management.verified_bot populated. If you are elsewhere, ask the question directly rather than assuming.',
        'Write your rules against your provider’s bot name, not a user agent. These differ per provider for the same agent: Akamai calls it ChatGPT Agent, Cloudflare calls it chatgpt-agent, Vercel calls it chatgpt-operator. A rule copied from a Cloudflare tutorial into an Akamai config matches nothing and fails open or closed without telling you.',
        'Audit what your edge already blocks before touching robots.txt. Bot fight modes and AI scraping toggles operate above robots.txt, and a welcoming file cannot un-refuse a request the edge already dropped.',
        'If you do terminate at your own origin, verification is available rather than theoretical. Cloudflare’s open-source repository ships working verifiers for Workers, a Caddy plugin and Rust, along with the thumbprint and directory logic. It also states plainly that it has not been audited.',
        'Leave the IP allowlists you have in place. Nothing here breaks them, and crawlers that publish ranges still publish them. Just stop treating them as the plan for agent traffic, because for the ChatGPT agent there is no list to treat that way.',
      ],
    },
    { type: 'h2', text: 'What is genuinely not settled' },
    {
      type: 'p',
      text: 'It would be dishonest to present this as finished. The registry and agent card specification is at revision 03, dated June 2026, and it is an individual Internet-Draft. It carries the standard language: not endorsed by the IETF, no formal standing in the standards process. It has not been adopted by a working group. The authors are from Cloudflare and Amazon, which tells you both that it has real implementation weight behind it and that it is not yet a neutral community product.',
    },
    {
      type: 'p',
      text: 'So field names can change, and a card you parse today may need revisiting. That is an argument for reading cards rather than building products on them, which is what almost everyone reading this should be doing anyway.',
    },
    {
      type: 'p',
      text: 'The deeper limit is one no protocol solves: a signature proves identity, not virtue. It tells you the request is genuinely from the operator it claims, and nothing whatsoever about whether that operator will respect your rate limits, honour your robots.txt, or use what it collects the way its card says. Identity is the precondition for accountability, not a substitute for it. What it buys you is that when an agent misbehaves, you now know precisely whose behaviour it was, which is more than the last two years of allowlists ever gave you.',
    },
    {
      type: 'p',
      text: 'The practical posture, then, is unglamorous: stop investing in string matching, find out what your edge provider verifies, and get comfortable with the idea that agent traffic will soon carry proof of origin the way HTTPS carries proof of server. If your catalog and prices are [machine-readable](/learn/product-feeds-for-ai-agents) and your identity [resolves cleanly](/learn/how-agents-identify-your-business), the agents that prove who they are will be able to act on all of it.',
    },
    {
      type: 'cta',
      title: 'Be worth letting in once the agent has proved itself',
      text: 'Verification decides whether an agent gets through. What it finds decides whether anything happens next. Nexez publishes your business as agent-legible, agent-transactable listings from one source: JSON-LD, llms.txt, agent.json, OpenAPI, a per-merchant MCP server, and ACP plus UCP feeds, with real Stripe checkout and Calendly-backed scheduling. Start on Free with no card; paid plans include a 7-day trial.',
      href: '/how-it-works',
      label: 'See how it works',
    },
  ],
  faqs: [
    {
      question: 'Does Web Bot Auth replace robots.txt?',
      answer:
        'No, and they solve different halves of the same problem. Robots.txt states your policy. Web Bot Auth establishes who is asking, so your policy applies to the right party. They connect through the signature agent card, which carries an rfc9309-product-token field naming the exact token an operator answers to in robots.txt. Keep publishing robots.txt.',
    },
    {
      question: 'Is Web Bot Auth an official standard yet?',
      answer:
        'Not yet. The registry and agent card specification is at draft revision 03, dated June 2026, and remains an individual Internet-Draft with no formal standing in the IETF process and no working group adoption. It is nonetheless deployed in production by Cloudflare and used by OpenAI, which is an unusual ordering but not an unprecedented one on the web.',
    },
    {
      question: 'How do I verify a signature if I am not on Cloudflare?',
      answer:
        'Ask your provider first, because several now do this at the edge and it is far less work than building it. If you terminate traffic yourself, Cloudflare publishes an open-source repository with verifiers for Workers, a Caddy plugin and Rust, covering RFC 9421 signatures, RFC 7638 thumbprints and directory validation. The repository notes it has not been audited, so treat it as a starting point rather than a finished dependency.',
    },
    {
      question: 'Can a signature be stolen and replayed against my site?',
      answer:
        'The design makes this hard in two ways. Signature-Input carries created and expires, so a captured signature stops verifying shortly after it was made. And the request authority is among the signed components, so a signature produced for one host fails when replayed against a different one. Neither protection is worth anything if your verifier skips those checks, which is a reason to use an existing implementation.',
    },
    {
      question: 'Which AI agents actually sign their requests today?',
      answer:
        'OpenAI documents signing for its agent, with Signature-Agent set to https://chatgpt.com and keys published at its well-known directory. Cloudflare launched signed agent support with several partners including Block’s Goose, Browserbase and Anchor Browser, and maintains a public bots directory listing verified and signed agents. The roster changes, so check the directory rather than a list in an article, including this one.',
    },
    {
      question: 'Does a signed agent mean I should trust it?',
      answer:
        'It means you can identify it. A valid signature says the request genuinely comes from the operator named in Signature-Agent, and says nothing about whether that operator will respect rate limits or use the data as described. The value is accountability: misbehaviour can now be attributed to a specific party rather than lost in a fog of spoofed strings.',
    },
    {
      question: 'I blocked all AI bots last year. Does this change anything?',
      answer:
        'It changes what the block is costing you, because you can now separate the two cases you were previously forced to treat as one. A blanket block stops training crawlers and also stops agents sent by real customers mid-purchase, and the second cost is invisible in your analytics. The trigger field distinguishes a fetcher acting for a waiting person from a crawler collecting on its own account, which lets you keep the block you wanted and drop the one you did not.',
    },
  ],
}

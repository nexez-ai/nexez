import type { LearnArticle } from '../learn-content'

export const whatStopsAgentsCompletingTasks: LearnArticle = {
  slug: 'what-stops-agents-completing-tasks',
  metaTitle: 'Why Agents Reach Your Site and Still Fail',
  metaDescription:
    'Reachable and readable are the first two gates. Operable is the third, and it is where a buyer with their wallet out quietly turns into nothing.',
  title: 'Why agents reach your site and still fail',
  dek: 'Almost everything written about agent readiness, including most of this library, is about two questions: can a machine reach your pages, and can it understand them. There is a third question that decides whether any of it turns into money, and it is the one nobody instruments. Once an agent is on your site, with a real buyer waiting behind it, can it actually finish?',
  cardSummary:
    'Reachable and readable are the first two gates. Operable is the third, and nobody instruments it.',
  category: 'Agent readiness',
  publishedAt: '2026-09-23',
  updatedAt: '2026-09-23',
  readMinutes: 11,
  blocks: [
    {
      type: 'p',
      text: 'When we scanned 652 small-business websites for the [agent readiness study](/learn/agent-readiness-study-2026), a site counted as invisible if its homepage did not return successfully, or if it offered no parseable structured data and none of the six machine-readable artifacts we probed for. That is a defensible definition and it measures something real. It also stops one step short of the thing that pays.',
    },
    {
      type: 'p',
      text: 'A site can return a clean 200, carry immaculate JSON-LD, and still defeat an agent that is trying to book a table or buy a jacket, because reading and doing are different problems. The agent arrives, understands you perfectly, and then hits a consent wall, or a modal, or a checkout step that assumes a human is holding the mouse. The buyer behind it gets a shrug and goes somewhere easier.',
    },
    { type: 'h2', text: 'Reachable, readable, operable' },
    {
      type: 'p',
      text: 'Three gates, in order, and each one is invisible to the instruments that measure the others.',
    },
    {
      type: 'table',
      headers: ['Gate', 'The question', 'What most advice covers'],
      rows: [
        ['Reachable', 'Can a machine fetch the page at all', 'Thoroughly, robots.txt and edge rules'],
        ['Readable', 'Can it extract facts it can rely on', 'Thoroughly, structured data and feeds'],
        ['Operable', 'Can it complete a task without a human', 'Almost not at all'],
      ],
    },
    {
      type: 'p',
      text: 'The reason for the imbalance is measurement. The first two gates fail loudly and leave evidence: a 403 in your logs, a validator error, a rich result that never appears. The third fails silently. There is no log line for an agent that got to step four of your checkout and gave up, and no support ticket either, because the person it was working for never knew your name.',
    },
    { type: 'h2', text: 'The agent is a browser with a supervisor' },
    {
      type: 'p',
      text: 'It helps to be concrete about what is actually visiting. OpenAI describes its cloud browser as having its own browser on a separate computer, able to read web pages, click buttons, enter information into forms, and carry out steps on supported public and signed-in websites. So it is not a crawler fetching HTML. It is closer to a careful, literal-minded temp who has been told to get something done and will not improvise.',
    },
    {
      type: 'p',
      text: 'That temp has two ways of stopping, and the difference matters. It pauses when it needs your input, a sign-in, or a confirmation, which returns control to the person and is often the correct behaviour. And it hands the task back when it cannot proceed, which OpenAI states plainly: support varies by website and action, and you may need to take over or complete the final step yourself.',
    },
    {
      type: 'callout',
      tone: 'signal',
      title: 'Every handback is a near-miss you will never see',
      text: 'Read that last line as a merchant rather than as a user. It describes a buyer who was far enough along to be asked to finish the job by hand, on a site that could not take them the rest of the way. They may finish. They may go to the competitor whose flow did not need rescuing. Nothing in your analytics distinguishes those two outcomes, because neither one produced a session you can attribute.',
    },
    { type: 'h2', text: 'The obstacle course, in the order an agent meets it' },
    {
      type: 'p',
      text: 'Everything below is ordinary web design. None of it was built to obstruct anyone. All of it was designed for a human with a pointer, a sense of impatience, and the ability to guess what a button means.',
    },
    {
      type: 'table',
      headers: ['Obstacle', 'Why it was added', 'What it costs now'],
      rows: [
        ['Consent banner over the content', 'Compliance, added once, never revisited', 'A gate before the first fact is readable'],
        ['Newsletter or discount modal', 'It lifts email capture', 'Fires on the page the agent came to read'],
        ['Content that only exists after hydration', 'It was easier to build that way', 'Prices and stock absent from the source'],
        ['Multi-step flow holding state in the client', 'It felt smooth to a designer', 'A reload or a slow step loses everything'],
        ['Login required to see a price', 'Trade pricing, or habit', 'Nothing to compare, so nothing to recommend'],
        ['Bot defences on the checkout path', 'Real abuse, genuinely', 'Cannot tell a buyer from an attacker'],
      ],
    },
    {
      type: 'p',
      text: 'Notice that none of these are bugs. Every one of them shipped for a reason a sensible person would defend, which is exactly why they survive. They were all designed against an assumption, that the visitor is a person, which quietly stopped being universally true.',
    },
    {
      type: 'cta',
      title: 'Find out where an agent stops on your site',
      text: 'The free Nexez scanner fetches your site the way an agent does and scores what comes back: crawler access, server-rendered content, structured data, and machine-readable offers. About a minute, no signup.',
      href: '/scan',
      label: 'Scan your site free',
    },
    { type: 'h2', text: 'Your bot defences are now also your customer defences' },
    {
      type: 'p',
      text: 'OpenAI states it without editorialising: some websites use security measures that restrict access from automated browser agents. As a sentence about the web that is neutral. As a sentence about your revenue it is expensive, because the measure that stops a scraper and the measure that stops a customer’s agent are frequently the same measure.',
    },
    {
      type: 'p',
      text: 'The old answer was to pick a side, block aggressively and lose the good traffic, or allow broadly and eat the abuse. That answer is out of date. Signed requests now let an origin tell a named, cryptographically identified agent apart from an anonymous one, which turns a binary into a policy. [How to verify an AI agent](/learn/how-to-verify-ai-agents) covers the mechanism; the point here is simply that you no longer have to choose blindly, and a bot rule written before that changed is a rule worth rereading.',
    },
    { type: 'h2', text: 'What your server says when it says no' },
    {
      type: 'p',
      text: 'Sometimes refusing is correct. You are under load, or the request really is abusive, or the thing is gone. Refusing is not the problem. Refusing uninformatively is, because status codes are the only vocabulary you share with something that will never read your error page.',
    },
    {
      type: 'table',
      headers: ['You send', 'An agent reasonably concludes', 'Right when'],
      rows: [
        ['403', 'I am not allowed here, and will not be', 'You mean it permanently'],
        ['429', 'I am going too fast, slow down and return', 'Rate limiting, and you say when'],
        ['503', 'Temporarily down, come back later', 'Maintenance or overload'],
        ['200 with an error in the body', 'Everything is fine, this is the content', 'Never'],
      ],
    },
    {
      type: 'p',
      text: 'The last row is the common one and it is the worst, because it is the only failure that also poisons your data. An agent that receives a successful response containing the words "something went wrong" has no way to know that is not your page, and may cache it, quote it, or treat the absence of a price as a fact about your pricing.',
    },
    {
      type: 'p',
      text: 'The missing half of a good refusal is Retry-After, which is a single header carrying either a number of seconds or an HTTP date, and which is used with 503, 429 and 301. A bare 429 tells an agent it went too fast and nothing about when it may return, so it guesses, and its guess is either too soon, which looks like abuse, or too late, which is a sale that happened somewhere else. One header removes the guess.',
    },
    {
      type: 'callout',
      tone: 'amber',
      title: 'Check what your edge returns under load, not just what your app returns',
      text: 'Most merchants have never seen their own 429. It is usually emitted by a CDN or WAF rather than by application code, which means the team that would think to add Retry-After never touches the response that needs it. Trigger one deliberately in staging and read the actual headers.',
    },
    { type: 'h2', text: 'Make the commitment point obvious, because the agent is looking for it' },
    {
      type: 'p',
      text: 'This is the part that is genuinely about design rather than plumbing. OpenAI says its agent is built to request confirmation before actions that could be hard to reverse or create a financial, legal, account, or other real-world commitment. That is a sensible safety property, and it is also a structural assumption about your site: that there is a recognisable moment where commitment happens.',
    },
    {
      type: 'p',
      text: 'Flows that have one clear, well-labelled commit step work with that assumption. Flows that scatter commitment, that charge on a screen which looks like navigation, that bury the irreversible action behind a button labelled Continue, fight it. The agent either stops too early, and the buyer is asked to take over for no reason, or it cannot identify the moment at all and stops short.',
    },
    {
      type: 'p',
      text: 'The instruction that follows is unfashionable: label the irreversible thing as irreversible. A button that says Place order and charge my card is worse marketing copy and a better commit signal, for the machine and, as it happens, for the human being represented by it.',
    },
    { type: 'h2', text: 'Twenty minutes to find out where you stand' },
    {
      type: 'ol',
      items: [
        'Fetch your own product or booking page with curl and read the raw HTML. If the price, the availability or the button text is not in that output, it does not exist for anything that does not run a browser.',
        'Open the same page in a browser with JavaScript disabled. This is the crudest possible proxy for the readable gate and it takes thirty seconds.',
        'Now do the operable test, which nobody does: open a private window, go to your own site, and complete a real purchase or booking without using any knowledge you have as the owner. Count every interruption. Each one is a place an agent can stop.',
        'Ask an actual assistant to do the same task on your site, and watch where it hands back. The handback point is your answer, and it is usually not where you expected.',
        'Trigger a rate limit in staging and read the response headers. Check for Retry-After, and check that your failures are not 200s carrying apologies.',
        'Grep your logs for 403s and 429s served to named agents, which [measuring AI agent traffic](/learn/measure-ai-agent-traffic) covers properly. A wall of them means the first gate is failing and the other two never got a turn.',
      ],
    },
    {
      type: 'p',
      text: 'The third item is the one people skip and it is the one that finds things. Owners cannot fail their own checkout, because they know which button is which, which field is optional and what the confusing step actually means. An agent knows none of that. It reads exactly what is written and does exactly what the interface implies, which makes it an unusually honest usability tester that costs nothing and never gets bored.',
    },
    {
      type: 'p',
      text: 'None of this is a structured data problem, which is why it survives in businesses that have done the structured data work properly. Being found is a solved discipline with tools and validators. Being finishable is not, and for now the merchants who take the twenty minutes are competing against a field that has not thought about it at all.',
    },
    {
      type: 'cta',
      title: 'Be readable and operable, from one source',
      text: 'Nexez publishes your business as agent-legible, agent-transactable listings from a single source: JSON-LD, llms.txt, agent.json, OpenAPI, a per-merchant MCP server, and ACP plus UCP feeds, with real Stripe checkout and Calendly-backed scheduling behind them. An agent can read the facts and complete the action without a browser in the middle. Start on Free with no card; paid plans include a 7-day trial.',
      href: '/how-it-works',
      label: 'See how it works',
    },
  ],
  faqs: [
    {
      question: 'My site has perfect structured data. Why would an agent still fail?',
      answer:
        'Because structured data answers what is true about you, not how to do something on your site. An agent that has read your price flawlessly still has to dismiss a consent banner, get past a discount modal, hold state across a multi-step checkout and identify the commit button. Those are separate from markup, they fail silently, and no validator checks them.',
    },
    {
      question: 'What does the ChatGPT agent actually do on a website?',
      answer:
        'OpenAI describes its cloud browser as running its own browser on a separate machine, able to read pages, click buttons, enter information into forms and carry out steps on supported public and signed-in sites. It pauses when it needs input, a sign-in or a confirmation, and OpenAI notes that support varies by website and action and that a user may need to take over or complete the final step themselves.',
    },
    {
      question: 'Do cookie banners block AI agents?',
      answer:
        'They do not block a crawler fetching raw HTML, which is why they rarely appear in crawler diagnostics. They are a real obstacle for a browsing agent, which sees the same overlay a person does and has to dismiss it correctly before reaching the content. The cost is not the banner itself but the fact that it sits between an arriving agent and the first fact it came for.',
    },
    {
      question: 'Should I stop blocking bots so agents can buy from me?',
      answer:
        'No, and that framing is out of date. OpenAI notes that some websites use security measures restricting access from automated browser agents, which is a real tension, but signed requests now let an origin distinguish a named, cryptographically identified agent from an anonymous one. That turns a blunt allow-or-block decision into a policy. Reread bot rules written before that was possible.',
    },
    {
      question: 'What HTTP status should I return to an agent I am rate limiting?',
      answer:
        '429, with a Retry-After header. Retry-After carries either a number of seconds or an HTTP date and is used with 429, 503 and 301. Without it an agent knows it went too fast but not when it may return, so it guesses, and both directions of that guess cost you something. Never return 200 with an error message in the body, since that is indistinguishable from real content.',
    },
    {
      question: 'How do I test whether an agent can complete a purchase on my site?',
      answer:
        'Ask one to, and watch where it stops. Then do the same task yourself in a private window using only what is written on the screen, with none of the knowledge you have as the owner, counting every interruption. Owners cannot fail their own checkout because they know which button means what, which is exactly why owner testing misses this class of problem.',
    },
    {
      question: 'Why does the commit button wording matter to an agent?',
      answer:
        'Because OpenAI states its agent requests confirmation before actions that are hard to reverse or that create a financial, legal, account or other real-world commitment, which assumes your flow has a recognisable commitment moment. A button labelled Continue that in fact charges a card gives it nothing to recognise. Place order and charge my card is weaker marketing copy and a much stronger signal.',
    },
  ],
}

import type { LearnArticle } from '../learn-content'

export const whenAiGetsYourBusinessWrong: LearnArticle = {
  slug: 'when-ai-gets-your-business-wrong',
  metaTitle: 'What to Do When AI Gets Your Business Wrong',
  metaDescription:
    'Most wrong answers about your business are retrieval failures, not model failures, and those you can fix this afternoon. How to tell which you have.',
  title: 'What to do when an AI gets your business wrong',
  dek: 'An assistant tells a customer you close at five when you close at nine, or that you are permanently shut, or quotes a price you retired last year. The instinct is to look for someone to complain to. That is almost always the wrong first move, because most wrong answers are not the model being wrong about you. They are the model faithfully repeating something wrong that it found, and that is a different problem with a much better fix.',
  cardSummary:
    'Most wrong answers are retrieval failures, not model failures, and those you can fix this afternoon.',
  category: 'Agent readiness',
  publishedAt: '2026-09-19',
  updatedAt: '2026-09-19',
  readMinutes: 10,
  blocks: [
    {
      type: 'p',
      text: 'Every operator eventually has the same afternoon. Someone asks an assistant about your business, reads the answer aloud, and it is wrong in a way that costs you money. The hours are stale. The price is from a promotion that ended. It says you closed. It has confused you with a similarly named business two suburbs over.',
    },
    {
      type: 'p',
      text: 'What follows is usually an hour spent looking for a contact form, and the hour is wasted, because the question you need to answer first is not who to complain to. It is which of two completely different failures you are looking at, since they have opposite remedies and only one of them is genuinely under your control.',
    },
    { type: 'h2', text: 'Two kinds of wrong, and only one is worth your afternoon' },
    {
      type: 'p',
      text: 'When an assistant says something about your business, the claim arrived by one of two routes, and telling them apart is the whole job.',
    },
    {
      type: 'table',
      headers: ['Route', 'Where the claim came from', 'What fixing it looks like'],
      rows: [
        ['Retrieval', 'Something it fetched or looked up just now', 'Correct the source, and the answer changes'],
        ['Parametric', 'Patterns absorbed during training, months ago', 'Request a review and wait, with no guarantee'],
      ],
    },
    {
      type: 'p',
      text: 'Merchants overwhelmingly assume they are in the second row, which is why the reaction is despair. In practice, for a local business or a retailer, almost everything is the first row. Your hours, your address, your prices, your stock, your open-or-closed status: these are exactly the volatile facts assistants look up rather than remember, because a model trained six months ago would be useless at them.',
    },
    {
      type: 'p',
      text: 'That is good news dressed as bad news. A retrieval failure means some specific record, somewhere, currently says the wrong thing, and records can be edited. You are not arguing with a model. You are fixing a data entry problem that happens to have an audience.',
    },
    { type: 'h2', text: 'Ask it to cite, and you have your diagnosis' },
    {
      type: 'p',
      text: 'The test takes about two minutes and settles the question. Ask the assistant the question your customer asked, and then ask it where it got that. Do it in each assistant your customers actually use, because they draw on different sources and one being wrong does not mean all of them are.',
    },
    {
      type: 'ul',
      items: [
        'It names a source you can open: retrieval. Go and look at that source, because it almost certainly says the wrong thing, and it is the thing to fix.',
        'It cites nothing and cannot produce a source when asked: either parametric, or it made the claim up on the spot. Treat these the same way, because your options are identical.',
        'It cites a source that actually says the right thing: the model misread it. Usually this means your page states the fact in a form that resists parsing, in an image, in a PDF, or buried in prose.',
        'It describes a business that is not yours: not a facts problem at all. That is entity resolution, and [how agents identify your business](/learn/how-agents-identify-your-business) covers why it happens.',
      ],
    },
    {
      type: 'callout',
      tone: 'signal',
      title: 'Do the test before you do anything else',
      text: 'Nearly all the wasted effort in this situation comes from skipping it. People file complaints about retrieval failures and rewrite their website over parametric ones. Two minutes of asking where that came from tells you which afternoon you are about to have.',
    },
    { type: 'h2', text: 'Retrieval wrong: fix the record, not the answer' },
    {
      type: 'p',
      text: 'For a business with a physical location, the record in question is usually your Google Business Profile, and the mechanics of editing it are more interesting than they look.',
    },
    {
      type: 'p',
      text: 'An edit you submit lands in one of three states. Accepted, and the new information displays. Pending, still under review. Or not approved, and Google states the reason plainly: it might not approve changes if it cannot confirm their accuracy. Review usually takes up to ten minutes, though Google notes it can take up to thirty days.',
    },
    {
      type: 'callout',
      tone: 'amber',
      title: 'The reason your correction did not stick',
      text: 'That third state is where most people give up, and they misread it as arbitrary. It is not. Google is checking your claim against what it can see elsewhere, so an edit that contradicts your own website, your directory listings and your social profiles is an edit it cannot confirm. The fix is not to resubmit. It is to make the fact true everywhere else first, then edit, so there is something to confirm it against.',
    },
    {
      type: 'p',
      text: 'That reframes the work. Correcting one record is not a support ticket, it is a consistency pass, and the order matters: your own website first, because it is the source you fully control and the one crawlers weight most heavily, then your profiles, then the directories that syndicate to everyone else. [Where local recommendations actually come from](/learn/ai-search-local-businesses) works through the four sources in the order they matter.',
    },
    {
      type: 'p',
      text: 'It also explains the more unsettling behaviour, which is a profile changing under you. Google says that if it receives reports that your business information is not accurate, it might update your profile, and that you will get a notification and an alert in the edit section when that happens. Those alerts are worth reading rather than dismissing, because they are the early warning that something in your wider footprint is now contradicting you.',
    },
    {
      type: 'cta',
      title: 'See which of your facts an agent can actually read',
      text: 'The free Nexez scanner fetches your site the way an agent does and scores what comes back: crawler access, server-rendered content, structured data, and machine-readable offers. About a minute, no signup.',
      href: '/scan',
      label: 'Scan your site free',
    },
    { type: 'h2', text: 'You were never the only author of your own record' },
    {
      type: 'p',
      text: 'Worth knowing why this keeps happening rather than treating each incident as a one-off. Google documents that it builds business information from several sources at once: publicly available crawled content including your own website, licensed data from third parties, contributions from users, information from owners, and its own interactions with the place. Anyone can suggest an edit to a profile, including people who are not you.',
    },
    {
      type: 'p',
      text: 'So your record is a consensus rather than a statement, and the practical consequence is that vagueness loses. Where you state a fact clearly, unambiguously and in a machine-readable form, you tend to win the consensus. Where you leave a gap, something fills it, and [typed structured data](/learn/json-ld-for-ai-agents) is the cheapest way to stop leaving gaps.',
    },
    { type: 'h2', text: 'Parametric wrong: what the vendors actually offer' },
    {
      type: 'p',
      text: 'Now the harder case, and it deserves an honest answer rather than a hopeful one.',
    },
    {
      type: 'p',
      text: 'OpenAI’s privacy policy is unusually direct about the underlying problem. It explains that models generate responses by predicting the words most likely to appear next, that in some cases those words may not be the most factually accurate, and it tells users plainly that they should not rely on the factual accuracy of output from the models. That is the vendor, in its own policy, describing the limit.',
    },
    {
      type: 'p',
      text: 'There is a route for factual inaccuracies about a person: requests go through privacy.openai.com or to the data subject address, and OpenAI says it will consider the request based on applicable law and the technical capabilities of its models. Read that last clause carefully, because it is doing a lot of work. The company is telling you in advance that a correction may not be technically possible.',
    },
    {
      type: 'p',
      text: 'There is also a scoping catch that most advice on this topic gets wrong. That channel is a privacy channel, built for personal data about individuals. A limited company is not a person, so a business complaining about a wrong opening time is not obviously making a data protection request at all. A sole trader whose business name is their own name sits in a genuinely different position from an incorporated company, and if what is being said about you is not merely inaccurate but unlawful, that is a question for a lawyer rather than a support form.',
    },
    {
      type: 'p',
      text: 'Google is similarly candid about its Search experiences. Its documentation states that AI Overviews can and will make mistakes, and advises checking important information in more than one place. The recourse offered is a thumbs-down and a report a problem link, and Google describes that feedback as helping it improve the feature. Note what that is and is not: it is a signal fed into product development, not a ticket that returns a corrected answer. Submitting it is worth ninety seconds. Waiting on it is not a plan.',
    },
    {
      type: 'p',
      text: 'Which leads to the conclusion people resist, and which is nonetheless the useful one: for the parametric case, the leverage is not in the complaint. It is in making the correct version of the fact so abundant, so consistent and so easy to retrieve that retrieval wins on the next answer, whatever is sitting in the weights.',
    },
    { type: 'h2', text: 'The order to work in' },
    {
      type: 'ol',
      items: [
        'Reproduce it. Get the exact prompt and the exact wrong output, in each assistant your customers use. Screenshot it, because these answers are not stable and you will want the record.',
        'Ask where that came from. Two minutes, and it determines everything that follows.',
        'If it cited a source, open it. Fix the record at that source. If it is your own site, fix the page and make sure the fact is in text rather than in an image or a PDF.',
        'Make it consistent before you submit corrections. Your website, then your profiles, then your directories. A correction that contradicts everything else is a correction that cannot be confirmed.',
        'Submit the profile edit and expect it inside ten minutes, but allow up to thirty days, and check the edit status rather than assuming it went through.',
        'State the volatile facts in structured data: hours, prices, availability, and whether you are open. These are the ones that go stale and the ones a machine most needs stated in a typed form.',
        'Leave the feedback. Thumbs down and report a problem where offered. It costs a minute and it is the only direct signal you have.',
        'Re-test in a week, in a fresh session so nothing is carried over from the last conversation.',
      ],
    },
    {
      type: 'p',
      text: 'The pattern underneath all of it is unglamorous and it is the same one that runs through this whole library. You cannot argue an assistant out of a belief. You can make the correct answer the easiest one to find, state it in a form that does not require interpretation, and repeat it in every place a machine looks. That is slower than a complaint and it is the only part that reliably works.',
    },
    {
      type: 'cta',
      title: 'Say it once, publish it everywhere a machine looks',
      text: 'Nexez publishes your business as agent-legible, agent-transactable listings from a single source: JSON-LD, llms.txt, agent.json, OpenAPI, a per-merchant MCP server, and ACP plus UCP feeds, with real Stripe checkout and Calendly-backed scheduling. One set of facts, updated in one place, with no copies left behind to contradict you. Start on Free with no card; paid plans include a 7-day trial.',
      href: '/how-it-works',
      label: 'See how it works',
    },
  ],
  faqs: [
    {
      question: 'How do I tell whether an AI is repeating bad data or just making it up?',
      answer:
        'Ask it where the claim came from. If it names a source you can open, it is retrieval, and that source is what you need to fix. If it cannot produce one, the claim is either baked in from training or fabricated in the moment, and your options are the same in both cases. This single question separates the problems you can solve today from the ones you can only influence over time.',
    },
    {
      question: 'Why was my Google Business Profile correction not approved?',
      answer:
        'Google states it might not approve changes when it cannot confirm their accuracy, so an edit that contradicts your website, your directory listings and your other profiles has nothing corroborating it. Resubmitting rarely helps. Make the fact consistent everywhere else first, starting with your own site, then submit the edit so there is something for Google to check it against.',
    },
    {
      question: 'How long does a Business Profile edit take to appear?',
      answer:
        'Google says edits usually take up to ten minutes to review, but that it can sometimes take up to thirty days. Edits land in one of three states, accepted, pending or not approved, so check the status rather than assuming silence means success. A rejected edit can be appealed.',
    },
    {
      question: 'Can Google change my business information without me?',
      answer:
        'Yes. Google documents that if it receives reports your business information is not accurate it might update your profile, and that you will get a notification plus an alert in the edit section. It builds profiles from several sources including crawled web content, licensed third-party data, user contributions and its own interactions, so your record is a consensus rather than only your statement.',
    },
    {
      question: 'Can I make ChatGPT correct something it says about my company?',
      answer:
        'There is a route for factual inaccuracies about a person, through privacy.openai.com or the data subject address, and OpenAI says it will consider requests based on applicable law and the technical capabilities of its models. Two caveats matter. That is a privacy channel scoped to personal data, so an incorporated company is in a weaker position than a sole trader trading under their own name, and the reference to technical capability is the company saying in advance that correction may not be possible.',
    },
    {
      question: 'Does reporting a problem on an AI Overview get it removed?',
      answer:
        'Not as a rule. Google offers a thumbs-down and a report a problem link, and describes that feedback as helping improve AI Overviews. That is a product signal rather than a ticket that returns a corrected answer. It is worth the minute it takes, but it should not be the plan, and Google states outright that AI Overviews can and will make mistakes.',
    },
    {
      question: 'An assistant is describing a different business as if it were mine. Is that the same problem?',
      answer:
        'No, and treating it as a facts problem will waste your time. That is entity resolution failing, which means your records are not linking to each other clearly enough for a machine to tell you apart from a similarly named business. The fix is identity markup and consistency across your profiles rather than correcting any individual claim.',
    },
  ],
}

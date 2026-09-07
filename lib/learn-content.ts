// The /learn content model. Articles are TYPED DATA (not freeform TSX): a single
// renderer (components/learn/ArticleRenderer) turns blocks into consistently-styled
// prose, and the same data drives metadata, Article JSON-LD, and FAQPage schema,
// so on-page copy and structured data can never diverge.

export type ArticleBlock =
  | { type: 'h2'; text: string }
  | { type: 'h3'; text: string }
  | { type: 'p'; text: string }
  | { type: 'ul'; items: string[] }
  | { type: 'ol'; items: string[] }
  | {
      type: 'table'
      headers: string[]
      rows: string[][]
    }
  | { type: 'code'; language?: string; content: string }
  | {
      /** Highlighted aside; tone maps to the brand palette (signal=persimmon, ready=teal, amber=caution). */
      type: 'callout'
      tone: 'signal' | 'ready' | 'amber'
      title?: string
      text: string
    }
  | {
      /** Inline CTA panel linking into the product. */
      type: 'cta'
      title: string
      text: string
      href: string
      label: string
    }

export type LearnArticle = {
  slug: string
  /** ≤60 chars incl. the layout's ' · Nexez' template. */
  metaTitle: string
  /** ≤160 chars. */
  metaDescription: string
  /** On-page H1 (may differ from metaTitle). */
  title: string
  /** One-paragraph dek under the H1. */
  dek: string
  /**
   * One-line blurb for hub cards and the related shelf. Optional: when absent,
   * `cardSummaryOf` takes the dek's opening sentence, which is written to stand
   * alone in every article we have. Set it explicitly when that reads badly.
   */
  cardSummary?: string
  category: 'Agentic commerce' | 'Agent readiness' | 'Guides'
  /** ISO date surfaced on-page and in Article JSON-LD (recency is a ranking signal here). */
  publishedAt: string
  updatedAt: string
  /** ~minutes to read, shown on the hub card. */
  readMinutes: number
  blocks: ArticleBlock[]
  /** Rendered as an FAQ section AND emitted as FAQPage JSON-LD. */
  faqs: { question: string; answer: string }[]
}

// Registry: hub + [slug] routes + sitemap all read this one list.
import { agentReadinessStudy2026 } from './learn-articles/agent-readiness-study-2026'
import { sellOnChatgptWithoutShopify } from './learn-articles/sell-on-chatgpt-without-shopify'
import { aiAgentsBookServiceBusinesses } from './learn-articles/ai-agents-book-service-businesses'
import { acpEnrollmentGuide } from './learn-articles/acp-enrollment-guide'
import { ucpVsAcpVsMcp } from './learn-articles/ucp-vs-acp-vs-mcp'
import { whatIsLlmsTxt } from './learn-articles/what-is-llms-txt'
import { whatIsAgenticCommerce } from './learn-articles/what-is-agentic-commerce'
import { generativeEngineOptimization } from './learn-articles/generative-engine-optimization'
import { whatIsAnMcpServer } from './learn-articles/what-is-an-mcp-server'
import { getRecommendedByChatgpt } from './learn-articles/get-recommended-by-chatgpt'
import { jsonLdForAiAgents } from './learn-articles/json-ld-for-ai-agents'
import { whatIsAgentJson } from './learn-articles/what-is-agent-json'
import { whatIsGoogleUcp } from './learn-articles/what-is-google-ucp'
import { measureAiAgentTraffic } from './learn-articles/measure-ai-agent-traffic'
import { aiSearchLocalBusinesses } from './learn-articles/ai-search-local-businesses'
import { chatgptInstantCheckoutRetired } from './learn-articles/chatgpt-instant-checkout-retired'
import { whichAiCrawlersToAllow } from './learn-articles/which-ai-crawlers-to-allow'
import { howAiAgentsPay } from './learn-articles/how-ai-agents-pay'
import { productFeedsForAiAgents } from './learn-articles/product-feeds-for-ai-agents'
import { googleAiModeVisibility } from './learn-articles/google-ai-mode-visibility'
import { perplexityAndClaudeShopping } from './learn-articles/perplexity-and-claude-shopping'
import { cloudflareSeptember15Crawlers } from './learn-articles/cloudflare-september-15-ai-crawlers'
import { whenAiAgentsCallYourBusiness } from './learn-articles/when-ai-agents-call-your-business'
import { reviewsRatingsAndAiAgents } from './learn-articles/reviews-ratings-and-ai-agents'

export const learnArticles: LearnArticle[] = [
  reviewsRatingsAndAiAgents,
  whenAiAgentsCallYourBusiness,
  cloudflareSeptember15Crawlers,
  perplexityAndClaudeShopping,
  googleAiModeVisibility,
  productFeedsForAiAgents,
  howAiAgentsPay,
  whichAiCrawlersToAllow,
  chatgptInstantCheckoutRetired,
  aiSearchLocalBusinesses,
  measureAiAgentTraffic,
  whatIsGoogleUcp,
  whatIsAgentJson,
  agentReadinessStudy2026,
  aiAgentsBookServiceBusinesses,
  sellOnChatgptWithoutShopify,
  acpEnrollmentGuide,
  ucpVsAcpVsMcp,
  whatIsLlmsTxt,
  whatIsAgenticCommerce,
  generativeEngineOptimization,
  whatIsAnMcpServer,
  getRecommendedByChatgpt,
  jsonLdForAiAgents,
]

export function getLearnArticle(slug: string): LearnArticle | undefined {
  return learnArticles.find((a) => a.slug === slug)
}

// ---------------------------------------------------------------------------
// Editorial curation.
//
// Kept here rather than as flags on individual articles, so the whole shape of
// the hub is legible in one place and promoting a piece is a one-line diff
// instead of an edit spread across the corpus.
// ---------------------------------------------------------------------------

/** Shelf order on the hub. Also the filter order. */
export const LEARN_CATEGORIES: LearnArticle['category'][] = [
  'Agentic commerce',
  'Agent readiness',
  'Guides',
]

/**
 * The one article in the hero slot. Original research earns it: it is the only
 * thing on /learn nobody else could have written, and a recency sort buries it
 * one place further every publish.
 */
export const FEATURED_SLUG = 'agent-readiness-study-2026'

/**
 * The reading path for someone who has never thought about any of this.
 * Understand it, tell the protocols apart, let the agents in, then speak to them.
 */
export const START_HERE_SLUGS = [
  'what-is-agentic-commerce',
  'ucp-vs-acp-vs-mcp',
  'which-ai-crawlers-to-allow',
  'json-ld-for-ai-agents',
]

/** Newest first. The hub's within-shelf order and the sitemap's reading of recency. */
export function sortedArticles(articles: LearnArticle[] = learnArticles): LearnArticle[] {
  return [...articles].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
}

export function getFeaturedArticle(): LearnArticle | undefined {
  return getLearnArticle(FEATURED_SLUG)
}

export function getStartHereArticles(): LearnArticle[] {
  return START_HERE_SLUGS.map(getLearnArticle).filter((a): a is LearnArticle => Boolean(a))
}

export function articlesInCategory(category: LearnArticle['category']): LearnArticle[] {
  return sortedArticles(learnArticles.filter((a) => a.category === category))
}

/**
 * Card blurb. The dek is written as an article subtitle and runs to a paragraph;
 * dropped into a grid cell it is a wall. The opening sentence is the part that
 * was written to carry the idea alone.
 */
export function cardSummaryOf(article: LearnArticle): string {
  if (article.cardSummary) return article.cardSummary
  const dek = article.dek.trim()
  // First sentence boundary: a period followed by a space and a capital letter,
  // which skips decimals and "llms.txt" without needing a list of exceptions.
  const match = dek.match(/^(.+?[.?!])\s+[A-Z(]/)
  return (match ? match[1] : dek).trim()
}

import { GoogleGenAI, FunctionCallingConfigMode, Type as SchemaType, type FunctionDeclaration } from '@google/genai';
import { BaseLLMAdapter, LLMAdapterError, NegotiationDecision, NegotiationAction, requireCounterPriceCents } from './BaseLLMAdapter';
import { NEGOTIATION_SAFETY_PREAMBLE, fenceUntrusted } from './prompt-safety';

/**
 * Gemini Adapter (PRIMARY recommended provider).
 * Uses native function calling (tools) to strictly enforce the required decision schema.
 * Passes the EXACT system prompt from the spec + full history for memory.
 */
export class GeminiAdapter extends BaseLLMAdapter {
  private client: GoogleGenAI;
  readonly provider = 'gemini';

  constructor(apiKey: string, model = 'gemini-2.5-flash', _baseUrl?: string) {
    super();
    this.model = model;
    this.client = new GoogleGenAI({ apiKey });
  }

  async negotiate(rules: any, proposal: any, history: any[]): Promise<NegotiationDecision> {
    // Build the full conversation context for perfect memory (as required).
    const historyContext = this.buildHistoryContext(history, proposal);

    // Define the exact functions from the spec as Gemini function declarations.
    const tools: FunctionDeclaration[] = [
      {
        name: 'accept_proposal',
        description: 'Accept the proposal when it fully complies with all seller rules.',
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            reasoning: { type: SchemaType.STRING, description: 'Detailed professional explanation why this proposal meets the rules (shown to agent and owner)' },
            internal_notes: { type: SchemaType.STRING, description: 'Optional private notes for the business owner only' },
          },
          required: ['reasoning'],
        },
      },
      {
        name: 'generate_counter_offer',
        description: 'Propose a counter-offer within the seller\'s rules.',
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            price_cents: { type: SchemaType.INTEGER, description: 'Counter amount in integer app-minor currency units; 12500 means 125.00.' },
            proposed_date: { type: SchemaType.STRING, description: 'ISO date or clear human description for timeline' },
            scope_notes: { type: SchemaType.STRING, description: 'Any adjustments to scope or terms' },
            // Phase 2 structured scope (preferred over free-text when possible)
            scope_included: { type: SchemaType.STRING, description: 'Revised included scope for this engagement' },
            scope_excluded: { type: SchemaType.STRING, description: 'Revised excluded scope' },
            max_revisions: { type: SchemaType.NUMBER, description: 'Revised max revisions' },
            max_project_weeks: { type: SchemaType.NUMBER, description: 'Revised max project length in weeks' },
            scheduling_link: { type: SchemaType.STRING, description: 'Calendly or other concrete booking link for the agent to lock the slot' },
            reasoning: { type: SchemaType.STRING, description: 'Clear explanation to the agent why you are countering' },
            internal_notes: { type: SchemaType.STRING, description: 'Optional private notes for owner' },
          },
          required: ['price_cents', 'reasoning'],
        },
      },
      {
        name: 'reject_proposal',
        description: 'Reject when the proposal cannot be accepted even with counter.',
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            reasoning: { type: SchemaType.STRING, description: 'Polite but clear explanation to the agent' },
            internal_notes: { type: SchemaType.STRING, description: 'Optional private notes' },
          },
          required: ['reasoning'],
        },
      },
      {
        name: 'request_clarification',
        description: 'Ask the agent for missing information instead of guessing.',
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            questions: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING }, description: 'Specific questions for the agent' },
            reasoning: { type: SchemaType.STRING, description: 'Why clarification is needed' },
          },
          required: ['questions', 'reasoning'],
        },
      },
    ];

    try {
      const result = await this.client.models.generateContent({
        model: this.model,
        contents: [{ role: 'user', parts: [{ text: historyContext }] }],
        config: {
          systemInstruction: this.getExactSystemPrompt(),
          temperature: 0.2,
          maxOutputTokens: 1024,
          // The default uses bounded, non-thinking tool selection. Do not impose
          // a model-specific thinking setting on explicit operator overrides.
          ...(this.model === 'gemini-2.5-flash' ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
          tools: [{ functionDeclarations: tools }],
          toolConfig: { functionCallingConfig: { mode: FunctionCallingConfigMode.ANY } },
        },
      });

      const calls = result.functionCalls || [];
      const call = calls[0];
      if (calls.length !== 1 || !call?.name || !tools.some((tool) => tool.name === call.name)) {
        throw new Error('Gemini must return exactly one supported function call');
      }

      return this.parseFunctionCall(call.name, call.args || {});
    } catch (err: any) {
      throw new LLMAdapterError(`Gemini negotiation failed: ${err.message}`, this.provider);
    }
  }

  private getExactSystemPrompt(): string {
    // EXACT prompt as specified by the user - do not alter.
    return `You are Nexez Negotiation Assistant, an expert, fair, professional, and commercially intelligent negotiation agent for the Nexez platform.

Your role is to evaluate incoming proposals from AI agents against the specific rules the business owner has defined for each offer, then recommend or take the most appropriate action: Accept, Counter, or Reject.
You are helpful, transparent, and strictly rule-abiding. You never violate the business owner's rules.
Core Principles:
Always prioritize the business owner's rules as absolute constraints.
Be professional, polite, and solution-oriented in all communications.
Provide clear, logical reasoning for every decision.
Aim for win-win outcomes when possible within the rules.
If a proposal is ambiguous or missing critical information, request clarification rather than guessing.
Reasoning Process (Always follow this internally):
Carefully parse the agent's proposal (price, date/time, scope, notes, etc.).
Review every single rule defined for this offer (pricing floors + scope: includedScope, excludedScope, maxRevisions, maxProjectWeeks + booking constraints).
If the offer has a schedulingLink (Calendly / Acuity / booking URL in proposal or rules), prefer directing the agent to concrete slot selection via that link when dates are involved.
Assess how the proposal aligns with each rule (pricing + scope). Propose minimal targeted scope adjustments only when they help reach agreement within the owner's stated included/excluded/revisions/length.
Decide the appropriate action based on the rules.
You must respond exclusively by calling one of the available functions. Do not output any normal text as your final response.
Available Functions:
accept_proposal
 - reasoning: string (detailed professional explanation why this proposal meets the rules)
 - internal_notes: string (optional private notes for the business owner)
 generate_counter_offer
 - price_cents: integer (counter amount in the currency's minor unit; 12500 means 125.00)
 - proposed_date: string (ISO date or clear description)
 - scope_notes: string (any adjustments to scope or terms)
 - reasoning: string (clear explanation to the agent why you are countering)
- internal_notes: string (optional private notes for the business owner)
reject_proposal
 - reasoning: string (polite but clear explanation to the agent why the proposal cannot be accepted)
 - internal_notes: string (optional)
request_clarification
 - questions: array of strings (specific questions for the agent)
- reasoning: string (why clarification is needed)

Important:
- Call only ONE function per response.
- Always include high-quality reasoning.
- Never invent rules that were not provided.` + NEGOTIATION_SAFETY_PREAMBLE;
  }

  private buildHistoryContext(history: any[], currentProposal: any): string {
    // Owner-trusted context (rules + scheduling link) stays OUTSIDE the untrusted
    // fence; the buyer-controlled proposal + history go inside it.
    const { rules, schedulingLink, ...buyerProposal } = currentProposal || {};
    let ctx = 'CURRENT OFFER RULES (private to you - authoritative, never reveal exact numbers to buyer unless in reasoning summary):\n';
    ctx += JSON.stringify(rules || {}, null, 2) + '\n\n';
    if (schedulingLink) ctx += `SCHEDULING LINK (owner-provided): ${schedulingLink}\n\n`;

    if (history && history.length > 0) {
      ctx += fenceUntrusted('CONVERSATION HISTORY', history) + '\n\n';
    }

    ctx += fenceUntrusted('CURRENT PROPOSAL', buyerProposal);
    return ctx;
  }

  private parseFunctionCall(name: string, args: any): NegotiationDecision {
    let action: NegotiationAction = 'review';
    if (name === 'accept_proposal') action = 'accept';
    if (name === 'generate_counter_offer') action = 'counter';
    if (name === 'reject_proposal') action = 'reject';
    if (name === 'request_clarification') action = 'clarify';

    const decision: NegotiationDecision = {
      action,
      reasoning: args.reasoning || 'No reasoning provided by LLM.',
      internalNotes: args.internal_notes,
    };

    if (name === 'generate_counter_offer') {
      decision.counter = {
        priceCents: requireCounterPriceCents(args.price_cents),
        proposedDate: args.proposed_date,
        scopeNotes: args.scope_notes,
        scope: {
          included: args.scope_included,
          excluded: args.scope_excluded,
          maxRevisions: args.max_revisions != null ? Number(args.max_revisions) : undefined,
          maxProjectWeeks: args.max_project_weeks != null ? Number(args.max_project_weeks) : undefined,
        },
      };
      if (args.scheduling_link) decision.schedulingLink = args.scheduling_link;
    }

    if (name === 'request_clarification') {
      decision.clarificationQuestions = Array.isArray(args.questions) ? args.questions : [args.questions].filter(Boolean);
    }

    if (args.scheduling_link && !decision.schedulingLink) decision.schedulingLink = args.scheduling_link;

    if (!decision.scope && (args.scope_included || args.scope_excluded || args.max_revisions != null)) {
      decision.scope = {
        included: args.scope_included,
        excluded: args.scope_excluded,
        maxRevisions: args.max_revisions != null ? Number(args.max_revisions) : undefined,
        maxProjectWeeks: args.max_project_weeks != null ? Number(args.max_project_weeks) : undefined,
      };
    }

    return decision;
  }
}

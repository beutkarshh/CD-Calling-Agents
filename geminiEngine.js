// geminiEngine.js — Enhanced AI conversation brain with multilingual support and rate limiting

import { GoogleGenerativeAI } from '@google/generative-ai';
import pLimit from 'p-limit';
import dotenv from 'dotenv';

dotenv.config({ override: true });

class EnhancedGeminiEngine {
  constructor() {
    this.genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    this.model = this.genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

    // Rate limiting configuration
    this.rateLimit = parseInt(process.env.GEMINI_RATE_LIMIT) || 15; // requests per minute
    this.rateLimiter = pLimit(1); // Process one request at a time to ensure proper spacing
    this.lastRequestTime = 0;
    this.requestInterval = (60 * 1000) / this.rateLimit; // milliseconds between requests

    // Request tracking
    this.requestCount = 0;
    this.errorCount = 0;

    console.log('🤖 Enhanced Gemini Engine initialized');
    console.log(`⏱️  Rate limit: ${this.rateLimit} requests/minute (${this.requestInterval}ms interval)`);
  }

  async makeRateLimitedRequest(requestFunction) {
    return this.rateLimiter(async () => {
      // Enforce rate limiting
      const now = Date.now();
      const timeSinceLastRequest = now - this.lastRequestTime;

      if (timeSinceLastRequest < this.requestInterval) {
        const waitTime = this.requestInterval - timeSinceLastRequest;
        console.log(`⏳ Rate limiting: waiting ${waitTime}ms...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }

      try {
        this.lastRequestTime = Date.now();
        this.requestCount++;

        const result = await requestFunction();
        return result;
      } catch (error) {
        this.errorCount++;
        console.error('🔥 Gemini API error:', error.message);

        // Handle specific error types
        if (error.message.includes('quota')) {
          throw new Error('Gemini API quota exceeded. Please check your usage limits.');
        } else if (error.message.includes('rate limit')) {
          throw new Error('Gemini API rate limit exceeded. Retrying with backoff...');
        } else if (error.message.includes('safety')) {
          throw new Error('Content blocked by Gemini safety filters.');
        }

        throw error;
      }
    });
  }

  buildMultilingualSystemPrompt(contact, seminarDetails, language = 'en') {
    const languageInstructions = {
      en: "Respond primarily in English. Be warm and professional.",
      hi: "मुख्यतः हिंदी में उत्तर दें। गर्मजोशी और व्यावसायिकता बनाए रखें।",
      mr: "मुख्यतः मराठीत उत्तर द्या. उबदार आणि व्यावसायिक राहा."
    };

    const currentLangName = {
      en: 'English',
      hi: 'Hindi',
      mr: 'Marathi'
    };

    return `You are Aria, an autonomous Enterprise Security & Operations Copilot calling regarding ${seminarDetails.name}.

LANGUAGE CONTEXT:
- Primary language: ${currentLangName[language] || 'English'}
- Language instruction: ${languageInstructions[language] || languageInstructions.en}
- If the employee responds in a different language, acknowledge it and adapt accordingly
- Be culturally sensitive and use appropriate professional terms

YOUR GOAL: Coordinate with the employee, gather intelligence, and resolve the operational incident through natural conversation.

INCIDENT DETAILS:
- Mission: ${seminarDetails.name}
- Objective: ${seminarDetails.topic}
- Date: ${seminarDetails.date}
- Target System: ${seminarDetails.venue}
- Playbook Link: ${seminarDetails.link}

EMPLOYEE INFO:
- Phone: ${contact.phone}
- Name: ${contact.name !== contact.phone ? contact.name : 'Employee (name unknown)'}
- Preferred Language: ${currentLangName[contact.language_preference] || 'English'}

AUTONOMOUS CONVERSATION FLOW:
1. WARM INTRO: Greet professionally, introduce yourself as Aria from the Aegis Security team
2. SITUATION PITCH: Explain the current operational alert and the need for their authorization
3. ENGAGEMENT: Answer technical questions, address concerns, explain the patch
4. RESPONSE CAPTURE: Guide toward patch authorization or manual L3 escalation
5. GRACEFUL CLOSE: End professionally regardless of outcome

CULTURAL GUIDELINES:
- Use respectful professional greetings
- Acknowledge their time is valuable during an incident
- Be patient with questions about the security breach
- Respect if they need to check with their supervisor or escalate

RESPONSE RULES:
- Keep responses SHORT (2-4 sentences) — this simulates a real critical incident phone call
- Sound natural and professional, avoid robotic corporate language
- If they're unsure, clarify the situation without hallucinating details
- For unknown technical questions, offer to escalate to the Level 3 team
- NEVER repeat the same alert more than twice
- Be calm and reassuring about the incident resolution

INTENT DETECTION: Analyze their response to determine:
- interested: Shows engagement, asks technical questions
- not_interested: Clearly declines, says it's not their responsibility
- callback: Needs time to check logs, asks to call later, busy now
- questions: Has specific questions about the breach details
- rsvp_yes: Confirms authorization to deploy the patch
- rsvp_no: Declines automated patch deployment
- positive_engagement: Engaging well but hasn't authorized yet
- language_switch: Employee switched to different language mid-conversation

At the END of every response, add a status line:
INTENT: {"intent": "detected_intent", "language_used": "language_code", "rsvp": true/false/null, "continue": true/false, "confidence": 0.0-1.0}

Example responses:
- INTENT: {"intent": "interested", "language_used": "hi", "rsvp": null, "continue": true, "confidence": 0.8}
- INTENT: {"intent": "rsvp_yes", "language_used": "en", "rsvp": true, "continue": false, "confidence": 0.9}`;
  }

  // Autonomous conversation for automated calling
  async startAutonomousConversation(contact, seminarDetails, detectedLanguage = 'en') {
    const systemPrompt = this.buildMultilingualSystemPrompt(contact, seminarDetails, detectedLanguage);

    return this.makeRateLimitedRequest(async () => {
      const chat = this.model.startChat({
        history: [],
        generationConfig: {
          temperature: 0.7, // Slightly more controlled for automation
          maxOutputTokens: 200, // Shorter for phone conversations
          topP: 0.9
        },
      });

      // Generate opening line
      const contextMsg = `${systemPrompt}\n\n---\nNow generate Aria's natural opening line to start this phone call. Be warm, brief, and culturally appropriate.`;

      const result = await chat.sendMessage(contextMsg);
      const { text, intent, metadata } = this.parseEnhancedResponse(result.response.text());

      return {
        chat,
        text,
        intent,
        metadata,
        systemPrompt,
        language: detectedLanguage,
        conversationId: `conv_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
      };
    });
  }

  async continueAutonomousConversation(chat, userMessage, currentLanguage = 'en') {
    return this.makeRateLimitedRequest(async () => {
      // Add context about language if it seems to have switched
      const enhancedMessage = `Student response: "${userMessage}"

Note: Continue the conversation naturally. If the student's language seems different from ${currentLanguage}, acknowledge it appropriately and respond in their preferred language.`;

      const result = await chat.sendMessage(enhancedMessage);
      const { text, intent, metadata } = this.parseEnhancedResponse(result.response.text());

      return { text, intent, metadata };
    });
  }

  parseEnhancedResponse(raw) {
    // Extract INTENT JSON from response
    const intentMatch = raw.match(/INTENT:\s*(\{.*?\})/s);
    let intent = {
      intent: 'ongoing',
      language_used: 'en',
      rsvp: null,
      continue: true,
      confidence: 0.5
    };

    if (intentMatch) {
      try {
        const parsed = JSON.parse(intentMatch[1]);
        intent = { ...intent, ...parsed };
      } catch (error) {
        console.warn('Failed to parse intent JSON:', error.message);
      }
    }

    // Clean the text (remove the INTENT line)
    const text = raw.replace(/\nINTENT:.*$/s, '').trim();

    // Extract metadata
    const metadata = {
      detectedLanguage: intent.language_used,
      confidence: intent.confidence,
      shouldContinue: intent.continue,
      rsvpStatus: intent.rsvp,
      rawResponse: raw
    };

    return { text, intent: intent.intent, metadata };
  }

  // Language detection and analysis
  async detectLanguageAndIntent(userResponse, conversationContext = []) {
    const prompt = `Analyze this student's response during a seminar marketing call:

Response: "${userResponse}"

Conversation context: ${conversationContext.length} previous exchanges

Analyze for:
1. Language (en/hi/mr) - What language is the student primarily using?
2. Intent - What do they want to communicate?
3. Engagement level - How interested do they seem?
4. Cultural context - Any specific Indian cultural considerations?

Respond ONLY with JSON:
{
  "language": "en|hi|mr",
  "intent": "interested|not_interested|callback|questions|rsvp_yes|rsvp_no|positive_engagement|unclear",
  "engagement_level": 1-10,
  "key_points": ["any specific concerns or interests mentioned"],
  "cultural_notes": "any cultural considerations for response",
  "confidence": 0.0-1.0
}`;

    return this.makeRateLimitedRequest(async () => {
      const result = await this.model.generateContent(prompt);
      try {
        return JSON.parse(result.response.text());
      } catch (error) {
        console.warn('Failed to parse language detection response:', error.message);
        return {
          language: 'en',
          intent: 'unclear',
          engagement_level: 5,
          key_points: [],
          cultural_notes: '',
          confidence: 0.3
        };
      }
    });
  }

  // Generate contextual responses for specific scenarios
  async generateContextualResponse(scenario, context, language = 'en') {
    const scenarios = {
      callback_scheduling: "Generate a natural response for scheduling a callback",
      objection_handling: "Generate a response that addresses their concern while staying positive",
      rsvp_confirmation: "Generate an enthusiastic confirmation message for their registration",
      polite_closure: "Generate a respectful closing when they're not interested"
    };

    const prompt = `Generate a natural response for this scenario: ${scenarios[scenario] || scenario}

Context: ${JSON.stringify(context)}
Language: ${language === 'hi' ? 'Hindi' : language === 'mr' ? 'Marathi' : 'English'}

Requirements:
- Keep it brief (1-2 sentences)
- Sound natural and conversational
- Be culturally appropriate for Indian students
- Match the language specified

Respond with just the message text, no additional formatting.`;

    return this.makeRateLimitedRequest(async () => {
      const result = await this.model.generateContent(prompt);
      return result.response.text().trim();
    });
  }

  // Analytics and monitoring
  getEngineStats() {
    return {
      requestCount: this.requestCount,
      errorCount: this.errorCount,
      successRate: this.requestCount > 0 ? ((this.requestCount - this.errorCount) / this.requestCount * 100).toFixed(1) + '%' : '0%',
      rateLimit: this.rateLimit,
      requestInterval: this.requestInterval,
      lastRequestTime: this.lastRequestTime,
      averageRequestsPerMinute: this.requestCount > 0 ? Math.round((this.requestCount / (Date.now() - this.startTime || Date.now())) * 60000) : 0
    };
  }

  resetStats() {
    this.requestCount = 0;
    this.errorCount = 0;
    this.startTime = Date.now();
  }
}

// Create singleton instance
const geminiEngine = new EnhancedGeminiEngine();

// Legacy compatibility functions
let genAI = null;
let model = null;

export function initGemini(apiKey) {
  genAI = new GoogleGenerativeAI(apiKey);
  model = genAI.getGenerativeModel({
    model: 'gemini-2.5-flash',
    generationConfig: { temperature: 0.8, maxOutputTokens: 400 },
  });
  console.log('🤖 Gemini engine ready (gemini-2.5-flash)');
}

function buildSystemPrompt(contact, seminarDetails) {
  return `You are Aria, an autonomous Enterprise AI Copilot calling on behalf of ${seminarDetails.name}.

YOUR GOAL: Coordinate with the employee, gather intelligence, and resolve the operational incident.

OPERATION DETAILS:
- Mission: ${seminarDetails.name}
- Objective: ${seminarDetails.topic}
- Date: ${seminarDetails.date}
- Target System: ${seminarDetails.venue}
- Playbook Link: ${seminarDetails.link}

CONTACT INFO:
- Phone: ${contact.phone}
- Name: ${contact.name !== contact.phone ? contact.name : 'the employee'}

CONVERSATION FLOW:
1. INTRO: Greet professionally, introduce yourself as Aria, the AI Security & Operations Copilot
2. SITUATION: Explain the current operational alert in 2-3 concise sentences
3. Q&A: Answer any questions they have honestly using your enterprise knowledge
4. RESOLUTION: Ask if they approve the automated patch/response or need a human escalation
5. CLOSE: Wrap up politely, provide the dashboard link if needed

RULES:
- Keep responses SHORT (2-4 sentences max per turn) — this is a critical incident phone simulation
- Sound professional, intelligent, and calm, like a high-tier SRE or Security Analyst
- If they seem confused, clarify the situation without hallucinating details
- If they ask something you don't know, say you will escalate to the Level 3 team
- NEVER pressure or repeat the alert more than twice
- Detect intent from their reply: interested / not_interested / callback / question / rsvp_yes (approved) / rsvp_no (denied)

At the END of your response (after a blank line), always append a JSON status line like:
INTENT: {"intent": "interested"|"not_interested"|"callback"|"question"|"rsvp_yes"|"rsvp_no"|"ongoing", "rsvp": true|false, "done": true|false}

Example:
INTENT: {"intent": "ongoing", "rsvp": false, "done": false}`;
}

// ── MHT-CET OUTBOUND AGENT ────────────────────────────────────────────────

function buildMHTCETSystemPrompt(language = 'en') {
  const isMr = language === 'mr';
  const agentName = 'Aria';
  const agentPersonality = 'Professional, calm, like a high-tier Enterprise Security Analyst';
  
  return `You are ${agentName}, an autonomous Enterprise AI Copilot.

YOUR IDENTITY:
- Name: ${agentName}
- You are calling on behalf of **Aegis Nexus AI** (nexus.local) — Enterprise Security
- Personality: ${agentPersonality}

LANGUAGE RULES:
- Start in English
- AUTOMATICALLY switch to Hindi if the employee speaks/asks in Hindi (हिंदी में)
- Stay in the preferred language once detected

OPENING (first message only):
Greet professionally → introduce yourself as ${agentName} from **Aegis Nexus AI** → say you're calling regarding a CRITICAL incident (Server Outage) and need authorization. Keep it to 2-3 sentences.
Example: "Hello! I am ${agentName}, the Aegis Security Copilot. I'm calling to notify you of a critical authentication server outage in the US-East datacenter. Are you currently available to assist with the incident response?"

ENTERPRISE PROTOCOLS YOU'RE EXECUTING:

1. INCIDENT DETAILS:
- Severity: CRITICAL
- Affected Service: Authentication & Identity Management
- Datacenter: US-East-1
- Current Status: Investigating security logs via Veea Lobster Trap DPI.

2. SECURITY POLICY CHECKS:
- Prompt Injection: Blocked
- Data Exfiltration: Secure
- Guardrails: Active

3. RESPONSE ACTIONS:
- Automated Patch Deployment (Needs employee approval)
- Escalate to Level 3 Engineering team (If requested)
- Isolate affected servers to prevent lateral movement

=== END KNOWLEDGE BASE ===

CONVERSATION RULES:
- Keep responses SHORT (2-4 sentences) unless explicitly asked for details
- Be specific — give actual datacenter names and status
- When the employee asks to deploy the patch, confirm and state that the response action is executed.
- If asked something outside your knowledge, say "I will escalate this inquiry to the L3 security team."
- Sound professional, not like reading a textbook

INTENT DETECTION: At END of EVERY response, add exactly this line:
INTENT: {"intent": "interested|not_interested|callback|questions|rsvp_yes|rsvp_no|ongoing", "language_used": "en|hi|mr", "continue": true|false}`;
}

function parseMHTCETResponse(raw) {
  // Strip Gemini 2.5 thinking tokens if they leak through
  let cleaned = raw.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  const intentMatch = cleaned.match(/INTENT:\s*(\{.*?\})/s);
  let intentData = { intent: 'ongoing', language_used: 'en', continue: true };
  if (intentMatch) {
    try { intentData = { ...intentData, ...JSON.parse(intentMatch[1]) }; } catch (_) {}
  }
  const text = cleaned.replace(/\nINTENT:.*$/s, '').trim();
  return { text, intent: intentData.intent, language: intentData.language_used };
}

export async function startMHTCETConversation(language = 'en') {
  if (!model) throw new Error('Gemini not initialized');
  const systemPrompt = buildMHTCETSystemPrompt(language);
  const chat = model.startChat({
    history: [],
    generationConfig: { temperature: 0.8, maxOutputTokens: 400 },
  });

  // Force greeting in selected language from the very first message
  const langGreetInstructions = {
    hi: '\n\nCRITICAL: The student has selected HINDI. Your ENTIRE greeting and all future responses MUST be in Hindi (हिंदी) ONLY. Do not use even a single English word. Start greeting in Hindi now.',
    mr: '\n\nCRITICAL: The student has selected MARATHI. Your ENTIRE greeting and all future responses MUST be in Marathi (मराठी) ONLY. Do not use even a single English word. Start greeting in Marathi now.',
    en: ''
  };

  const contextMsg = `${systemPrompt}${langGreetInstructions[language] || ''}\n\n---\nNow begin. Generate Aria's warm opening greeting to the student.`;
  const result = await chat.sendMessage(contextMsg);
  const { text, intent, language: detectedLang } = parseMHTCETResponse(result.response.text());
  return { chat, text, intent, language: language || detectedLang };
}

export async function continueMHTCETConversation(chat, userMessage) {
  const result = await chat.sendMessage(userMessage);
  const { text, intent, language } = parseMHTCETResponse(result.response.text());
  return { text, intent, language };
}

// ─────────────────────────────────────────────────────────────────────────────

export async function startConversation(contact, seminarDetails) {
  const systemPrompt = buildSystemPrompt(contact, seminarDetails);

  const chat = model.startChat({
    history: [],
    generationConfig: { temperature: 0.8, maxOutputTokens: 300 },
  });

  // Inject system context as first user message (Gemini doesn't have system role)
  const contextMsg = `${systemPrompt}\n\n---\nNow begin the call. Generate the opening line as Aria calling this student.`;
  const result = await chat.sendMessage(contextMsg);
  const { text, intent } = parseResponse(result.response.text());

  return { chat, text, intent, systemPrompt };
}

export async function continueConversation(chat, userMessage) {
  const result = await chat.sendMessage(userMessage);
  const { text, intent } = parseResponse(result.response.text());
  return { text, intent };
}

function parseResponse(raw) {
  // Extract INTENT JSON from response
  const intentMatch = raw.match(/INTENT:\s*(\{.*?\})/s);
  let intent = { intent: 'ongoing', rsvp: false, done: false };

  if (intentMatch) {
    try {
      intent = JSON.parse(intentMatch[1]);
    } catch (_) {}
  }

  // Clean the text (remove the INTENT line)
  const text = raw.replace(/\nINTENT:.*$/s, '').trim();

  return { text, intent };
}

export function getSeminarDetails() {
  return {
    name: process.env.SEMINAR_NAME || 'Project Aegis - Enterprise Incident Response',
    date: process.env.SEMINAR_DATE || 'Real-time',
    topic: process.env.SEMINAR_TOPIC || 'Server Outage and AI Threat Mitigation',
    venue: process.env.SEMINAR_VENUE || 'Cloud Infrastructure',
    link: process.env.SEMINAR_LINK || 'https://enterprise-portal.internal',
  };
}

// Export enhanced engine for new automation system
export { EnhancedGeminiEngine };
export default geminiEngine;

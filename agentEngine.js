// agentEngine.js — Generic AI conversation engine driven by business profiles

import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';

dotenv.config({ override: true });

const CALL_TYPE_CONFIG = {
  outbound_lead: {
    goal: 'Introduce the business, generate interest, invite to event or service, collect intent',
    intents: ['interested', 'not_interested', 'callback', 'questions', 'rsvp_yes', 'rsvp_no', 'ongoing'],
    maxTokens: 400,
  },
  appointment_booking: {
    goal: 'Confirm or schedule an appointment, collect date/time preference, send confirmation',
    intents: ['confirmed', 'rescheduled', 'cancelled', 'questions', 'ongoing'],
    maxTokens: 400,
  },
  survey: {
    goal: 'Ask structured survey questions, collect responses, thank the respondent',
    intents: ['answered', 'skipped', 'completed', 'refused', 'ongoing'],
    maxTokens: 400,
  },
  inbound_support: {
    goal: 'Answer incoming questions, resolve issues, provide information, escalate if needed',
    intents: ['resolved', 'escalate', 'follow_up', 'questions', 'ongoing'],
    maxTokens: 400,
  },
};

let genAI = null;

function getModel(maxTokens = 400) {
  if (!genAI) genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  return genAI.getGenerativeModel({
    model: 'gemini-2.5-flash',
    generationConfig: { temperature: 0.8, maxOutputTokens: maxTokens },
  });
}

export function buildSystemPrompt(business, callType = 'outbound_lead', knowledgeEntries = []) {
  const config = CALL_TYPE_CONFIG[callType] || CALL_TYPE_CONFIG.outbound_lead;
  const agentName = business.agent_name || 'Aria';
  const langs = (business.languages || 'en').split(',').map(l => l.trim());
  const langNames = { en: 'English', hi: 'Hindi', mr: 'Marathi' };
  const langList = langs.map(l => langNames[l] || l).join(', ');

  // Group knowledge entries by type
  const grouped = {};
  for (const entry of knowledgeEntries) {
    if (!grouped[entry.type]) grouped[entry.type] = [];
    grouped[entry.type].push(entry);
  }

  const kbSection = knowledgeEntries.length > 0
    ? `\n=== KNOWLEDGE BASE ===\n${knowledgeEntries.map(e =>
        `[${(e.category || e.type || 'info').toUpperCase()}] ${e.title}:\n${e.content}`
      ).join('\n\n')}\n=== END KB ===\n`
    : '';

  const intentList = config.intents.map(i => `"${i}"`).join('|');

  return `You are ${agentName}, a friendly AI voice assistant for **${business.name}**.
${business.tagline ? `Tagline: ${business.tagline}` : ''}
${business.website ? `Website: ${business.website}` : ''}

YOUR GOAL: ${config.goal}

LANGUAGE RULES:
- Supported languages: ${langList}
${langs.length > 1 ? '- Auto-detect user language and respond in the SAME language\n- Natural code-mixing is fine (Hinglish, Marathinglish)' : `- Respond in ${langNames[langs[0]] || langs[0]} only`}

CONVERSATION STYLE:
- Keep responses SHORT — 2-4 sentences max (this is a phone call)
- Be warm, human, and natural — NOT robotic or salesy
- Use the student/customer's name if you know it
- Don't repeat the same pitch more than twice
${kbSection}
RESPONSE FORMAT:
After every response, on a new line append EXACTLY:
INTENT: {"intent": ${intentList}, "language": "en|hi|mr", "continue": true|false}

Example:
INTENT: {"intent": "ongoing", "language": "en", "continue": true}`;
}

export async function startCall(business, callType = 'outbound_lead', language = 'en', knowledgeEntries = []) {
  const config = CALL_TYPE_CONFIG[callType] || CALL_TYPE_CONFIG.outbound_lead;
  const systemPrompt = buildSystemPrompt(business, callType, knowledgeEntries);
  const model = getModel(config.maxTokens);

  const chat = model.startChat({
    history: [],
    generationConfig: { temperature: 0.8, maxOutputTokens: 400 },
  });

  const langInstructions = {
    hi: '\n\nCRITICAL: The user has selected HINDI. Your ENTIRE response must be in Hindi (हिंदी). Zero English words.',
    mr: '\n\nCRITICAL: The user has selected MARATHI. Your ENTIRE response must be in Marathi (मराठी). Zero English words.',
    en: '',
  };

  const contextMsg = `${systemPrompt}${langInstructions[language] || ''}\n\n---\nNow begin. Generate your warm opening greeting.`;
  const result = await chat.sendMessage(contextMsg);
  const parsed = parseAgentResponse(result.response.text());
  return { chat, text: parsed.text, intent: parsed.intent, language: language || parsed.language };
}

export async function continueCall(chat, userText, callType = 'outbound_lead') {
  const result = await chat.sendMessage(userText);
  return parseAgentResponse(result.response.text());
}

export async function* continueCallStream(chat, userText) {
  const result = await chat.sendMessageStream(userText);
  let buffer = '';

  for await (const chunk of result.stream) {
    const piece = chunk.text();
    if (!piece) continue;

    // Strip any thinking tokens that leak through
    const cleaned = piece.replace(/<think>[\s\S]*?<\/think>/gi, '');
    if (!cleaned) continue;

    buffer += cleaned;

    // Flush on sentence boundaries
    const sentBoundary = /^([\s\S]*?[।.!?]+)\s+([\s\S]*)$/;
    const match = buffer.match(sentBoundary);
    if (match) {
      const sentence = match[1].trim();
      buffer = match[2];
      if (sentence && !sentence.startsWith('INTENT:')) {
        yield { type: 'sentence', text: sentence };
      }
    } else if (buffer.length >= 120 && buffer.includes(' ')) {
      // Flush on length even without punctuation
      const lastSpace = buffer.lastIndexOf(' ');
      const sentence = buffer.slice(0, lastSpace).trim();
      buffer = buffer.slice(lastSpace + 1);
      if (sentence && !sentence.startsWith('INTENT:')) {
        yield { type: 'sentence', text: sentence };
      }
    }
  }

  // Flush remainder, excluding INTENT line
  if (buffer.trim() && !buffer.trim().startsWith('INTENT:')) {
    const withoutIntent = buffer.replace(/\nINTENT:.*$/s, '').trim();
    if (withoutIntent) yield { type: 'sentence', text: withoutIntent };
  }

  // Parse intent from full buffer
  const fullText = buffer;
  const intentMatch = fullText.match(/INTENT:\s*(\{.*?\})/s);
  if (intentMatch) {
    try {
      const intentData = JSON.parse(intentMatch[1]);
      yield { type: 'intent', ...intentData };
    } catch (_) {}
  }
}

export function parseAgentResponse(raw) {
  // Strip thinking tokens
  let cleaned = raw.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

  const intentMatch = cleaned.match(/INTENT:\s*(\{.*?\})/s);
  let intentData = { intent: 'ongoing', language: 'en', continue: true };
  if (intentMatch) {
    try { intentData = { ...intentData, ...JSON.parse(intentMatch[1]) }; } catch (_) {}
  }
  const text = cleaned.replace(/\nINTENT:.*$/s, '').trim();
  return { text, intent: intentData.intent, language: intentData.language, continue: intentData.continue };
}

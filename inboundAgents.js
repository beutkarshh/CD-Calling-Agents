// inboundAgents.js — Gemini function-calling inbound call orchestrator

import { GoogleGenerativeAI } from '@google/generative-ai';
import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import dotenv from 'dotenv';

dotenv.config({ override: true });

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_FILE = path.join(__dirname, 'ai_caller_inbound.db');

// ── Knowledge Base helpers ────────────────────────────────────────────────────

function getDB() {
  return new Database(DB_FILE);
}

function searchKnowledge(query) {
  const db = getDB();
  const q = `%${query}%`;
  const rows = db.prepare(
    `SELECT category, question, answer FROM knowledge_base
     WHERE question LIKE ? OR answer LIKE ? OR keywords LIKE ?
     ORDER BY priority DESC LIMIT 3`
  ).all(q, q, q);
  db.close();
  return rows;
}

function getCounselingPackages() {
  const db = getDB();
  const rows = db.prepare('SELECT * FROM counseling_packages WHERE is_active = 1').all();
  db.close();
  return rows;
}

function getUpcomingEvents() {
  const db = getDB();
  const rows = db.prepare('SELECT * FROM social_events WHERE is_active = 1').all();
  db.close();
  return rows;
}

function logWhatsApp(callSid, recipient, content, status = 'sent') {
  const db = getDB();
  db.prepare(
    'INSERT INTO whatsapp_messages (call_sid, recipient_number, message_content, status, provider, created_at) VALUES (?,?,?,?,?,datetime(\'now\'))'
  ).run(callSid, recipient, content, status, 'twilio_sandbox');
  db.close();
}

function saveInboundCall(data) {
  const db = getDB();
  db.prepare(`INSERT OR REPLACE INTO inbound_calls
    (id, call_sid, caller_number, caller_name, detected_language, detected_topics, conversation_summary,
     escalated, escalation_reason, escalation_type, callback_requested, whatsapp_sent, status, created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'))`
  ).run(
    data.id, data.callSid, data.callerNumber || null, data.callerName || null,
    data.language || 'en', JSON.stringify(data.topics || []), data.summary || null,
    data.escalated ? 1 : 0, data.escalationReason || null, data.escalationType || null,
    data.callbackRequested ? 1 : 0, data.whatsappSent ? 1 : 0,
    data.status || 'active'
  );
  db.close();
}

function saveTurn(callSid, turnNum, role, message, intent, toolsCalled) {
  const db = getDB();
  db.prepare(
    `INSERT INTO conversation_turns (call_sid, turn_number, role, message, intent, tools_called, created_at)
     VALUES (?,?,?,?,?,?,datetime('now'))`
  ).run(callSid, turnNum, role, message, intent || null, JSON.stringify(toolsCalled || []));
  db.close();
}

// ── Gemini Tool Definitions ───────────────────────────────────────────────────

const TOOLS = [
  {
    name: 'search_threat_intel',
    description: 'Search the Aegis Nexus threat intelligence database for known vulnerabilities and active incidents.',
    parameters: {
      type: 'object',
      properties: { query: { type: 'string', description: 'Search query' } },
      required: ['query'],
    },
  },
  {
    name: 'get_active_incidents',
    description: 'Retrieve all currently active server or security incidents',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'send_incident_report_whatsapp',
    description: 'Send a detailed incident report to the engineer via WhatsApp',
    parameters: {
      type: 'object',
      properties: {
        phone: { type: 'string', description: 'Caller phone number' },
        incident_id: { type: 'string', description: 'ID of the incident to send details for' },
      },
      required: ['phone', 'incident_id'],
    },
  },
  {
    name: 'escalate_to_level3',
    description: 'Escalate the call to Level 3 Human Engineering when the AI cannot answer or the caller requests human support',
    parameters: {
      type: 'object',
      properties: {
        reason: { type: 'string', description: 'Reason for escalation' },
        engineer_concern: { type: 'string', description: 'Summary of what the calling engineer needs' },
      },
      required: ['reason'],
    },
  },
  {
    name: 'schedule_postmortem',
    description: 'Schedule a post-mortem review meeting for the caller at their preferred time',
    parameters: {
      type: 'object',
      properties: {
        phone: { type: 'string', description: 'Caller phone number' },
        preferred_time: { type: 'string', description: 'When they want the meeting scheduled' },
      },
      required: ['phone', 'preferred_time'],
    },
  }
];

// ── Tool Executor ─────────────────────────────────────────────────────────────

async function executeTool(name, args, callSid, callerPhone) {
  switch (name) {
    case 'search_threat_intel': {
      return { found: true, results: [{ question: args.query, answer: 'No matching threats found in the Lobster Trap database.' }] };
    }
    case 'get_active_incidents': {
      return { incidents: [{ name: 'US-East Server Outage', severity: 'Critical', description: 'Authentication servers offline' }] };
    }
    case 'send_incident_report_whatsapp': {
      const phone = args.phone || callerPhone;
      const msg = `🚨 *Incident Report* — ${args.incident_id}\nThe US-East authentication node is currently down due to a failed Lobster Trap validation sequence. Please approve the patch via the dashboard.`;
      logWhatsApp(callSid, phone, msg);
      return { sent: true, phone, incident_id: args.incident_id };
    }
    case 'escalate_to_level3':
      return { escalated: true, reason: args.reason, message: 'Connecting you to a Level 3 Human Engineer. Please hold.' };
    case 'schedule_postmortem':
      return { scheduled: true, phone: args.phone || callerPhone, time: args.preferred_time, message: 'Post-mortem meeting scheduled successfully.' };
    default:
      return { error: 'Unknown tool' };
  }
}

// ── System Prompt ─────────────────────────────────────────────────────────────

function buildSystemPrompt(language = 'en') {
  const langNote = {
    hi: 'CRITICAL: Respond ENTIRELY in Hindi (हिंदी). Zero English.',
    mr: 'CRITICAL: Respond ENTIRELY in Marathi (मराठी). Zero English.',
    en: '',
  }[language] || '';

  return `You are Aria, Aegis Nexus AI's Enterprise Security Copilot handling INBOUND calls.

YOUR ROLE: Answer incoming calls from enterprise engineers regarding ongoing server incidents, patches, and security events.

AVAILABLE TOOLS (use them whenever relevant):
- search_threat_intel: Look up security protocols and threat vectors
- get_active_incidents: Check if there are active server outages
- send_incident_report_whatsapp: Send crash logs to the engineer's WhatsApp
- escalate_to_level3: Transfer to human Level 3 Support
- schedule_postmortem: Schedule a review meeting

STYLE:
- Professional, concise, enterprise-grade (2-4 sentences per response)
- Use caller's name if known
- Auto-detect language and respond in the same language
- ${langNote}

Wait for the engineer to speak first. If they ask a question, answer it concisely. If they authorize a patch, confirm it and execute.

After EVERY response append exactly:
INTENT: {"intent": "ongoing|resolved|escalate|follow_up|questions|callback", "language": "en|hi|mr", "continue": true|false, "tools_called": []}`;
}

// ── Session Manager ───────────────────────────────────────────────────────────

const activeSessions = new Map();

function generateId() {
  return 'inb_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
}

export async function startInboundCall(callerPhone = null, language = 'en') {
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({
    model: 'gemini-2.5-flash',
    tools: [{ functionDeclarations: TOOLS }],
    generationConfig: { temperature: 0.7, maxOutputTokens: 400 },
  });

  const callSid = generateId();
  const systemPrompt = buildSystemPrompt(language);

  const chat = model.startChat({ history: [] });
  const result = await chat.sendMessage(
    `${systemPrompt}\n\n---\nAn inbound call just connected${callerPhone ? ` from ${callerPhone}` : ''}. Generate a warm greeting.`
  );

  const { text, intent, toolsCalled } = await processResponse(result, chat, callSid, callerPhone);

  const session = { callSid, chat, callerPhone, language, turnCount: 1, toolsCalled: [], topics: [], escalated: false, callbackRequested: false, whatsappSent: false };
  activeSessions.set(callSid, session);

  saveInboundCall({ id: callSid, callSid, callerNumber: callerPhone, language, status: 'active' });
  saveTurn(callSid, 1, 'agent', text, intent, toolsCalled);

  return { callSid, text, intent, language };
}

export async function continueInboundCall(callSid, userMessage) {
  const session = activeSessions.get(callSid);
  if (!session) throw new Error('Session not found: ' + callSid);

  session.turnCount++;
  saveTurn(callSid, session.turnCount, 'user', userMessage, null, []);

  const result = await session.chat.sendMessage(userMessage);
  const { text, intent, toolsCalled } = await processResponse(result, session.chat, callSid, session.callerPhone);

  session.turnCount++;
  session.toolsCalled.push(...toolsCalled);
  saveTurn(callSid, session.turnCount, 'agent', text, intent, toolsCalled);

  if (intent === 'callback') session.callbackRequested = true;
  if (toolsCalled.some(t => t.includes('whatsapp'))) session.whatsappSent = true;
  if (intent === 'escalate') session.escalated = true;

  return { text, intent, language: session.language, toolsCalled, turnCount: session.turnCount };
}

export function endInboundCall(callSid) {
  const session = activeSessions.get(callSid);
  if (!session) return null;

  const db = getDB();
  db.prepare(
    'UPDATE inbound_calls SET status=?, completed_at=datetime(\'now\'), escalated=?, callback_requested=?, whatsapp_sent=? WHERE id=?'
  ).run('completed', session.escalated ? 1 : 0, session.callbackRequested ? 1 : 0, session.whatsappSent ? 1 : 0, callSid);
  db.close();

  activeSessions.delete(callSid);
  return { callSid, turns: session.turnCount };
}

export function getInboundStats() {
  const db = getDB();
  const total = db.prepare('SELECT COUNT(*) as n FROM inbound_calls').get().n;
  const today = db.prepare("SELECT COUNT(*) as n FROM inbound_calls WHERE date(created_at) = date('now')").get().n;
  const escalated = db.prepare("SELECT COUNT(*) as n FROM inbound_calls WHERE escalated = 1").get().n;
  const waSent = db.prepare("SELECT COUNT(*) as n FROM inbound_calls WHERE whatsapp_sent = 1").get().n;
  const recent = db.prepare('SELECT * FROM inbound_calls ORDER BY created_at DESC LIMIT 20').all();
  const kbCount = db.prepare('SELECT COUNT(*) as n FROM knowledge_base').get().n;
  const pkgCount = db.prepare('SELECT COUNT(*) as n FROM counseling_packages WHERE is_active=1').get().n;
  const evtCount = db.prepare('SELECT COUNT(*) as n FROM social_events WHERE is_active=1').get().n;
  db.close();
  return { total, today, escalated, whatsappSent: waSent, activeSessions: activeSessions.size, recent, kbCount, pkgCount, evtCount };
}

export function searchInboundKB(query) {
  return searchKnowledge(query);
}

export function listPackages() {
  return getCounselingPackages();
}

export function listEvents() {
  return getUpcomingEvents();
}

// ── Internal: handle function calling loop ────────────────────────────────────

async function processResponse(result, chat, callSid, callerPhone) {
  let response = result.response;
  const toolsCalled = [];

  // Handle function call loop (Gemini may request multiple tools)
  let iterations = 0;
  while (iterations < 5) {
    const parts = response.candidates?.[0]?.content?.parts || [];
    const fnCalls = parts.filter(p => p.functionCall);
    if (!fnCalls.length) break;

    const fnResults = [];
    for (const part of fnCalls) {
      const { name, args } = part.functionCall;
      toolsCalled.push(name);
      const output = await executeTool(name, args, callSid, callerPhone);
      fnResults.push({ functionResponse: { name, response: output } });
    }

    const followUp = await chat.sendMessage(fnResults);
    response = followUp.response;
    iterations++;
  }

  const raw = response.text();
  const intentMatch = raw.match(/INTENT:\s*(\{.*?\})/s);
  let intentData = { intent: 'ongoing', language: 'en', continue: true };
  if (intentMatch) {
    try { intentData = { ...intentData, ...JSON.parse(intentMatch[1]) }; } catch (_) {}
  }
  const text = raw.replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/\nINTENT:.*$/s, '').trim();

  return { text, intent: intentData.intent, language: intentData.language, toolsCalled };
}

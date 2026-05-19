// dashboard-server.js — Enhanced Express + WebSocket server with automation controls and multilingual monitoring

import dotenv from 'dotenv';
dotenv.config({ override: true });

import express from 'express';
import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import { initGemini, startConversation, continueConversation, getSeminarDetails, startMHTCETConversation, continueMHTCETConversation } from './geminiEngine.js';
import { speak } from './voiceEngine.js';
import { loadContacts, saveResults, getStats } from './contactQueue.js';
import QueueProcessor from './queueProcessor.js';
import AICallerDatabase from './database.js';
import LanguageEngine from './languageEngine.js';
import CharacterManager from './characterManager.js';
import MultilingualVoiceEngine from './voiceEngine.js';
import TwilioCallManager from './twilioIntegration.js';
import ExotelCaller from './exotelIntegration.js';
import WhatsAppManager from './whatsappIntegration.js';
import { BusinessManager } from './businessManager.js';
import { startCall as agentStartCall, continueCall as agentContinueCall, parseAgentResponse } from './agentEngine.js';
import { startInboundCall, continueInboundCall, endInboundCall, getInboundStats, searchInboundKB, listPackages, listEvents } from './inboundAgents.js';
import { attachMediaStreamHandler, generateMediaStreamTwiML } from './twilioMediaStream.js';

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

app.use(express.json());
// Serve from source directory regardless of CWD
app.use(express.static(path.join(__dirname, 'public')));
// Also serve audio files from ai-caller/public if that's where they live
if (fs.existsSync(path.join(__dirname, 'ai-caller', 'public'))) {
  app.use(express.static(path.join(__dirname, 'ai-caller', 'public')));
}

// Enhanced State Management
let contacts = [];
let activeSessions = new Map(); // phone -> { chat, contact, transcript }
const outboundSessions = new Map(); // sessionId -> { chat, transcript, language, startTime }
function generateSessionId() { return `ob_${Date.now()}_${Math.random().toString(36).substr(2, 8)}`; }
// Pick language-specific ElevenLabs voice (ELEVENLABS_VOICE_HI, _MR, _EN) or fallback to default
function getVoiceId(lang) {
  return process.env[`ELEVENLABS_VOICE_${(lang || 'en').toUpperCase()}`] || process.env.ELEVENLABS_VOICE_ID;
}
// Resolve data files — check CWD first (backward compat), then ai-caller subdir
function resolveDataFile(name) {
  const local = path.join(__dirname, name);
  if (fs.existsSync(local)) return local;
  const sub = path.join(__dirname, 'ai-caller', name);
  if (fs.existsSync(sub)) return sub;
  return local; // default to source dir even if not yet existing
}
const RESULTS_FILE = process.env.RESULTS_FILE || resolveDataFile('results.csv');
const CSV_FILE = process.env.CSV_FILE || resolveDataFile('contacts.csv');

// New Automation Components
let queueProcessor = null;
let database = null;
let languageEngine = null;
let characterManager = null;
let voiceEngine = null;
let twilioManager = null;
let exotelCaller = null;
let whatsappManager = null;
let businessManager = null;
let automationEnabled = false;

// Initialize Systems
async function initializeSystems() {
  console.log('🚀 Initializing enhanced dashboard systems...');

  // Initialize legacy system
  initGemini(process.env.GEMINI_API_KEY);

  // Initialize new automation components
  try {
    businessManager = new BusinessManager();
    database = new AICallerDatabase();
    languageEngine = new LanguageEngine();
    characterManager = new CharacterManager();
    voiceEngine = new MultilingualVoiceEngine();
    exotelCaller = new ExotelCaller();
    twilioManager = new TwilioCallManager();
    whatsappManager = new WhatsAppManager();

    // Initialize queue processor
    queueProcessor = new QueueProcessor();
    setupAutomationEventHandlers();

    // Load existing contacts into database
    await migrateContactsToDatabase();

    console.log('✅ All systems initialized successfully');
    automationEnabled = true;

  } catch (error) {
    console.error('❌ Failed to initialize automation systems:', error);
    console.log('📝 Falling back to manual dashboard mode');
    automationEnabled = false;
  }
}

async function migrateContactsToDatabase() {
  if (fs.existsSync(CSV_FILE)) {
    contacts = loadContacts(CSV_FILE, process.env.PHONE_COLUMN || 'phone');
    console.log(`📊 Loaded ${contacts.length} contacts from CSV`);

    // Import into database
    const importResult = await database.importContactsFromCSV(contacts);
    console.log(`💾 Database import: ${importResult.imported} imported, ${importResult.skipped} skipped`);
  } else {
    // Use default test contacts
    contacts = [
      { id: 1, phone: '+919876543210', name: 'Rahul Sharma', status: 'pending', rsvp: false, notes: '', calledAt: null },
      { id: 2, phone: '+919823456789', name: 'John Doe', status: 'pending', rsvp: false, notes: '', calledAt: null },
      { id: 3, phone: '+919745678901', name: 'Arjun Mehta', status: 'pending', rsvp: false, notes: '', calledAt: null },
      { id: 4, phone: '+919834567890', name: 'Sneha Gupta', status: 'pending', rsvp: false, notes: '', calledAt: null },
      { id: 5, phone: '+919812345678', name: 'Kiran Rao', status: 'pending', rsvp: false, notes: '', calledAt: null },
    ];

    for (const contact of contacts) {
      await database.addContact(contact.phone, contact.name);
    }
  }
}

function setupAutomationEventHandlers() {
  if (!queueProcessor) return;

  queueProcessor.on('automation:started', (data) => {
    broadcastAutomationUpdate({ type: 'automation_started', data });
  });

  queueProcessor.on('automation:paused', () => {
    broadcastAutomationUpdate({ type: 'automation_paused' });
  });

  queueProcessor.on('automation:resumed', () => {
    broadcastAutomationUpdate({ type: 'automation_resumed' });
  });

  queueProcessor.on('automation:stopped', () => {
    broadcastAutomationUpdate({ type: 'automation_stopped' });
  });

  queueProcessor.on('call:completed', (data) => {
    broadcastAutomationUpdate({ type: 'call_completed', data });
  });

  queueProcessor.on('call:failed', (data) => {
    broadcastAutomationUpdate({ type: 'call_failed', data });
  });

  queueProcessor.on('progress:update', (data) => {
    broadcastAutomationUpdate({ type: 'progress_update', data });
  });

  queueProcessor.on('batch:completed', (data) => {
    broadcastAutomationUpdate({ type: 'batch_completed', data });
  });
}

// Legacy API routes (maintained for backward compatibility)
app.get('/api/contacts', (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 50;
  const filter = req.query.filter || 'all';

  let filtered = contacts;
  if (filter !== 'all') filtered = contacts.filter(c => c.status === filter);

  const start = (page - 1) * limit;
  res.json({
    contacts: filtered.slice(start, start + limit),
    total: filtered.length,
    stats: getStats(contacts),
  });
});

app.get('/api/stats', (req, res) => {
  res.json(getStats(contacts));
});

// Enhanced API Routes for Automation
app.get('/api/automation/status', async (req, res) => {
  if (!automationEnabled) {
    return res.json({ enabled: false, message: 'Automation system not available' });
  }

  try {
    const systemHealth = await queueProcessor.getSystemHealth();
    res.json({ enabled: true, ...systemHealth });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/automation/start', async (req, res) => {
  if (!automationEnabled || !queueProcessor) {
    return res.status(503).json({ error: 'Automation system not available' });
  }

  try {
    const { batchSize } = req.body;
    const success = await queueProcessor.startAutomation(batchSize);

    if (success) {
      res.json({ message: 'Automation started successfully' });
    } else {
      res.status(400).json({ error: 'Failed to start automation' });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/automation/pause', async (req, res) => {
  if (!queueProcessor) {
    return res.status(503).json({ error: 'Queue processor not available' });
  }

  try {
    const success = await queueProcessor.pauseAutomation();
    res.json({ success, message: success ? 'Automation paused' : 'Failed to pause' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/automation/resume', async (req, res) => {
  if (!queueProcessor) {
    return res.status(503).json({ error: 'Queue processor not available' });
  }

  try {
    const success = await queueProcessor.resumeAutomation();
    res.json({ success, message: success ? 'Automation resumed' : 'Failed to resume' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/automation/stop', async (req, res) => {
  if (!queueProcessor) {
    return res.status(503).json({ error: 'Queue processor not available' });
  }

  try {
    const success = await queueProcessor.stopAutomation();
    res.json({ success, message: success ? 'Automation stopped' : 'Failed to stop' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Language and Character Management APIs
app.get('/api/languages/usage', async (req, res) => {
  if (!characterManager) {
    return res.status(503).json({ error: 'Character manager not available' });
  }

  try {
    const dailyUsage = await characterManager.getDailyUsage();
    const analytics = await characterManager.getUsageAnalytics(7);
    const suggestions = await characterManager.getOptimizationSuggestions();

    res.json({
      daily: dailyUsage,
      analytics,
      suggestions
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/languages/stats', async (req, res) => {
  if (!database) {
    return res.status(503).json({ error: 'Database not available' });
  }

  try {
    const languageStats = await database.getLanguageUsageStats();
    const contactStats = await database.getContactStatusStats();
    const systemStats = await database.getSystemStats();

    res.json({
      languageDistribution: languageStats,
      contactStats,
      systemOverview: systemStats
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/voice/test/:language', async (req, res) => {
  if (!voiceEngine) {
    return res.status(503).json({ error: 'Voice engine not available' });
  }

  try {
    const { language } = req.params;
    const result = await voiceEngine.testVoice(language);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/voice/stats', async (req, res) => {
  if (!voiceEngine) {
    return res.status(503).json({ error: 'Voice engine not available' });
  }

  try {
    const stats = await voiceEngine.getVoiceStats();
    res.json(stats);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Database Management APIs
app.get('/api/database/contacts', async (req, res) => {
  if (!database) {
    return res.status(503).json({ error: 'Database not available' });
  }

  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const status = req.query.status || 'all';
    const language = req.query.language || 'all';

    // Build query conditions
    let whereClause = '';
    const params = [];

    if (status !== 'all') {
      whereClause += ' WHERE status = ?';
      params.push(status);
    }

    if (language !== 'all') {
      whereClause += (whereClause ? ' AND' : ' WHERE') + ' language_preference = ?';
      params.push(language);
    }

    const offset = (page - 1) * limit;

    const contacts = database.db.prepare(`
      SELECT * FROM contacts ${whereClause}
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `).all(...params, limit, offset);

    const totalCount = database.db.prepare(`
      SELECT COUNT(*) as count FROM contacts ${whereClause}
    `).get(...params).count;

    res.json({
      contacts,
      pagination: {
        page,
        limit,
        total: totalCount,
        pages: Math.ceil(totalCount / limit)
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/database/batches', async (req, res) => {
  if (!database) {
    return res.status(503).json({ error: 'Database not available' });
  }

  try {
    const batches = database.db.prepare(`
      SELECT * FROM daily_batches
      ORDER BY created_at DESC
      LIMIT 10
    `).all();

    res.json(batches);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/database/logs', async (req, res) => {
  if (!database) {
    return res.status(503).json({ error: 'Database not available' });
  }

  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;

    const logs = database.db.prepare(`
      SELECT cl.*, c.phone, c.name
      FROM call_logs cl
      JOIN contacts c ON cl.contact_id = c.id
      ORDER BY cl.created_at DESC
      LIMIT ? OFFSET ?
    `).all(limit, offset);

    res.json(logs);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ── OUTBOUND CALL (Generic Agent — uses active business) ───────────────────

// Resolve the public/audio dir regardless of CWD
const AUDIO_DIR = fs.existsSync(path.join(__dirname, 'public', 'audio'))
  ? path.join(__dirname, 'public', 'audio')
  : path.join(__dirname, 'ai-caller', 'public', 'audio');

async function generateAudio(text, language) {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey || apiKey === 'your_elevenlabs_api_key_here') return null;
  try {
    if (!fs.existsSync(AUDIO_DIR)) fs.mkdirSync(AUDIO_DIR, { recursive: true });
    const filePath = await speak(text, apiKey, getVoiceId(language), AUDIO_DIR);
    return filePath ? `/audio/${path.basename(filePath)}` : null;
  } catch (e) {
    console.error('TTS error:', e.message);
    return null;
  }
}

app.post('/api/outbound/start', async (req, res) => {
  try {
    const sessionId = generateSessionId();
    const preferredLanguage = req.body?.language || 'en';

    let chat, text, intent, language;

    const activeBiz = businessManager?.getActiveBusiness();
    if (activeBiz) {
      const kb = businessManager.getKnowledge(activeBiz.id);
      const result = await agentStartCall(activeBiz, 'outbound_lead', preferredLanguage, kb);
      chat = result.chat;
      text = result.text;
      intent = result.intent;
      language = result.language;
    } else {
      // Fallback to legacy MHT-CET agent
      const result = await startMHTCETConversation(preferredLanguage);
      chat = result.chat;
      text = result.text;
      intent = result.intent;
      language = result.language;
    }

    outboundSessions.set(sessionId, {
      chat,
      transcript: [{ role: 'agent', text, time: new Date().toISOString() }],
      language: language || preferredLanguage,
      startTime: new Date().toISOString(),
      businessId: activeBiz?.id || null,
    });

    const audioPath = await generateAudio(text, language || preferredLanguage);
    res.json({ sessionId, text, intent, audioPath, language: language || preferredLanguage, businessName: activeBiz?.name || 'Aegis Nexus AI' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/outbound/respond', async (req, res) => {
  const { sessionId, message, language } = req.body;
  const session = outboundSessions.get(sessionId);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  try {
    session.transcript.push({ role: 'user', text: message, time: new Date().toISOString() });

    let text, intent, detectedLang;

    const activeBiz = businessManager?.getActiveBusiness();
    if (activeBiz) {
      const result = await agentContinueCall(session.chat, message, 'outbound_lead');
      text = result.text;
      intent = result.intent;
      detectedLang = result.language;
    } else {
      // Fallback: inject language override for legacy agent
      let messageForGemini = message;
      if (language && language !== 'en') {
        const langName = language === 'hi' ? 'Hindi (हिंदी)' : 'Marathi (मराठी)';
        messageForGemini = `[LANGUAGE: ${langName}] Student's message: "${message}"`;
      }
      const result = await continueMHTCETConversation(session.chat, messageForGemini);
      text = result.text;
      intent = result.intent;
      detectedLang = result.language;
    }

    session.transcript.push({ role: 'agent', text, time: new Date().toISOString() });
    session.language = language || detectedLang || session.language;

    const audioPath = await generateAudio(text, session.language);
    res.json({ text, intent, audioPath, language: session.language });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/outbound/end', (req, res) => {
  const { sessionId, phone } = req.body;
  const session = outboundSessions.get(sessionId);

  if (session && businessManager) {
    const durationS = Math.round((Date.now() - new Date(session.startTime).getTime()) / 1000);
    const lastIntent = session.transcript.filter(t => t.role === 'agent').slice(-1)[0];
    businessManager.saveTranscript(
      sessionId,
      session.businessId,
      phone || null,
      session.transcript,
      lastIntent ? { intent: lastIntent.intent } : {},
      durationS
    );
  }

  const exchanges = session ? session.transcript.length : 0;
  outboundSessions.delete(sessionId);
  res.json({ success: true, exchanges });
});

// ── BUSINESS MANAGEMENT API ──────────────────────────────────────────────────

app.get('/api/businesses', (req, res) => {
  if (!businessManager) return res.status(503).json({ error: 'BusinessManager not available' });
  res.json(businessManager.listBusinesses());
});

app.get('/api/businesses/active', (req, res) => {
  if (!businessManager) return res.status(503).json({ error: 'BusinessManager not available' });
  const biz = businessManager.getActiveBusiness();
  if (!biz) return res.status(404).json({ error: 'No active business' });
  res.json(biz);
});

app.get('/api/businesses/:id', (req, res) => {
  if (!businessManager) return res.status(503).json({ error: 'BusinessManager not available' });
  const biz = businessManager.getBusiness(parseInt(req.params.id));
  if (!biz) return res.status(404).json({ error: 'Not found' });
  res.json(biz);
});

app.post('/api/businesses', (req, res) => {
  if (!businessManager) return res.status(503).json({ error: 'BusinessManager not available' });
  try {
    const biz = businessManager.createBusiness(req.body);
    res.status(201).json(biz);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.put('/api/businesses/:id', (req, res) => {
  if (!businessManager) return res.status(503).json({ error: 'BusinessManager not available' });
  const biz = businessManager.updateBusiness(req.params.id, req.body);
  res.json(biz);
});

app.delete('/api/businesses/:id', (req, res) => {
  if (!businessManager) return res.status(503).json({ error: 'BusinessManager not available' });
  const ok = businessManager.deleteBusiness(req.params.id);
  res.json({ success: ok });
});

app.post('/api/businesses/:id/activate', (req, res) => {
  if (!businessManager) return res.status(503).json({ error: 'BusinessManager not available' });
  const biz = businessManager.setActiveBusiness(req.params.id);
  res.json(biz);
});

// ── KNOWLEDGE BASE API ────────────────────────────────────────────────────────

app.get('/api/businesses/:id/knowledge', (req, res) => {
  if (!businessManager) return res.status(503).json({ error: 'BusinessManager not available' });
  const entries = businessManager.getKnowledge(req.params.id, req.query.type || null);
  res.json(entries);
});

app.post('/api/businesses/:id/knowledge', (req, res) => {
  if (!businessManager) return res.status(503).json({ error: 'BusinessManager not available' });
  try {
    const entry = businessManager.addKnowledge(req.params.id, req.body);
    res.status(201).json(entry);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.put('/api/knowledge/:kbId', (req, res) => {
  if (!businessManager) return res.status(503).json({ error: 'BusinessManager not available' });
  businessManager.updateKnowledge(req.params.kbId, req.body);
  res.json({ success: true });
});

app.delete('/api/knowledge/:kbId', (req, res) => {
  if (!businessManager) return res.status(503).json({ error: 'BusinessManager not available' });
  const ok = businessManager.deleteKnowledge(req.params.kbId);
  res.json({ success: ok });
});

// Transcript listing (admin dashboard)
function formatTranscripts(rows) {
  return rows.map(r => {
    let finalIntent = '–', language = 'en', transcriptJson = null;
    try { const d = JSON.parse(r.intent_data || '{}'); finalIntent = d.intent || finalIntent; language = d.language || language; } catch (_) {}
    try { transcriptJson = JSON.parse(r.transcript); } catch (_) { transcriptJson = r.transcript; }
    return { id: r.id, session_id: r.session_id, business_id: r.business_id, contact_phone: r.phone, final_intent: finalIntent, language, transcript_json: transcriptJson, duration_s: r.duration_s, created_at: r.created_at };
  });
}

app.get('/api/transcripts', (req, res) => {
  if (!businessManager) return res.status(503).json({ error: 'Not available' });
  const rows = businessManager.db.prepare('SELECT * FROM call_transcripts ORDER BY created_at DESC LIMIT 50').all();
  res.json(formatTranscripts(rows));
});

app.get('/api/businesses/:id/transcripts', (req, res) => {
  if (!businessManager) return res.status(503).json({ error: 'Not available' });
  const rows = businessManager.getTranscripts(req.params.id, 50);
  res.json(formatTranscripts(rows));
});

app.get('/api/businesses/:id/transcripts', (req, res) => {
  if (!businessManager) return res.status(503).json({ error: 'BusinessManager not available' });
  const transcripts = businessManager.getTranscripts(parseInt(req.params.id), parseInt(req.query.limit) || 20);
  res.json(transcripts);
});

// ── LEGACY CALL ENDPOINTS ─────────────────────────────────────────────────────

// Legacy call endpoints (maintained for manual dashboard)
app.post('/api/call/start', async (req, res) => {
  const { contactId } = req.body;
  const contact = contacts.find(c => c.id === contactId);
  if (!contact) return res.status(404).json({ error: 'Contact not found' });

  try {
    const seminar = getSeminarDetails();
    const { chat, text, intent } = await startConversation(contact, seminar);

    activeSessions.set(contactId, { chat, contact, transcript: [], intent });
    activeSessions.get(contactId).transcript.push({ role: 'aria', text, time: new Date().toISOString() });

    // TTS
    let audioPath = null;
    if (process.env.ELEVENLABS_API_KEY && process.env.ELEVENLABS_API_KEY !== 'your_elevenlabs_api_key_here') {
      audioPath = await speak(text, process.env.ELEVENLABS_API_KEY, process.env.ELEVENLABS_VOICE_ID, './public/audio');
      audioPath = audioPath ? `/audio/${path.basename(audioPath)}` : null;
    }

    res.json({ text, intent, audioPath, sessionActive: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/call/respond', async (req, res) => {
  const { contactId, message } = req.body;
  const session = activeSessions.get(contactId);
  if (!session) return res.status(404).json({ error: 'No active session' });

  try {
    session.transcript.push({ role: 'student', text: message, time: new Date().toISOString() });

    const { text, intent } = await continueConversation(session.chat, message);
    session.transcript.push({ role: 'aria', text, time: new Date().toISOString() });
    session.intent = intent;

    let audioPath = null;
    if (process.env.ELEVENLABS_API_KEY && process.env.ELEVENLABS_API_KEY !== 'your_elevenlabs_api_key_here') {
      audioPath = await speak(text, process.env.ELEVENLABS_API_KEY, process.env.ELEVENLABS_VOICE_ID, './public/audio');
      audioPath = audioPath ? `/audio/${path.basename(audioPath)}` : null;
    }

    res.json({ text, intent, audioPath });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/call/end', (req, res) => {
  const { contactId, status, rsvp, notes } = req.body;
  const session = activeSessions.get(contactId);
  const contact = contacts.find(c => c.id === contactId);

  if (contact) {
    contact.status = status || 'called';
    contact.rsvp = rsvp || false;
    contact.calledAt = new Date().toISOString();
    contact.notes = notes || (session ? session.transcript.map(t => `[${t.role}]: ${t.text}`).join('\n') : '');
  }

  activeSessions.delete(contactId);
  saveResults(contacts, RESULTS_FILE);

  broadcastStats();
  res.json({ success: true, stats: getStats(contacts) });
});

// WebSocket Broadcasting
function broadcastStats() {
  const stats = getStats(contacts);
  wss.clients.forEach(client => {
    if (client.readyState === 1) {
      client.send(JSON.stringify({ type: 'stats_update', stats }));
    }
  });
}

function broadcastAutomationUpdate(update) {
  wss.clients.forEach(client => {
    if (client.readyState === 1) {
      client.send(JSON.stringify({ type: 'automation_update', ...update }));
    }
  });
}

// WebSocket Connection Handling
wss.on('connection', (ws) => {
  console.log('📱 Dashboard client connected');

  // Send initial status
  ws.send(JSON.stringify({
    type: 'connection_status',
    automationEnabled,
    timestamp: new Date().toISOString()
  }));

  if (automationEnabled && queueProcessor) {
    ws.send(JSON.stringify({
      type: 'automation_status',
      status: queueProcessor.getProgressStats()
    }));
  }

  ws.on('close', () => {
    console.log('📱 Dashboard client disconnected');
  });
});

// Serve dashboard HTML
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── EXOTEL WEBHOOK ENDPOINTS ──────────────────────────────────────────────
// These endpoints handle real phone calls via Exotel cloud telephony

app.use(express.urlencoded({ extended: true })); // For Exotel form data

// Webhook: Called when student answers the phone
app.post('/webhook/exotel-call-connect', async (req, res) => {
  console.log('🔗 Exotel call connected:', req.body);
  const callSid = req.body.CallSid;

  if (exotelCaller) {
    await exotelCaller.handleCallConnect(callSid, req, res);
  } else {
    res.status(503).send('Exotel caller not initialized');
  }
});

// Webhook: Handles student input (DTMF digits or speech)
app.post('/webhook/exotel-gather', async (req, res) => {
  console.log('👂 Exotel gather input:', req.body);
  const callSid = req.body.CallSid;
  const digits = req.body.Digits;
  const speechResult = req.body.SpeechResult;

  if (exotelCaller) {
    await exotelCaller.handleGather(callSid, digits, speechResult, req, res);
  } else {
    res.status(503).send('Exotel caller not initialized');
  }
});

// Webhook: Handles call timeouts
app.post('/webhook/exotel-timeout', async (req, res) => {
  console.log('⏰ Exotel call timeout:', req.body);
  const callSid = req.body.CallSid;

  if (exotelCaller) {
    exotelCaller.handleTimeout(callSid, req, res);
  } else {
    res.status(503).send('Exotel caller not initialized');
  }
});

// Webhook: Call status updates (answered, completed, failed, etc.)
app.post('/webhook/exotel-call-status', (req, res) => {
  console.log('📊 Exotel call status update:', req.body);
  const callSid = req.body.CallSid;
  const callStatus = req.body.CallStatus;
  const callDuration = req.body.CallDuration;

  if (exotelCaller) {
    exotelCaller.handleCallStatus(callSid, callStatus, callDuration, req, res);
  } else {
    res.status(200).send('OK');
  }
});

// ── TWILIO WEBHOOK ENDPOINTS ──────────────────────────────────────────────

// Voice Start: Generate the initial greeting TwiML for the outbound call
// Speechmatics real-time engine is active via twilioMediaStream.js when
// a stable WebSocket connection is available (production deployment).
app.post('/api/twilio/voice-start', express.urlencoded({ extended: true }), async (req, res) => {
  console.log('🔗 Twilio call connected:', req.body.CallSid);
  if (!twilioManager) return res.status(503).send('Twilio not initialized');
  const contact = { phone: req.body.To || req.body.From, name: 'Engineer' };
  const twiml = await twilioManager.generateStartTwiML(req.body.CallSid, contact, req.body.AnsweredBy);
  res.type('text/xml').send(twiml);
});


app.post('/api/twilio/voice-continue', express.urlencoded({ extended: true }), async (req, res) => {
  console.log('👂 Twilio gather input for:', req.body.CallSid);
  if (!twilioManager) return res.status(503).send('Twilio not initialized');
  const noInput = req.query.noInput === 'true';
  const twiml = await twilioManager.generateContinueTwiML(req.body.CallSid, req.body.SpeechResult, noInput);
  res.type('text/xml').send(twiml);
});

app.post('/api/twilio/status', express.urlencoded({ extended: true }), async (req, res) => {
  console.log('📊 Twilio status update:', req.body.CallStatus);
  if (twilioManager) {
    await twilioManager.handleStatusUpdate(req.body.CallSid, req.body.CallStatus, req.body.CallDuration);
  }
  res.send('OK');
});

// API: Start real outbound call to a student via Twilio
app.post('/api/twilio/call', async (req, res) => {
  const { phone, name } = req.body;
  if (!twilioManager) return res.status(503).json({ error: 'Twilio caller not initialized' });
  if (!phone) return res.status(400).json({ error: 'Phone number required' });
  try {
    const call = await twilioManager.makeCall({ phone, name: name || 'Student' });
    res.json(call);
  } catch (error) {
    console.error('❌ Failed to start Twilio call:', error);
    res.status(500).json({ error: error.message });
  }
});

// API: Start real outbound call to a student (Exotel)
app.post('/api/exotel/call', async (req, res) => {
  const { phone, name } = req.body;

  if (!exotelCaller) {
    return res.status(503).json({ error: 'Exotel caller not initialized' });
  }

  if (!phone) {
    return res.status(400).json({ error: 'Phone number required' });
  }

  try {
    const call = await exotelCaller.makeCall(phone, name || 'Student');
    res.json({
      success: true,
      callSid: call.Sid,
      message: `Call initiated to ${phone}`,
      status: call.Status
    });
  } catch (error) {
    console.error('❌ Failed to start call:', error);
    res.status(500).json({ error: error.message });
  }
});

// API: Start bulk calling campaign
app.post('/api/exotel/bulk-call', async (req, res) => {
  const { contactIds, delayMinutes } = req.body;

  if (!exotelCaller) {
    return res.status(503).json({ error: 'Exotel caller not initialized' });
  }

  if (!contactIds || !Array.isArray(contactIds)) {
    return res.status(400).json({ error: 'Contact IDs array required' });
  }

  try {
    const selectedContacts = contacts.filter(c => contactIds.includes(c.id));
    const delayMs = (delayMinutes || 0.5) * 60 * 1000; // Default 30 seconds between calls

    // Start bulk calling in background
    exotelCaller.startBulkCalling(selectedContacts, delayMs);

    res.json({
      success: true,
      message: `Bulk calling started for ${selectedContacts.length} contacts`,
      contactCount: selectedContacts.length,
      delayBetweenCalls: `${delayMinutes || 0.5} minutes`
    });
  } catch (error) {
    console.error('❌ Failed to start bulk calling:', error);
    res.status(500).json({ error: error.message });
  }
});

// ── END EXOTEL WEBHOOKS ──────────────────────────────────────────────────

// ── WHATSAPP INTEGRATION ──────────────────────────────────────────────────

// Webhook: Handle incoming WhatsApp messages from Twilio
app.post('/webhook/whatsapp', async (req, res) => {
  console.log('📱 WhatsApp webhook received:', req.body);

  const from = req.body.From; // Format: whatsapp:+919876543210
  const body = req.body.Body; // Message text
  const senderName = req.body.ProfileName || 'Student';

  if (!whatsappManager) {
    console.error('❌ WhatsApp manager not initialized');
    return res.status(503).send('WhatsApp not configured');
  }

  try {
    await whatsappManager.handleIncomingMessage(from, body, senderName);
    res.status(200).send('OK');
  } catch (error) {
    console.error('❌ WhatsApp webhook error:', error);
    res.status(500).send('Error processing message');
  }
});

// API: Send WhatsApp message to a contact
app.post('/api/whatsapp/send', async (req, res) => {
  const { phone, message, mediaUrl } = req.body;

  if (!whatsappManager) {
    return res.status(503).json({ error: 'WhatsApp not configured' });
  }

  if (!phone || !message) {
    return res.status(400).json({ error: 'Phone number and message required' });
  }

  try {
    const result = await whatsappManager.sendMessage(phone, message, mediaUrl);
    res.json(result);
  } catch (error) {
    console.error('❌ Failed to send WhatsApp:', error);
    res.status(500).json({ error: error.message });
  }
});

// API: Send welcome message to a contact
app.post('/api/whatsapp/welcome', async (req, res) => {
  const { phone, name } = req.body;

  if (!whatsappManager) {
    return res.status(503).json({ error: 'WhatsApp not configured' });
  }

  if (!phone) {
    return res.status(400).json({ error: 'Phone number required' });
  }

  try {
    const result = await whatsappManager.sendWelcomeMessage(phone, name);
    res.json(result);
  } catch (error) {
    console.error('❌ Failed to send welcome message:', error);
    res.status(500).json({ error: error.message });
  }
});

// API: Send bulk WhatsApp messages
app.post('/api/whatsapp/bulk-send', async (req, res) => {
  const { contactIds, messageTemplate } = req.body;

  if (!whatsappManager) {
    return res.status(503).json({ error: 'WhatsApp not configured' });
  }

  if (!contactIds || !messageTemplate) {
    return res.status(400).json({ error: 'Contact IDs and message template required' });
  }

  try {
    const selectedContacts = contacts.filter(c => contactIds.includes(c.id));
    const results = await whatsappManager.sendBulkMessages(selectedContacts, messageTemplate);

    res.json({
      success: true,
      ...results,
      totalContacts: selectedContacts.length
    });
  } catch (error) {
    console.error('❌ Failed to send bulk WhatsApp:', error);
    res.status(500).json({ error: error.message });
  }
});

// API: Get active WhatsApp chats
app.get('/api/whatsapp/active-chats', (req, res) => {
  if (!whatsappManager) {
    return res.status(503).json({ error: 'WhatsApp not configured' });
  }

  try {
    const activeSessions = whatsappManager.getAllActiveSessions();
    res.json({
      count: whatsappManager.getActiveChatsCount(),
      sessions: activeSessions
    });
  } catch (error) {
    console.error('❌ Failed to get active chats:', error);
    res.status(500).json({ error: error.message });
  }
});

// API: Clear WhatsApp chat session
app.post('/api/whatsapp/clear-session', (req, res) => {
  const { phone } = req.body;

  if (!whatsappManager) {
    return res.status(503).json({ error: 'WhatsApp not configured' });
  }

  if (!phone) {
    return res.status(400).json({ error: 'Phone number required' });
  }

  try {
    const cleared = whatsappManager.clearChatSession(phone);
    res.json({
      success: cleared,
      message: cleared ? 'Session cleared' : 'No active session found'
    });
  } catch (error) {
    console.error('❌ Failed to clear session:', error);
    res.status(500).json({ error: error.message });
  }
});

// ── END WHATSAPP INTEGRATION ──────────────────────────────────────────────

// ── ONBOARDING & CAMPAIGN ROUTES ─────────────────────────────────────────

app.get('/onboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'onboard.html'));
});

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// Onboarding: create business + seed KB in one shot
app.post('/api/onboard', async (req, res) => {
  if (!businessManager) return res.status(503).json({ error: 'BusinessManager not available' });
  try {
    const { business, knowledge } = req.body;
    const biz = businessManager.createBusiness(business);
    if (knowledge && Array.isArray(knowledge)) {
      for (const entry of knowledge) {
        businessManager.addKnowledge(biz.id, entry);
      }
    }
    res.status(201).json({ business: biz, knowledgeCount: knowledge?.length || 0 });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Preview agent greeting for a business (without saving)
app.post('/api/preview-greeting', async (req, res) => {
  try {
    const { business, language = 'en' } = req.body;
    const kb = business.id ? businessManager?.getKnowledge(business.id) : [];
    const { startCall } = await import('./agentEngine.js');
    const result = await startCall(business, 'outbound_lead', language, kb || []);
    res.json({ text: result.text });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Campaign CRUD
app.get('/api/businesses/:id/campaigns', (req, res) => {
  if (!businessManager) return res.status(503).json({ error: 'Not available' });
  const rows = businessManager.db.prepare(
    'SELECT * FROM biz_campaigns WHERE business_id = ? ORDER BY created_at DESC'
  ).all(req.params.id);
  res.json(rows);
});

app.post('/api/businesses/:id/campaigns', (req, res) => {
  if (!businessManager) return res.status(503).json({ error: 'Not available' });
  const { name, call_type } = req.body;
  const id = 'cmp_' + Date.now();
  businessManager.db.prepare(
    'INSERT INTO biz_campaigns (id, business_id, name, call_type, status) VALUES (?,?,?,?,?)'
  ).run(id, req.params.id, name, call_type || 'outbound_lead', 'draft');
  res.status(201).json(businessManager.db.prepare('SELECT * FROM biz_campaigns WHERE id=?').get(id));
});

// Global stats across all businesses
app.get('/api/admin/stats', (req, res) => {
  if (!businessManager) return res.status(503).json({ error: 'Not available' });
  const businesses = businessManager.listBusinesses();
  const totalTranscripts = businessManager.db.prepare('SELECT COUNT(*) as n FROM call_transcripts').get().n;
  const todayTranscripts = businessManager.db.prepare(
    "SELECT COUNT(*) as n FROM call_transcripts WHERE date(created_at) = date('now')"
  ).get().n;
  res.json({
    totalClients: businesses.length,
    activeClient: businesses.find(b => b.active)?.name || 'None',
    totalCalls: totalTranscripts,
    callsToday: todayTranscripts,
    businesses: businesses.map(b => ({
      id: b.id, name: b.name, agent_name: b.agent_name,
      industry: b.industry, active: b.active,
      calls: businessManager.db.prepare(
        'SELECT COUNT(*) as n FROM call_transcripts WHERE business_id=?'
      ).get(b.id)?.n || 0
    }))
  });
});

// ── INBOUND CALL SYSTEM ───────────────────────────────────────────────────

app.get('/inbound', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'inbound-dashboard.html'));
});

app.post('/api/inbound/start', async (req, res) => {
  try {
    const { callerPhone, language = 'en' } = req.body;
    const result = await startInboundCall(callerPhone, language);
    res.json(result);
  } catch (e) {
    console.error('❌ Inbound start error:', e);
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/inbound/respond', async (req, res) => {
  try {
    const { callSid, message } = req.body;
    if (!callSid || !message) return res.status(400).json({ error: 'callSid and message required' });
    const result = await continueInboundCall(callSid, message);
    res.json(result);
  } catch (e) {
    console.error('❌ Inbound respond error:', e);
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/inbound/end', (req, res) => {
  const { callSid } = req.body;
  const result = endInboundCall(callSid);
  res.json(result || { ended: true });
});

app.get('/api/inbound/stats', (req, res) => {
  try {
    res.json(getInboundStats());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/inbound/knowledge/search', (req, res) => {
  const { q } = req.query;
  if (!q) return res.status(400).json({ error: 'q param required' });
  res.json(searchInboundKB(q));
});

app.get('/api/inbound/packages', (req, res) => {
  res.json(listPackages());
});

app.get('/api/inbound/events', (req, res) => {
  res.json(listEvents());
});

// ── END INBOUND CALL SYSTEM ───────────────────────────────────────────────

// ── END ONBOARDING & CAMPAIGN ROUTES ─────────────────────────────────────

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n🔄 Gracefully shutting down...');

  if (queueProcessor) {
    await queueProcessor.shutdown();
  }

  if (database) {
    database.close();
  }

  if (languageEngine) {
    await languageEngine.close();
  }

  if (characterManager) {
    await characterManager.close();
  }

  if (voiceEngine) {
    await voiceEngine.close();
  }

  if (whatsappManager) {
    console.log('📱 Closing WhatsApp manager...');
  }

  server.close(() => {
    console.log('✅ Server shut down complete');
    process.exit(0);
  });
});

// Start server
const PORT = process.env.PORT || 3000;

initializeSystems().then(() => {
  server.listen(PORT, () => {
    console.log(`\n🚀 Enhanced Dashboard running at http://localhost:${PORT}`);
    console.log(`📊 Features: ${automationEnabled ? 'Full Automation + Manual Mode' : 'Manual Mode Only'}`);
    console.log(`🌐 Languages: ${automationEnabled ? 'English, Hindi, Marathi' : 'English Only'}`);
    console.log(`🎙️  Speechmatics Real-Time STT: ${process.env.SPEECHMATICS_API_KEY ? 'ENABLED ✅' : 'DISABLED (add SPEECHMATICS_API_KEY to .env)'}`);
    console.log(`📱 Open your browser to access the dashboard\n`);

    // Attach Speechmatics Media Stream WebSocket handler
    // This handles the /twilio/media-stream WebSocket path
    attachMediaStreamHandler(server, wss);
    console.log('🎙️  Twilio Media Stream WebSocket handler ready at /twilio/media-stream');
  });
}).catch(error => {
  console.error('❌ Failed to start server:', error);
  process.exit(1);
});


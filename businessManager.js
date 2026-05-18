// businessManager.js — SQLite-backed multi-business profile manager

import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Resolve DB path: use ai-caller/ai_caller.db if it exists (legacy location), else local
const LEGACY_DB = path.join(__dirname, 'ai-caller', 'ai_caller.db');
const LOCAL_DB  = path.join(__dirname, 'ai_caller.db');
const DB_PATH   = fs.existsSync(LEGACY_DB) ? LEGACY_DB : LOCAL_DB;

export class BusinessManager {
  constructor() {
    this.db = new Database(DB_PATH);
    this.db.pragma('journal_mode = WAL');
    this._initTables();
    this._seedAegisNexus();
    console.log('🏢 BusinessManager initialized');
  }

  _generateId() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
  }

  _initTables() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS businesses (
        id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
        name        TEXT NOT NULL,
        agent_name  TEXT DEFAULT 'Aria',
        industry    TEXT DEFAULT 'education',
        description TEXT,
        call_goal   TEXT,
        call_types  TEXT DEFAULT '["outbound_lead"]',
        default_language TEXT DEFAULT 'en',
        languages   TEXT DEFAULT '["en","hi","mr"]',
        phone       TEXT,
        website     TEXT,
        custom_prompt TEXT,
        active      INTEGER DEFAULT 0,
        created_at  TEXT DEFAULT (datetime('now')),
        updated_at  TEXT DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS biz_knowledge (
        id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
        business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
        category    TEXT NOT NULL,
        title       TEXT NOT NULL,
        content     TEXT NOT NULL,
        tags        TEXT,
        priority    INTEGER DEFAULT 5,
        created_at  TEXT DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS biz_campaigns (
        id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
        business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
        name        TEXT NOT NULL,
        call_type   TEXT DEFAULT 'outbound_lead',
        status      TEXT DEFAULT 'draft',
        created_at  TEXT DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS call_transcripts (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id  TEXT NOT NULL,
        business_id TEXT,
        phone       TEXT,
        transcript  TEXT,
        intent_data TEXT,
        duration_s  INTEGER,
        created_at  TEXT DEFAULT (datetime('now'))
      );
    `);
  }

  _seedAegisNexus() {
    const existing = this.db.prepare('SELECT COUNT(*) as n FROM businesses').get();
    if (existing.n > 0) return;

    const bizId = this._generateId();
    this.db.prepare(`
      INSERT INTO businesses (id, name, agent_name, industry, description, call_goal, call_types, default_language, languages, website, active)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
    `).run(
      bizId,
      'Aegis Nexus AI',
      'Aria',
      'Cybersecurity Operations',
      "Aegis Nexus AI is the enterprise operations copilot for incident response and threat mitigation.",
      'Coordinate with employees regarding the ongoing US-East server outage and get authorization to deploy automated patches.',
      '["outbound_lead","inbound_support"]',
      'en',
      '["en","hi","mr"]',
      'https://nexus.local'
    );

    const insertKb = this.db.prepare(`
      INSERT INTO biz_knowledge (id, business_id, category, title, content, tags, priority)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    const entries = [
      ['script', 'Opening Greeting', "Hello! I am Aria, the Aegis Security Copilot. I'm calling to notify you of a critical authentication server outage in the US-East datacenter. Are you currently available to assist with the incident response?", 'greeting,opener', 10],
      ['faq', 'What is Aegis Nexus?', "Aegis Nexus AI is the enterprise operations platform that uses Lobster Trap DPI and Gemini 2.5 Flash to automatically detect and mitigate infrastructure threats.", 'company,about', 9],
      ['faq', 'Incident Details', 'The US-East-1 datacenter is currently experiencing a critical authentication outage due to a detected policy breach. We need authorization to isolate the affected servers and deploy the automated security patch.', 'incident,outage,server', 9],
      ['faq', 'Security Status', 'Our Lobster Trap DPI is currently enforcing strict network policies. All prompt injections and unauthorized data exfiltration attempts have been blocked. We remain HIPAA and SOC2 compliant.', 'security,lobster,guardrails', 8],
      ['faq', 'Next Steps', 'Once you authorize the patch deployment, I will initiate the rollout across all US-East edge nodes and then escalate the post-mortem report to the Level 3 Engineering team.', 'patch,deployment,escalation', 8]
    ];

    const insertMany = this.db.transaction((rows) => {
      for (const [category, title, content, tags, priority] of rows) {
        insertKb.run(this._generateId(), bizId, category, title, content, tags, priority);
      }
    });
    insertMany(entries);

    console.log(`✅ Aegis Nexus seeded as default business (${entries.length} KB entries)`);
  }

  // ── CRUD ──────────────────────────────────────────────────────────────────

  listBusinesses() {
    return this.db.prepare('SELECT * FROM businesses ORDER BY created_at DESC').all();
  }

  getBusiness(id) {
    return this.db.prepare('SELECT * FROM businesses WHERE id = ?').get(id);
  }

  getActiveBusiness() {
    return this.db.prepare('SELECT * FROM businesses WHERE active = 1 LIMIT 1').get() || null;
  }

  createBusiness(data) {
    const bizId = this._generateId();
    this.db.prepare(`
      INSERT INTO businesses (id, name, agent_name, industry, description, languages, phone, website, active)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)
    `).run(
      bizId,
      data.name,
      data.agent_name || 'Aria',
      data.industry || 'general',
      data.tagline || data.description || '',
      JSON.stringify((data.languages || 'en').split(',').map(l => l.trim())),
      data.phone || '',
      data.website || '',
    );
    return this.getBusiness(bizId);
  }

  updateBusiness(id, data) {
    const allowed = { name: data.name, agent_name: data.agent_name, industry: data.industry,
      description: data.tagline || data.description, languages: data.languages, phone: data.phone, website: data.website };
    const entries = Object.entries(allowed).filter(([, v]) => v !== undefined);
    if (!entries.length) return this.getBusiness(id);
    const sets = entries.map(([k]) => `${k} = ?`).join(', ');
    this.db.prepare(`UPDATE businesses SET ${sets}, updated_at = datetime('now') WHERE id = ?`).run(
      ...entries.map(([, v]) => v), id
    );
    return this.getBusiness(id);
  }

  deleteBusiness(id) {
    return this.db.prepare('DELETE FROM businesses WHERE id = ?').run(id).changes > 0;
  }

  setActiveBusiness(id) {
    this.db.transaction(() => {
      this.db.prepare('UPDATE businesses SET active = 0').run();
      this.db.prepare('UPDATE businesses SET active = 1 WHERE id = ?').run(id);
    })();
    return this.getBusiness(id);
  }

  // ── KNOWLEDGE BASE ────────────────────────────────────────────────────────

  getKnowledge(businessId, category = null) {
    if (category) {
      return this.db.prepare(
        'SELECT * FROM biz_knowledge WHERE business_id = ? AND category = ? ORDER BY priority DESC'
      ).all(businessId, category);
    }
    return this.db.prepare(
      'SELECT * FROM biz_knowledge WHERE business_id = ? ORDER BY priority DESC'
    ).all(businessId);
  }

  searchKnowledge(businessId, query) {
    const q = `%${query}%`;
    return this.db.prepare(`
      SELECT * FROM biz_knowledge
      WHERE business_id = ?
        AND (title LIKE ? OR content LIKE ? OR tags LIKE ?)
      ORDER BY priority DESC
      LIMIT 5
    `).all(businessId, q, q, q);
  }

  addKnowledge(businessId, data) {
    const kbId = this._generateId();
    this.db.prepare(`
      INSERT INTO biz_knowledge (id, business_id, category, title, content, tags, priority)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      kbId,
      businessId,
      data.category || data.type || 'faq',
      data.title,
      data.content,
      data.tags || '',
      data.priority || 5
    );
    return this.db.prepare('SELECT * FROM biz_knowledge WHERE id = ?').get(kbId);
  }

  updateKnowledge(id, data) {
    const allowed = { category: data.category || data.type, title: data.title, content: data.content, tags: data.tags, priority: data.priority };
    const entries = Object.entries(allowed).filter(([, v]) => v !== undefined);
    if (!entries.length) return;
    const sets = entries.map(([k]) => `${k} = ?`).join(', ');
    this.db.prepare(`UPDATE biz_knowledge SET ${sets} WHERE id = ?`).run(
      ...entries.map(([, v]) => v), id
    );
  }

  deleteKnowledge(id) {
    return this.db.prepare('DELETE FROM biz_knowledge WHERE id = ?').run(id).changes > 0;
  }

  // ── TRANSCRIPTS ───────────────────────────────────────────────────────────

  saveTranscript(sessionId, businessId, phone, transcript, intentData, durationS) {
    this.db.prepare(`
      INSERT INTO call_transcripts (session_id, business_id, phone, transcript, intent_data, duration_s)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      sessionId,
      businessId || null,
      phone || null,
      JSON.stringify(transcript),
      JSON.stringify(intentData || {}),
      durationS || 0
    );
  }

  getTranscripts(businessId, limit = 20) {
    return this.db.prepare(
      'SELECT * FROM call_transcripts WHERE business_id = ? ORDER BY created_at DESC LIMIT ?'
    ).all(businessId, limit);
  }
}

export default BusinessManager;

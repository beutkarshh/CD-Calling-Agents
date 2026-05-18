import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_FILE = path.join(__dirname, 'ai_caller_inbound.db');

const db = new Database(DB_FILE);

db.exec(`
  CREATE TABLE IF NOT EXISTS knowledge_base (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    category TEXT,
    question TEXT,
    answer TEXT,
    keywords TEXT,
    priority INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS counseling_packages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    price TEXT,
    description TEXT,
    is_active INTEGER DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS social_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT,
    platform TEXT,
    event_date TEXT,
    description TEXT,
    is_active INTEGER DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS whatsapp_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    call_sid TEXT,
    recipient_number TEXT,
    message_content TEXT,
    status TEXT,
    provider TEXT,
    created_at TEXT
  );

  CREATE TABLE IF NOT EXISTS inbound_calls (
    id TEXT PRIMARY KEY,
    call_sid TEXT,
    caller_number TEXT,
    caller_name TEXT,
    detected_language TEXT,
    detected_topics TEXT,
    conversation_summary TEXT,
    escalated INTEGER DEFAULT 0,
    escalation_reason TEXT,
    escalation_type TEXT,
    callback_requested INTEGER DEFAULT 0,
    whatsapp_sent INTEGER DEFAULT 0,
    status TEXT,
    created_at TEXT,
    completed_at TEXT
  );

  CREATE TABLE IF NOT EXISTS conversation_turns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    call_sid TEXT,
    turn_number INTEGER,
    role TEXT,
    message TEXT,
    intent TEXT,
    tools_called TEXT,
    created_at TEXT
  );
`);

console.log('Inbound DB Initialized successfully at ' + DB_FILE);
db.close();

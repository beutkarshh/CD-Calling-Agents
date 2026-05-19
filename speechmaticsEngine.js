// speechmaticsEngine.js — Real-Time Speech-to-Text Bridge: Twilio → Speechmatics → Gemini
// Replaces the slow turn-based <Gather> approach with a live streaming WebSocket pipeline.

import WebSocket from 'ws';
import dotenv from 'dotenv';
dotenv.config({ override: true });

const SPEECHMATICS_API_KEY = process.env.SPEECHMATICS_API_KEY;
const SPEECHMATICS_RT_URL = 'wss://eu2.rt.speechmatics.com/v2';

/**
 * SpeechmaticsSession
 * 
 * Each live phone call gets one SpeechmaticsSession.
 * It maintains two WebSocket connections:
 *   1. twilioWs  — the raw audio bytes arriving from Twilio Media Streams
 *   2. smWs      — the Speechmatics real-time transcription WebSocket
 * 
 * When Speechmatics returns a Final Transcript, the onTranscript callback fires
 * which feeds the text into geminiEngine.js for AI reasoning.
 */
export class SpeechmaticsSession {
  constructor({ callSid, onTranscript, onError, language = 'en' }) {
    this.callSid = callSid;
    this.onTranscript = onTranscript; // async (text) => {}
    this.onError = onError;           // (err) => {}
    this.language = language;
    this.smWs = null;
    this.isConnected = false;
    this.audioQueue = [];             // Buffer audio while SM is connecting
    this.streamSid = null;            // Twilio stream identifier
    this.partialTranscript = '';
    this.sessionStarted = false;
  }

  /**
   * Connect to Speechmatics Real-Time API and start receiving audio
   */
  async connect() {
    if (!SPEECHMATICS_API_KEY) {
      console.error('❌ SPEECHMATICS_API_KEY is not set in .env');
      if (this.onError) this.onError(new Error('SPEECHMATICS_API_KEY missing'));
      return false;
    }

    return new Promise((resolve, reject) => {
      console.log(`🎙️  [${this.callSid}] Connecting to Speechmatics Real-Time API...`);

      this.smWs = new WebSocket(SPEECHMATICS_RT_URL, {
        headers: { Authorization: `Bearer ${SPEECHMATICS_API_KEY}` }
      });

      this.smWs.on('open', () => {
        console.log(`✅ [${this.callSid}] Speechmatics WebSocket connected`);
        this._sendStartRecognition();
      });

      this.smWs.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString());
          this._handleSpeechmaticsMessage(msg, resolve);
        } catch (e) {
          console.error(`[${this.callSid}] SM parse error:`, e.message);
        }
      });

      this.smWs.on('error', (err) => {
        console.error(`❌ [${this.callSid}] Speechmatics WebSocket error:`, err.message);
        if (this.onError) this.onError(err);
        reject(err);
      });

      this.smWs.on('close', (code, reason) => {
        console.log(`🔌 [${this.callSid}] Speechmatics WebSocket closed (${code}): ${reason}`);
        this.isConnected = false;
      });
    });
  }

  /**
   * Send StartRecognition message to Speechmatics
   * Uses mulaw (PCMU) audio format which is what Twilio Media Streams send by default
   */
  _sendStartRecognition() {
    const config = {
      message: 'StartRecognition',
      audio_format: {
        type: 'raw',
        encoding: 'mulaw',   // Twilio sends μ-law encoded audio by default
        sample_rate: 8000    // Twilio Media Streams use 8kHz
      },
      transcription_config: {
        language: this._mapLanguageCode(this.language),
        enable_partials: true,           // Get words as they are spoken
        max_delay: 2,                    // Max seconds to wait before finalizing
        enable_entities: false,
        diarization: 'none',
        operating_point: 'enhanced'      // Most accurate model
      }
    };

    this.smWs.send(JSON.stringify(config));
    console.log(`📤 [${this.callSid}] Sent StartRecognition to Speechmatics (language: ${config.transcription_config.language})`);
  }

  /**
   * Map our app language codes to Speechmatics language codes
   */
  _mapLanguageCode(lang) {
    const map = { en: 'en', hi: 'hi', mr: 'mr' };
    return map[lang] || 'en';
  }

  /**
   * Handle incoming messages from Speechmatics
   */
  _handleSpeechmaticsMessage(msg, resolveConnect) {
    switch (msg.message) {
      case 'RecognitionStarted':
        console.log(`🟢 [${this.callSid}] Speechmatics Recognition STARTED — Session: ${msg.id}`);
        this.isConnected = true;
        this.sessionStarted = true;
        // Flush any buffered audio chunks
        if (this.audioQueue.length > 0) {
          console.log(`📦 [${this.callSid}] Flushing ${this.audioQueue.length} buffered audio chunks`);
          for (const chunk of this.audioQueue) {
            this._sendAudio(chunk);
          }
          this.audioQueue = [];
        }
        if (resolveConnect) resolveConnect(true);
        break;

      case 'AddPartialTranscript':
        // Partial — words being spoken right now
        const partialText = msg.results?.map(r => r.alternatives?.[0]?.content || '').join(' ');
        if (partialText) {
          this.partialTranscript = partialText;
          // Broadcast partial to dashboard clients for live display
          if (this.onPartial) this.onPartial(partialText);
        }
        break;

      case 'AddTranscript':
        // Final — utterance is complete, send to Gemini
        const finalWords = msg.results?.map(r => r.alternatives?.[0]?.content || '').join(' ').trim();
        if (finalWords && finalWords.length > 1) {
          console.log(`🗣️  [${this.callSid}] FINAL TRANSCRIPT: "${finalWords}"`);
          this.partialTranscript = '';
          if (this.onTranscript) this.onTranscript(finalWords);
        }
        break;

      case 'EndOfTranscript':
        console.log(`🏁 [${this.callSid}] Speechmatics transcript session ended`);
        break;

      case 'Error':
        console.error(`❌ [${this.callSid}] Speechmatics Error:`, msg.reason);
        if (this.onError) this.onError(new Error(msg.reason));
        break;

      case 'Warning':
        console.warn(`⚠️  [${this.callSid}] Speechmatics Warning:`, msg.reason);
        break;

      default:
        // Silently ignore unknown messages (Info, etc.)
        break;
    }
  }

  /**
   * Feed raw audio bytes from Twilio Media Streams into Speechmatics.
   * Twilio sends audio as base64-encoded mulaw chunks via WebSocket messages.
   * @param {Buffer|string} audioPayload — base64 string from Twilio
   */
  receiveAudio(audioPayload) {
    // Decode base64 → raw Buffer
    const rawAudio = Buffer.from(audioPayload, 'base64');

    if (!this.isConnected || !this.sessionStarted) {
      // Buffer while connecting
      this.audioQueue.push(rawAudio);
      return;
    }

    this._sendAudio(rawAudio);
  }

  _sendAudio(rawBuffer) {
    if (this.smWs && this.smWs.readyState === WebSocket.OPEN) {
      this.smWs.send(rawBuffer);
    }
  }

  /**
   * Gracefully end the Speechmatics session
   */
  end() {
    if (this.smWs && this.smWs.readyState === WebSocket.OPEN) {
      try {
        this.smWs.send(JSON.stringify({ message: 'EndOfStream', last_seq_no: 0 }));
      } catch (_) {}
      setTimeout(() => {
        if (this.smWs) this.smWs.close();
      }, 1000);
    }
    this.isConnected = false;
    console.log(`🔚 [${this.callSid}] Speechmatics session ended`);
  }
}

/**
 * SpeechmaticsSessionManager
 * Manages one SpeechmaticsSession per active Twilio call
 */
export class SpeechmaticsSessionManager {
  constructor() {
    this.sessions = new Map(); // callSid → SpeechmaticsSession
  }

  /**
   * Create and connect a new session for an incoming Twilio Media Stream
   */
  async createSession({ callSid, onTranscript, onPartial, onError, language }) {
    if (this.sessions.has(callSid)) {
      console.warn(`⚠️  Session already exists for callSid ${callSid}`);
      return this.sessions.get(callSid);
    }

    const session = new SpeechmaticsSession({ callSid, onTranscript, onError, language });
    session.onPartial = onPartial;
    this.sessions.set(callSid, session);

    await session.connect();
    return session;
  }

  getSession(callSid) {
    return this.sessions.get(callSid);
  }

  endSession(callSid) {
    const session = this.sessions.get(callSid);
    if (session) {
      session.end();
      this.sessions.delete(callSid);
    }
  }

  getActiveSessions() {
    return this.sessions.size;
  }
}

export default new SpeechmaticsSessionManager();

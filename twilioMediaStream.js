// twilioMediaStream.js — Twilio Media Stream WebSocket Handler
// This replaces the old <Gather speech> approach with a true real-time pipeline:
//
//   Twilio Phone Call
//       │ (raw mulaw audio, 8kHz, streamed in real-time)
//       ▼
//   YOUR SERVER (WebSocket /twilio/media-stream)
//       │ (pipe audio bytes)
//       ▼
//   Speechmatics Real-Time API
//       │ (returns Final Transcript instantly when utterance is complete)
//       ▼
//   geminiEngine.js (AI reasoning + intent detection)
//       │ (returns text response)
//       ▼
//   ElevenLabs TTS → Audio streamed back to Twilio

import { WebSocketServer } from 'ws';
import twilio from 'twilio';
import dotenv from 'dotenv';
import speechmaticsManager from './speechmaticsEngine.js';
import { startInboundCall, continueInboundCall } from './inboundAgents.js';
import { speak } from './voiceEngine.js';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

dotenv.config({ override: true });

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AUDIO_DIR = path.join(__dirname, 'public', 'audio');

// ── Active call state ─────────────────────────────────────────────────────────
// callSid → { chat, language, transcript, isAgentSpeaking, streamSid, twilioWs }
const activeCalls = new Map();

// ── TwiML Generator ───────────────────────────────────────────────────────────

/**
 * Generate TwiML that tells Twilio to open a Media Stream WebSocket to our server.
 * This is what gets served at /api/twilio/voice-start.
 * REPLACES the old <Gather input="speech"> approach.
 */
export function generateMediaStreamTwiML(publicUrl) {
  const VoiceResponse = twilio.twiml.VoiceResponse;
  const twiml = new VoiceResponse();

  // Brief pause to let the WebSocket connect before audio starts
  twiml.pause({ length: 1 });

  // Open a real-time audio stream to our WebSocket server
  const connect = twiml.connect();
  connect.stream({
    url: `${publicUrl.replace('https://', 'wss://').replace('http://', 'ws://')}/twilio/media-stream`,
    track: 'inbound_track' // Only transcribe what the human says
  });

  return twiml.toString();
}

/**
 * Generate TwiML to play back the AI response via ElevenLabs audio URL.
 * We use <Play> to stream the audio file and then re-open the stream.
 */
export function generatePlayResponseTwiML(audioUrl, publicUrl) {
  const VoiceResponse = twilio.twiml.VoiceResponse;
  const twiml = new VoiceResponse();
  twiml.play(audioUrl);
  // After playing, re-open the stream to continue listening
  const connect = twiml.connect();
  connect.stream({
    url: `${publicUrl.replace('https://', 'wss://').replace('http://', 'ws://')}/twilio/media-stream`,
    track: 'inbound_track'
  });
  return twiml.toString();
}

// ── Media Stream WebSocket Handler ────────────────────────────────────────────

/**
 * Attach a Media Stream WebSocket server to your existing HTTP server.
 * Call this once from dashboard-server.js during initialization.
 * 
 * @param {http.Server} httpServer - your existing Express HTTP server
 * @param {WebSocketServer} dashboardWss - your dashboard WSS for broadcasting live transcripts
 */
export function attachMediaStreamHandler(httpServer, dashboardWss) {
  // Create a separate WSS on a specific path for Twilio
  const mediaStreamWss = new WebSocketServer({
    server: httpServer,
    path: '/twilio/media-stream'
  });

  console.log('🎙️  Twilio Media Stream WebSocket handler attached at /twilio/media-stream');

  mediaStreamWss.on('connection', (twilioWs, req) => {
    let callSid = null;
    let smSession = null;
    let isProcessing = false; // Prevent concurrent Gemini calls

    console.log('📞 Twilio Media Stream connected');

    twilioWs.on('message', async (rawMsg) => {
      let msg;
      try {
        msg = JSON.parse(rawMsg.toString());
      } catch (_) {
        return;
      }

      switch (msg.event) {
        // ── Stream starts ──────────────────────────────────────────────────
        case 'start': {
          callSid = msg.start.callSid;
          const streamSid = msg.start.streamSid;
          const language = msg.start.customParameters?.language || 'en';

          console.log(`📞 Media Stream START — callSid: ${callSid}, streamSid: ${streamSid}`);

          // Initialize Gemini conversation
          try {
            // Initialize Aegis Nexus enterprise inbound session
            const callSidKey = `media_${Date.now()}`;
            const result = await startInboundCall(callSidKey, language, '+10000000000');
            const greeting = result.text || "Hello, this is Aria from Aegis Nexus AI. How can I assist with your security incident today?";

            activeCalls.set(callSid, {
              inboundCallSid: callSidKey,
              language,
              streamSid,
              twilioWs,
              transcript: [{ role: 'agent', text: greeting, time: new Date().toISOString() }],
              isAgentSpeaking: false,
            });

            // Broadcast greeting to dashboard as Live Transcript
            broadcastTranscript(dashboardWss, callSid, 'agent', greeting);

            // Convert Aria's greeting to speech and play it
            await speakAndPlay(callSid, greeting, language, twilioWs, streamSid);
          } catch (err) {
            console.error(`❌ Failed to start Gemini conversation:`, err.message);
          }

          // Start Speechmatics session
          try {
            smSession = await speechmaticsManager.createSession({
              callSid,
              language,

              // ── Called every time a word is being spoken (partial) ──────
              onPartial: (partialText) => {
                broadcastPartial(dashboardWss, callSid, partialText);
              },

              // ── Called when an utterance is complete (final) ────────────
              onTranscript: async (finalText) => {
                const callState = activeCalls.get(callSid);
                if (!callState || isProcessing || callState.isAgentSpeaking) {
                  console.log(`[${callSid}] Skipping transcript (processing/agent speaking): "${finalText}"`);
                  return;
                }

                isProcessing = true;
                console.log(`\n🗣️  [${callSid}] Human said: "${finalText}"`);

                // Save to transcript
                callState.transcript.push({ role: 'human', text: finalText, time: new Date().toISOString() });
                broadcastTranscript(dashboardWss, callSid, 'human', finalText);

                try {
                  // Send to Gemini (enterprise inbound pipeline)
                  const callState = activeCalls.get(callSid);
                  const { text: aiText, intent } = await continueInboundCall(
                    callState.inboundCallSid,
                    finalText
                  );

                  console.log(`🤖 [${callSid}] Agent responds: "${aiText}" (intent: ${intent})`);

                  callState.transcript.push({ role: 'agent', text: aiText, time: new Date().toISOString() });
                  broadcastTranscript(dashboardWss, callSid, 'agent', aiText);

                  // Speak and play the response
                  await speakAndPlay(callSid, aiText, callState.language, twilioWs, callState.streamSid);

                  // End call if intent signals resolution
                  if (intent === 'resolved' || intent === 'escalate') {
                    setTimeout(() => {
                      hangupCall(callSid, twilioWs);
                    }, 3000);
                  }
                } catch (err) {
                  console.error(`❌ [${callSid}] Gemini error:`, err.message);
                } finally {
                  isProcessing = false;
                }
              },

              onError: (err) => {
                console.error(`❌ [${callSid}] Speechmatics error:`, err.message);
              }
            });
          } catch (err) {
            console.error(`❌ Failed to connect to Speechmatics:`, err.message);
          }
          break;
        }

        // ── Incoming audio from the human on the phone ─────────────────────
        case 'media': {
          const callState = activeCalls.get(callSid);
          // Only feed audio to Speechmatics when agent is NOT speaking
          if (smSession && callState && !callState.isAgentSpeaking) {
            smSession.receiveAudio(msg.media.payload);
          }
          break;
        }

        // ── Stream ends (call hung up) ─────────────────────────────────────
        case 'stop': {
          console.log(`🔚 [${callSid}] Media Stream STOPPED`);
          if (smSession) speechmaticsManager.endSession(callSid);
          activeCalls.delete(callSid);
          break;
        }
      }
    });

    twilioWs.on('close', () => {
      console.log(`🔌 Twilio WebSocket closed for callSid: ${callSid}`);
      if (callSid) {
        if (smSession) speechmaticsManager.endSession(callSid);
        activeCalls.delete(callSid);
      }
    });

    twilioWs.on('error', (err) => {
      console.error(`❌ Twilio WS error:`, err.message);
    });
  });

  return mediaStreamWss;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Convert text to speech using ElevenLabs, save as audio file, and
 * send a <Play> command to Twilio via the call's REST API.
 */
async function speakAndPlay(callSid, text, language, twilioWs, streamSid) {
  const callState = activeCalls.get(callSid);
  if (callState) callState.isAgentSpeaking = true;

  try {
    const apiKey = process.env.ELEVENLABS_API_KEY;
    const voiceId = process.env[`ELEVENLABS_VOICE_${(language || 'en').toUpperCase()}`] || process.env.ELEVENLABS_VOICE_ID;

    if (apiKey && apiKey !== 'your_elevenlabs_api_key_here' && voiceId) {
      if (!fs.existsSync(AUDIO_DIR)) fs.mkdirSync(AUDIO_DIR, { recursive: true });

      const filePath = await speak(text, apiKey, voiceId, AUDIO_DIR);
      if (filePath) {
        const audioUrl = `${process.env.PUBLIC_URL}/audio/${path.basename(filePath)}`;
        console.log(`🔊 [${callSid}] Playing TTS audio: ${audioUrl}`);

        // Use Twilio REST API to update the call and play audio
        const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
        await twilioClient.calls(callSid).update({
          twiml: `<Response><Play>${audioUrl}</Play></Response>`
        });

        // Estimate speech duration to know when agent has finished speaking
        const wordCount = text.split(' ').length;
        const estimatedDurationMs = Math.max(wordCount * 350, 1500);
        await sleep(estimatedDurationMs);
      }
    } else {
      // Fallback: Use Twilio's built-in TTS (Polly)
      const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
      await twilioClient.calls(callSid).update({
        twiml: `<Response><Say voice="Polly.Joanna" language="en-US">${escapeXml(text)}</Say></Response>`
      });
      const wordCount = text.split(' ').length;
      await sleep(Math.max(wordCount * 400, 1500));
    }
  } catch (err) {
    console.error(`❌ [${callSid}] TTS/playback error:`, err.message);
  } finally {
    if (callState) callState.isAgentSpeaking = false;
  }
}

function hangupCall(callSid, twilioWs) {
  try {
    const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    twilioClient.calls(callSid).update({ status: 'completed' }).catch(() => {});
  } catch (_) {}
}

function broadcastTranscript(wss, callSid, role, text) {
  if (!wss) return;
  const msg = JSON.stringify({
    type: 'live_transcript',
    callSid,
    role,
    text,
    timestamp: new Date().toISOString()
  });
  wss.clients.forEach(client => {
    if (client.readyState === 1) client.send(msg);
  });
}

function broadcastPartial(wss, callSid, text) {
  if (!wss) return;
  const msg = JSON.stringify({ type: 'partial_transcript', callSid, text });
  wss.clients.forEach(client => {
    if (client.readyState === 1) client.send(msg);
  });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function escapeXml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

export { activeCalls };

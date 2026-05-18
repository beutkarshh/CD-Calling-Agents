// simulate.js — CLI call simulation: you type, AI speaks back

import 'dotenv/config';
import readline from 'readline';
import { initGemini, startConversation, continueConversation, getSeminarDetails } from './geminiEngine.js';
import { speak } from './voiceEngine.js';
import { loadContacts, saveResults } from './contactQueue.js';
import fs from 'fs';

const GEMINI_KEY = process.env.GEMINI_API_KEY;
const ELEVEN_KEY = process.env.ELEVENLABS_API_KEY;
const VOICE_ID = process.env.ELEVENLABS_VOICE_ID || '21m00Tcm4TlvDq8ikWAM';
const CSV_FILE = process.env.CSV_FILE || 'contacts.csv';
const RESULTS_FILE = process.env.RESULTS_FILE || 'results.csv';

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise(res => rl.question(q, res));

async function runSimulation() {
  console.log('\n╔════════════════════════════════════════╗');
  console.log('║   🤖 AI CALLER — SIMULATION MODE       ║');
  console.log('╚════════════════════════════════════════╝\n');

  // Init Gemini
  if (!GEMINI_KEY || GEMINI_KEY === 'your_gemini_api_key_here') {
    console.error('❌ Set GEMINI_API_KEY in your .env file');
    process.exit(1);
  }
  initGemini(GEMINI_KEY);

  // Load contacts
  let contacts = [];
  if (fs.existsSync(CSV_FILE)) {
    contacts = loadContacts(CSV_FILE, process.env.PHONE_COLUMN || 'phone');
  } else {
    // Demo mode with fake contacts
    console.log('⚠️  No contacts.csv found — running with demo contacts\n');
    contacts = [
      { id: 1, phone: '+919876543210', name: 'Rahul Sharma', status: 'pending', rsvp: false, notes: '', calledAt: null },
      { id: 2, phone: '+919823456789', name: 'Alice Smith', status: 'pending', rsvp: false, notes: '', calledAt: null },
      { id: 3, phone: '+919812345678', name: 'Student 3', status: 'pending', rsvp: false, notes: '', calledAt: null },
    ];
  }

  const seminar = getSeminarDetails();
  const pending = contacts.filter(c => c.status === 'pending');

  console.log(`📋 Seminar: ${seminar.name}`);
  console.log(`📅 Date: ${seminar.date}`);
  console.log(`📍 Venue: ${seminar.venue}`);
  console.log(`📞 Pending contacts: ${pending.length}\n`);

  // Pick contact to simulate
  console.log('Available contacts (first 10):');
  pending.slice(0, 10).forEach((c, i) => {
    console.log(`  [${i + 1}] ${c.name} — ${c.phone}`);
  });

  const choice = await ask('\nEnter contact number to simulate (or press Enter for #1): ');
  const idx = parseInt(choice) - 1 || 0;
  const contact = pending[idx] || pending[0];

  console.log(`\n📞 Simulating call to: ${contact.name} (${contact.phone})\n`);
  console.log('─'.repeat(50));
  console.log('💡 Type your response after Aria speaks. Commands:');
  console.log('   /quit — end call   /skip — mark no answer   /callback — schedule callback');
  console.log('─'.repeat(50) + '\n');

  await ask('Press Enter to start the call...');

  // Start conversation
  const { chat, text: openingText, intent } = await startConversation(contact, seminar);
  
  console.log(`\n🤖 Aria: ${openingText}\n`);
  
  // Speak opening
  if (ELEVEN_KEY && ELEVEN_KEY !== 'your_elevenlabs_api_key_here') {
    await speak(openingText, ELEVEN_KEY, VOICE_ID);
  } else {
    console.log('🔇 (ElevenLabs key not set — text only mode)');
  }

  let callDone = false;
  let finalStatus = 'called';
  let finalRsvp = false;
  const transcript = [`[Aria]: ${openingText}`];

  // Conversation loop
  while (!callDone) {
    const userInput = await ask('\n👤 You: ');

    if (!userInput.trim()) continue;

    if (userInput === '/quit') {
      console.log('\n📵 Call ended by user');
      break;
    }
    if (userInput === '/skip') {
      finalStatus = 'no_answer';
      console.log('\n📵 Marked as no answer');
      break;
    }
    if (userInput === '/callback') {
      finalStatus = 'callback';
      console.log('\n🔁 Scheduled for callback');
      break;
    }

    transcript.push(`[Student]: ${userInput}`);

    // Get AI response
    const { text: aiText, intent: aiIntent } = await continueConversation(chat, userInput);
    
    console.log(`\n🤖 Aria: ${aiText}\n`);
    transcript.push(`[Aria]: ${aiText}`);

    // Speak response
    if (ELEVEN_KEY && ELEVEN_KEY !== 'your_elevenlabs_api_key_here') {
      await speak(aiText, ELEVEN_KEY, VOICE_ID);
    }

    // Update status from intent
    if (aiIntent.rsvp) finalRsvp = true;
    if (aiIntent.intent === 'not_interested') { finalStatus = 'not_interested'; }
    else if (aiIntent.intent === 'rsvp_yes') { finalStatus = 'interested'; finalRsvp = true; }
    else if (aiIntent.intent === 'callback') { finalStatus = 'callback'; }
    else if (aiIntent.intent === 'interested') { finalStatus = 'interested'; }

    if (aiIntent.done) {
      callDone = true;
      console.log('\n✅ Call naturally concluded');
    }
  }

  // Save result
  contact.status = finalStatus || 'called';
  contact.rsvp = finalRsvp;
  contact.calledAt = new Date().toISOString();
  contact.notes = transcript.join('\n');

  // Print summary
  console.log('\n' + '═'.repeat(50));
  console.log('📊 CALL SUMMARY');
  console.log('═'.repeat(50));
  console.log(`Contact : ${contact.name} (${contact.phone})`);
  console.log(`Status  : ${contact.status.toUpperCase()}`);
  console.log(`RSVP    : ${contact.rsvp ? '✅ YES' : '❌ NO'}`);
  console.log('─'.repeat(50));
  console.log('📝 Transcript:');
  transcript.forEach(line => console.log(`  ${line}`));
  console.log('═'.repeat(50) + '\n');

  saveResults(contacts, RESULTS_FILE);

  const again = await ask('Simulate another call? (y/n): ');
  rl.close();

  if (again.toLowerCase() === 'y') {
    rl.close();
    // Restart
    await runSimulation();
  } else {
    console.log('\n👋 Goodbye! Check results.csv for saved data.\n');
    process.exit(0);
  }
}

runSimulation().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});

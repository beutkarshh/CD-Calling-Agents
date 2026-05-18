// twilioIntegration.js — Real phone call integration with Twilio

import twilio from 'twilio';
import dotenv from 'dotenv';
import { startConversation, continueConversation, getSeminarDetails } from './geminiEngine.js';
import LanguageEngine from './languageEngine.js';
import AICallerDatabase from './database.js';

dotenv.config();

class TwilioCallManager {
  constructor() {
    this.accountSid = process.env.TWILIO_ACCOUNT_SID;
    this.authToken = process.env.TWILIO_AUTH_TOKEN;
    this.phoneNumber = process.env.TWILIO_PHONE_NUMBER;

    if (this.accountSid && this.authToken) {
      this.client = twilio(this.accountSid, this.authToken);
      console.log('📞 Twilio integration initialized');
    } else {
      console.warn('⚠️  Twilio credentials not found. Real calling disabled.');
      this.client = null;
    }

    this.db = new AICallerDatabase();
    this.languageEngine = new LanguageEngine();
    this.activeCalls = new Map(); // callSid -> call state
  }

  /**
   * Initiate outbound call to a contact
   */
  async makeCall(contact) {
    if (!this.client) {
      throw new Error('Twilio not configured');
    }

    try {
      console.log(`📞 Initiating call to ${contact.name} (${contact.phone})`);

      const call = await this.client.calls.create({
        to: contact.phone,
        from: this.phoneNumber,
        url: `${process.env.PUBLIC_URL}/api/twilio/voice-start`,
        statusCallback: `${process.env.PUBLIC_URL}/api/twilio/status`,
        statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed'],
        statusCallbackMethod: 'POST',
        record: process.env.TWILIO_RECORD_CALLS === 'true',
        recordingStatusCallback: `${process.env.PUBLIC_URL}/api/twilio/recording`,
        timeout: 30, // Ring timeout
        machineDetection: 'Enable', // Detect answering machines
        machineDetectionTimeout: 5000
      });

      // Initialize call state
      this.activeCalls.set(call.sid, {
        callSid: call.sid,
        contact,
        startTime: new Date(),
        conversationHistory: [],
        language: 'en',
        chat: null
      });

      // Log to database
      // await this.db.logCall(contact.phone, 'initiated', {
      //  callSid: call.sid,
      //  direction: 'outbound'
      // });

      return {
        success: true,
        callSid: call.sid,
        status: call.status
      };

    } catch (error) {
      console.error(`❌ Failed to initiate call: ${error.message}`);
      // await this.db.logCall(contact.phone, 'failed', {
      //  error: error.message
      // });

      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Generate TwiML for call start (Aria's introduction)
   */
  async generateStartTwiML(callSid, contact, machineDetection = 'human') {
    const VoiceResponse = twilio.twiml.VoiceResponse;
    const twiml = new VoiceResponse();

    // If answering machine detected, leave voicemail and hangup
    if (machineDetection === 'machine') {
      console.log(`📠 Answering machine detected for ${contact.name}`);

      twiml.say({
        voice: 'Polly.Joanna',
        language: 'en-US'
      }, `Hello, this is Aria calling from Aegis Nexus. We are experiencing a critical server incident. Please check your emergency pager. Thank you!`);

      twiml.hangup();

      // await this.db.updateCallLog(contact.phone, 'voicemail_left');
      return twiml.toString();
    }

    // Get call state
    const callState = this.activeCalls.get(callSid);
    if (!callState) {
      this.activeCalls.set(callSid, {
        callSid,
        contact,
        startTime: new Date(),
        conversationHistory: [],
        language: 'en',
        chat: null
      });
    }

    // Aria's introduction
    const intro = await this.languageEngine.getTemplate('intro', 'en');

    // Gather student response with speech recognition
    const gather = twiml.gather({
      input: 'speech',
      action: '/api/twilio/voice-continue',
      method: 'POST',
      timeout: 5,
      speechTimeout: 'auto',
      language: 'en-US',
      hints: 'yes, no, interested, not interested, tell me more, when, where'
    });

    gather.say({
      voice: 'Polly.Joanna',
      language: 'en-US'
    }, intro);

    // If no input, prompt again
    twiml.redirect('/api/twilio/voice-continue?noInput=true');

    return twiml.toString();
  }

  /**
   * Generate TwiML for conversation continuation
   */
  async generateContinueTwiML(callSid, studentSpeech, noInput = false) {
    const VoiceResponse = twilio.twiml.VoiceResponse;
    const twiml = new VoiceResponse();

    const callState = this.activeCalls.get(callSid);
    if (!callState) {
      twiml.say('Sorry, there was an error. Goodbye.');
      twiml.hangup();
      return twiml.toString();
    }

    try {
      // Handle no input
      if (noInput) {
        twiml.say({
          voice: 'Polly.Joanna',
          language: 'en-IN'
        }, 'Are you still there? Please respond.');

        const gather = twiml.gather({
          input: 'speech',
          action: '/api/twilio/voice-continue',
          method: 'POST',
          timeout: 5,
          speechTimeout: 'auto',
          language: 'en-IN'
        });

        return twiml.toString();
      }

      // Get AI response
      if (!callState.chat) {
        // First conversation - need to initialize
        const { chat, text, intent } = await startConversation(
          callState.contact,
          getSeminarDetails()
        );
        callState.chat = chat;
      }

      const { text: aiResponse, intent } = await continueConversation(
        callState.chat,
        studentSpeech
      );

      // Save to conversation history
      callState.conversationHistory.push({
        role: 'student',
        text: studentSpeech,
        timestamp: new Date()
      });
      callState.conversationHistory.push({
        role: 'aria',
        text: aiResponse,
        timestamp: new Date()
      });

      // Check if conversation should end
      if (intent?.done) {
        // End call
        twiml.say({
          voice: 'Polly.Joanna',
          language: 'en-IN'
        }, aiResponse + ' Thank you for your time. Have a great day!');

        twiml.hangup();

        // Cleanup
        this.activeCalls.delete(callSid);
      } else {
        // Continue conversation
        const gather = twiml.gather({
          input: 'speech',
          action: '/api/twilio/voice-continue',
          method: 'POST',
          timeout: 5,
          speechTimeout: 'auto',
          language: 'en-IN'
        });

        gather.say({
          voice: 'Polly.Joanna',
          language: 'en-IN'
        }, aiResponse);

        twiml.redirect('/api/twilio/voice-continue?noInput=true');
      }

      return twiml.toString();

    } catch (error) {
      console.error(`❌ Error in conversation: ${error.message}`);

      twiml.say('Sorry, I encountered an error. Please try again later. Goodbye.');
      twiml.hangup();

      // await this.db.updateCallLog(callState.contact.phone, 'error', {
      //  error: error.message
      // });

      this.activeCalls.delete(callSid);

      return twiml.toString();
    }
  }

  /**
   * Handle call status updates
   */
  async handleStatusUpdate(callSid, status, duration = null) {
    console.log(`📞 Call ${callSid} status: ${status}`);

    const callState = this.activeCalls.get(callSid);

    if (status === 'completed' || status === 'failed' || status === 'no-answer' || status === 'busy') {
      if (callState) {
        // await this.db.updateCallLog(callState.contact.phone, status, {
        //  duration,
        //  conversationHistory: callState.conversationHistory
        // });

        this.activeCalls.delete(callSid);
      }
    }
  }

  /**
   * Get statistics
   */
  getActiveCallsCount() {
    return this.activeCalls.size;
  }

  getCallState(callSid) {
    return this.activeCalls.get(callSid);
  }
}

export default TwilioCallManager;

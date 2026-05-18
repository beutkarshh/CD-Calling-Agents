// whatsappIntegration.js — WhatsApp automation with Twilio for Aegis Nexus alerts

import twilio from 'twilio';
import dotenv from 'dotenv';
import { startMHTCETConversation, continueMHTCETConversation } from './geminiEngine.js';
import AICallerDatabase from './database.js';

dotenv.config();

class WhatsAppManager {
  constructor() {
    this.accountSid = process.env.TWILIO_ACCOUNT_SID;
    this.authToken = process.env.TWILIO_AUTH_TOKEN;
    this.whatsappNumber = process.env.TWILIO_WHATSAPP_NUMBER;
    this.registrationLink = process.env.WHATSAPP_REGISTRATION_LINK || 'https://aegisnexus.ai/incident-dashboard';

    if (this.accountSid && this.authToken) {
      this.client = twilio(this.accountSid, this.authToken);
      console.log('📱 WhatsApp integration initialized');
      console.log(`   Sandbox: ${this.whatsappNumber}`);
    } else {
      console.warn('⚠️  Twilio credentials not found. WhatsApp disabled.');
      this.client = null;
    }

    this.db = new AICallerDatabase();
    this.activeChats = new Map(); // userNumber -> { chat, history, language }
  }

  /**
   * Send WhatsApp message to a user
   */
  async sendMessage(to, message, mediaUrl = null) {
    if (!this.client) {
      throw new Error('WhatsApp not configured');
    }

    try {
      // Ensure 'to' has whatsapp: prefix
      const toNumber = to.startsWith('whatsapp:') ? to : `whatsapp:${to}`;

      const messageData = {
        from: this.whatsappNumber,
        to: toNumber,
        body: message
      };

      if (mediaUrl) {
        messageData.mediaUrl = [mediaUrl];
      }

      const msg = await this.client.messages.create(messageData);

      console.log(`📱 WhatsApp sent to ${to}: ${message.substring(0, 50)}...`);

      // Log to database (optional - don't fail if database logging fails)
      try {
        // Extract plain phone number for database
        const plainPhone = toNumber.replace('whatsapp:', '');

        // Try to find or create contact in database
        let contact = await this.db.getContactByPhone(plainPhone);
        if (!contact) {
          // Create contact if doesn't exist
          await this.db.addContact(plainPhone, 'WhatsApp User');
        }

        await this.db.logCall(plainPhone, 'whatsapp_sent', {
          messageSid: msg.sid,
          message: message.substring(0, 200)
        });
      } catch (dbError) {
        console.warn(`⚠️  Database logging failed (non-critical): ${dbError.message}`);
      }

      return {
        success: true,
        messageSid: msg.sid
      };

    } catch (error) {
      console.error(`❌ WhatsApp send failed: ${error.message}`);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Handle incoming WhatsApp message
   */
  async handleIncomingMessage(from, message, senderName = 'Engineer') {
    try {
      console.log(`📩 WhatsApp from ${from}: ${message}`);

      // Get or create chat session
      let chatSession = this.activeChats.get(from);

      let response;
      let intent;

      if (!chatSession) {
        // Start new conversation
        const result = await startMHTCETConversation(senderName);
        chatSession = {
          chat: result.chat,
          history: [
            { role: 'assistant', text: result.greeting },
            { role: 'user', text: message }
          ],
          language: 'en', // Default to English, can be detected later
          startTime: new Date()
        };
        this.activeChats.set(from, chatSession);

        // Get AI response to user's first message
        const aiResponse = await continueMHTCETConversation(chatSession.chat, message);
        response = aiResponse.text;
        intent = aiResponse.intent;

        chatSession.history.push({ role: 'assistant', text: response });

      } else {
        // Continue existing conversation
        chatSession.history.push({ role: 'user', text: message });

        const aiResponse = await continueMHTCETConversation(chatSession.chat, message);
        response = aiResponse.text;
        intent = aiResponse.intent;

        chatSession.history.push({ role: 'assistant', text: response });
      }

      // Check if user wants registration link
      if (this.shouldSendLink(message, intent)) {
        response += `\n\n🔗 Register here: ${this.registrationLink}\n\n✅ Complete your registration and secure your spot!`;
      }

      // Send response back to user
      await this.sendMessage(from, response);

      // Log conversation to database (optional - don't fail if database logging fails)
      try {
        const plainPhone = from.replace('whatsapp:', '');

        // Ensure contact exists
        let contact = await this.db.getContactByPhone(plainPhone);
        if (!contact) {
          await this.db.addContact(plainPhone, senderName || 'WhatsApp Engineer');
        }

        await this.db.logCall(plainPhone, 'whatsapp_conversation', {
          message,
          response,
          intent: intent?.intent,
          rsvp: intent?.rsvp
        });
      } catch (dbError) {
        console.warn(`⚠️  Database logging failed (non-critical): ${dbError.message}`);
      }

      // Check if conversation should end
      if (intent?.done) {
        console.log(`✅ Conversation ended with ${from}`);
        // Keep session for 30 mins in case user messages again
        setTimeout(() => {
          this.activeChats.delete(from);
        }, 30 * 60 * 1000);
      }

      return {
        success: true,
        response,
        intent
      };

    } catch (error) {
      console.error(`❌ Error handling WhatsApp message: ${error.message}`);

      await this.sendMessage(
        from,
        "Sorry, I encountered an error. Please try again or contact support@aegisnexus.ai"
      );

      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Check if we should send registration link
   */
  shouldSendLink(message, intent) {
    const linkKeywords = [
      'register', 'registration', 'sign up', 'signup', 'enroll',
      'join', 'link', 'how to register', 'rgister', // Common typo
      'interested', 'yes', 'attend', 'coming', 'will come'
    ];

    const msgLower = message.toLowerCase();
    const hasKeyword = linkKeywords.some(keyword => msgLower.includes(keyword));

    // Also check intent from AI
    const intentWantsLink = intent?.rsvp === 'YES' || intent?.intent === 'REGISTER';

    return hasKeyword || intentWantsLink;
  }

  /**
   * Send bulk WhatsApp messages (for campaigns)
   */
  async sendBulkMessages(contacts, messageTemplate) {
    const results = {
      sent: 0,
      failed: 0,
      errors: []
    };

    for (const contact of contacts) {
      try {
        const personalizedMessage = messageTemplate
          .replace('{name}', contact.name || 'Student')
          .replace('{city}', contact.city || 'Maharashtra');

        await this.sendMessage(contact.phone, personalizedMessage);
        results.sent++;

        // Rate limiting: 1 message per second to avoid Twilio throttling
        await new Promise(resolve => setTimeout(resolve, 1000));

      } catch (error) {
        results.failed++;
        results.errors.push({
          contact: contact.phone,
          error: error.message
        });
      }
    }

    return results;
  }

  /**
   * Send welcome message to new user
   */
  async sendWelcomeMessage(to, name = 'Engineer') {
    const welcomeMessage = `🚨 *Aegis Nexus Alert System*

I'm Aria from Aegis Nexus AI, your autonomous security copilot.

🛡️ *Monitoring active systems for:*
✅ Unauthorized Access Attempts
✅ Server Outages (US-East, EU-West)
✅ Lobster Trap DPI Violations

📍 *Global Nodes Monitored:* 24 Data Centers

💬 *Reply with your node location* (e.g., US-East, EU-West) to get status details.`;

    return await this.sendMessage(to, welcomeMessage);
  }

  /**
   * Get active chats count
   */
  getActiveChatsCount() {
    return this.activeChats.size;
  }

  /**
   * Get chat session for a user
   */
  getChatSession(userNumber) {
    return this.activeChats.get(userNumber);
  }

  /**
   * Clear chat session
   */
  clearChatSession(userNumber) {
    return this.activeChats.delete(userNumber);
  }

  /**
   * Get all active sessions
   */
  getAllActiveSessions() {
    return Array.from(this.activeChats.entries()).map(([number, session]) => ({
      number,
      messageCount: session.history.length,
      startTime: session.startTime,
      language: session.language
    }));
  }
}

export default WhatsAppManager;

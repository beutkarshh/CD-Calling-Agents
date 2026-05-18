// exotelIntegration.js — Real telephony integration with Exotel for Campus Dekho
import https from 'https';
import querystring from 'querystring';
import { speak } from './voiceEngine.js';
import { startMHTCETConversation, continueMHTCETConversation } from './geminiEngine.js';

class ExotelCaller {
  constructor() {
    // Add these to your .env file
    this.accountSid = process.env.EXOTEL_SID;
    this.authToken = process.env.EXOTEL_TOKEN;
    this.fromNumber = process.env.EXOTEL_FROM_NUMBER; // Your Exotel number

    if (!this.accountSid || !this.authToken || !this.fromNumber) {
      console.log('⚠️  Exotel credentials missing. Add to .env:');
      console.log('EXOTEL_SID=your_account_sid');
      console.log('EXOTEL_TOKEN=your_auth_token');
      console.log('EXOTEL_FROM_NUMBER=your_exotel_number');
    }

    this.baseUrl = `https://${this.accountSid}:${this.authToken}@api.exotel.com/v1/Accounts/${this.accountSid}`;

    // Active call sessions
    this.activeCalls = new Map();

    console.log('📞 Exotel integration initialized');
  }

  // Make outbound call to student
  async makeCall(studentPhone, studentName = 'Student') {
    if (!this.accountSid) {
      throw new Error('Exotel not configured');
    }

    const callData = querystring.stringify({
      From: this.fromNumber,
      To: studentPhone,
      TimeLimit: '1800', // 30 minutes max
      TimeOut: '30', // Ring for 30 seconds
      Url: `${process.env.BASE_URL || 'http://localhost:3001'}/webhook/exotel-call-connect`,
      StatusCallback: `${process.env.BASE_URL || 'http://localhost:3001'}/webhook/exotel-call-status`,
      StatusCallbackMethod: 'POST'
    });

    return new Promise((resolve, reject) => {
      const options = {
        hostname: 'api.exotel.com',
        path: `/v1/Accounts/${this.accountSid}/Calls/connect.json`,
        method: 'POST',
        headers: {
          'Authorization': 'Basic ' + Buffer.from(`${this.accountSid}:${this.authToken}`).toString('base64'),
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(callData)
        }
      };

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => data += chunk);
        res.on('end', () => {
          try {
            const result = JSON.parse(data);
            if (result.Call) {
              console.log(`📞 Call initiated to ${studentPhone} - SID: ${result.Call.Sid}`);

              // Initialize AI conversation session
              this.activeCalls.set(result.Call.Sid, {
                studentPhone,
                studentName,
                aiSession: null,
                startTime: Date.now()
              });

              resolve(result.Call);
            } else {
              reject(new Error('Failed to initiate call: ' + data));
            }
          } catch (err) {
            reject(new Error('Invalid response: ' + data));
          }
        });
      });

      req.on('error', reject);
      req.write(callData);
      req.end();
    });
  }

  // Handle call connection (when student picks up)
  async handleCallConnect(callSid, req, res) {
    console.log(`🔗 Call connected: ${callSid}`);

    const callSession = this.activeCalls.get(callSid);
    if (!callSession) {
      console.log('❌ Unknown call session');
      return this.endCall(res);
    }

    try {
      // Start AI conversation
      const aiResult = await startMHTCETConversation('en');
      callSession.aiSession = aiResult.chat;

      // Generate TTS for Aria's greeting
      const audioPath = await speak(
        aiResult.text,
        process.env.ELEVENLABS_API_KEY,
        process.env.ELEVENLABS_VOICE_EN,
        './audio'
      );

      // Exotel XML response to play TTS and gather input
      const twimlResponse = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Play>${process.env.BASE_URL || 'http://localhost:3001'}${audioPath}</Play>
  <Gather timeout="5" numDigits="1" action="${process.env.BASE_URL || 'http://localhost:3001'}/webhook/exotel-gather" method="POST">
    <Say voice="woman">Press any key to continue or speak directly</Say>
  </Gather>
  <Redirect method="POST">${process.env.BASE_URL || 'http://localhost:3001'}/webhook/exotel-timeout</Redirect>
</Response>`;

      res.set('Content-Type', 'application/xml');
      res.send(twimlResponse);

    } catch (error) {
      console.error('❌ Error in call connect:', error);
      this.endCall(res);
    }
  }

  // Handle student input (DTMF or speech)
  async handleGather(callSid, digits, speechResult, req, res) {
    const callSession = this.activeCalls.get(callSid);
    if (!callSession || !callSession.aiSession) {
      return this.endCall(res);
    }

    try {
      // For simplicity, this example uses DTMF.
      // For speech recognition, you'd integrate with Exotel's speech features
      let userMessage;

      if (speechResult) {
        userMessage = speechResult;
      } else if (digits) {
        // Map digits to common responses for demo
        const digitResponses = {
          '1': 'Yes, I am preparing for MHT-CET',
          '2': 'No, I am not preparing yet',
          '3': 'I need more information',
          '9': 'I want to end this call'
        };
        userMessage = digitResponses[digits] || 'I pressed ' + digits;
      } else {
        userMessage = 'I want to continue';
      }

      console.log(`👂 Student input: ${userMessage}`);

      // Get AI response
      const aiResult = await continueMHTCETConversation(callSession.aiSession, userMessage);

      // Generate TTS
      const audioPath = await speak(
        aiResult.text,
        process.env.ELEVENLABS_API_KEY,
        process.env.ELEVENLABS_VOICE_EN,
        './audio'
      );

      // Check if conversation should end
      if (aiResult.intent === 'rsvp_yes' || aiResult.intent === 'rsvp_no' || aiResult.intent === 'not_interested') {
        const twimlResponse = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Play>${process.env.BASE_URL || 'http://localhost:3001'}${audioPath}</Play>
  <Say voice="woman">Thank you for your time. Have a great day!</Say>
  <Hangup/>
</Response>`;
        res.set('Content-Type', 'application/xml');
        res.send(twimlResponse);
        this.activeCalls.delete(callSid);
      } else {
        // Continue conversation
        const twimlResponse = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Play>${process.env.BASE_URL || 'http://localhost:3001'}${audioPath}</Play>
  <Gather timeout="8" numDigits="1" action="${process.env.BASE_URL || 'http://localhost:3001'}/webhook/exotel-gather" method="POST">
    <Say voice="woman">Press 1 for yes, 2 for no, 3 for more info, or speak your response</Say>
  </Gather>
  <Redirect method="POST">${process.env.BASE_URL || 'http://localhost:3001'}/webhook/exotel-timeout</Redirect>
</Response>`;
        res.set('Content-Type', 'application/xml');
        res.send(twimlResponse);
      }

    } catch (error) {
      console.error('❌ Error processing input:', error);
      this.endCall(res);
    }
  }

  // Handle call timeout
  handleTimeout(callSid, req, res) {
    console.log(`⏰ Call timeout: ${callSid}`);
    const twimlResponse = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="woman">Thank you for your time. You can call us back anytime. Goodbye!</Say>
  <Hangup/>
</Response>`;
    res.set('Content-Type', 'application/xml');
    res.send(twimlResponse);
    this.activeCalls.delete(callSid);
  }

  // Handle call status updates
  handleCallStatus(callSid, callStatus, callDuration, req, res) {
    console.log(`📊 Call ${callSid} status: ${callStatus}, duration: ${callDuration}s`);

    if (callStatus === 'completed' || callStatus === 'failed' || callStatus === 'no-answer') {
      this.activeCalls.delete(callSid);
    }

    res.status(200).send('OK');
  }

  // End call helper
  endCall(res) {
    const twimlResponse = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="woman">Thank you for your time. Goodbye!</Say>
  <Hangup/>
</Response>`;
    res.set('Content-Type', 'application/xml');
    res.send(twimlResponse);
  }

  // Bulk calling function
  async startBulkCalling(contacts, delayBetweenCalls = 30000) {
    console.log(`🚀 Starting bulk calling for ${contacts.length} contacts`);

    for (let i = 0; i < contacts.length; i++) {
      const contact = contacts[i];

      try {
        await this.makeCall(contact.phone, contact.name);
        console.log(`✅ Call ${i + 1}/${contacts.length} initiated to ${contact.phone}`);

        // Wait between calls to avoid rate limits
        if (i < contacts.length - 1) {
          await new Promise(resolve => setTimeout(resolve, delayBetweenCalls));
        }

      } catch (error) {
        console.error(`❌ Failed to call ${contact.phone}:`, error.message);
      }
    }
  }
}

export default ExotelCaller;
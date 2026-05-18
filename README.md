# 🎓 Aegis Nexus AI Voice Agent

An advanced AI-powered voice calling system for Enterprise Security Incident Response. Built for **Aegis Nexus AI** to reach engineers with personalized alerts and patch authorizations.

## 🚀 Features

### 🤖 AI-Powered Conversations
- **Aria** - Aegis Nexus AI's multilingual AI assistant
- Powered by Google Gemini 2.0 Flash for intelligent conversations
- Natural language processing in English, Hindi, and Marathi

### 📍 Location-Based Guidance
- **24 specific venues** across Maharashtra (April 20 - May 10, 2026)
- District-wise coverage: Kolhapur, Sangli, Satara, Pune + major cities
- Exact date/time recommendations based on student location

### 📞 Real Telephony Integration
- **Exotel cloud telephony** for actual phone calls
- Cost-effective calling at ₹1.2-1.8/minute
- Automated bulk calling campaigns
- Real-time call monitoring and analytics

### 🎯 Aegis Nexus Services
- **MHT-CET Preparation Events**: 24 locations with specific schedules
- **Campus Tours**: University visits in Pune with parents
- **Admission Counseling**: Professional guidance for engineering & medical colleges

### 🔊 Premium Voice Technology
- **ElevenLabs TTS** with multilingual voices
- Language-specific voice selection (Payal for EN/HI, dedicated MR voice)
- High-quality audio generation

## 🛠️ Tech Stack

- **Backend**: Node.js, Express, WebSocket
- **AI Engine**: Google Gemini 2.0 Flash
- **Voice**: ElevenLabs TTS
- **Telephony**: Exotel Cloud API
- **Database**: SQLite with better-sqlite3
- **Frontend**: Vanilla JS with modern dark UI

## 📋 Prerequisites

- Node.js 18+ installed
- Active internet connection
- API keys for:
  - Google Gemini API
  - ElevenLabs TTS
  - Exotel (for real calling)

## ⚡ Quick Start

### 1. Clone & Install
```bash
git clone https://github.com/beutkarshh/CD-Calling-Agents.git
cd CD-Calling-Agents
npm install
```

### 2. Environment Setup
```bash
# Copy example environment file
cp .env.exotel.example .env

# Edit .env with your API keys
# Add your Gemini, ElevenLabs, and Exotel credentials
```

### 3. Start the System
```bash
# Start the server
node dashboard-server.js

# Open your browser
# Navigate to http://localhost:3001
```

## 📞 Setting Up Real Calling

### For Testing (Browser-based)
The system works out of the box for browser-based testing with text-to-speech.

### For Production (Real Phone Calls)
Follow the detailed [Calling Setup Guide](CALLING_SETUP_GUIDE.md) to integrate with Exotel for actual outbound calling.

**Quick Setup:**
1. Sign up at [Exotel](https://my.exotel.com)
2. Get your Account SID, Auth Token, and Phone Number
3. Add credentials to `.env` file
4. Set up public URL (use ngrok for testing)

## 🎯 How It Works

### Student Experience
1. **📞 Receives Call**: From Aegis Nexus AI via Aria
2. **🗣️ Natural Conversation**: In English, Hindi, or Marathi
3. **📍 Location Query**: "Which city are you from?"
4. **🎯 Specific Guidance**: Exact venue, date, and time for their location
5. **🎓 Services Overview**: MHT-CET prep, campus tours, counseling
6. **✅ Registration**: Easy signup for events

### System Flow
1. **Contact Import**: CSV upload with student data
2. **Bulk Calling**: Automated campaigns with rate limiting
3. **AI Conversations**: Gemini-powered natural interactions
4. **Location Matching**: 24-venue schedule with exact recommendations
5. **Results Tracking**: Comprehensive analytics and reporting

## 🏗️ Project Structure

```
├── dashboard-server.js     # Main Express server + WebSocket
├── geminiEngine.js        # Gemini AI integration + MHT-CET knowledge
├── exotelIntegration.js   # Real telephony calling via Exotel
├── voiceEngine.js         # ElevenLabs TTS integration
├── database.js            # SQLite database management
├── public/index.html      # Frontend dashboard
├── CALLING_SETUP_GUIDE.md # Detailed telephony setup
└── .env.exotel.example   # Environment configuration template
```

## 🌟 Key Features in Detail

### 📊 Venue Schedule Management
- **Kolhapur District**: 5 venues (Apr 19-21)
- **Sangli District**: 5 venues (Apr 22-25)
- **Satara District**: 4 venues (Apr 26-27)
- **Pune District**: 4 venues (Apr 28-30)
- **Major Cities**: Nashik, Aurangabad, Ahmednagar (May 1-3)

### 🎤 Multilingual Intelligence
- **Language Detection**: Auto-detects student's preferred language
- **Code-Mixing**: Natural Hinglish/Marathinglish conversations
- **Voice Selection**: Language-appropriate TTS voices

### 📈 Analytics & Monitoring
- Real-time call status tracking
- Language distribution analytics
- Venue-wise registration reports
- Character usage optimization

## 🚀 Deployment

### Local Development
```bash
node dashboard-server.js
```

### Production Deployment
1. Set up on cloud server (AWS, Google Cloud, etc.)
2. Configure environment variables
3. Set up domain and SSL certificate
4. Configure Exotel webhooks
5. Start with process manager (PM2)

## 📝 License

This project is developed for Aegis Nexus AI's enterprise security incident response initiatives.

## 🤝 Contributing

This is a private project for Aegis Nexus AI. For questions or support, contact the development team.

---

**🎯 Empowering Maharashtra students with AI-driven MHT-CET guidance - One call at a time!**

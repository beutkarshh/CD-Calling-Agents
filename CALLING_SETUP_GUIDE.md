# 📞 Real Calling Integration Guide - Aegis Nexus AI

This guide helps you connect your Aegis Nexus AI system to **Exotel** for real outbound calls to engineers.

## 🎯 What You'll Get

✅ **Real Phone Calls**: Make actual calls to students using Exotel cloud telephony
✅ **AI-Powered Conversations**: Aria handles the entire conversation automatically
✅ **Location-Based Recommendations**: Students get specific venue details for their city
✅ **Bulk Calling**: Process thousands of contacts automatically
✅ **Cost-Effective**: ₹1.2-1.8 per minute with Indian provider

---

## 🚀 Step 1: Sign Up for Exotel

1. **Visit**: [https://my.exotel.com](https://my.exotel.com)
2. **Choose Plan**: "Startup Plan" or "Business Plan" (based on volume)
3. **Get Credentials**: Note down your:
   - Account SID
   - Auth Token
   - Exotel Phone Number

**Pricing**: ₹1.2-1.8/minute + ₹3000-5000 setup fee

---

## 🔧 Step 2: Configure Your System

### Add Exotel Credentials
Copy `.env.exotel.example` to your `.env` file and update:

```env
# ── EXOTEL CREDENTIALS ──────────────────────────────
EXOTEL_SID=your_account_sid_here
EXOTEL_TOKEN=your_auth_token_here
EXOTEL_FROM_NUMBER=your_exotel_number_here

# ── WEBHOOK URL (for call handling) ──────────────────
BASE_URL=https://your-domain.com
```

### Set Up Public URL (Required for Webhooks)
Exotel needs to send call events to your server. Use **ngrok** for testing:

```bash
# Install ngrok
npm install -g ngrok

# Expose your local server
ngrok http 3001

# Copy the HTTPS URL (e.g., https://abc123.ngrok.io)
# Add it to your .env as BASE_URL
```

---

## 🔄 Step 3: Test the Integration

### Start Your Server
```bash
cd "d:/Projects/AI Voice agents/ai-caller-system/ai-caller"
node dashboard-server.js
```

### Test Single Call
```bash
curl -X POST http://localhost:3001/api/exotel/call \
  -H "Content-Type: application/json" \
  -d '{"phone": "+919876543210", "name": "Test Student"}'
```

### Test from Dashboard
1. Open `http://localhost:3001`
2. Go to "Contacts" section
3. Click "Call" next to any contact
4. Monitor the call flow in server logs

---

## 📋 Step 4: Bulk Calling Campaign

### Prepare Contact List
Ensure your `contacts.csv` has proper format:
```csv
name,phone,city
Rahul Sharma,+919876543210,Pune
Alice Smith,+919876543211,Kolhapur
Amit Kumar,+919876543212,Nashik
```

### Start Bulk Campaign
```bash
curl -X POST http://localhost:3001/api/exotel/bulk-call \
  -H "Content-Type: application/json" \
  -d '{"contactIds": [1,2,3,4,5], "delayMinutes": 0.5}'
```

---

## 🎯 How the Call Flow Works

1. **🔍 System dials student number**
2. **👋 Aria introduces**: "Hi! I'm Aria from Aegis Nexus AI..."
3. **📍 Asks location**: "Which city are you from?"
4. **🎯 Provides specific details**: "Great! Pune has events on April 28th..."
5. **📚 Discusses MHT-CET preparation**
6. **🎓 Mentions campus tours and counseling**
7. **✅ Registers interest** or **❌ politely ends call**

---

## 🔍 Monitoring & Logs

### Real-time Monitoring
```bash
# Watch server logs
tail -f server.log

# Monitor call status
curl http://localhost:3001/api/automation/status
```

### Call Analytics
- **Dashboard**: `http://localhost:3001` → View call statistics
- **Database**: All conversations logged with outcomes
- **CSV Reports**: Exported results with RSVP status

---

## 💡 Pro Tips

### ✅ Best Practices
- **Test thoroughly** with your own phone number first
- **Monitor costs** – set daily limits in Exotel dashboard
- **Follow DND regulations** – respect Do Not Disturb lists
- **Time your calls** – avoid early morning/late evening
- **Review scripts** – ensure Aria's responses are appropriate

### ⚡ Optimization
- **Batch processing**: 50-100 calls per batch with delays
- **Time slots**: 10 AM - 6 PM for best response rates
- **Follow-ups**: Schedule callbacks for interested students
- **A/B testing**: Try different opening messages

---

## 🆘 Troubleshooting

### Common Issues

**❌ "Exotel not configured"**
→ Check your `.env` file has correct EXOTEL_SID, EXOTEL_TOKEN

**❌ "Webhook failed"**
→ Ensure BASE_URL is publicly accessible (use ngrok)

**❌ "Call failed to connect"**
→ Check phone number format (+91XXXXXXXXXX)

**❌ "TTS not working"**
→ Verify ElevenLabs API key and voice IDs

### Need Help?
- **Exotel Support**: [support@exotel.com](mailto:support@exotel.com)
- **Aegis Nexus Tech**: Check server logs for detailed error messages

---

## 🎉 You're Ready!

Your Aegis Nexus AI calling system is now ready to reach engineers with personalized incident response!

**Next Steps:**
1. Upload your student contact list
2. Set your daily calling quota
3. Schedule your outreach campaigns
4. Monitor results and optimize

🚀 **Start making India's most advanced AI-powered educational outreach calls!**
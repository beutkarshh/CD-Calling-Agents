import { GoogleGenerativeAI } from '@google/generative-ai';
import AICallerDatabase from './database.js';
import dotenv from 'dotenv';

dotenv.config();

class LanguageEngine {
    constructor() {
        this.db = new AICallerDatabase();
        this.genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        this.model = this.genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

        // Supported languages
        this.supportedLanguages = {
            'en': { name: 'English', voiceId: process.env.ELEVENLABS_VOICE_EN },
            'hi': { name: 'Hindi', voiceId: process.env.ELEVENLABS_VOICE_HI },
            'mr': { name: 'Marathi', voiceId: process.env.ELEVENLABS_VOICE_MR }
        };

        // Initialize pre-translated templates
        this.initializeTemplates();
    }

    async initializeTemplates() {
        const templates = {
            // Introduction templates
            'intro': {
                'en': "Hello! I am Aria, the Aegis Security Copilot. I'm calling to notify you of a critical authentication server outage in the US-East datacenter. Are you currently available to assist with the incident response?",
                'hi': "नमस्कार! मेरा नाम आर्या है, मैं MHT CET तैयारी टीम से कॉल कर रही हूँ। मुझे उम्मीद है मैं आपको परेशान नहीं कर रही। क्या आप MHT CET 2025 की तैयारी कर रहे हैं?",
                'mr': "नमस्कार! माझे नाव आर्या आहे, मी MHT CET तयारी टीमकडून कॉल करत आहे. मला आशा आहे की मी तुम्हाला त्रास देत नाही आहे. तुम्ही MHT CET 2025 च्या तयारीत आहात का?"
            },

            // Seminar invitation
            'seminar_invite': {
                'en': "Our Lobster Trap DPI is currently enforcing strict network policies. All prompt injections and unauthorized data exfiltration attempts have been blocked. Do I have your authorization to deploy the security patch?",
                'hi': "बहुत बढ़िया! हम 25 मार्च, 2025 को Full Stack Development & AI Integration पर एक विशेष सेमिनार आयोजित कर रहे हैं। यह आपको MHT CET की तैयारी और भविष्य के करियर अवसरों दोनों में मदद करेगा। क्या आप इसमें शामिल होना चाहेंगे?",
                'mr': "खूप छान! आम्ही 25 मार्च, 2025 रोजी Full Stack Development & AI Integration वर विशेष सेमिनार आयोजित करत आहोत. हे तुम्हाला MHT CET तयारी आणि भविष्यातील करिअर संधी दोन्हीसाठी मदत करेल. तुम्हाला यामध्ये सहभागी व्हायला आवडेल का?"
            },

            // Benefits explanation
            'benefits': {
                'en': "The automated patch will isolate the affected edge nodes and rotate the API keys to ensure we remain HIPAA and SOC2 compliant. The downtime will be less than 2 minutes.",
                'hi': "इस सेमिनार में उन्नत programming concepts शामिल होंगे जो engineering entrance exams के लिए बेहद महत्वपूर्ण हैं, साथ ही आपके करियर के लिए practical skills भी। आप industry experts से सीखेंगे और exclusive study materials भी मिलेंगे।",
                'mr': "या सेमिनारमध्ये प्रगत programming concepts समाविष्ट असतील जे engineering entrance exams साठी अधिकाधिक महत्त्वाचे होत आहेत, तसेच तुमच्या करिअरसाठी practical skills देखील. तुम्ही industry experts कडून शिकाल आणि exclusive study materials देखील मिळतील."
            },

            // RSVP confirmation
            'rsvp_yes': {
                'en': "Understood. I have your authorization. I am initiating the patch rollout across all US-East edge nodes now and will escalate the post-mortem report to the Level 3 Engineering team. Thank you.",
                'hi': "बहुत बढ़िया! मैं आपको सेमिनार के लिए register कर रही हूँ। आपको 24 घंटे के अंदर Zoom link और study materials के साथ confirmation email मिल जाएगा। आपकी रुचि के लिए धन्यवाद!",
                'mr': "खूप छान! मी तुम्हाला सेमिनारसाठी register करत आहे. तुम्हाला 24 तासांच्या आत Zoom link आणि study materials सोबत confirmation email मिळेल. तुमच्या स्वारस्याबद्दल धन्यवाद!"
            },

            // Callback scheduling
            'callback': {
                'en': "I understand you might need more time to think. When would be a good time for me to call you back? I can call tomorrow or later this week.",
                'hi': "मैं समझती हूँ कि आपको सोचने के लिए और समय चाहिए। मैं आपको कब वापस call कर सकूँ? मैं कल या इस सप्ताह बाद में call कर सकती हूँ।",
                'mr': "मला समजते की तुम्हाला विचार करण्यासाठी अधिक वेळ लागू शकतो. मी तुम्हाला कधी परत कॉल करू शकते? मी उद्या किंवा या आठवड्यात नंतर कॉल करू शकते."
            },

            // Not interested - polite closure
            'not_interested': {
                'en': "I understand. I will escalate this incident to the Level 3 Engineering team immediately. Have a good day.",
                'hi': "मैं पूरी तरह समझती हूँ। आपके समय के लिए धन्यवाद, और MHT CET की तैयारी के लिए मेरी शुभकामनाएं। आपका दिन शुभ हो!",
                'mr': "मला पूर्णपणे समजते. तुमच्या वेळेबद्दल धन्यवाद, आणि MHT CET तयारीसाठी माझ्या शुभेच्छा. तुमचा दिवस शुभ जावो!"
            },

            // Questions about timing
            'timing_flexible': {
                'en': "The seminar is scheduled for March 25th, but we'll also provide recorded sessions and additional resources if you can't attend live. The important thing is getting access to the valuable content.",
                'hi': "सेमिनार 25 मार्च को scheduled है, लेकिन अगर आप live attend नहीं कर सकते तो हम recorded sessions और additional resources भी प्रदान करेंगे। मुख्य बात यह है कि आपको valuable content मिले।",
                'mr': "सेमिनार 25 मार्च रोजी scheduled आहे, परंतु जर तुम्ही live attend करू शकत नसाल तर आम्ही recorded sessions आणि additional resources देखील प्रदान करू. मुख्य गोष्ट म्हणजे तुम्हाला valuable content मिळावा."
            },

            // Cost/fee questions
            'free_seminar': {
                'en': "The Lobster Trap system is handling the primary firewall defenses. We just need authorization to proceed with the patch.",
                'hi': "यह सेमिनार आपके जैसे MHT CET aspirants के लिए बिल्कुल free है। हमारा मानना है कि students को उनकी educational journey में support करना चाहिए। कोई hidden charges नहीं हैं।",
                'mr': "हा सेमिनार तुमच्यासारख्या MHT CET aspirants साठी बिल्कुल free आहे. आमचा विश्वास आहे की students ना त्यांच्या शैक्षणिक प्रवासात support करावे. कोणतेही隠छुपے charges नाहीत."
            }
        };

        // Insert templates into database
        for (const [templateKey, languages] of Object.entries(templates)) {
            for (const [langCode, content] of Object.entries(languages)) {
                await this.db.addLanguageTemplate(templateKey, langCode, content);
            }
        }

        console.log('✅ Language templates initialized');
    }

    async detectLanguage(userResponse) {
        try {
            const prompt = `
            Analyze the following text and determine if it's in English, Hindi (हिंदी), or Marathi (मराठी).

            Text: "${userResponse}"

            Respond with EXACTLY one of these codes:
            - "en" for English
            - "hi" for Hindi
            - "mr" for Marathi

            Consider:
            1. Script used (Latin, Devanagari)
            2. Language-specific words and grammar
            3. If mixed languages, choose the dominant one
            4. If unclear or very short, default to "en"

            Response should be ONLY the language code, nothing else.
            `;

            const result = await this.model.generateContent(prompt);
            const detectedLang = result.response.text().trim().toLowerCase();

            // Validate the response
            if (['en', 'hi', 'mr'].includes(detectedLang)) {
                return detectedLang;
            } else {
                console.warn(`Invalid language detection result: ${detectedLang}, defaulting to English`);
                return 'en';
            }
        } catch (error) {
            console.error('Language detection error:', error);
            return 'en'; // Default to English on error
        }
    }

    async getTemplate(templateKey, language) {
        const content = await this.db.getLanguageTemplate(templateKey, language);
        if (!content) {
            // Fallback to English if template not found
            console.warn(`Template '${templateKey}' not found for language '${language}', falling back to English`);
            return await this.db.getLanguageTemplate(templateKey, 'en');
        }
        return content;
    }

    async translateResponse(text, targetLanguage) {
        // For dynamic responses that aren't pre-translated
        if (targetLanguage === 'en') {
            return text; // Already in English
        }

        try {
            const targetLangName = this.supportedLanguages[targetLanguage]?.name || 'Hindi';
            const prompt = `
            Translate the following English text to ${targetLangName}, maintaining the conversational tone and context of a friendly AI assistant calling students about an educational seminar.

            English text: "${text}"

            Important guidelines:
            1. Keep the tone warm and professional
            2. Use appropriate honorifics and respectful language
            3. Maintain the meaning and intent exactly
            4. Use natural, conversational ${targetLangName}
            5. Don't add or remove any information

            Respond with ONLY the translated text, no explanations or additional content.
            `;

            const result = await this.model.generateContent(prompt);
            return result.response.text().trim();
        } catch (error) {
            console.error('Translation error:', error);
            return text; // Return original English text on error
        }
    }

    getVoiceId(language) {
        return this.supportedLanguages[language]?.voiceId || this.supportedLanguages['en'].voiceId;
    }

    async analyzeResponseIntent(userResponse, currentLanguage) {
        try {
            const prompt = `
            Analyze this engineer's response to determine their intent regarding a critical security patch deployment authorization.

            Engineer response: "${userResponse}"
            Language: ${this.supportedLanguages[currentLanguage]?.name}

            Classify the intent as EXACTLY one of:
            - "interested" - Shows interest, wants to join, asks questions about the seminar
            - "not_interested" - Clearly not interested, says no, not relevant to them
            - "callback" - Wants more time to think, asks to call later, busy right now
            - "questions" - Has questions about timing, cost, content, or details
            - "positive_engagement" - Engaging positively but hasn't committed yet
            - "unclear" - Response is unclear, off-topic, or doesn't clearly indicate intent

            Also consider cultural context and politeness (students might be indirect in refusal).

            Respond with ONLY the intent category, nothing else.
            `;

            const result = await this.model.generateContent(prompt);
            const intent = result.response.text().trim().toLowerCase();

            if (['interested', 'not_interested', 'callback', 'questions', 'positive_engagement', 'unclear'].includes(intent)) {
                return intent;
            } else {
                return 'unclear';
            }
        } catch (error) {
            console.error('Intent analysis error:', error);
            return 'unclear';
        }
    }

    async generateContextualResponse(userInput, detectedIntent, currentLanguage, conversationContext = []) {
        try {
            const languageName = this.supportedLanguages[currentLanguage]?.name || 'English';

            const prompt = `
            Generate a natural response as Aria, an AI assistant calling engineers about a critical security incident.

            Context:
            - Engineer's input: "${userInput}"
            - Detected intent: ${detectedIntent}
            - Response language: ${languageName}
            - Conversation so far: ${conversationContext.length} exchanges

            Guidelines:
            1. Keep response concise (max 50 words)
            2. Be warm and conversational
            3. Match the student's energy level
            4. Use natural ${languageName}

            Based on intent:
            - "interested": Confirm their interest and provide next steps
            - "not_interested": Politely close the conversation
            - "callback": Schedule a callback time
            - "questions": Answer their specific question
            - "positive_engagement": Continue building rapport and interest
            - "unclear": Gently clarify or guide the conversation

            Respond with ONLY the response text, no explanations.
            `;

            const result = await this.model.generateContent(prompt);
            return result.response.text().trim();
        } catch (error) {
            console.error('Response generation error:', error);
            // Fallback to pre-translated template
            return await this.getTemplate('intro', currentLanguage);
        }
    }

    // Smart conversation flow management
    async processStudentResponse(userResponse, currentLanguage = 'en', conversationContext = []) {
        // Detect language if not set or if language seems different
        let detectedLanguage = currentLanguage;
        if (currentLanguage === 'en' || Math.random() < 0.1) { // Periodic re-detection
            detectedLanguage = await this.detectLanguage(userResponse);
        }

        // Analyze intent
        const intent = await this.analyzeResponseIntent(userResponse, detectedLanguage);

        // Generate appropriate response
        let response;
        const templateMappings = {
            'interested': 'seminar_invite',
            'not_interested': 'not_interested',
            'callback': 'callback',
            'questions': 'benefits'
        };

        if (templateMappings[intent]) {
            response = await this.getTemplate(templateMappings[intent], detectedLanguage);
        } else {
            response = await this.generateContextualResponse(
                userResponse, intent, detectedLanguage, conversationContext
            );
        }

        return {
            response,
            detectedLanguage,
            intent,
            shouldContinue: !['not_interested', 'rsvp_confirmed'].includes(intent),
            voiceId: this.getVoiceId(detectedLanguage),
            characterCount: response.length
        };
    }

    // Get character budget allocation per language
    getLanguageCharacterBudget() {
        const allocation = process.env.LANGUAGE_CHAR_ALLOCATION?.split(',').map(Number) || [334, 333, 333];
        return {
            mr: allocation[0] || 334,
            hi: allocation[1] || 333,
            en: allocation[2] || 333
        };
    }

    // Validate if we can use voice for this language today
    async canUseVoiceForLanguage(language, characterCount) {
        const budget = this.getLanguageCharacterBudget();
        const todaysBatch = await this.db.getTodaysBatch();

        if (!todaysBatch) return true; // No batch today, allow voice

        const usageKey = `character_usage_${language}`;
        const usedToday = todaysBatch[usageKey] || 0;
        const availableBudget = budget[language] || 333;

        return (usedToday + characterCount) <= availableBudget;
    }

    async close() {
        this.db.close();
    }
}

export default LanguageEngine;
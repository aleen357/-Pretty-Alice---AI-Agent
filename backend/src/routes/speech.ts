import { Router } from 'express';
import { Modality } from '@google/genai';
import { requireAuth, AuthRequest } from '../middleware/auth.js';
import { getAI } from '../lib/gemini.js';

export const speechRouter = Router();

// POST /api/speech/generate
// Body: { text }
speechRouter.post('/generate', requireAuth, async (req: AuthRequest, res) => {
  try {
    const { text } = req.body;
    const ai = getAI();

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash-preview-tts',
      contents: [{ parts: [{ text }] }],
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Zephyr' } },
        },
      },
    });

    const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    if (!base64Audio) return res.status(500).json({ error: 'No audio returned' });

    res.json({ audioBase64: base64Audio });
  } catch (err: any) {
    console.error('speech error:', err);
    res.status(500).json({ error: err.message });
  }
});

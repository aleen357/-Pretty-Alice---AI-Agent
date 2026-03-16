import { Router } from 'express';
import { Type } from '@google/genai';
import { requireAuth, AuthRequest } from '../middleware/auth.js';
import { getAI, SYSTEM_PROMPT, addToWishlistFunction } from '../lib/gemini.js';

export const adviceRouter = Router();

// POST /api/advice
// Body: { prompt, imageBase64?, vanityContext?, history? }
adviceRouter.post('/', requireAuth, async (req: AuthRequest, res) => {
  try {
    const { prompt, imageBase64, vanityContext, history = [] } = req.body;

    const ai = getAI();

    const historyParts = history.map((m: any) => ({
      role: m.sender === 'user' ? 'user' : 'model',
      parts: [{ text: m.content }],
    }));

    const userParts: any[] = [{ text: prompt }];
    if (imageBase64) {
      userParts.push({ inlineData: { mimeType: 'image/jpeg', data: imageBase64 } });
    }

    const contents = [...historyParts, { role: 'user', parts: userParts }];

    const systemInstruction = vanityContext
      ? `${SYSTEM_PROMPT}\n\nUSER'S MAKEUP KIT:\n${vanityContext}\n\nRecommend products the user already has. If missing something essential, use 'addToWishlist'.`
      : SYSTEM_PROMPT;

    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: contents as any,
      config: {
        systemInstruction,
        tools: [{ functionDeclarations: [addToWishlistFunction] }],
      },
    });

    res.json({ text: response.text, functionCalls: response.functionCalls ?? [] });
  } catch (err: any) {
    console.error('advice error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/advice/validate-image
// Body: { imageBase64, prompt }
adviceRouter.post('/validate-image', requireAuth, async (_req: AuthRequest, res) => {
  const req = _req as AuthRequest & { body: { imageBase64: string; prompt: string } };
  try {
    const { imageBase64, prompt } = req.body;
    const ai = getAI();

    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: {
        parts: [
          { inlineData: { mimeType: 'image/jpeg', data: imageBase64 } },
          {
            text: `Analyze this photo for a beauty/makeup request: "${prompt}".
Determine if it is a USER_FACE or REFERENCE_IMAGE.
For USER_FACE check visibility of the relevant feature (lips/eyes/skin).
Return JSON: { "type": "USER_FACE"|"REFERENCE_IMAGE", "isValid": boolean, "reason": string|null }`,
          },
        ],
      },
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            type:    { type: Type.STRING, enum: ['USER_FACE', 'REFERENCE_IMAGE'] },
            isValid: { type: Type.BOOLEAN },
            reason:  { type: Type.STRING, nullable: true },
          },
          required: ['type', 'isValid'],
        },
      },
    });

    res.json(JSON.parse(response.text ?? '{}'));
  } catch (err: any) {
    console.error('validate-image error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/advice/analyze-product
// Body: { imageBase64 }
adviceRouter.post('/analyze-product', requireAuth, async (req: AuthRequest, res) => {
  try {
    const { imageBase64 } = req.body;
    const ai = getAI();

    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: {
        parts: [
          { inlineData: { mimeType: 'image/jpeg', data: imageBase64 } },
          {
            text: 'If this is a makeup/beauty product, return JSON: { name, brand, category, shade }. Otherwise return null.',
          },
        ],
      },
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            name:     { type: Type.STRING },
            brand:    { type: Type.STRING },
            category: { type: Type.STRING },
            shade:    { type: Type.STRING },
          },
        },
      },
    });

    res.json(JSON.parse(response.text ?? 'null'));
  } catch (err: any) {
    console.error('analyze-product error:', err);
    res.status(500).json({ error: err.message });
  }
});

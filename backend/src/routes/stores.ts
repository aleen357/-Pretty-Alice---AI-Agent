import { Router } from 'express';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { getAI } from '../lib/gemini';

export const storesRouter = Router();

// POST /api/stores/find
// Body: { query, lat?, lng? }
storesRouter.post('/find', requireAuth, async (req: AuthRequest, res) => {
  try {
    const { query, lat, lng } = req.body;
    const ai = getAI();

    const locationHint = lat && lng ? ` near coordinates ${lat},${lng}` : '';

    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: `Find makeup stores or beauty salons for: ${query}${locationHint}`,
      config: {
        tools: [{ googleSearch: {} }],
      } as any,
    });

    res.json({
      text: response.text,
      places: response.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [],
    });
  } catch (err: any) {
    console.error('stores error:', err);
    res.status(500).json({ error: err.message });
  }
});

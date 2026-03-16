import { Router } from 'express';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { getAI } from '../lib/gemini';

export const videoRouter = Router();

// POST /api/video/generate
// Body: { prompt }
// Returns a base64-encoded video so the FE can create an object URL
videoRouter.post('/generate', requireAuth, async (req: AuthRequest, res) => {
  try {
    const { prompt } = req.body;
    const ai = getAI();

    let operation = await (ai.models as any).generateVideos({
      model: 'veo-2.0-generate-001',
      prompt: `A short 5-second tutorial showing how to use ${prompt} correctly for makeup application. High quality, close-up.`,
      config: { numberOfVideos: 1, resolution: '720p', aspectRatio: '9:16' },
    });

    while (!operation.done) {
      await new Promise(r => setTimeout(r, 5000));
      operation = await (ai.operations as any).getVideosOperation({ operation });
    }

    const uri = operation.response?.generatedVideos?.[0]?.video?.uri;
    if (!uri) return res.status(500).json({ error: 'No video URI returned' });

    const videoRes = await fetch(uri, {
      headers: { 'x-goog-api-key': process.env.GEMINI_API_KEY! },
    });

    const buffer = await videoRes.arrayBuffer();
    const base64 = Buffer.from(buffer).toString('base64');
    res.json({ videoBase64: base64, mimeType: 'video/mp4' });
  } catch (err: any) {
    console.error('video error:', err);
    res.status(500).json({ error: err.message });
  }
});

import { Router } from 'express';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { getAI } from '../lib/gemini';

export const imagesRouter = Router();

const tryImageModel = async (ai: any, modelName: string, parts: any[]) => {
  try {
    const response = await ai.models.generateContent({ model: modelName, contents: { parts } });
    for (const part of response.candidates?.[0]?.content?.parts ?? []) {
      if (part.inlineData) return `data:image/png;base64,${part.inlineData.data}`;
    }
    return null;
  } catch (err) {
    console.error(`${modelName} failed:`, err);
    return null;
  }
};

// POST /api/images/face-map
// Body: { imageBase64, prompt }
imagesRouter.post('/face-map', requireAuth, async (req: AuthRequest, res) => {
  try {
    const { imageBase64, prompt } = req.body;
    const ai = getAI();

    const parts = [
      { inlineData: { mimeType: 'image/jpeg', data: imageBase64 } },
      {
        text: `You are a professional makeup artist. EDIT this image to create a precise makeup application guide for: ${prompt}.
Guidelines:
- Use colored dots for placement points, arrows for blending direction, shaded areas for diffusion zones.
- For eye/lip requests, zoom in mentally and mark ONLY the relevant area.
- No stray marks on unrelated face areas.
- No connecting lines between left and right eyes.
- Style: clean, professional, high-end beauty masterclass diagram.`,
      },
    ];

    let result = await tryImageModel(ai, 'gemini-3-pro-image-preview', parts);
    if (!result) result = await tryImageModel(ai, 'gemini-3.1-flash-image-preview', parts);

    if (!result) return res.status(500).json({ error: 'Face map generation failed' });
    res.json({ imageUrl: result });
  } catch (err: any) {
    console.error('face-map error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/images/apply-makeup
// Body: { imageBase64, prompt, referenceImageBase64? }
imagesRouter.post('/apply-makeup', requireAuth, async (req: AuthRequest, res) => {
  try {
    const { imageBase64, prompt, referenceImageBase64 } = req.body;
    const ai = getAI();

    const parts: any[] = [{ inlineData: { mimeType: 'image/jpeg', data: imageBase64 } }];

    if (referenceImageBase64) {
      parts.push({ inlineData: { mimeType: 'image/jpeg', data: referenceImageBase64 } });
      parts.push({
        text: `You are a professional makeup artist.
First image = user's face. Second image = reference look.
EDIT the user's photo to apply the reference makeup style: ${prompt}.
Rules: realistic blending, no arrows/dots/text, preserve identity.`,
      });
    } else {
      parts.push({
        text: `You are a professional makeup artist.
EDIT this photo to show how the user looks with: ${prompt}.
Rules: realistic blending, no arrows/dots/text, preserve identity, high-end result.`,
      });
    }

    let result = await tryImageModel(ai, 'gemini-3-pro-image-preview', parts);
    if (!result) result = await tryImageModel(ai, 'gemini-3.1-flash-image-preview', parts);

    if (!result) return res.status(500).json({ error: 'Makeup application failed' });
    res.json({ imageUrl: result });
  } catch (err: any) {
    console.error('apply-makeup error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/images/reference
// Body: { prompt }
imagesRouter.post('/reference', requireAuth, async (req: AuthRequest, res) => {
  try {
    const { prompt } = req.body;
    const ai = getAI();

    const parts = [
      {
        text: `Generate a high-quality professional beauty reference image for: ${prompt}.
Clean, well-lit, focused on makeup details. Professional beauty campaign style.`,
      },
    ];

    let result = await tryImageModel(ai, 'gemini-3-pro-image-preview', parts);
    if (!result) result = await tryImageModel(ai, 'gemini-3.1-flash-image-preview', parts);

    if (!result) return res.status(500).json({ error: 'Reference image generation failed' });
    res.json({ imageUrl: result });
  } catch (err: any) {
    console.error('reference image error:', err);
    res.status(500).json({ error: err.message });
  }
});

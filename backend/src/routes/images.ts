import { Router } from 'express';
import { requireAuth, AuthRequest } from '../middleware/auth.js';
import { getAI } from '../lib/gemini.js';

export const imagesRouter = Router();

const tryImageModel = async (ai: any, modelName: string, parts: any[]) => {
  try {
    const response = await ai.models.generateContent({
      model: modelName,
      contents: { parts },
      config: { responseModalities: ['TEXT', 'IMAGE'] }
    });
    for (const part of response.candidates?.[0]?.content?.parts ?? []) {
      if (part.inlineData) return `data:image/png;base64,${part.inlineData.data}`;
    }
    console.warn(`${modelName} returned no image data`);
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
        text: `You are a world-class makeup artist and beauty educator creating a luxury editorial guide.
EDIT this image to produce a POLISHED, HIGH-END makeup application diagram for: ${prompt}.

QUALITY STANDARDS:
- The base skin must look flawless, hydrated, and luminous — never dry, cakey, or flat.
- Any makeup shown must appear freshly applied, blended to perfection, with a professional finish.
- Lighting should look soft and flattering, as if shot in a high-end beauty studio.

DIAGRAM GUIDELINES:
- Use elegant colored dots for precise placement points, fine arrows for blending direction, soft shaded overlays for diffusion zones.
- For eye or lip requests, mentally zoom in and mark ONLY that area with surgical precision.
- Zero stray marks on unrelated areas. No lines connecting left and right eyes.
- The overall aesthetic should feel like a diagram from a Vogue beauty masterclass — clean, sophisticated, aspirational.`,
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
        text: `You are a world-class makeup artist working on a luxury beauty editorial.
First image = the user's face. Second image = the reference makeup look to replicate.

EDIT the user's photo to apply the reference look: ${prompt}.

QUALITY STANDARDS:
- Skin must look flawless, dewy, and luminous — perfectly primed, never dry, cakey, or patchy.
- All makeup must appear expertly blended with seamless transitions and a professional finish.
- Colors should be rich, vibrant, and true-to-reference — not washed out or muddy.
- The result should look like a high-end beauty campaign photo, not a filter.
- Preserve the user's facial identity, bone structure, and natural features completely.
- No arrows, dots, text, or technical markings of any kind on the image.`,
      });
    } else {
      parts.push({
        text: `You are a world-class makeup artist working on a luxury beauty editorial.
EDIT this photo to show the user wearing: ${prompt}.

QUALITY STANDARDS:
- Skin must look flawless, dewy, and luminous — perfectly primed, never dry, cakey, or patchy.
- All makeup must appear expertly blended with seamless transitions and a professional finish.
- Colors should be rich, vibrant, and true to the requested look — not washed out or muddy.
- The result should look like a high-end beauty campaign photo, not a filter.
- Preserve the user's facial identity, bone structure, and natural features completely.
- No arrows, dots, text, or technical markings of any kind on the image.`,
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
        text: `Generate a stunning, high-end beauty reference image for: ${prompt}.

QUALITY STANDARDS:
- Shot style: luxury beauty campaign or Vogue editorial — soft studio lighting, flawless skin, rich colors.
- Makeup must look freshly applied, expertly blended, and polished to perfection.
- Skin should appear luminous, hydrated, and airbrushed — never dry, flat, or cakey.
- Colors vivid and true-to-life, not washed out.
- Close-up framing that highlights the makeup details beautifully.`,
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

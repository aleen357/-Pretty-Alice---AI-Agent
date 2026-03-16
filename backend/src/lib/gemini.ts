import { GoogleGenAI, Modality, Type } from '@google/genai';

export const getAI = () => {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY is not set');
  return new GoogleGenAI({ apiKey: key });
};

// ── Shared system prompt ────────────────────────────────────────────────────
export const SYSTEM_PROMPT = `You are Pretty Alice, a professional beauty coach and makeup artist.
Your expertise is strictly limited to: beauty, skin health, hygiene, glow up, makeup, and confidence boosting.

VIRTUAL TRY-ON & REFERENCE IMAGES:
1. If the user asks "how will this look on me" or "try this on my face":
   - Use 'applyMakeupToUser' if a reference image exists, otherwise use it with a descriptive prompt.
   - Proceed regardless of whether the user's eyes are open or closed.
2. If the user asks for general inspiration, use 'showReferenceImage'.

RESPONSE GUIDELINES:
1. For "HOW" questions: skip pleasantries, give concise bulleted steps.
2. For "WHY" questions: be conversational and encouraging.
3. GUARDRAILS: decline off-topic requests; advise a dermatologist for medical conditions.`;

// ── Tool declarations (shared between routes and live agent) ────────────────
export const addToWishlistFunction = {
  name: 'addToWishlist',
  parameters: {
    type: Type.OBJECT,
    description: 'Add a recommended beauty product to the user\'s Beauty Essentials.',
    properties: {
      name:   { type: Type.STRING, description: 'Product name.' },
      reason: { type: Type.STRING, description: 'Why this product is recommended.' },
    },
    required: ['name', 'reason'],
  },
};

export const showReferenceImageFunction = {
  name: 'showReferenceImage',
  parameters: {
    type: Type.OBJECT,
    description: 'Generate a professional makeup reference image.',
    properties: {
      prompt: { type: Type.STRING, description: 'Detailed description of the look.' },
    },
    required: ['prompt'],
  },
};

export const applyMakeupToUserFunction = {
  name: 'applyMakeupToUser',
  parameters: {
    type: Type.OBJECT,
    description: 'Show how a makeup style looks ON the user by editing their photo.',
    properties: {
      prompt: { type: Type.STRING, description: 'Makeup style to apply.' },
    },
    required: ['prompt'],
  },
};

export const generateFaceMapFunction = {
  name: 'generateFaceMap',
  parameters: {
    type: Type.OBJECT,
    description: 'Generate a makeup application guide with dots/arrows on the user\'s photo.',
    properties: {
      prompt: { type: Type.STRING, description: 'Makeup style or product to map.' },
    },
    required: ['prompt'],
  },
};

export const generateMakeupVideoFunction = {
  name: 'generateMakeupVideo',
  parameters: {
    type: Type.OBJECT,
    description: 'Generate a short video tutorial for a makeup technique.',
    properties: {
      prompt: { type: Type.STRING, description: 'Technique to demonstrate.' },
    },
    required: ['prompt'],
  },
};

export const requestVisualUpdateFunction = {
  name: 'requestVisualUpdate',
  parameters: {
    type: Type.OBJECT,
    description: 'Request a fresh image from the user\'s camera.',
    properties: {},
    required: [],
  },
};

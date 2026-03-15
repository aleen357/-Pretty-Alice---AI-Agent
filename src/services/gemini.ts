import { GoogleGenAI, Modality, Type, GenerateContentResponse, ThinkingLevel } from "@google/genai";

const getAI = () => {
  const key = process.env.API_KEY || process.env.GEMINI_API_KEY;
  if (!key) {
    throw new Error("API Key is not set");
  }
  return new GoogleGenAI({ apiKey: key });
};

// Global error handler for API key issues
export const handleApiError = (err: any) => {
  const errorMessage = err?.message || String(err);
  if (errorMessage.includes("Requested entity was not found") || errorMessage.includes("PERMISSION_DENIED")) {
    console.warn("API Key permission error detected");
  }
};

const SYSTEM_PROMPT = `You are Pretty Alice, a professional beauty coach and makeup artist.
Your expertise is strictly limited to: beauty, skin health, hygiene, glow up, makeup, and confidence boosting.

VIRTUAL TRY-ON & REFERENCE IMAGES:
1. If the user asks "how will this look on me" or "try this on my face":
   - If they have provided a reference image (or you just generated one for them), use the 'applyMakeupToUser' tool.
   - If they have NOT provided a reference image, but asked for a specific look (e.g., "smokey eye"), use 'applyMakeupToUser' with a descriptive prompt.
   - If you need to see their face to perform the try-on, ask them to upload a photo or use the camera.
   - **IMPORTANT:** Proceed with the try-on regardless of whether the user's eyes are open or closed. Do not ask for a new photo just because of eye position.
2. If the user asks for general inspiration or "show me a look", use 'showReferenceImage'.

RESPONSE GUIDELINES:
1. Differentiate between "HOW" (tutorials, application, steps) and "WHY" (theory, benefits, general advice) questions.
2. For "HOW" questions (e.g., "How do I apply...", "Show me...", "Face map steps"):
   - SKIP ALL PLEASANTRIES and repetitive fluff (e.g., "Hello darling", "You have a lovely glow").
   - Provide SOPHISTICATED, CONCISE, and BULLETED steps.
   - Focus purely on the actions. Use bold text for key areas (e.g., **Forehead**, **Cheeks**).
   - Ensure the steps are easy to read while the user is applying makeup.
3. For "WHY" questions:
   - You can be more conversational and encouraging.
   - Explain the benefits and theory behind the advice.
4. GUARDRAILS:
   - If the user asks about topics outside these domains, politely decline.
   - Use Google Search for current trends.
   - Advise consulting a dermatologist for medical conditions.`;

export const generateSpeech = async (text: string) => {
  const ai = getAI();
  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-preview-tts",
      contents: [{ parts: [{ text }] }],
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: 'Zephyr' },
          },
        },
      },
    });

    const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    return base64Audio;
  } catch (err) {
    console.error("Error generating speech:", err);
    return null;
  }
};

export const generateMakeupAdvice = async (prompt: string, imageBase64?: string, signal?: AbortSignal, vanityContext?: string, history?: any[]) => {
  const ai = getAI();
  
  const historyParts = history?.map(m => ({
    role: m.sender === 'user' ? 'user' : 'model',
    parts: [{ text: m.content }]
  })) || [];

  const contents = imageBase64 
    ? [...historyParts, { role: 'user', parts: [{ text: prompt }, { inlineData: { mimeType: "image/jpeg", data: imageBase64 } }] }]
    : [...historyParts, { role: 'user', parts: [{ text: prompt }] }];

  const systemInstruction = vanityContext 
    ? `${SYSTEM_PROMPT}\n\nUSER'S MAKEUP KIT (VANITY):\n${vanityContext}\n\nUse this information to recommend products the user already has. If they are missing something essential, recommend a product and use the 'addToWishlist' tool to save it for them. ALWAYS explain WHY you are adding a product in your text response.`
    : SYSTEM_PROMPT;

  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: contents as any,
    config: {
        systemInstruction,
        tools: [{ functionDeclarations: [addToWishlistFunction] }]
    }
  });

  return {
    text: response.text,
    functionCalls: response.functionCalls
  };
};

export const validateImageForMakeup = async (imageBase64: string, prompt: string) => {
  const ai = getAI();
  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: {
      parts: [
        { inlineData: { mimeType: "image/jpeg", data: imageBase64 } },
        { text: `Analyze this photo in the context of a beauty/makeup request: "${prompt}".
        
        Determine if this is:
        1. A "USER_FACE": A clear photo of the user's face (or part of it) that can be used to apply makeup ONTO.
        2. A "REFERENCE_IMAGE": An inspirational photo of someone else, a close-up of a specific look, or a product that the user wants to copy or learn about.
        
        If it is a "USER_FACE", also determine if it is "fit for purpose" (well-lit, clear).
        
        CRITICAL VISIBILITY CHECKS for USER_FACE:
        - If the request involves LIPS (lipstick, gloss, liner), the LIPS must be clearly visible and NOT covered by hands, hair, or objects.
        - If the request involves EYES (eyeliner, shadow, lashes), the EYES must be clearly visible.
        - If the request involves FACE (foundation, blush, contour), the relevant areas of the skin must be visible.
        - If a hand or object is blocking a feature that the user wants to apply makeup to, it is INVALID.
        
        CONSIDERATIONS:
        - VISIBILITY: Are the relevant areas clear, in focus, and well-lit?
        - EYE POSITION: DO NOT reject a photo just because eyes are closed (e.g., for eyeshadow).
        - NUANCE: If a professional artist could accurately apply makeup to this photo, it's valid.
        
        Return a JSON object:
        {
          "type": "USER_FACE" | "REFERENCE_IMAGE",
          "isValid": boolean,
          "reason": "If it's a USER_FACE but invalid (e.g., 'Lips are covered by a hand'), explain why. Otherwise null."
        }` }
      ]
    },
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          type: { type: Type.STRING, enum: ["USER_FACE", "REFERENCE_IMAGE"] },
          isValid: { type: Type.BOOLEAN },
          reason: { type: Type.STRING, nullable: true }
        },
        required: ["type", "isValid"]
      }
    }
  });

  try {
    return JSON.parse(response.text);
  } catch (e) {
    return { type: "REFERENCE_IMAGE", isValid: true, reason: null };
  }
};

export const applyMakeupToUser = async (imageBase64: string, prompt: string, referenceImageBase64?: string) => {
  const ai = getAI();
  const tryModel = async (modelName: string) => {
    try {
      console.log(`Calling ${modelName} for virtual try-on:`, prompt);
      const parts: any[] = [
        { inlineData: { mimeType: "image/jpeg", data: imageBase64 } }
      ];

      if (referenceImageBase64) {
        parts.push({ inlineData: { mimeType: "image/jpeg", data: referenceImageBase64 } });
        parts.push({ text: `You are a professional makeup artist. 
        The first image is a photo of the user. 
        The second image is a REFERENCE image showing the makeup style the user wants.
        
        Your task is to EDIT the user's photo to apply the makeup style from the reference image onto their face.
        
        GUIDELINES:
        1. FIDELITY TO REFERENCE: Replicate the colors, textures, and style from the reference image accurately.
        2. REALISM: The makeup should look natural and blended into the user's skin, eyes, and lips.
        3. NO TECHNICAL MARKS: DO NOT draw any arrows, dots, lines, or text on the image.
        4. IDENTITY: Maintain the user's original facial features.
        
        Apply the look from the reference image: ${prompt}.` });
      } else {
        parts.push({ text: `You are a professional makeup artist. This is a photo of the user. 
        Your task is to EDIT this image to show EXACTLY how the user would look with this makeup style: ${prompt}.
        
        GUIDELINES:
        1. REALISM: The makeup should look natural and blended into the user's skin, eyes, and lips.
        2. NO TECHNICAL MARKS: DO NOT draw any arrows, dots, lines, or text on the image.
        3. FIDELITY: Maintain the user's original facial features and identity.
        4. QUALITY: The result should look like a high-end professional makeover.
        
        Apply the following look: ${prompt}.` });
      }

      const response = await ai.models.generateContent({
        model: modelName,
        contents: { parts },
      });

      if (response.candidates && response.candidates.length > 0) {
        for (const part of response.candidates[0].content?.parts || []) {
          if (part.inlineData) {
            return `data:image/png;base64,${part.inlineData.data}`;
          }
        }
      }
      return null;
    } catch (err) {
      console.error(`Error in ${modelName} virtual try-on:`, err);
      return null;
    }
  };

  // Use gemini-3.1-flash-image-preview for high-quality edits
  let result = await tryModel('gemini-3.1-flash-image-preview');
  if (!result) result = await tryModel('gemini-2.5-flash-image');
  return result;
};

export const generateFaceMap = async (imageBase64: string, prompt: string) => {
  const ai = getAI();
  const tryModel = async (modelName: string) => {
    try {
      console.log(`Calling ${modelName} for face map:`, prompt);
      console.log(`Image data length: ${imageBase64.length} characters`);
      const response = await ai.models.generateContent({
        model: modelName,
        contents: {
          parts: [
            { inlineData: { mimeType: "image/jpeg", data: imageBase64 } },
            { text: `You are a professional makeup artist. This is a photo of the user. 
            Your task is to EDIT this image to create a highly precise, technical makeup application guide for: ${prompt}.

            TECHNICAL GUIDELINES:
            1. PRECISION: Place dots and lines EXACTLY where the product should be applied. 
            2. FOCUS & CROP: If the request is specifically for EYES or LIPS, you MUST output a zoomed-in, cropped version of the image that focuses ONLY on that area (e.g., a close-up of the eyes for eyeliner). This allows for much higher precision.
            3. EYE MAKEUP: For eyeliner or eyeshadow, zoom in your mental focus on the eyes. Draw the wing or line directly on the lash line or outer corner. NEVER place dots on the eyeball itself; focus on the skin of the eyelids and the lash line.
            3. NO STRAY MARKS: Do not place any marks, dots, or lines on the nose, forehead, or cheeks if the request is for eye makeup. 
            4. NO CONNECTORS: Do not draw lines connecting the left eye to the right eye across the bridge of the nose. Each eye should have its own independent markings.
            5. VISUAL LANGUAGE:
               - Use small, solid COLORED DOTS to indicate starting points or heavy placement.
               - Use thin, elegant ARROWS to show the direction of blending or the "flick" of a wing.
               - Use subtle, semi-transparent SHADED AREAS to show where color should be diffused.
            6. CLARITY: Do not place marks randomly on the face. If the request is for "eyeliner", all marks must be on or immediately around the eyes.
            7. STYLE: Keep the overlays clean, professional, and sophisticated. It should look like a diagram from a high-end beauty masterclass.

            Create the map for: ${prompt}.` },
          ],
        },
      });

      console.log(`${modelName} face map response:`, response);

      if (response.candidates && response.candidates.length > 0) {
        for (const part of response.candidates[0].content?.parts || []) {
          if (part.inlineData) {
            console.log(`Face map image data found in ${modelName} response`);
            return `data:image/png;base64,${part.inlineData.data}`;
          }
        }
      }
      return null;
    } catch (err) {
      console.error(`Error in ${modelName} face map:`, err);
      return null;
    }
  };

  // Try gemini-3.1-flash-image-preview first as it's more precise for technical edits
  let result = await tryModel('gemini-3.1-flash-image-preview');
  
  // Fallback to gemini-2.5-flash-image
  if (!result) {
    console.log("Falling back to gemini-2.5-flash-image for face map...");
    result = await tryModel('gemini-2.5-flash-image');
  }

  if (!result) {
    console.error("All models failed to generate face map.");
  }

  return result;
};

export const analyzeProductImage = async (imageBase64: string) => {
  const ai = getAI();
  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: {
      parts: [
        { inlineData: { mimeType: "image/jpeg", data: imageBase64 } },
        { text: "Analyze this image. If it is a makeup or beauty product, extract the following details in JSON format: name, brand, category (one of: Foundation, Concealer, Blush, Bronzer, Eyeshadow, Lipstick, Other), and shade (if visible). If it is not a makeup product, return null." }
      ]
    },
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          name: { type: Type.STRING },
          brand: { type: Type.STRING },
          category: { type: Type.STRING },
          shade: { type: Type.STRING }
        }
      }
    }
  });

  try {
    return JSON.parse(response.text);
  } catch (e) {
    return null;
  }
};

export const findMakeupStores = async (query: string, lat?: number, lng?: number) => {
  const ai = getAI();
  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: `Find makeup stores or beauty salons for: ${query}`,
    config: {
      tools: [{ googleMaps: {} }],
      toolConfig: {
        retrievalConfig: {
          latLng: lat && lng ? { latitude: lat, longitude: lng } : undefined
        }
      }
    }
  });

  return {
    text: response.text,
    places: response.candidates?.[0]?.groundingMetadata?.groundingChunks
  };
};

export const generateReferenceImage = async (prompt: string) => {
  const ai = getAI();
  const tryModel = async (modelName: string) => {
    try {
      console.log(`Calling ${modelName} for reference image:`, prompt);
      const response = await ai.models.generateContent({
        model: modelName,
        contents: {
          parts: [
            { text: `Generate a high-quality, professional beauty and makeup reference image for: ${prompt}. The image should be clean, well-lit, and focus on the makeup details. It should look like a professional beauty campaign photo.` },
          ],
        },
        config: {
          imageConfig: {
            aspectRatio: "1:1",
          }
        }
      });

      console.log(`${modelName} response received:`, response);

      if (response.candidates && response.candidates.length > 0) {
        for (const part of response.candidates[0].content?.parts || []) {
          if (part.inlineData) {
            console.log(`Image data found in ${modelName} response`);
            return `data:image/png;base64,${part.inlineData.data}`;
          }
        }
      }
      return null;
    } catch (err) {
      console.error(`Error in ${modelName}:`, err);
      return null;
    }
  };

  // Try gemini-2.5-flash-image first
  let result = await tryModel('gemini-2.5-flash-image');
  
  // Fallback to gemini-3.1-flash-image-preview if first fails
  if (!result) {
    console.log("Falling back to gemini-3.1-flash-image-preview...");
    result = await tryModel('gemini-3.1-flash-image-preview');
  }

  return result;
};

export const generateMakeupVideo = async (prompt: string) => {
  const ai = getAI();
  let operation = await ai.models.generateVideos({
    model: 'veo-3.1-fast-generate-preview',
    prompt: `A short 5-second tutorial showing how to use ${prompt} correctly for makeup application. High quality, close-up.`,
    config: {
      numberOfVideos: 1,
      resolution: '720p',
      aspectRatio: '9:16'
    }
  });

  while (!operation.done) {
    await new Promise(resolve => setTimeout(resolve, 5000));
    operation = await ai.operations.getVideosOperation({ operation: operation });
  }

  const downloadLink = operation.response?.generatedVideos?.[0]?.video?.uri;
  if (!downloadLink) return null;

  const response = await fetch(downloadLink, {
    method: 'GET',
    headers: {
      'x-goog-api-key': process.env.API_KEY || process.env.GEMINI_API_KEY || '',
    },
  });
  
  const blob = await response.blob();
  return URL.createObjectURL(blob);
};

export const showReferenceImageFunction = {
  name: "showReferenceImage",
  parameters: {
    type: Type.OBJECT,
    description: "Generates and shows a professional makeup or beauty reference image to the user. Use this when the user asks to see a look, a style, or an inspiration image.",
    properties: {
      prompt: {
        type: Type.STRING,
        description: "A detailed description of the makeup look or beauty style to generate.",
      },
    },
    required: ["prompt"],
  },
};

export const addToWishlistFunction = {
  name: "addToWishlist",
  parameters: {
    type: Type.OBJECT,
    description: "Add a recommended beauty product to the user's Beauty Essentials (wishlist).",
    properties: {
      name: { type: Type.STRING, description: "The name of the product." },
      reason: { type: Type.STRING, description: "Why this product is recommended for the user." }
    },
    required: ["name", "reason"]
  }
};
export const applyMakeupToUserFunction = {
  name: "applyMakeupToUser",
  parameters: {
    type: Type.OBJECT,
    description: "Shows the user how a specific makeup style will look ON THEM. This edits the user's photo to apply the makeup realistically without any technical markings (no dots or arrows). Use this when the user asks 'how will this look on me?' or 'try this on me'.",
    properties: {
      prompt: { type: Type.STRING, description: "The makeup style or product to apply to the user's face." }
    },
    required: ["prompt"]
  }
};

export const generateFaceMapFunction = {
  name: "generateFaceMap",
  parameters: {
    type: Type.OBJECT,
    description: "Generate a professional makeup application guide (with dots and arrows) on the user's photo. Use this when the user asks 'show me where to apply' or 'how do I apply this on my face?'.",
    properties: {
      prompt: { type: Type.STRING, description: "The makeup style or product to map (e.g., 'blush', 'contour')." }
    },
    required: ["prompt"]
  }
};

export const generateMakeupVideoFunction = {
  name: "generateMakeupVideo",
  parameters: {
    type: Type.OBJECT,
    description: "Generate a short video tutorial for a specific makeup technique.",
    properties: {
      prompt: { type: Type.STRING, description: "The technique to show (e.g., 'how to blend foundation', 'wing eyeliner tutorial')." }
    },
    required: ["prompt"]
  }
};

export const requestVisualUpdateFunction = {
  name: "requestVisualUpdate",
  parameters: {
    type: Type.OBJECT,
    description: "Requests a fresh image from the user's camera. Use this when you need to see the user's face, their current makeup, or a product they are holding to provide better advice.",
    properties: {},
    required: [],
  },
};

export const connectLiveAgent = (callbacks: any, context?: string) => {
  const ai = getAI();
  return ai.live.connect({
    model: "gemini-2.5-flash-native-audio-preview-09-2025",
    callbacks,
    config: {
      responseModalities: [Modality.AUDIO],
      speechConfig: {
        voiceConfig: { prebuiltVoiceConfig: { voiceName: "Zephyr" } },
      },
      tools: [
        { functionDeclarations: [generateFaceMapFunction, applyMakeupToUserFunction, generateMakeupVideoFunction, addToWishlistFunction, showReferenceImageFunction, requestVisualUpdateFunction] }
      ],
      systemInstruction: `You are Pretty Alice, a professional live beauty coach. 
      
      IMPORTANT: Be decisive and efficient. When you decide to use a tool, call it ONCE and then WAIT for the result. Do not repeat the same tool call multiple times in a row.

VIRTUAL TRY-ON & REFERENCE IMAGES:
1. If the user asks "how will this look on me" or "try this on my face":
   - If they have provided a reference image (or you just generated one for them), use the 'applyMakeupToUser' tool.
   - If they have NOT provided a reference image, but asked for a specific look (e.g., "smokey eye"), use 'applyMakeupToUser' with a descriptive prompt.
   - If you need to see their face to perform the try-on, use 'requestVisualUpdate'.
   - **IMPORTANT:** Proceed with the try-on regardless of whether the user's eyes are open or closed. Do not ask for a new photo just because of eye position.
2. If the user asks for general inspiration or "show me a look", use 'showReferenceImage'.

VISUAL CAPABILITIES & DISTINCTIONS:
1. **Virtual Try-On ('applyMakeupToUser'):** Use this when the user asks "how will this look ON ME?". This edits their photo to show the finished look realistically, WITHOUT any technical markings (no dots/arrows).
2. **Face Maps ('generateFaceMap'):** Use this when the user asks "HOW do I apply this?" or "show me WHERE to put it". This edits their photo to add technical guides (dots/arrows).
3. **Reference Images ('showReferenceImage'):** Use this for general inspiration or when the user asks "show me a [style] look" (NOT on their face). This generates a completely new, high-quality model image.
4. **Video Tutorials ('generateMakeupVideo'):** Use for technique questions (e.g., "how do I blend?").

OPTIMIZED COORDINATION:
- You stream audio continuously to talk to the user.
- You DO NOT see a continuous video feed. Instead, you must ASK to see the user when needed.
- Use the 'requestVisualUpdate' tool whenever you need to see the user's face, their makeup progress, or a product they are showing.
- Once you call 'requestVisualUpdate', the client will send you a fresh image frame. You can then comment on it.
- Your expertise is strictly limited to: beauty, skin health, hygiene, glow up, makeup, and confidence boosting.

${context ? `RECENT CONTEXT:\n${context}\n\n` : ''}
CAPABILITIES & TOOL USAGE:
- **Wishlist:** Use 'addToWishlist' to save recommended products.
- **Visuals:** Use 'requestVisualUpdate' to see the user before giving specific placement advice.

GUARDRAILS:
- If the user asks about topics outside these domains, politely decline.
- If the user says 'stop' or 'interrupt', acknowledge briefly and stop talking.
- Provide real-time, personalized advice. Always prioritize visual tools for "how-to" or "how-it-looks" questions.`,
      inputAudioTranscription: {},
      outputAudioTranscription: {},
    },
  });
};

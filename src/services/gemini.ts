/**
 * Frontend Gemini service – all AI calls go through the backend API.
 * The backend holds the API key; the frontend only sends Firebase ID tokens.
 */
import { auth } from '../firebase';

const BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';

// ── Auth helper ──────────────────────────────────────────────────────────────

async function getIdToken(): Promise<string> {
  const user = auth.currentUser;
  if (!user) throw new Error('Not authenticated');
  return user.getIdToken();
}

async function post<T>(path: string, body: object): Promise<T> {
  const token = await getIdToken();
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error ?? res.statusText);
  }
  return res.json();
}

// ── Global error handler ─────────────────────────────────────────────────────

export const handleApiError = (err: any) => {
  const msg = err?.message || String(err);
  if (msg.includes('Requested entity was not found') || msg.includes('PERMISSION_DENIED')) {
    console.warn('API permission error detected');
  }
};

// ── Advice ───────────────────────────────────────────────────────────────────

export const generateMakeupAdvice = async (
  prompt: string,
  imageBase64?: string,
  _signal?: AbortSignal,
  vanityContext?: string,
  history?: any[]
) => {
  return post<{ text: string; functionCalls: any[] }>('/api/advice', {
    prompt,
    imageBase64,
    vanityContext,
    history,
  });
};

export const validateImageForMakeup = async (imageBase64: string, prompt: string) => {
  return post<{ type: string; isValid: boolean; reason: string | null }>(
    '/api/advice/validate-image',
    { imageBase64, prompt }
  );
};

export const analyzeProductImage = async (imageBase64: string) => {
  return post<{ name: string; brand: string; category: string; shade: string } | null>(
    '/api/advice/analyze-product',
    { imageBase64 }
  );
};

// ── Images ───────────────────────────────────────────────────────────────────

export const generateFaceMap = async (imageBase64: string, prompt: string) => {
  const data = await post<{ imageUrl: string }>('/api/images/face-map', { imageBase64, prompt });
  return data.imageUrl ?? null;
};

export const applyMakeupToUser = async (
  imageBase64: string,
  prompt: string,
  referenceImageBase64?: string
) => {
  const data = await post<{ imageUrl: string }>('/api/images/apply-makeup', {
    imageBase64,
    prompt,
    referenceImageBase64,
  });
  return data.imageUrl ?? null;
};

export const generateReferenceImage = async (prompt: string) => {
  const data = await post<{ imageUrl: string }>('/api/images/reference', { prompt });
  return data.imageUrl ?? null;
};

// ── Video ────────────────────────────────────────────────────────────────────

export const generateMakeupVideo = async (prompt: string) => {
  const data = await post<{ videoBase64: string; mimeType: string }>('/api/video/generate', {
    prompt,
  });
  if (!data.videoBase64) return null;
  const blob = await fetch(`data:${data.mimeType};base64,${data.videoBase64}`).then(r => r.blob());
  return URL.createObjectURL(blob);
};

// ── Speech ───────────────────────────────────────────────────────────────────

export const generateSpeech = async (text: string) => {
  const data = await post<{ audioBase64: string }>('/api/speech/generate', { text });
  return data.audioBase64 ?? null;
};

// ── Stores ───────────────────────────────────────────────────────────────────

export const findMakeupStores = async (query: string, lat?: number, lng?: number) => {
  return post<{ text: string; places: any[] }>('/api/stores/find', { query, lat, lng });
};

// ── Live agent (WebSocket) ───────────────────────────────────────────────────

export const connectLiveAgent = async (callbacks: {
  onopen: () => void;
  onmessage: (msg: any) => void;
  onclose: () => void;
  onerror: (err: any) => void;
}, context?: string) => {
  const token = await getIdToken();
  const wsBase = BASE_URL.replace(/^http/, 'ws');
  const contextParam = context ? `&context=${encodeURIComponent(context)}` : '';
  const ws = new WebSocket(`${wsBase}/api/live/ws?token=${token}${contextParam}`);

  ws.onopen = callbacks.onopen;
  ws.onclose = callbacks.onclose;
  ws.onerror = (e) => callbacks.onerror(e);
  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      if (msg.type === 'gemini_message') callbacks.onmessage(msg.payload);
      else if (msg.type === 'session_ready') callbacks.onopen();
      else if (msg.type === 'error') callbacks.onerror(new Error(msg.message));
    } catch (e) {
      callbacks.onerror(e);
    }
  };

  // Return a session-like object matching the shape App.tsx expects
  return {
    sendRealtimeInput: (payload: any) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'realtime_input', payload }));
      }
    },
    sendToolResponse: (payload: any) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'tool_response', payload }));
      }
    },
    close: () => ws.close(),
  };
};

/**
 * Frontend API client — all Gemini calls go through the backend.
 * Firebase Auth + Firestore stay client-side (real-time listeners).
 */
import { auth } from '../firebase';

const BASE = import.meta.env.VITE_API_URL || 'http://localhost:4000';

async function authHeaders(): Promise<HeadersInit> {
  const token = await auth.currentUser?.getIdToken();
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function post<T>(path: string, body: object): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error ?? res.statusText);
  }
  return res.json();
}

// ── Advice ──────────────────────────────────────────────────────────────────

export const generateMakeupAdvice = (
  prompt: string,
  imageBase64?: string,
  _signal?: AbortSignal,
  vanityContext?: string,
  history?: any[],
) =>
  post<{ text: string; functionCalls: any[] }>('/api/advice', {
    prompt, imageBase64, vanityContext, history,
  });

export const validateImageForMakeup = (imageBase64: string, prompt: string) =>
  post<{ type: string; isValid: boolean; reason: string | null }>(
    '/api/advice/validate-image',
    { imageBase64, prompt },
  );

export const analyzeProductImage = (imageBase64: string) =>
  post<{ name: string; brand: string; category: string; shade: string } | null>(
    '/api/advice/analyze-product',
    { imageBase64 },
  );

// ── Images ──────────────────────────────────────────────────────────────────

export const generateFaceMap = async (imageBase64: string, prompt: string) => {
  const { imageUrl } = await post<{ imageUrl: string }>('/api/images/face-map', { imageBase64, prompt });
  return imageUrl;
};

export const applyMakeupToUser = async (
  imageBase64: string,
  prompt: string,
  referenceImageBase64?: string,
) => {
  const { imageUrl } = await post<{ imageUrl: string }>('/api/images/apply-makeup', {
    imageBase64, prompt, referenceImageBase64,
  });
  return imageUrl;
};

export const generateReferenceImage = async (prompt: string) => {
  const { imageUrl } = await post<{ imageUrl: string }>('/api/images/reference', { prompt });
  return imageUrl;
};

// ── Video ───────────────────────────────────────────────────────────────────

export const generateMakeupVideo = async (prompt: string) => {
  const { videoBase64, mimeType } = await post<{ videoBase64: string; mimeType: string }>(
    '/api/video/generate',
    { prompt },
  );
  const blob = new Blob(
    [Uint8Array.from(atob(videoBase64), c => c.charCodeAt(0))],
    { type: mimeType },
  );
  return URL.createObjectURL(blob);
};

// ── Speech ──────────────────────────────────────────────────────────────────

export const generateSpeech = async (text: string) => {
  const { audioBase64 } = await post<{ audioBase64: string }>('/api/speech/generate', { text });
  return audioBase64;
};

// ── Stores ──────────────────────────────────────────────────────────────────

export const findMakeupStores = (query: string, lat?: number, lng?: number) =>
  post<{ text: string; places: any[] }>('/api/stores/find', { query, lat, lng });

// ── Live agent (WebSocket) ───────────────────────────────────────────────────

export const handleApiError = (err: any) => {
  console.error('API error:', err?.message ?? err);
};

/**
 * Connects to the backend WebSocket live agent proxy.
 * Mirrors the interface of the old connectLiveAgent() so App.tsx needs
 * minimal changes — just swap the import.
 */
export const connectLiveAgent = async (
  callbacks: {
    onopen: () => void;
    onmessage: (msg: any) => void;
    onclose: () => void;
    onerror: (err: any) => void;
  },
  context?: string,
) => {
  const token = await auth.currentUser?.getIdToken();
  const wsBase = BASE.replace(/^http/, 'ws');
  const params = new URLSearchParams();
  if (token) params.set('token', token);
  if (context) params.set('context', encodeURIComponent(context));

  const wsUrl = `${wsBase}/api/live/ws?${params}`;
  console.log('[LiveAgent] Connecting to', wsUrl.replace(/token=[^&]+/, 'token=***'));
  const ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    console.log('[LiveAgent] WebSocket connected, waiting for session_ready...');
  };

  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    console.log('[LiveAgent] message type:', msg.type);
    if (msg.type === 'session_ready') {
      console.log('[LiveAgent] session_ready received');
      callbacks.onopen();
    } else if (msg.type === 'gemini_message') {
      callbacks.onmessage(msg.payload);
    } else if (msg.type === 'session_closed') {
      console.warn('[LiveAgent] session_closed received from server');
      callbacks.onclose();
    } else if (msg.type === 'error') {
      console.error('[LiveAgent] error from server:', msg.message);
      callbacks.onerror(new Error(msg.message));
    }
  };

  ws.onclose = (e) => {
    console.warn('[LiveAgent] WebSocket closed — code:', e.code, 'reason:', e.reason || '(none)');
    callbacks.onclose();
  };
  ws.onerror = (e) => {
    console.error('[LiveAgent] WebSocket error:', e);
    callbacks.onerror(e);
  };

  // Return a session-like object so App.tsx can call sendRealtimeInput / sendToolResponse / close
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

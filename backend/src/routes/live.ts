import { Router, Request, Response } from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import { Modality } from '@google/genai';
import { getAuth } from 'firebase-admin/auth';
import { getAI, SYSTEM_PROMPT, generateFaceMapFunction, applyMakeupToUserFunction, generateMakeupVideoFunction, addToWishlistFunction, showReferenceImageFunction, requestVisualUpdateFunction } from '../lib/gemini.js';

export const liveRouter = Router();

// The WebSocket server is attached to the HTTP server in index.ts.
// This module exports a helper to wire it up.
export function attachLiveWss(server: import('http').Server) {
  const wss = new WebSocketServer({ server, path: '/api/live/ws' });

  wss.on('connection', async (clientWs, req) => {
    // Authenticate via ?token= query param (browsers can't set headers on WS)
    const url = new URL(req.url!, `http://${req.headers.host}`);
    const token = url.searchParams.get('token');

    if (!token) {
      clientWs.close(4001, 'Missing token');
      return;
    }

    let uid: string;
    try {
      const decoded = await getAuth().verifyIdToken(token);
      uid = decoded.uid;
    } catch {
      clientWs.close(4001, 'Invalid token');
      return;
    }

    const context = url.searchParams.get('context') ?? '';
    const ai = getAI();

    let geminiSession: any = null;

    try {
      const sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-09-2025',
        callbacks: {
          onopen: () => {
            clientWs.send(JSON.stringify({ type: 'session_ready' }));
          },
          onmessage: (msg: any) => {
            if (clientWs.readyState === WebSocket.OPEN) {
              clientWs.send(JSON.stringify({ type: 'gemini_message', payload: msg }));
            }
          },
          onclose: () => {
            clientWs.send(JSON.stringify({ type: 'session_closed' }));
          },
          onerror: (err: any) => {
            clientWs.send(JSON.stringify({ type: 'error', message: String(err) }));
          },
        },
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Zephyr' } },
            languageCode: 'en-US',
          },
          tools: [{
            functionDeclarations: [
              generateFaceMapFunction,
              applyMakeupToUserFunction,
              generateMakeupVideoFunction,
              addToWishlistFunction,
              showReferenceImageFunction,
              requestVisualUpdateFunction,
            ],
          }],
          systemInstruction: `${SYSTEM_PROMPT}
${context ? `\nRECENT CONTEXT:\n${context}` : ''}
You are in a live audio session. Use tools for visual requests. Be decisive — call each tool once and wait.
LANGUAGE: You must ALWAYS respond in English only, regardless of what language the user speaks in. Never switch languages.`,
          inputAudioTranscription: {},
          outputAudioTranscription: {},
        },
      });

      geminiSession = await sessionPromise;
    } catch (err) {
      clientWs.send(JSON.stringify({ type: 'error', message: 'Failed to connect to Gemini' }));
      clientWs.close();
      return;
    }

    // Forward client messages → Gemini
    clientWs.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (!geminiSession) return;

        if (msg.type === 'realtime_input') {
          geminiSession.sendRealtimeInput(msg.payload);
        } else if (msg.type === 'tool_response') {
          geminiSession.sendToolResponse(msg.payload);
        }
      } catch (err) {
        console.error('live ws parse error:', err);
      }
    });

    clientWs.on('close', () => {
      geminiSession?.close();
    });
  });

  return wss;
}

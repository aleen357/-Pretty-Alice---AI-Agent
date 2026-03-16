import { Request, Response, NextFunction } from 'express';
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

// Initialise Firebase Admin once
if (!getApps().length) {
  const inlineJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (inlineJson) {
    // Option B: inline JSON string (useful for cloud deployments)
    const serviceAccount = JSON.parse(inlineJson);
    initializeApp({ credential: cert(serviceAccount) });
  } else {
    // Option A: GOOGLE_APPLICATION_CREDENTIALS env var, or default ADC
    initializeApp();
  }
}

export interface AuthRequest extends Request {
  uid?: string;
}

export async function requireAuth(req: AuthRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing auth token' });
    return;
  }
  try {
    const token = header.slice(7);
    const decoded = await getAuth().verifyIdToken(token);
    req.uid = decoded.uid;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid auth token' });
  }
}

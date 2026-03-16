# Pretty Alice — AI Beauty Coach

Pretty Alice is a full-stack AI beauty coaching app powered by Google Gemini. Users can chat with Alice, get makeup advice, generate face maps, do virtual try-ons, manage their makeup kit, and have live voice conversations with an AI beauty agent.

---

## What it does

### 🎙️ Live Voice Agent — the core experience

Talk to Alice hands-free in real time. Alice listens, speaks back, and sees your face through your camera whenever she needs to. You don't have to type a single word.

While in voice mode Alice can do everything the app offers — just hold your camera steady when you want her to see your progress or when she asks to look at you:

- **Virtual try-on** — ask "how would a smokey eye look on me?" and Alice captures your face, applies the look, and shows you the result in the chat
- **Face maps** — ask "where do I apply blush?" and Alice draws a precise placement guide directly on your photo
- **Reference images** — ask "show me a dewy glass skin look" and Alice generates a professional beauty reference image. You can go ahead and try it on
- **Small Generated Video** - this feature can generate a really small video on your makeup queries (Needs to be tuned)

### 💄 Vanity Kit

Vanity kit is an important utility to Agent as it lets agent know what weapons are already in your makeup kit and it helps Alice guide you using your products instead of new ones
---

## Tech Stackup products by photo — Alice's Vanity Vision AI reads the product label and auto-fills the name, brand, category, and shade. Once your kit is set up, Alice references it in every conversation and recommends what you already own before suggesting anything new.orials** — ask for a technique and Alice generates a short tutorial clip

The camera is passive — Alice only looks when she needs to. You stay in control of the conversation throughout.

---

### 💬 Text Chat

Everything Alice can do in voice mode is also available in text chat. Upload photos directly, ask questions, get step-by-step guides, and see all results in the chat history.

- Virtual try-on — upload your photo and a reference look
- Face maps — annotated placement guides on your own photo
- Makeup advice — full conversation with your vanity kit as context

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React + TypeScript + Vite + Tailwind |
| Backend | Node.js + Express + TypeScript |
| AI | Google Gemini API (@google/genai) |
| Auth | Firebase Authentication (Google OAuth) |
| Database | Firebase Firestore |
| Frontend hosting | Firebase Hosting |
| Backend hosting | Google Cloud Run |

---

## Project Structure

```
pretty-alice/
├── src/                        Frontend (React)
│   ├── App.tsx                 Main component, all state + orchestration
│   ├── firebase.ts             Firebase client setup
│   ├── components/
│   │   ├── VanityManager.tsx   Makeup kit + wishlist UI
│   │   └── ErrorBoundary.tsx   Global error handler
│   ├── services/
│   │   ├── api.ts              HTTP + WebSocket client → backend
│   │   └── audio.ts            Mic capture + audio playback
│   └── utils/
│       └── image.ts            Image compression utility
│
├── backend/                    Backend (Node.js + Express)
│   └── src/
│       ├── index.ts            Express server entry point
│       ├── middleware/
│       │   └── auth.ts         Firebase Admin token verification
│       ├── lib/
│       │   └── gemini.ts       Shared AI client + tool declarations
│       └── routes/
│           ├── advice.ts       Text advice, image validation, product scan
│           ├── images.ts       Face maps, virtual try-on, reference images
│           ├── video.ts        Video tutorial generation
│           ├── speech.ts       Text-to-speech
│           ├── stores.ts       Store finder
│           └── live.ts         Live audio WebSocket proxy
│
├── ARCHITECTURE.md             Full component map
├── DATAFLOW.md                 All user flows end-to-end
└── firestore.rules             Firestore security rules
```

---

## Prerequisites

- Node.js 20+
- Google Cloud CLI (`gcloud`)
- Firebase CLI (`npm install -g firebase-tools`)
- A Google account

---

## Step 1 — Get your API keys

### Gemini API key
1. Go to [aistudio.google.com](https://aistudio.google.com)
2. Click "Get API key" → Create API key
3. Copy the key — you'll need it for both local dev and deployment

### Firebase project
1. Go to [console.firebase.google.com](https://console.firebase.google.com)
2. Create a new project
3. Enable **Authentication** → Sign-in method → Google
4. Enable **Firestore Database** → create a database in production mode
5. Go to Project Settings → General → Your apps → Add web app
6. Copy the config object shown

### Firebase service account (for backend)
1. Project Settings → Service accounts
2. Click "Generate new private key" → download the JSON file
3. Keep this file safe — never commit it to git

---

## Step 2 — Configure the frontend

Copy the example config files and fill them in:

```bash
cp firebase-applet-config.example.json firebase-applet-config.json
cp .env.example .env
```

Edit `firebase-applet-config.json` with your Firebase project values:
```json
{
  "projectId": "your-project-id",
  "appId": "your-app-id",
  "apiKey": "your-firebase-web-api-key",
  "authDomain": "your-project.firebaseapp.com",
  "firestoreDatabaseId": "(default)",
  "storageBucket": "your-project.firebasestorage.app",
  "messagingSenderId": "your-sender-id",
  "measurementId": ""
}
```

Edit `.env`:
```
GEMINI_API_KEY="your-gemini-api-key"
APP_URL="http://localhost:5173"
VITE_API_URL="http://localhost:4000"
```

---

## Step 3 — Configure the backend

```bash
cp backend/.env.example backend/.env
```

Edit `backend/.env`:
```
GEMINI_API_KEY="your-gemini-api-key"
FRONTEND_URL="http://localhost:5173"
GOOGLE_APPLICATION_CREDENTIALS="/absolute/path/to/serviceAccountKey.json"
PORT=4000
```

---

## Step 4 — Run locally

Install dependencies for both frontend and backend:

```bash
npm install
cd backend && npm install
```

Start the backend (in one terminal):
```bash
cd backend
npm run dev
```

Start the frontend (in another terminal):
```bash
npm run dev
```

Open [http://localhost:5173](http://localhost:5173)

---

## Step 5 — Deploy the backend to Cloud Run

```bash
cd backend
npm run build
```

Then deploy:
```bash
gcloud run deploy pretty-alice-backend --source . --region us-central1 --allow-unauthenticated --port 8080 --session-affinity --min-instances 1 --set-env-vars "GEMINI_API_KEY=your-key,FRONTEND_URL=https://your-project.web.app"
```

After deploying, add `FIREBASE_SERVICE_ACCOUNT_JSON` in the Cloud Run console:
1. [console.cloud.google.com/run](https://console.cloud.google.com/run) → your service
2. Edit & Deploy New Revision → Variables & Secrets
3. Add `FIREBASE_SERVICE_ACCOUNT_JSON` → paste the full contents of your service account JSON

Copy the Cloud Run URL (e.g. `https://your-backend-xxxx.run.app`) and update your frontend `.env`:
```
VITE_API_URL="https://your-backend-xxxx.run.app"
```

---

## Step 6 — Deploy the frontend to Firebase Hosting

Build the frontend:
```bash
npm run build
```

Set up Firebase Hosting (first time only):
```bash
firebase login
firebase init hosting
# public directory: dist
# single-page app: yes
# overwrite dist/index.html: no
```

Deploy:
```bash
firebase deploy --only hosting
```

Your app is live at `https://your-project.web.app`

---

## Step 7 — Final configuration

**Add your hosting URL to Firebase Auth:**
1. Firebase Console → Authentication → Settings → Authorized domains
2. Add `your-project.web.app`

**Update CORS on Cloud Run:**
```bash
gcloud run services update pretty-alice-backend --region us-central1 --update-env-vars "FRONTEND_URL=https://your-project.web.app"
```

**Deploy Firestore rules:**
```bash
firebase deploy --only firestore:rules
```

---

## Firestore security rules

The included `firestore.rules` enforces:
- Users can only read/write their own data
- Messages, vanity products, and wishlist items are validated before write
- Admin role supported via user document

---

## How it works

See [ARCHITECTURE.md](ARCHITECTURE.md) for a full component map and [DATAFLOW.md](DATAFLOW.md) for detailed end-to-end user flow diagrams covering all 8 interaction flows.

---

## Environment variables reference

### Frontend
| Variable | Description |
|---|---|
| `VITE_API_URL` | Backend URL (Cloud Run in prod, localhost:4000 locally) |

### Backend
| Variable | Description |
|---|---|
| `GEMINI_API_KEY` | Your Gemini API key |
| `FRONTEND_URL` | Allowed CORS origin |
| `PORT` | Server port (8080 on Cloud Run) |
| `GOOGLE_APPLICATION_CREDENTIALS` | Path to service account JSON (local dev) |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | Inline service account JSON (Cloud Run) |

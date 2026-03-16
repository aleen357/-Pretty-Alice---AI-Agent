# Pretty Alice – Architecture Overview

## Hosting
- Frontend  → Firebase Hosting       (https://your-project.web.app)
- Backend   → Google Cloud Run       (https://your-backend-url.run.app)
- Database  → Firebase Firestore     (project: your-firebase-project)
- Auth      → Firebase Auth          (Google OAuth)

---

## Frontend  (Vite + React + TypeScript)

src/
├── main.tsx                  Entry point, mounts App inside ErrorBoundary
├── App.tsx                   Root component — owns all state and orchestration
│   │
│   ├── AUTH
│   │   └── onAuthStateChanged     Login/logout, creates user doc in Firestore
│   │       └── pruneOldMessages   On every login, deletes all but 10 most recent messages
│   │
│   ├── CHAT (text mode)
│   │   ├── handleSend()           Sends text + optional images to backend
│   │   ├── Image validator        → POST /api/advice/validate-image
│   │   │                            Checks if image is USER_FACE or REFERENCE_IMAGE
│   │   │                            Blocks invalid images before AI processing
│   │   ├── Face map trigger       → POST /api/images/face-map
│   │   │                            Detects "map/where/placement" keywords
│   │   ├── Virtual try-on trigger → POST /api/images/apply-makeup
│   │   │                            Detects "look/try on/this in" keywords
│   │   ├── Reference image        → POST /api/images/reference
│   │   │                            Detects "show me/inspiration" keywords
│   │   ├── Video tutorial         → POST /api/video/generate
│   │   │                            Detects "tutorial/video/how to" keywords
│   │   └── General advice         → POST /api/advice
│   │                                All other beauty questions
│   │
│   ├── LIVE AUDIO SESSION
│   │   ├── toggleLive()           Start/stop live session
│   │   │   ├── getUserMedia       Mic first (required) → camera (optional)
│   │   │   ├── AudioStreamer      Mic → PCM 16kHz → base64 → WebSocket
│   │   │   ├── AudioPlayer        Receives AI audio → scheduled playback
│   │   │   └── connectLiveAgent   Opens WS to backend /api/live/ws
│   │   │
│   │   └── Tool call dispatcher   Handles AI tool calls during live session:
│   │       ├── generateFaceMap    Captures camera frame → validate → face map
│   │       ├── applyMakeupToUser  Captures camera frame → validate → try-on
│   │       ├── showReferenceImage Generates inspiration image
│   │       ├── generateMakeupVideo Generates tutorial video
│   │       ├── addToWishlist      Saves product to Firestore wishlist
│   │       └── requestVisualUpdate Sends fresh camera frame to AI
│   │
│   └── STATE
│       ├── messages               Chat history (Firestore real-time listener)
│       ├── vanityProducts         User's kit (Firestore real-time listener)
│       ├── lastReferenceImage     Last generated/uploaded reference (passed to try-on)
│       └── pendingAction          Queued face-map or advice after image capture
│
├── components/
│   │
│   ├── VanityManager.tsx          Makeup kit management UI
│   │   ├── My Kit tab
│   │   │   ├── Add product form   Name, brand, category, shade + photo upload
│   │   │   ├── Vanity Vision AI   → POST /api/advice/analyze-product
│   │   │   │                        Auto-fills product details from photo using Gemini
│   │   │   └── Product grid       Shows all kit items, supports delete
│   │   └── Beauty Essentials tab
│   │       └── Wishlist           Products recommended by Alice via addToWishlist tool
│   │
│   └── ErrorBoundary.tsx          Global React crash handler with reload button
│
├── services/
│   ├── api.ts                     HTTP + WebSocket proxy client
│   │   ├── getIdToken()           Fetches Firebase ID token for every request
│   │   ├── post()                 Authenticated fetch wrapper → backend
│   │   ├── generateMakeupAdvice   → POST /api/advice
│   │   ├── validateImageForMakeup → POST /api/advice/validate-image
│   │   ├── analyzeProductImage    → POST /api/advice/analyze-product
│   │   ├── generateFaceMap        → POST /api/images/face-map
│   │   ├── applyMakeupToUser      → POST /api/images/apply-makeup
│   │   ├── generateReferenceImage → POST /api/images/reference
│   │   ├── generateMakeupVideo    → POST /api/video/generate
│   │   ├── generateSpeech         → POST /api/speech/generate
│   │   ├── findMakeupStores       → POST /api/stores/find
│   │   └── connectLiveAgent       → WS  /api/live/ws
│   │
│   └── audio.ts
│       ├── AudioStreamer           Mic → ScriptProcessorNode → PCM 16kHz
│       │                           → base64 → WebSocket (with volume callback)
│       └── AudioPlayer             base64 PCM → AudioContext → gain boost
│                                   → scheduled queue → interrupt support
│
└── utils/
    └── image.ts                   Canvas resize + JPEG compression
                                   Used before every image sent to backend

---

## Backend  (Node.js + Express + TypeScript → Cloud Run)

backend/src/
├── index.ts                  Express server, HTTP + WebSocket, all routers mounted
│
├── middleware/
│   └── auth.ts               Firebase Admin ID token verification
│                             requireAuth middleware on all routes
│                             Supports file path or inline JSON credentials
│
├── lib/
│   └── gemini.ts             Shared AI setup
│                             ├── getAI()           Initialises GoogleGenAI client
│                             ├── SYSTEM_PROMPT     Pretty Alice persona + guardrails
│                             └── Tool declarations  All 6 function schemas for live agent
│
└── routes/
    │
    ├── advice.ts             Text intelligence routes
    │   ├── POST /api/advice
    │   │     Full conversation with history + vanity kit context
    │   │     Calls addToWishlist tool when products are recommended
    │   │     Model: gemini-3-flash-preview
    │   │
    │   ├── POST /api/advice/validate-image
    │   │     Classifies image as USER_FACE or REFERENCE_IMAGE
    │   │     Checks visibility of relevant feature (lips/eyes/skin)
    │   │     Returns: { type, isValid, reason }
    │   │     Model: gemini-3-flash-preview
    │   │
    │   └── POST /api/advice/analyze-product
    │         Identifies makeup product from photo (Vanity Vision AI)
    │         Returns: { name, brand, category, shade }
    │         Model: gemini-3-flash-preview
    │a
    ├── images.ts             Visual generation routes
    │   │                     All use responseModalities: ['TEXT','IMAGE']
    │   │                     Primary: gemini-3-pro-image-preview
    │   │                     Fallback: gemini-3.1-flash-image-preview
    │   │
    │   ├── POST /api/images/face-map
    │   │     Edits user photo to add makeup placement guide
    │   │     Dots = placement, arrows = blending, shading = diffusion
    │   │     Luxury editorial quality prompt
    │   │
    │   ├── POST /api/images/apply-makeup
    │   │     Virtual try-on — edits user photo to show finished look
    │   │     Supports optional reference image for style matching
    │   │     No technical markings, preserve identity
    │   │
    │   └── POST /api/images/reference
    │         Generates standalone beauty inspiration image
    │         Vogue editorial style, no user face involved
    │
    ├── video.ts              POST /api/video/generate
    │                         Polls until complete, returns base64 video
    │                         Model: veo-2.0-generate-001
    │
    ├── speech.ts             POST /api/speech/generate
    │                         Text → audio for verbal confirmations
    │                         Model: gemini-2.5-flash-preview-tts
    │                         Voice: Zephyr, en-US
    │
    ├── stores.ts             POST /api/stores/find
    │                         Finds nearby beauty stores/salons
    │                         Model: gemini-3-flash-preview + Google Search
    │                         Supports lat/lng for location-aware results
    │
    └── live.ts               WS /api/live/ws
                              Full-duplex live audio/video agent proxy
                              Auth: Firebase token via ?token= query param
                              Model: gemini-2.5-flash-native-audio-preview
                              Voice: Zephyr, en-US (language locked)
                              Context: vanity kit + last 5 messages injected
                              Tools: generateFaceMap, applyMakeupToUser,
                                     generateMakeupVideo, addToWishlist,
                                     showReferenceImage, requestVisualUpdate
                              Transcription: input + output audio → text

---

## Image Validation Flow

User uploads / camera captures image
          │
          ▼
validateImageForMakeup()  →  POST /api/advice/validate-image
          │
    ┌─────┴──────┐
    │            │
USER_FACE    REFERENCE_IMAGE
isValid?         │
    │            └──→ Used as style reference for apply-makeup
    │
  false → Show error ("lips covered", "too dark", etc.)
  true  → Proceed to face-map or apply-makeup

---

## Virtual Try-On Flow

1. User asks "try this on me" or "how will X look on me"
2. App captures camera frame (or uses uploaded image)
3. validateImageForMakeup() checks face visibility
4. If valid → POST /api/images/apply-makeup
   - With reference image: replicates that style onto user
   - Without: applies described look directly
5. Result saved to Firestore as image message
6. lastReferenceImage stored for follow-up requests

---

## Vanity Kit Flow

User adds product
    │
    ├── Uploads photo → POST /api/advice/analyze-product (Vanity Vision AI)
    │                   Gemini reads product label → auto-fills name/brand/category/shade
    │
    └── Saves to Firestore users/{uid}/vanity

Alice uses kit
    ├── Text chat: vanityContext string injected into every /api/advice call
    └── Live session: vanityContext injected into system instruction at session start
        Alice recommends kit products first, uses addToWishlist for missing items

---

## Firestore Collections

users/{uid}                   User profile (uid, email, displayName, photoURL)
users/{uid}/messages          Chat history — max 10 kept, pruned on every login
users/{uid}/vanity            Makeup kit products (name, brand, category, shade, imageUrl)
users/{uid}/wishlist          AI-recommended products (name, reason, addedAt)

---

## Data Flow Summary

User speaks/types/uploads
        │
        ▼
App.tsx  (attaches Firebase ID token)
        │
        ▼
Backend API on Cloud Run  (verifies token via Firebase Admin)
        │
        ▼
Gemini API  (text / image / audio / video response)
        │
        ▼
Backend → Frontend
        │
        ▼
Firestore  (message saved) ←→ onSnapshot listener → UI updates in real time

---

## Environment Variables

Frontend (.env)
  VITE_API_URL                    Backend Cloud Run URL

Backend (.env / Cloud Run secrets)
  GEMINI_API_KEY                  Gemini API key (never exposed to frontend)
  FRONTEND_URL                    Allowed CORS origin
  PORT                            8080 on Cloud Run
  GOOGLE_APPLICATION_CREDENTIALS  Path to service account JSON (local dev)
  FIREBASE_SERVICE_ACCOUNT_JSON   Inline service account JSON (Cloud Run)

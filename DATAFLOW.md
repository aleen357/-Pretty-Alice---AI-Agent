# Pretty Alice – User Interaction & Data Flow

═══════════════════════════════════════════════════════════════
  USER ENTRY
═══════════════════════════════════════════════════════════════

  User opens https://your-project.web.app
          │
          ▼
  Firebase Auth checks session
          │
    ┌─────┴─────┐
  logged in   not logged in
    │               │
    │           Google OAuth popup
    │               │
    │           Firebase saves user token
    │               │
    └──────┬────────┘
           │
           ▼
  App fetches Firestore data (real-time listeners)
    ├── users/{uid}/messages     → loads last 10 messages
    ├── users/{uid}/vanity       → loads makeup kit
    └── users/{uid}/wishlist     → loads beauty essentials
           │
           ▼
  pruneOldMessages() runs
    └── deletes everything older than 10 messages
           │
           ▼
  ┌─────────────────────────────┐
  │        MAIN APP UI          │
  │  Chat  │  Mic  │  Vanity   │
  └─────────────────────────────┘


═══════════════════════════════════════════════════════════════
  FLOW 1 — TEXT CHAT (general beauty advice)
═══════════════════════════════════════════════════════════════

  User types a question → taps Send
          │
          ▼
  App.tsx handleSend()
    ├── saves user message → Firestore users/{uid}/messages
    └── builds vanityContext from kit products
          │
          ▼
  POST /api/advice  (with Firebase ID token)
    ├── Backend verifies token
    ├── Injects vanity kit + last 5 messages as context
    └── Calls gemini-3-flash-preview
          │
          ▼
  Gemini responds
    ├── text answer
    └── (optional) addToWishlist tool call
              │
              ▼
         Backend saves product → Firestore users/{uid}/wishlist
          │
          ▼
  Backend returns { text, functionCalls }
          │
          ▼
  App saves AI message → Firestore users/{uid}/messages
          │
          ▼
  onSnapshot fires → UI updates with Alice's response


═══════════════════════════════════════════════════════════════
  FLOW 2 — IMAGE VALIDATION
  (runs before every face-map or virtual try-on)
═══════════════════════════════════════════════════════════════

  User uploads photo or captures from camera
          │
          ▼
  compressImage() → resizes to max 1024px, JPEG quality 0.8
          │
          ▼
  POST /api/advice/validate-image
    └── gemini-3-flash-preview analyzes photo
          │
    ┌─────┴──────────────┐
    │                    │
  USER_FACE          REFERENCE_IMAGE
  isValid: true/false    │
    │                    └──→ stored as lastReferenceImage
    │                         used as style source for try-on
  false
    └──→ Alice explains why (lips covered, too dark, etc.)
         flow stops here
  true
    └──→ continues to face-map or try-on flow below


═══════════════════════════════════════════════════════════════
  FLOW 3 — FACE MAP
  ("show me where to apply", "how do I apply this")
═══════════════════════════════════════════════════════════════

  User asks for placement guide
          │
          ▼
  App detects keywords (map / where / placement / how to apply)
          │
          ▼
  Image validation (Flow 2) runs first
          │
          ▼
  POST /api/images/face-map
    ├── Backend verifies token
    ├── Sends user face + makeup prompt to Gemini
    └── gemini-3-pro-image-preview
        → fallback gemini-3.1-flash-image-preview
          │
          ▼
  Gemini edits photo:
    dots     = exact placement points
    arrows   = blending direction
    shading  = diffusion zones
    style    = luxury editorial, flawless skin
          │
          ▼
  Returns base64 image
          │
          ▼
  compressImage() → App saves image message → Firestore
          │
          ▼
  onSnapshot → UI shows annotated face map in chat


═══════════════════════════════════════════════════════════════
  FLOW 4 — VIRTUAL TRY-ON
  ("how will this look on me", "try this on me")
═══════════════════════════════════════════════════════════════

  User asks to try a look
          │
          ▼
  App detects keywords (look / try on / this in / it in)
          │
          ▼
  Image validation (Flow 2) runs first
          │
          ▼
  POST /api/images/apply-makeup
    ├── image 1: user's face
    ├── image 2: lastReferenceImage (if available)
    └── prompt: makeup style description
          │
          ▼
  gemini-3-pro-image-preview edits photo:
    - applies makeup realistically onto user's face
    - matches reference style if provided
    - flawless dewy skin, professional finish
    - no dots/arrows/text on image
    - preserves user's identity
          │
          ▼
  Returns base64 image
          │
          ▼
  compressImage() → App saves image message → Firestore
          │
          ▼
  onSnapshot → UI shows try-on result in chat


═══════════════════════════════════════════════════════════════
  FLOW 5 — REFERENCE IMAGE
  ("show me a smokey eye", "what does X look like")
═══════════════════════════════════════════════════════════════

  User asks for inspiration
          │
          ▼
  App detects keywords (show me / inspiration / look like)
          │
          ▼
  POST /api/images/reference
    └── gemini-3-pro-image-preview generates new image
        Vogue editorial style, no user face
          │
          ▼
  Returns base64 image
    └── stored as lastReferenceImage for follow-up try-on
          │
          ▼
  App saves image message → Firestore → UI shows in chat


═══════════════════════════════════════════════════════════════
  FLOW 6 — VANITY KIT (My Makeup Kit)
═══════════════════════════════════════════════════════════════

  User opens Vanity Manager
          │
          ▼
  Loads products from Firestore users/{uid}/vanity  (real-time)
  Loads wishlist from Firestore users/{uid}/wishlist (real-time)

  ── Adding a product ──────────────────────────────────────────

  User uploads product photo
          │
          ▼
  compressImage()
          │
          ▼
  POST /api/advice/analyze-product  (Vanity Vision AI)
    └── gemini-3-flash-preview reads product label
        returns { name, brand, category, shade }
          │
          ▼
  Form auto-fills with detected details
  User confirms → addDoc → Firestore users/{uid}/vanity
          │
          ▼
  onSnapshot → product grid updates instantly

  ── How kit is used by Alice ──────────────────────────────────

  Text chat:
    vanityContext string built from all products
    → injected into every /api/advice request
    → Alice recommends kit products first

  Live session:
    vanityContext injected into system instruction at start
    → Alice knows the full kit throughout the session


═══════════════════════════════════════════════════════════════
  FLOW 7 — VIDEO TUTORIAL
  ("show me a tutorial", "how do I blend")
═══════════════════════════════════════════════════════════════

  User asks for video
          │
          ▼
  App detects keywords (tutorial / video / how to)
          │
          ▼
  POST /api/video/generate
    └── veo-2.0-generate-001 generates 5s tutorial clip
        Backend polls until complete (~30-60s)
          │
          ▼
  Returns base64 video → converted to blob URL
          │
          ▼
  App saves video message → Firestore → UI shows player in chat


═══════════════════════════════════════════════════════════════
  FLOW 8 — LIVE AUDIO SESSION (Alice voice agent)
═══════════════════════════════════════════════════════════════

  User taps mic button
          │
          ▼
  getUserMedia({ audio })   ← mic permission (required)
  getUserMedia({ video })   ← camera permission (optional)
          │
          ▼
  AudioStreamer starts
    Mic → ScriptProcessorNode → PCM 16kHz → base64 chunks
          │
          ▼
  connectLiveAgent() opens WebSocket
    wss://your-backend-url.run.app/api/live/ws?token=<firebase-id-token>
          │
          ▼
  Backend verifies token → connects to Gemini Live API
    model: gemini-2.5-flash-native-audio-preview
    voice: Zephyr, en-US
    context injected: vanity kit + last 5 messages
          │
          ▼
  WebSocket established — bidirectional stream

  ── While session is active ───────────────────────────────────

  User speaks
    │
    ▼
  AudioStreamer → base64 PCM → WS → Backend → Gemini
    │                                            │
    │                                     transcribes speech
    │                                     generates response
    │                                            │
    ◄────────────────────────────────────────────┘
    │
    ├── Audio chunks → AudioPlayer → plays Alice's voice
    ├── User transcript → saved to Firestore messages
    └── AI transcript  → saved to Firestore messages

  ── Alice calls a tool ────────────────────────────────────────

  Gemini emits tool call
    │
    ▼
  Backend forwards to frontend via WS { type: 'gemini_message' }
    │
    ▼
  App.tsx tool dispatcher handles:

    generateFaceMap
      → captureFrame() from camera
      → validate image
      → POST /api/images/face-map
      → save result to Firestore
      → sendToolResponse(success) back to Gemini

    applyMakeupToUser
      → captureFrame() from camera
      → validate image
      → POST /api/images/apply-makeup
      → save result to Firestore
      → sendToolResponse(success) back to Gemini

    showReferenceImage
      → POST /api/images/reference
      → save result + store as lastReferenceImage
      → sendToolResponse(success) back to Gemini

    generateMakeupVideo
      → POST /api/video/generate
      → save result to Firestore
      → sendToolResponse(success) back to Gemini

    addToWishlist
      → addDoc → Firestore users/{uid}/wishlist
      → sendToolResponse(success) back to Gemini

    requestVisualUpdate
      → captureFrame() from camera
      → sendRealtimeInput(image) directly to Gemini
      → Alice can now see user's face/progress

  ── Ending the session ────────────────────────────────────────

  User taps mic again (or says "stop")
    │
    ▼
  liveSession.close()
  AudioStreamer.stop()
  AudioPlayer.stop()
  Camera stream released
  WebSocket closed


═══════════════════════════════════════════════════════════════
  SECURITY LAYER (every API call)
═══════════════════════════════════════════════════════════════

  Frontend
    └── auth.currentUser.getIdToken()
        → short-lived JWT attached to every request

  Backend middleware (requireAuth)
    └── Firebase Admin verifyIdToken()
        ├── valid   → req.uid set, request continues
        └── invalid → 401 returned, request blocked

  Gemini API key
    └── stored only in Cloud Run environment
        never sent to or visible in the browser


═══════════════════════════════════════════════════════════════
  FIRESTORE WRITE/READ SUMMARY
═══════════════════════════════════════════════════════════════

  Collection                  Written by              Read by
  ─────────────────────────────────────────────────────────────
  users/{uid}                 App on login            App (auth check)
  users/{uid}/messages        App (chat + live)       App (onSnapshot)
  users/{uid}/vanity          VanityManager           App + VanityManager
  users/{uid}/wishlist        App (tool dispatch)     VanityManager

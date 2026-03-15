import React, { useState, useEffect, useRef } from 'react';
import { auth, db, signIn, logOut, handleFirestoreError, OperationType } from './firebase';
import { onAuthStateChanged, User } from 'firebase/auth';
import { collection, addDoc, onSnapshot, query, orderBy, limit, serverTimestamp, doc, setDoc, deleteDoc, getDocs, writeBatch } from 'firebase/firestore';
import { generateMakeupAdvice, generateFaceMap, generateMakeupVideo, generateReferenceImage, connectLiveAgent, findMakeupStores, handleApiError, validateImageForMakeup, applyMakeupToUser, generateSpeech } from './services/gemini';
import { AudioStreamer, AudioPlayer } from './services/audio';
import { Camera, Mic, MicOff, Send, Image as ImageIcon, Video, LogOut, User as UserIcon, Sparkles, Loader2, Play, X, Package, Trash2, Key } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { compressImage } from './utils/image';
import VanityManager from './components/VanityManager';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import ReactMarkdown from 'react-markdown';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean, error: any }> {
  constructor(props: any) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: any) {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      let message = "Something went wrong.";
      try {
        const errInfo = JSON.parse(this.state.error.message);
        if (errInfo.error.includes('permissions')) {
          message = "You don't have permission to perform this action. Please make sure you are logged in correctly.";
        }
      } catch (e) {
        // Not a JSON error
      }

      return (
        <div className="min-h-screen bg-black flex items-center justify-center p-6 text-center">
          <div className="max-w-md space-y-4">
            <X className="w-12 h-12 text-red-500 mx-auto" />
            <h2 className="text-2xl font-bold text-white">Application Error</h2>
            <p className="text-zinc-400">{message}</p>
            <button 
              onClick={() => window.location.reload()}
              className="px-6 py-2 bg-white text-black font-bold rounded-xl"
            >
              Reload App
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [messages, setMessages] = useState<any[]>([]);
  const [inputText, setInputText] = useState('');
  const [isLive, setIsLive] = useState(false);
  const [isSessionReady, setIsSessionReady] = useState(false);
  const isSessionReadyRef = useRef(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [selectedImages, setSelectedImages] = useState<string[]>([]);
  const [showCamera, setShowCamera] = useState(false);
  const [showVanity, setShowVanity] = useState(false);
  const [onboardingStep, setOnboardingStep] = useState<'none' | 'choice' | 'vanity'>('none');
  const [vanityProducts, setVanityProducts] = useState<any[]>([]);
  const [pendingAction, setPendingAction] = useState<{ type: 'face-map' | 'advice', prompt?: string } | null>(null);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [micLevel, setMicLevel] = useState(0);
  const [lastReferenceImage, setLastReferenceImage] = useState<string | null>(null);
  const lastReferenceImageRef = useRef<string | null>(null);
  const lastUserFaceRef = useRef<string | null>(null);
  const liveSessionRef = useRef<any>(null);
  const audioBufferRef = useRef<string[]>([]);
  const liveSessionPromiseRef = useRef<Promise<any> | null>(null);
  const liveSessionCallbacksRef = useRef<any>(null);
  const audioStreamerRef = useRef<AudioStreamer | null>(null);
  const audioPlayerRef = useRef<AudioPlayer | null>(null);
  const videoIntervalRef = useRef<any>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (isLive && videoRef.current && liveSessionRef.current) {
      videoIntervalRef.current = setInterval(() => {
        if (videoRef.current && canvasRef.current) {
          const context = canvasRef.current.getContext('2d');
          if (context) {
            canvasRef.current.width = 320;
            canvasRef.current.height = 240;
            context.drawImage(videoRef.current, 0, 0, 320, 240);
            const base64Image = canvasRef.current.toDataURL('image/jpeg', 0.5).split(',')[1];
            liveSessionRef.current.sendRealtimeInput({
              media: { data: base64Image, mimeType: 'image/jpeg' }
            });
          }
        }
      }, 500);
    } else {
      if (videoIntervalRef.current) {
        clearInterval(videoIntervalRef.current);
        videoIntervalRef.current = null;
      }
    }

    return () => {
      if (videoIntervalRef.current) {
        clearInterval(videoIntervalRef.current);
      }
    };
  }, [isLive, isSessionReady, showCamera]);

  const captureFrame = () => {
    if (videoRef.current && canvasRef.current) {
      const context = canvasRef.current.getContext('2d');
      if (context) {
        // Use video dimensions for better quality if possible
        const width = videoRef.current.videoWidth || 640;
        const height = videoRef.current.videoHeight || 480;
        canvasRef.current.width = width;
        canvasRef.current.height = height;
        context.drawImage(videoRef.current, 0, 0, width, height);
        return canvasRef.current.toDataURL('image/jpeg', 0.8);
      }
    }
    return null;
  };

  const toggleLive = async () => {
    if (isLive) {
      liveSessionRef.current?.close();
      audioStreamerRef.current?.stop();
      audioPlayerRef.current?.stop();
      if (videoIntervalRef.current) clearInterval(videoIntervalRef.current);
      setIsLive(false);
      setIsSessionReady(false);
      isSessionReadyRef.current = false;
      setMicLevel(0);
      stopCamera(true);
      return;
    }

    // Request both audio and video at once for better mobile support
    let stream: MediaStream | null = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        },
        video: true 
      });
    } catch (err) {
      console.warn("Failed to get both audio and video, trying audio only:", err);
      try {
        stream = await navigator.mediaDevices.getUserMedia({ 
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true
          }
        });
      } catch (audioErr) {
        console.error("Failed to get audio:", audioErr);
        throw audioErr;
      }
    }

    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
      try {
        await videoRef.current.play();
      } catch (e) {
        console.warn("Auto-play failed, user interaction might be needed:", e);
      }
    }

    setIsLive(true);
    setIsSessionReady(false);
    isSessionReadyRef.current = false;
    audioBufferRef.current = [];
    
    try {
      const player = new AudioPlayer();
      await player.resume();
      audioPlayerRef.current = player;
      
      const streamer = new AudioStreamer((base64Data) => {
        if (isSessionReadyRef.current && liveSessionRef.current) {
          // Send buffered audio first if any
          if (audioBufferRef.current.length > 0) {
            console.log(`Sending ${audioBufferRef.current.length} buffered audio chunks`);
            audioBufferRef.current.forEach(data => {
              liveSessionRef.current.sendRealtimeInput({
                media: { data, mimeType: 'audio/pcm;rate=16000' }
              });
            });
            audioBufferRef.current = [];
          }
          
          liveSessionRef.current.sendRealtimeInput({
            media: { data: base64Data, mimeType: 'audio/pcm;rate=16000' }
          });
        } else {
          // Buffer audio while session is connecting
          audioBufferRef.current.push(base64Data);
          // Keep buffer small to avoid huge bursts
          if (audioBufferRef.current.length > 50) audioBufferRef.current.shift();
        }
      });

      if (stream) streamer.setExternalStream(stream);

      streamer.setVolumeCallback((volume) => {
        setMicLevel(volume);
      });

      await streamer.start();
      audioStreamerRef.current = streamer;

      let currentAiTurnText = "";
      const processedToolCalls = new Set<string>();

      // Prepare context from last 5 messages
      const recentContext = messages.slice(-5).map(m => `${m.sender === 'user' ? 'User' : 'Alice'}: ${m.content}`).join('\n');

      const sessionPromise = connectLiveAgent({
        onopen: () => {
          console.log("Live session opened");
          // Set ref immediately on open if possible
          sessionPromise.then(s => {
            console.log("Live session ref set in onopen");
            liveSessionRef.current = s;
            setIsSessionReady(true);
            isSessionReadyRef.current = true;

            // Send initial context if we have a reference image
            if (lastReferenceImageRef.current) {
              console.log("Sending last reference image to live session");
              s.sendRealtimeInput({
                media: { data: lastReferenceImageRef.current, mimeType: 'image/jpeg' }
              });
            }
          });
        },
        onmessage: async (msg: any) => {
          console.log("Live message received:", msg);
          // Handle interruption
          if (msg.serverContent?.interrupted) {
            player.interrupt();
            currentAiTurnText = "";
            return;
          }

          // Handle tool calls
          const toolCall = msg.toolCall || msg.serverContent?.toolCall || msg.serverContent?.modelTurn?.parts?.find((p: any) => p.toolCall)?.toolCall;
          if (toolCall && user) {
            const session = liveSessionRef.current;
            if (!session) {
              console.warn("Tool call received but session ref not yet set");
              return;
            }

            console.log("Processing tool calls:", toolCall.functionCalls);
            const responses = [];
            
            for (const call of toolCall.functionCalls) {
              if (processedToolCalls.has(call.id)) {
                console.log("Skipping already processed tool call:", call.id);
                continue;
              }
              processedToolCalls.add(call.id);

              try {
                if (call.name === 'generateFaceMap') {
                  const { prompt } = call.args as any;
                  console.log("Generating face map for:", prompt);
                  
                  playVerbalConfirmation(`I've got your photo! Give me a moment while I map out the ${prompt} look for you.`);

                  // Add temporary message
                  await addDoc(collection(db, `users/${user.uid}/messages`), {
                    sender: 'ai',
                    content: `🎨 One moment, I'm analyzing your face to create a ${prompt} map...`,
                    type: 'text',
                    createdAt: serverTimestamp()
                  });

                  const frame = captureFrame();
                  if (frame) {
                    const compressedFrame = await compressImage(frame, 1024, 0.8);
                    const base64 = compressedFrame.includes(',') ? compressedFrame.split(',')[1] : compressedFrame;
                    
                    // Validate image before generating face map
                    const validation = await validateImageForMakeup(base64, prompt);
                    if (!validation.isValid) {
                      await addDoc(collection(db, `users/${user.uid}/messages`), {
                        sender: 'ai',
                        content: `I'd love to help with that, but I need a better view! ${validation.reason}`,
                        type: 'text',
                        createdAt: serverTimestamp()
                      });
                      responses.push({ name: call.name, response: { success: false, error: validation.reason }, id: call.id });
                    } else {
                      const mapUrl = await generateFaceMap(base64, prompt);
                      if (mapUrl) {
                        const compressed = await compressImage(mapUrl);
                        await addDoc(collection(db, `users/${user.uid}/messages`), {
                          sender: 'ai',
                          content: `I've generated a new face map for ${prompt}. Check it out!`,
                          type: 'image',
                          mediaUrl: compressed,
                          createdAt: serverTimestamp()
                        });
                        responses.push({ name: call.name, response: { success: true }, id: call.id });
                      } else {
                        console.error("Face map generation returned null");
                        await addDoc(collection(db, `users/${user.uid}/messages`), {
                          sender: 'ai',
                          content: `❌ I'm sorry, I had trouble generating the face map for ${prompt}. Please try again in a moment.`,
                          type: 'text',
                          createdAt: serverTimestamp()
                        });
                        responses.push({ name: call.name, response: { success: false, error: "Failed to generate map" }, id: call.id });
                      }
                    }
                  } else {
                    console.error("Failed to capture frame for face map");
                    await addDoc(collection(db, `users/${user.uid}/messages`), {
                      sender: 'ai',
                      content: `❌ I couldn't access your camera to create the face map. Please make sure your camera is enabled.`,
                      type: 'text',
                      createdAt: serverTimestamp()
                    });
                    responses.push({ name: call.name, response: { success: false, error: "Camera not ready" }, id: call.id });
                  }
                } else if (call.name === 'applyMakeupToUser') {
                  const { prompt } = call.args as any;
                  console.log("Applying makeup to user:", prompt);

                  const frame = captureFrame();
                  if (frame) {
                    const compressedFrame = await compressImage(frame, 1024, 0.8);
                    const base64 = compressedFrame.includes(',') ? compressedFrame.split(',')[1] : compressedFrame;
                    
                    // Validate image before applying makeup
                    const validation = await validateImageForMakeup(base64, prompt);
                    if (!validation.isValid) {
                      playVerbalConfirmation(`I'd love to show you that look, but I need a better view of your face! ${validation.reason}`);
                      await addDoc(collection(db, `users/${user.uid}/messages`), {
                        sender: 'ai',
                        content: `I'd love to help with that, but I need a better view! ${validation.reason}`,
                        type: 'text',
                        createdAt: serverTimestamp()
                      });
                      responses.push({ name: call.name, response: { success: false, error: validation.reason }, id: call.id });
                    } else {
                      playVerbalConfirmation(`Got it! I'm applying the ${prompt} look to your photo now. One second!`);
                      await addDoc(collection(db, `users/${user.uid}/messages`), {
                        sender: 'ai',
                        content: `💄 One moment, I'm applying the ${prompt} look to your photo...`,
                        type: 'text',
                        createdAt: serverTimestamp()
                      });
                      
                      const resultUrl = await applyMakeupToUser(base64, prompt, lastReferenceImageRef.current || undefined);
                      if (resultUrl) {
                        const compressed = await compressImage(resultUrl);
                        await addDoc(collection(db, `users/${user.uid}/messages`), {
                          sender: 'ai',
                          content: `Here is how the **${prompt}** look would appear on you!`,
                          type: 'image',
                          mediaUrl: compressed,
                          createdAt: serverTimestamp()
                        });
                        responses.push({ name: call.name, response: { success: true }, id: call.id });
                      } else {
                        responses.push({ name: call.name, response: { success: false, error: "Failed to apply makeup" }, id: call.id });
                      }
                    }
                  } else {
                    responses.push({ name: call.name, response: { success: false, error: "Camera not ready" }, id: call.id });
                  }
                } else if (call.name === 'showReferenceImage') {
                  const { prompt } = call.args as any;
                  console.log("Showing reference image for:", prompt);
                  const imageUrl = await generateReferenceImage(prompt);
                  if (imageUrl) {
                    const compressed = await compressImage(imageUrl);
                    const base64 = compressed.includes(',') ? compressed.split(',')[1] : compressed;
                    setLastReferenceImage(compressed);
                    lastReferenceImageRef.current = base64;
                    await addDoc(collection(db, `users/${user.uid}/messages`), {
                      sender: 'ai',
                      content: `Here is a reference image for **${prompt}**.`,
                      type: 'image',
                      mediaUrl: compressed,
                      createdAt: serverTimestamp()
                    });
                    responses.push({ name: call.name, response: { success: true }, id: call.id });
                  } else {
                    console.error("Reference image generation returned null");
                    responses.push({ name: call.name, response: { success: false, error: "Failed to generate image" }, id: call.id });
                  }
                } else if (call.name === 'generateMakeupVideo') {
                  const { prompt } = call.args as any;
                  console.log("Generating video for:", prompt);
                  const videoUrl = await generateMakeupVideo(prompt);
                  if (videoUrl) {
                    await addDoc(collection(db, `users/${user.uid}/messages`), {
                      sender: 'ai',
                      content: `Here is a tutorial for ${prompt}.`,
                      type: 'video',
                      mediaUrl: videoUrl,
                      createdAt: serverTimestamp()
                    });
                    responses.push({ name: call.name, response: { success: true }, id: call.id });
                  } else {
                    console.error("Video generation returned null");
                    responses.push({ name: call.name, response: { success: false, error: "Failed to generate video" }, id: call.id });
                  }
                } else if (call.name === 'addToWishlist') {
                  const { name, reason } = call.args as any;
                  console.log("Adding to wishlist:", name);
                  await addDoc(collection(db, `users/${user.uid}/wishlist`), {
                    name,
                    reason,
                    addedAt: serverTimestamp()
                  });
                  await addDoc(collection(db, `users/${user.uid}/messages`), {
                    sender: 'ai',
                    content: `✨ I've added **${name}** to your Beauty Essentials!`,
                    type: 'text',
                    createdAt: serverTimestamp()
                  });
                  responses.push({ name: call.name, response: { success: true }, id: call.id });
                } else if (call.name === 'requestVisualUpdate') {
                  console.log("Agent requested visual update");
                  const frame = captureFrame();
                  if (frame) {
                    const compressed = await compressImage(frame, 640, 0.6);
                    session.sendRealtimeInput({
                      media: {
                        data: compressed.split(',')[1],
                        mimeType: 'image/jpeg'
                      }
                    });
                    responses.push({ name: call.name, response: { success: true, message: "Image sent" }, id: call.id });
                  } else {
                    responses.push({ name: call.name, response: { success: false, error: "Camera not available" }, id: call.id });
                  }
                } else {
                  console.warn("Unknown tool call:", call.name);
                  responses.push({ name: call.name, response: { success: false, error: "Unknown tool" }, id: call.id });
                }
              } catch (err) {
                console.error(`Error processing tool call ${call.name}:`, err);
                handleApiError(err);
                responses.push({ name: call.name, response: { success: false, error: String(err) }, id: call.id });
              }
            }
            
            if (responses.length > 0) {
              console.log("Sending tool responses:", responses);
              session.sendToolResponse({ functionResponses: responses });
            }
          }

          // Handle audio output and AI transcription
          const modelTurn = msg.serverContent?.modelTurn;
          if (modelTurn) {
            for (const part of modelTurn.parts || []) {
              if (part.inlineData?.data) {
                console.log("Playing AI audio chunk, size:", part.inlineData.data.length);
                player.play(part.inlineData.data);
              }
              if (part.text) {
                console.log("AI transcription:", part.text);
                currentAiTurnText += part.text;
              }
            }
          }

          // Handle user transcription - check all possible paths
          const userTranscription = 
            msg.inputAudioTranscription?.text || 
            msg.serverContent?.inputAudioTranscription?.text ||
            msg.input_audio_transcription?.text ||
            msg.serverContent?.input_audio_transcription?.text;

          if (userTranscription && user) {
            // Check if it's final or if we should just show it
            const isFinal = 
              msg.inputAudioTranscription?.isFinal ?? 
              msg.serverContent?.inputAudioTranscription?.isFinal ?? 
              msg.input_audio_transcription?.isFinal ?? 
              msg.serverContent?.input_audio_transcription?.isFinal ?? 
              true;

            if (isFinal) {
              const lowerTranscript = userTranscription.toLowerCase();
              if (lowerTranscript.includes('stop') || lowerTranscript.includes('interrupt')) {
                toggleLive();
                return;
              }

              await addDoc(collection(db, `users/${user.uid}/messages`), {
                sender: 'user',
                content: userTranscription,
                type: 'text',
                createdAt: serverTimestamp()
              });
            }
          }

          // Handle AI transcription from outputAudioTranscription
          const outputTranscription = 
            msg.outputAudioTranscription?.text || 
            msg.serverContent?.outputAudioTranscription?.text ||
            msg.output_audio_transcription?.text ||
            msg.serverContent?.output_audio_transcription?.text;

          if (outputTranscription) {
            currentAiTurnText += outputTranscription;
          }

          // Save AI message when turn is complete
          if (msg.serverContent?.turnComplete && currentAiTurnText && user) {
            await addDoc(collection(db, `users/${user.uid}/messages`), {
              sender: 'ai',
              content: currentAiTurnText.trim(),
              type: 'text',
              createdAt: serverTimestamp()
            });
            currentAiTurnText = ""; // Reset for next turn
          }
        },
        onclose: () => {
          audioStreamerRef.current?.stop();
          audioPlayerRef.current?.stop();
          if (videoIntervalRef.current) clearInterval(videoIntervalRef.current);
          setIsLive(false);
          setIsSessionReady(false);
          isSessionReadyRef.current = false;
        },
        onerror: (err: any) => {
          console.error("Live agent error:", err);
          handleApiError(err);
          audioStreamerRef.current?.stop();
          audioPlayerRef.current?.stop();
          if (videoIntervalRef.current) clearInterval(videoIntervalRef.current);
          setIsLive(false);
          setIsSessionReady(false);
          isSessionReadyRef.current = false;
        }
      }, recentContext);

      sessionPromise.then(s => {
        liveSessionRef.current = s;
      });

      const session = await sessionPromise;
      liveSessionRef.current = session;
    } catch (err) {
      console.error("Failed to connect live agent:", err);
      handleApiError(err);
      setIsLive(false);
    }
  };
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (u) {
        // Ensure user doc exists
        await setDoc(doc(db, 'users', u.uid), {
          uid: u.uid,
          email: u.email,
          displayName: u.displayName,
          photoURL: u.photoURL,
          updatedAt: serverTimestamp()
        }, { merge: true });

        // Check for vanity products to trigger onboarding
        const vanityPath = `users/${u.uid}/vanity`;
        onSnapshot(query(collection(db, vanityPath), limit(1)), (snapshot) => {
          if (snapshot.empty && onboardingStep === 'none') {
            setOnboardingStep('choice');
          }
        }, (error) => handleFirestoreError(error, OperationType.LIST, vanityPath));
      }
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (user) {
      const path = `users/${user.uid}/messages`;
      const q = query(
        collection(db, path),
        orderBy('createdAt', 'desc'),
        limit(50)
      );
      const unsubscribe = onSnapshot(q, (snapshot) => {
        const msgs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })).reverse();
        setMessages(msgs);
      }, (error) => handleFirestoreError(error, OperationType.LIST, path));
      return unsubscribe;
    }
  }, [user]);

  useEffect(() => {
    if (user) {
      const path = `users/${user.uid}/vanity`;
      const q = query(collection(db, path));
      const unsubscribe = onSnapshot(q, (snapshot) => {
        const products = snapshot.docs.map(doc => doc.data());
        setVanityProducts(products);
      }, (error) => handleFirestoreError(error, OperationType.LIST, path));
      return unsubscribe;
    }
  }, [user]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const clearChat = async () => {
    if (!user) return;

    setIsProcessing(true);
    setShowClearConfirm(false);
    try {
      const msgPath = `users/${user.uid}/messages`;
      const q = query(collection(db, msgPath));
      const snapshot = await getDocs(q);
      
      const batch = writeBatch(db);
      snapshot.docs.forEach((doc) => {
        batch.delete(doc.ref);
      });
      
      await batch.commit();
      setMessages([]);
    } catch (e) {
      handleFirestoreError(e, OperationType.DELETE, `users/${user.uid}/messages`);
    } finally {
      setIsProcessing(false);
    }
  };

  const playVerbalConfirmation = async (text: string) => {
    try {
      const base64 = await generateSpeech(text);
      if (base64 && audioPlayerRef.current) {
        audioPlayerRef.current.play(base64);
      }
    } catch (err) {
      console.error("Error playing verbal confirmation:", err);
    }
  };

  const handleSend = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if ((!inputText.trim() && selectedImages.length === 0) || isProcessing || !user) return;

    const text = inputText;
    const images = [...selectedImages];
    setInputText('');
    setSelectedImages([]);
    setIsProcessing(true);

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const vanityContext = vanityProducts.length > 0 
        ? vanityProducts.map(p => `- ${p.name} (${p.brand}, ${p.category})`).join('\n')
        : "User has not added any products to their kit yet.";

      // Save user message
      const msgPath = `users/${user.uid}/messages`;
      try {
        if (images.length > 0) {
          // For now, we store the first image as the primary mediaUrl for the message
          // but we can process all of them for the AI
          const primaryImage = images[0];
          const base64 = primaryImage.includes(',') ? primaryImage.split(',')[1] : primaryImage;
          setLastReferenceImage(primaryImage);
          lastReferenceImageRef.current = base64;
        }

        await addDoc(collection(db, msgPath), {
          sender: 'user',
          content: text || "Analyzed images",
          type: images.length > 0 ? 'image' : 'text',
          mediaUrl: images.length > 0 ? images[0] : null,
          additionalImages: images.length > 1 ? images.slice(1) : null,
          createdAt: serverTimestamp()
        });
      } catch (e) {
        handleFirestoreError(e, OperationType.CREATE, msgPath);
      }

      let aiResponse = "";
      let mediaUrl = null;
      let type: 'text' | 'image' | 'video' = 'text';

      const lowerText = text.toLowerCase();
      const isFaceMapRequest = (images.length > 0 || pendingAction?.type === 'face-map' || (lastUserFaceRef.current && (lowerText.includes('look') || lowerText.includes('this in') || lowerText.includes('it in')))) && (
        lowerText.includes('look') || 
        lowerText.includes('map') || 
        lowerText.includes('where') || 
        lowerText.includes('how to apply') || 
        lowerText.includes('placement') ||
        lowerText.includes('facemap') ||
        lowerText.includes('try on') ||
        lowerText.includes('this in') ||
        lowerText.includes('it in') ||
        (pendingAction?.type === 'face-map' && images.length > 0)
      );
      const isStoreQuestion = lowerText.includes('buy') || lowerText.includes('store') || lowerText.includes('shop') || lowerText.includes('near me');

      console.log("Message analysis:", { isFaceMapRequest, isStoreQuestion, hasImages: images.length > 0 });

      // Check for face map request first if image is provided or pending
      if (isFaceMapRequest) {
          const prompt = pendingAction?.prompt || text || "makeup application";
          const isTechnicalRequest = lowerText.includes('map') || lowerText.includes('placement') || lowerText.includes('where') || lowerText.includes('how to apply') || lowerText.includes('facemap') || lowerText.includes('diagram');
          const isTryOnRequest = lowerText.includes('look on me') || lowerText.includes('try on') || (lowerText.includes('look') && (lowerText.includes('on my') || lowerText.includes('on me'))) || lowerText.includes('this in') || lowerText.includes('it in');
          
          const isTryOn = isTryOnRequest && !isTechnicalRequest;
          const isGeneralMap = lowerText.includes('general') || lowerText.includes('inspiration');
          
          let userFaceBase64: string | null = lastUserFaceRef.current;
          let referenceBase64: string | null = lastReferenceImageRef.current;

          if (images.length > 0) {
            // Process all uploaded images
            for (const img of images) {
              const validation = await validateImageForMakeup(img.split(',')[1], prompt);
              if (validation.type === 'USER_FACE') {
                if (validation.isValid) {
                  userFaceBase64 = img.split(',')[1];
                  lastUserFaceRef.current = userFaceBase64;
                } else if (!aiResponse) {
                  aiResponse = `I'd love to help with that, but I need a better photo of your face first! ${validation.reason}`;
                  type = 'text';
                  setPendingAction({ type: 'face-map', prompt });
                }
              } else {
                // It's a reference image
                referenceBase64 = img.split(',')[1];
                setLastReferenceImage(img);
                lastReferenceImageRef.current = referenceBase64;
              }
            }
          }
          
          // If we still don't have a user face, try to capture from camera
          if (!userFaceBase64 && !aiResponse) {
            userFaceBase64 = captureFrame()?.split(',')[1] || null;
            if (userFaceBase64) lastUserFaceRef.current = userFaceBase64;
          }

          if (!aiResponse) {
            if (isTryOn) {
              if (!userFaceBase64) {
                await startCamera(false);
                aiResponse = "I have the look ready, but I need to see your face to apply it! I've turned on your camera—please look at it and say 'Try it on me' or upload a clear photo of your face.";
                type = 'text';
                setPendingAction({ type: 'face-map', prompt });
              } else {
                const resultUrl = await applyMakeupToUser(userFaceBase64, prompt, referenceBase64 || undefined);
                aiResponse = `Here is how the **${prompt}** look would appear on you! No technical marks, just the finished result.`;
                mediaUrl = resultUrl;
                type = 'image';
                setPendingAction(null);
              }
            } else if (isGeneralMap) {
              const imageUrl = await generateReferenceImage(`${prompt} face map guide diagram`);
              aiResponse = `Here is a general face map guide for **${prompt}**. This is a reference diagram on a professional model.`;
              mediaUrl = imageUrl;
              type = 'image';
              if (imageUrl) {
                setLastReferenceImage(imageUrl);
                lastReferenceImageRef.current = imageUrl.split(',')[1];
              }
              setPendingAction(null);
            } else {
              // Standard face map
              if (!userFaceBase64) {
                await startCamera(false);
                aiResponse = "I need to see your face to create a personalized face map! I've turned on your camera—please look at it or upload a clear photo of your face.";
                type = 'text';
                setPendingAction({ type: 'face-map', prompt });
              } else {
                const [mapUrl, adviceResult] = await Promise.all([
                  generateFaceMap(userFaceBase64, prompt),
                  generateMakeupAdvice(`DETAILED FACE MAP GUIDE: ${prompt}. 
                  I have generated a technical face map image for you. Now, provide the corresponding MASTERCLASS TEXT GUIDE.
                  1. ANATOMY: Identify the specific facial landmarks (e.g., "outer V", "crease", "apple of the cheek") where the DOTS are placed.
                  2. MOTION: Explain the exact brush strokes or finger movements indicated by the ARROWS (e.g., "upward flick", "circular buffing").
                  3. TEXTURE: Describe how the product should look at each stage (e.g., "sheer wash of color", "sharp, defined line").
                  4. PRO TIPS: Provide 2-3 professional secrets for this specific look.
                  Keep it sophisticated, technical, and strictly focused on the application steps. Skip all pleasantries.`, userFaceBase64, controller.signal, vanityContext)
                ]);
                aiResponse = adviceResult.text || `I've generated your personalized face map for ${prompt}.`;
                mediaUrl = mapUrl;
                type = 'image';
                setPendingAction(null);
              }
            }
          }
      } else if (isStoreQuestion) {
          aiResponse = "Searching for the best makeup spots near you...";
          const result = await findMakeupStores(text);
          aiResponse = result.text || "I found some places for you.";
      } else if (lowerText.includes('how to use') || lowerText.includes('tutorial')) {
          aiResponse = "Generating a quick tutorial for you...";
          mediaUrl = await generateMakeupVideo(text);
          type = 'video';
      } else if (lowerText.includes('show me') || lowerText.includes('inspiration') || lowerText.includes('look like')) {
          aiResponse = "Generating a professional reference look for you...";
          mediaUrl = await generateReferenceImage(text);
          type = 'image';
      } else {
          const result = await generateMakeupAdvice(text, images.length > 0 ? images[0].split(',')[1] : undefined, controller.signal, vanityContext, messages.slice(-5));
          aiResponse = result.text || "I'm here to help with your beauty questions.";
          
          if (result.functionCalls) {
            for (const call of result.functionCalls) {
              if (call.name === 'addToWishlist') {
                const { name, reason } = call.args as any;
                if (name && reason) {
                  await addDoc(collection(db, `users/${user.uid}/wishlist`), {
                    name: String(name),
                    reason: String(reason),
                    addedAt: serverTimestamp()
                  });
                  if (!aiResponse.toLowerCase().includes(String(name).toLowerCase())) {
                    aiResponse += `\n\n✨ I've added **${name}** to your Beauty Essentials! ${reason}`;
                  } else if (!aiResponse.includes('Beauty Essentials')) {
                    aiResponse += `\n\n✨ I've added this to your Beauty Essentials!`;
                  }
                }
              }
            }
          }
      }

      if (type === 'image' && mediaUrl) {
        mediaUrl = await compressImage(mediaUrl);
      }

      const aiMsgPath = `users/${user.uid}/messages`;
      try {
        await addDoc(collection(db, aiMsgPath), {
          sender: 'ai',
          content: aiResponse || "I'm sorry, I couldn't generate a response.",
          type,
          mediaUrl,
          createdAt: serverTimestamp()
        });
      } catch (e) {
        handleFirestoreError(e, OperationType.CREATE, aiMsgPath);
      }
    } catch (error: any) {
      if (error.name === 'AbortError') {
        console.log('Generation aborted');
      } else {
        console.error(error);
        handleApiError(error);
      }
    } finally {
      setIsProcessing(false);
      abortControllerRef.current = null;
    }
  };

  const interruptGeneration = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      setIsProcessing(false);
    }
  };

  const startCamera = async (openModal = true) => {
    if (openModal) setShowCamera(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      if (videoRef.current) videoRef.current.srcObject = stream;
    } catch (err) {
      console.error("Camera error:", err);
    }
  };

  const captureImage = async () => {
    if (videoRef.current && canvasRef.current) {
      const context = canvasRef.current.getContext('2d');
      if (context) {
        canvasRef.current.width = videoRef.current.videoWidth;
        canvasRef.current.height = videoRef.current.videoHeight;
        context.drawImage(videoRef.current, 0, 0);
        const dataUrl = canvasRef.current.toDataURL('image/jpeg', 0.8);
        const compressed = await compressImage(dataUrl);
        setSelectedImages(prev => [...prev, compressed].slice(0, 2));
        stopCamera();
      }
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files) {
      const newImages: string[] = [];
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const url = URL.createObjectURL(file);
        try {
          const compressed = await compressImage(url);
          newImages.push(compressed);
        } catch (err) {
          console.error("File processing failed:", err);
        } finally {
          URL.revokeObjectURL(url);
        }
      }
      setSelectedImages(prev => [...prev, ...newImages].slice(0, 2)); // Limit to 2 images for now
    }
  };

  const stopCamera = (force = false) => {
    setShowCamera(false);
    if ((force || !isLive) && videoRef.current?.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach(track => track.stop());
      videoRef.current.srcObject = null;
    }
  };

  if (loading) {
    return (
      <ErrorBoundary>
        <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center">
          <Loader2 className="w-8 h-8 text-emerald-500 animate-spin" />
        </div>
      </ErrorBoundary>
    );
  }

  if (!user) {
    return (
      <ErrorBoundary>
        <div className="min-h-screen bg-[#0a0a0a] flex flex-col items-center justify-center p-4">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="max-w-md w-full text-center space-y-8"
        >
          <div className="relative inline-block">
            <div className="absolute -inset-4 bg-emerald-500/20 blur-3xl rounded-full" />
            <Sparkles className="w-16 h-16 text-emerald-500 relative" />
          </div>
          <div className="space-y-2">
            <h1 className="text-4xl font-bold text-white tracking-tight">Pretty Alice</h1>
            <p className="text-zinc-400">Your personal AI beauty coach and confidence booster.</p>
          </div>
          <button 
            onClick={signIn}
            className="w-full py-4 bg-white text-black font-semibold rounded-2xl hover:bg-zinc-200 transition-all flex items-center justify-center gap-3 shadow-xl shadow-white/5"
          >
            <UserIcon className="w-5 h-5" />
            Sign in with Google
          </button>
        </motion.div>
      </div>
      </ErrorBoundary>
    );
  }

  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-[#0a0a0a] text-zinc-100 flex flex-col font-sans">
      {/* Header */}
      <header className="h-16 border-b border-white/5 flex items-center justify-between px-4 sm:px-6 bg-black/50 backdrop-blur-xl sticky top-0 z-50">
        <div className="flex items-center gap-2 sm:gap-3">
          <Sparkles className="w-5 h-5 sm:w-6 sm:h-6 text-emerald-500" />
          <span className="font-bold tracking-tight text-base sm:text-lg">Pretty Alice</span>
        </div>
        <div className="flex items-center gap-2 sm:gap-4">
          <button 
            onClick={() => setShowVanity(true)}
            className="flex items-center gap-2 px-2.5 py-1.5 bg-emerald-500/10 text-emerald-500 rounded-full border border-emerald-500/20 hover:bg-emerald-500/20 transition-all"
          >
            <Package className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
            <span className="text-[10px] sm:text-xs font-bold">My Kit</span>
          </button>
          <button 
            onClick={() => setShowClearConfirm(true)}
            disabled={isProcessing || messages.length === 0}
            className="p-1.5 sm:p-2 hover:bg-red-500/10 text-zinc-400 hover:text-red-400 rounded-full transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            title="Clear Chat"
          >
            <Trash2 className="w-4 h-4 sm:w-5 sm:h-5" />
          </button>
          <div className="flex items-center gap-2 px-2 py-1 sm:px-3 sm:py-1.5 bg-white/5 rounded-full border border-white/10">
            <img src={user.photoURL || ''} className="w-5 h-5 sm:w-6 sm:h-6 rounded-full" referrerPolicy="no-referrer" />
            <span className="text-xs sm:text-sm font-medium hidden xs:inline-block max-w-[80px] truncate">{user.displayName}</span>
          </div>
          <button onClick={logOut} className="p-1.5 sm:p-2 hover:bg-white/5 rounded-full transition-colors">
            <LogOut className="w-4 h-4 sm:w-5 sm:h-5 text-zinc-400" />
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 flex flex-col max-w-4xl mx-auto w-full p-4 gap-4 overflow-hidden relative">
        {/* Onboarding Overlay */}
        <AnimatePresence>
          {onboardingStep !== 'none' && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 z-40 bg-black/80 backdrop-blur-md flex items-center justify-center p-6"
            >
              {onboardingStep === 'choice' && (
                <motion.div 
                  initial={{ scale: 0.9, y: 20 }}
                  animate={{ scale: 1, y: 0 }}
                  className="max-w-md w-full bg-zinc-900 border border-white/10 rounded-3xl p-8 text-center space-y-8 shadow-2xl"
                >
                  <div className="relative inline-block">
                    <div className="absolute -inset-4 bg-emerald-500/20 blur-2xl rounded-full" />
                    <Sparkles className="w-16 h-16 text-emerald-500 relative" />
                  </div>
                  <div className="space-y-2">
                    <h2 className="text-2xl font-bold text-white">Welcome to Pretty Alice!</h2>
                    <p className="text-zinc-400 text-sm">To give you the best advice, Alice needs to know what's in your makeup kit. How would you like to start?</p>
                  </div>
                  <div className="space-y-3">
                    <button 
                      onClick={() => setOnboardingStep('vanity')}
                      className="w-full py-4 bg-emerald-600 text-white font-bold rounded-2xl hover:bg-emerald-500 transition-all flex items-center justify-center gap-3"
                    >
                      <Package className="w-5 h-5" />
                      Build My Vanity Kit
                    </button>
                    <button 
                      onClick={() => setOnboardingStep('none')}
                      className="w-full py-4 bg-white/5 text-zinc-400 font-medium rounded-2xl hover:bg-white/10 transition-all"
                    >
                      Jump Directly to Chat
                    </button>
                  </div>
                </motion.div>
              )}
              {onboardingStep === 'vanity' && (
                <div className="w-full h-full flex flex-col items-center justify-center">
                  <VanityManager 
                    userId={user.uid} 
                    onClose={() => setOnboardingStep('none')} 
                  />
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {showVanity && (
          <VanityManager 
            userId={user.uid} 
            onClose={() => setShowVanity(false)} 
          />
        )}

        {/* Chat Area */}
        <div className="flex-1 overflow-y-auto space-y-6 pr-2 custom-scrollbar">
          <AnimatePresence initial={false}>
            {messages.map((msg) => (
              <motion.div
                key={msg.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className={cn(
                  "flex flex-col gap-2 max-w-[85%]",
                  msg.sender === 'user' ? "ml-auto items-end" : "mr-auto items-start"
                )}
              >
                <div className={cn(
                  "px-4 py-3 rounded-2xl text-sm leading-relaxed",
                  msg.sender === 'user' 
                    ? "bg-emerald-600 text-white rounded-tr-none" 
                    : "bg-zinc-900 text-zinc-100 border border-white/5 rounded-tl-none"
                )}>
                  {msg.type === 'text' && (
                    <div className="markdown-body">
                      <ReactMarkdown>{msg.content}</ReactMarkdown>
                    </div>
                  )}
                  {msg.type === 'image' && (
                    <div className="space-y-3">
                      <img src={msg.mediaUrl} className="rounded-xl w-full max-h-96 object-cover" referrerPolicy="no-referrer" />
                      <div className="markdown-body">
                        <ReactMarkdown>{msg.content}</ReactMarkdown>
                      </div>
                    </div>
                  )}
                  {msg.type === 'video' && (
                    <div className="space-y-3">
                      <video src={msg.mediaUrl} controls className="rounded-xl w-full aspect-[9/16] bg-black" />
                      <div className="markdown-body">
                        <ReactMarkdown>{msg.content}</ReactMarkdown>
                      </div>
                    </div>
                  )}
                </div>
                <span className="text-[10px] text-zinc-500 uppercase tracking-widest font-mono">
                  {msg.sender === 'ai' ? 'Pretty Alice' : 'You'}
                </span>
              </motion.div>
            ))}
            {isLive && !isSessionReady && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="mx-auto"
              >
                <div className="bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 rounded-full px-4 py-1.5 text-[10px] uppercase tracking-widest font-bold flex items-center gap-2">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  Connecting to Alice...
                </div>
              </motion.div>
            )}
            {isLive && isSessionReady && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="mx-auto"
              >
                <div className="bg-red-500/10 text-red-500 border border-red-500/20 rounded-full px-4 py-1.5 text-[10px] uppercase tracking-widest font-bold flex items-center gap-2">
                  <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
                  Live with Alice
                </div>
              </motion.div>
            )}
            {isProcessing && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="mr-auto items-start flex flex-col gap-2"
              >
                <div className="bg-zinc-900 text-zinc-400 border border-white/5 rounded-2xl rounded-tl-none px-4 py-3 text-sm flex flex-col gap-3">
                  <div className="flex items-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Pretty Alice is thinking...
                  </div>
                  <button 
                    onClick={interruptGeneration}
                    className="text-[10px] uppercase tracking-widest font-bold text-red-500 hover:text-red-400 transition-colors flex items-center gap-1"
                  >
                    <X className="w-3 h-3" />
                    Interrupt
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
          <div ref={chatEndRef} />
        </div>

        {/* Input Area */}
        <div className="space-y-4">
          {selectedImages.length > 0 && (
            <div className="flex gap-2">
              {selectedImages.map((img, idx) => (
                <div key={idx} className="relative inline-block">
                  <img src={img} className="w-24 h-24 object-cover rounded-xl border-2 border-emerald-500" />
                  <button 
                    onClick={() => setSelectedImages(prev => prev.filter((_, i) => i !== idx))}
                    className="absolute -top-2 -right-2 p-1 bg-zinc-800 rounded-full border border-white/10"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          )}

          <form onSubmit={handleSend} className="relative flex items-end gap-2 z-30">
            <div className="flex-1 relative group">
              <textarea 
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
                placeholder="Ask Alice..."
                className="w-full bg-zinc-900 border border-white/5 rounded-2xl px-4 py-4 pr-32 sm:pr-40 text-sm focus:outline-none focus:border-emerald-500/50 transition-all resize-none min-h-[56px] max-h-32"
                rows={1}
              />
              <div className="absolute right-2 bottom-2 flex items-center gap-1 z-20">
                <button 
                  type="button"
                  onClick={() => startCamera()}
                  className="p-2.5 sm:p-2 hover:bg-white/5 active:scale-95 rounded-xl transition-colors text-zinc-400"
                >
                  <Camera className="w-5 h-5" />
                </button>
                <label className="p-2.5 sm:p-2 hover:bg-white/5 active:scale-95 rounded-xl transition-colors text-zinc-400 cursor-pointer">
                  <ImageIcon className="w-5 h-5" />
                  <input 
                    type="file" 
                    accept="image/*" 
                    multiple
                    className="hidden" 
                    onChange={handleFileUpload}
                  />
                </label>
                <button 
                  type="button"
                  className={cn(
                    "p-2.5 sm:p-2 rounded-xl transition-all relative overflow-hidden active:scale-95",
                    isLive ? "bg-red-500/20 text-red-500" : "hover:bg-white/5 text-zinc-400"
                  )}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    toggleLive();
                  }}
                >
                  {isLive && (
                    <motion.div 
                      className="absolute bottom-0 left-0 right-0 bg-red-500/30"
                      initial={{ height: 0 }}
                      animate={{ height: `${Math.min(100, micLevel * 500)}%` }}
                      transition={{ type: 'spring', stiffness: 300, damping: 30 }}
                    />
                  )}
                  {isLive ? <Mic className="w-5 h-5 relative z-10" /> : <MicOff className="w-5 h-5 relative z-10" />}
                </button>
              </div>
            </div>
            <button 
              disabled={isProcessing || (!inputText.trim() && selectedImages.length === 0)}
              className="p-3.5 sm:p-4 bg-emerald-500 text-black rounded-2xl hover:bg-emerald-400 disabled:opacity-50 disabled:hover:bg-emerald-500 transition-all shadow-lg shadow-emerald-500/10"
            >
              {isProcessing ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
            </button>
          </form>
        </div>
      </main>

      {/* Camera Modal Controls */}
      <AnimatePresence>
        {showCamera && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[110] bg-black/40 backdrop-blur-sm flex flex-col items-center justify-end p-12"
          >
            <div className="max-w-xl w-full space-y-8 text-center">
              <div className="space-y-2">
                <h3 className="text-2xl font-bold text-white">Capture Your Look</h3>
                <p className="text-zinc-300 text-sm">Alice will analyze this photo to give you personalized advice.</p>
              </div>
              <div className="flex items-center justify-center gap-6">
                <button 
                  onClick={() => stopCamera()}
                  className="px-8 py-4 bg-white/10 text-white rounded-2xl font-bold hover:bg-white/20 transition-all backdrop-blur-md"
                >
                  Cancel
                </button>
                <button 
                  onClick={captureImage}
                  className="px-10 py-4 bg-emerald-500 text-black rounded-2xl font-bold hover:bg-emerald-400 transition-all shadow-xl shadow-emerald-500/20"
                >
                  Capture Look
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Persistent Video Element */}
      <video 
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className={cn(
          "fixed transition-all duration-500 z-[10] object-cover shadow-2xl",
          showCamera 
            ? "inset-0 w-full h-full rounded-none" 
            : (isLive ? "bottom-32 right-6 w-32 h-44 rounded-2xl border-2 border-emerald-500 scale-100 opacity-100" : "bottom-32 right-6 w-32 h-44 rounded-2xl opacity-0 scale-90 pointer-events-none")
        )}
      />

      <AnimatePresence>
        {showClearConfirm && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[60] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
          >
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="max-w-sm w-full bg-zinc-900 border border-white/10 rounded-3xl p-6 space-y-6 shadow-2xl"
            >
              <div className="flex flex-col items-center text-center space-y-4">
                <div className="w-12 h-12 bg-red-500/10 rounded-full flex items-center justify-center">
                  <Trash2 className="w-6 h-6 text-red-500" />
                </div>
                <div className="space-y-2">
                  <h3 className="text-xl font-bold text-white">Clear Chat?</h3>
                  <p className="text-zinc-400 text-sm">This will permanently delete all messages in this conversation. This action cannot be undone.</p>
                </div>
              </div>
              <div className="flex gap-3">
                <button 
                  onClick={() => setShowClearConfirm(false)}
                  className="flex-1 py-3 bg-white/5 text-zinc-400 font-medium rounded-2xl hover:bg-white/10 transition-all"
                >
                  Cancel
                </button>
                <button 
                  onClick={clearChat}
                  className="flex-1 py-3 bg-red-600 text-white font-bold rounded-2xl hover:bg-red-500 transition-all"
                >
                  Clear All
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <canvas ref={canvasRef} className="hidden" />

      <style>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: rgba(255, 255, 255, 0.05);
          border-radius: 10px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: rgba(255, 255, 255, 0.1);
        }
      `}</style>
    </div>
    </ErrorBoundary>
  );
}

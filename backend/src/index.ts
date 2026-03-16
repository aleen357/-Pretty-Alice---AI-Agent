import http from 'http';
import express from 'express';
import cors from 'cors';
import { adviceRouter } from './routes/advice.js';
import { imagesRouter } from './routes/images.js';
import { videoRouter } from './routes/video.js';
import { speechRouter } from './routes/speech.js';
import { storesRouter } from './routes/stores.js';
import { liveRouter, attachLiveWss } from './routes/live.js';

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors({ origin: process.env.FRONTEND_URL || 'http://localhost:3000' }));
app.use(express.json({ limit: '20mb' }));

app.use('/api/advice', adviceRouter);
app.use('/api/images', imagesRouter);
app.use('/api/video', videoRouter);
app.use('/api/speech', speechRouter);
app.use('/api/stores', storesRouter);
app.use('/api/live', liveRouter);

app.get('/health', (_req, res) => res.json({ status: 'ok' }));

const server = http.createServer(app);
attachLiveWss(server); // WebSocket at ws://localhost:4000/api/live/ws

server.listen(PORT, () => console.log(`Backend running on http://localhost:${PORT}`));

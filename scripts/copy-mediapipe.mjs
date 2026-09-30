// Copies the MediaPipe WASM runtime into public/ so face detection works offline
// and on GitHub Pages without depending on a CDN.
import { cpSync, mkdirSync } from 'node:fs';

const src = 'node_modules/@mediapipe/tasks-vision/wasm';
const dest = 'public/mediapipe';
mkdirSync(dest, { recursive: true });
cpSync(src, dest, { recursive: true });
console.log(`copied ${src} -> ${dest}`);

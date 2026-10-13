// Renders every pose to an SVG contact sheet: node scripts/preview-sprite.mjs out.svg
import {writeFileSync} from 'node:fs';
import {spritePixels, W, H, POSE_LABEL} from '../extension/homeview@local/sprite.js';

const out = process.argv[2] || 'sprite-preview.svg';
const S = 8, PAD = 10, COLS = 5;
const base = {eye: 0.9, px: 0, py: 0, mouth: 0.1, mouth_open: 0, blush: 0, breathe: 0.2, hue: 28, playing: false, llm: false, offline: false};
const variants = [
    ...Object.keys(POSE_LABEL).map(p => ({label: p, f: {...base, pose: p}, t: 0.3})),
    {label: 'work + music', f: {...base, pose: 'work', playing: true, hue: 200, mouth: 0.6}, t: 0.3},
    {label: 'idle + music', f: {...base, pose: 'idle', playing: true, hue: 300, mouth: 0.6}, t: 0.9},
    {label: 'sleep t+1', f: {...base, pose: 'sleep'}, t: 1.2},
    {label: 'blink', f: {...base, pose: 'idle', eye: 0.05}, t: 0.3},
    {label: 'offline', f: {...base, pose: 'sleep', offline: true}, t: 0.3},
    {label: 'work t+0.5', f: {...base, pose: 'work'}, t: 0.55},
];
const cw = W * S + PAD * 2, ch = H * S + PAD * 2 + 16;
const rows = Math.ceil(variants.length / COLS);
let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${COLS * cw}" height="${rows * ch}"><rect width="100%" height="100%" fill="#1f2128"/>`;
variants.forEach((v, i) => {
    const ox = (i % COLS) * cw + PAD, oy = Math.floor(i / COLS) * ch + PAD;
    svg += `<rect x="${ox}" y="${oy}" width="${W * S}" height="${H * S}" fill="#2a2d36"/>`;
    for (const [x, y, c, a] of spritePixels(v.f, v.t)) {
        const col = c.map(n => Math.round(n * 255)).join(',');
        svg += `<rect x="${ox + x * S}" y="${oy + y * S}" width="${S}" height="${S}" fill="rgb(${col})" fill-opacity="${a}"/>`;
    }
    svg += `<text x="${ox}" y="${oy + H * S + 13}" fill="#ccc" font-family="sans-serif" font-size="12">${v.label}</text>`;
});
writeFileSync(out, svg + '</svg>');
console.log('wrote', out);

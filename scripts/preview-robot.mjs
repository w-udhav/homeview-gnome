// Renders every robot expression to an SVG contact sheet:
//   node scripts/preview-robot.mjs out.svg
// A tiny recorder stands in for the cairo context GNOME Shell provides.
import {writeFileSync} from 'node:fs';
import {drawMascot, POSE_LABEL} from '../extension/homeview@local/robot.js';

class SvgCtx {
    constructor() { this.out = []; this.rgba = [0, 0, 0, 1]; this.lw = 1; this.d = ''; this.cap = 'butt'; this.tx = 0; this.ty = 0; this.stack = []; }
    save() { this.stack.push([this.tx, this.ty]); }
    restore() { [this.tx, this.ty] = this.stack.pop(); }
    translate(x, y) { this.tx += x; this.ty += y; }
    setSourceRGBA(r, g, b, a) { this.rgba = [r, g, b, a]; }
    setLineWidth(w) { this.lw = w; }
    setLineCap(c) { this.cap = c === 1 ? 'round' : 'butt'; }
    newPath() { this.d = ''; }
    closePath() { this.d += 'Z '; }
    moveTo(x, y) { this.d += `M${(x + this.tx).toFixed(2)} ${(y + this.ty).toFixed(2)} `; }
    lineTo(x, y) { this.d += `L${(x + this.tx).toFixed(2)} ${(y + this.ty).toFixed(2)} `; }
    curveTo(a, b, c, d, e, f) { this.d += `C${[a + this.tx, b + this.ty, c + this.tx, d + this.ty, e + this.tx, f + this.ty].map(n => n.toFixed(2)).join(' ')} `; }
    fill() { this.out.push(`<path d="${this.d}" fill="${this.c()}" fill-opacity="${this.rgba[3]}"/>`); }
    stroke() {
        this.out.push(`<path d="${this.d}" fill="none" stroke="${this.c()}" stroke-opacity="${this.rgba[3]}" stroke-width="${this.lw}" stroke-linecap="${this.cap}" stroke-linejoin="round"/>`);
    }
    c() { return `rgb(${this.rgba.slice(0, 3).map(n => Math.round(n * 255)).join(',')})`; }
}

const out = process.argv[2] || 'robot-preview.svg';
const base = {eye: 0.95, px: 0, py: 0, brow: 0, mouth: 0.1, mouth_open: 0, blush: 0, breathe: 0.2, tilt: 0, hue: 195, playing: false, llm: false, offline: false};
const poses = Object.keys(POSE_LABEL);
const variants = [
    ...poses.map(p => ({label: p, f: {...base, pose: p}, t: 0.4})),
    {label: 'idle + music', f: {...base, pose: 'idle', playing: true, hue: 145, mouth: 0.7}, t: 0.4},
    {label: 'work + music', f: {...base, pose: 'work', playing: true, hue: 300}, t: 0.4},
    {label: 'offline', f: {...base, pose: 'sleep', offline: true}, t: 0.4},
];

let svg = '';
const place = (cell, x, y, w, h, scale) => {
    const ctx = new SvgCtx();
    drawMascot(ctx, w, h, cell.f, cell.t, {mode: h >= 44 ? 'full' : 'head'});
    svg += `<g transform="translate(${x} ${y}) scale(${scale})">${ctx.out.join('')}</g>`;
};
const COLS = 3, CW = 340, CH = 190;
variants.forEach((v, i) => {
    const x = (i % COLS) * CW + 12, y = Math.floor(i / COLS) * (CH + 20) + 12;
    place(v, x, y, 312, 150, 1);               // hover-card size
    place(v, x + 130, y + 160, 48, 28, 1);     // panel size, 1x
    place(v, x + 190, y + 160, 48, 28, 1);
    svg += `<text x="${x}" y="${y + 190}" fill="#ccc" font-family="sans-serif" font-size="13">${v.label}</text>`;
});
const rows = Math.ceil(variants.length / COLS);
writeFileSync(out, `<svg xmlns="http://www.w3.org/2000/svg" width="${COLS * CW + 12}" height="${rows * (CH + 20) + 12}"><rect width="100%" height="100%" fill="#e9e9ee"/>${svg}</svg>`);
console.log('wrote', out);

// Pixel-art creature. Pure: (frame, time) -> list of coloured pixels.
// No GNOME imports so it can be rendered offline (see scripts/preview-sprite.mjs).
//
// Canvas is 24x14 cells; the creature occupies a 16x14 block at x=4 so props
// (laptop, headphones, notes, zzz) can sit beside it.

export const W = 24;
export const H = 14;
const OX = 4;

// The creature: O outline, B body, L belly.
const BASE = [
    '...OO......OO...',
    '..OBBO....OBBO..',
    '..OBBBOOOOBBBO..',
    '.OBBBBBBBBBBBBO.',
    'OBBBBBBBBBBBBBBO',
    'OBBBBBBBBBBBBBBO',
    'OBBBBBBBBBBBBBBO',
    'OBBBBBBBBBBBBBBO',
    'OBBLLLLLLLLLLBBO',
    '.OBLLLLLLLLLLBO.',
    '.OBBLLLLLLLLBBO.',
    '..OBBBBBBBBBBO..',
    '..OOBBO..OBBOO..',
    '...OOOO..OOOO...',
];

export function hsl(h, s, l) {
    h = ((h % 360) + 360) % 360 / 360;
    if (s === 0)
        return [l, l, l];
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    const f = t => {
        if (t < 0) t += 1;
        if (t > 1) t -= 1;
        if (t < 1 / 6) return p + (q - p) * 6 * t;
        if (t < 1 / 2) return q;
        if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
        return p;
    };
    return [f(h + 1 / 3), f(h), f(h - 1 / 3)];
}

const rgb = (r, g, b) => [r / 255, g / 255, b / 255];
const WHITE = [1, 1, 1];
const PINK = rgb(255, 138, 165);
const GREY = rgb(154, 163, 173);
const DGREY = rgb(107, 116, 128);
const ZZZ = rgb(156, 201, 255);
const RED = rgb(229, 72, 77);
const CREAM = rgb(255, 233, 168);
const BOOK = rgb(244, 239, 230);
const COVER = rgb(139, 90, 60);
const PHONE = rgb(43, 47, 58);
const SCREEN = rgb(120, 190, 255);
const CONFETTI = [rgb(255, 93, 115), rgb(255, 205, 77), rgb(94, 214, 160), rgb(120, 170, 255)];

export const OFFLINE_FRAME = {
    eye: 0, px: 0, py: 0, mouth: 0, mouth_open: 0, blush: 0, breathe: 0,
    hue: 28, playing: false, llm: false, pose: 'sleep', offline: true,
};

export const POSE_LABEL = {
    idle: 'Hanging out',
    work: 'Typing away',
    think: 'Waiting on the AI',
    watch: 'Watching something',
    read: 'Reading',
    social: 'Scrolling',
    sideeye: 'Distracted?',
    sleep: 'Napping',
    cheer: 'Nice, it is done!',
    wave: 'Welcome back!',
};

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/**
 * Returns [x, y, [r,g,b], alpha][] in canvas cells (0..W-1, 0..H-1).
 * `t` is seconds (any monotonic clock).
 */
export function spritePixels(f, t) {
    const out = [];
    const put = (x, y, c, a = 1) => {
        if (x >= 0 && x < W && y >= 0 && y < H)
            out.push([x, y, c, a]);
    };
    const pose = f.pose || 'idle';

    // Palette from the current track's hue; warm orange otherwise.
    const hue = f.playing ? f.hue : 28;
    let B = hsl(hue, 0.7, 0.68);
    let L = hsl(hue, 0.55, 0.88);
    let O = hsl(hue, 0.45, 0.17);
    if (f.offline) {
        B = [0.62, 0.62, 0.64];
        L = [0.8, 0.8, 0.82];
        O = [0.2, 0.2, 0.22];
    }
    const accent = hsl(hue + 170, 0.75, 0.55);

    const beat = Math.floor(t * 2.5) % 4;     // sway/music beat
    const flip = Math.floor(t * 3) % 2;       // slow animation toggle
    const fast = Math.floor(t * 8) % 2;       // typing
    const bob = f.breathe > 0.5 ? 0 : 1;

    // Whole-body offset per pose.
    let dx = 0;
    let dy = bob;
    if (pose === 'sleep')
        dy = 1 + (f.breathe > 0.5 ? 0 : 0);
    if (pose === 'cheer')
        dy = -((Math.floor(t * 5) % 2) * 2);
    if (f.playing && pose !== 'sleep' && pose !== 'cheer')
        dx = [0, 1, 0, -1][beat];

    // --- things behind the body ------------------------------------------
    if (pose === 'cheer') {
        for (let i = 0; i < 9; i++) {
            const x = (i * 5 + 2) % W;
            const y = (Math.floor(t * 6) + i * 3) % H;
            put(x, y, CONFETTI[i % 4]);
        }
    }
    if (f.playing) {
        // Headphone band (drawn first; the head covers the middle).
        for (let y = 2; y <= 5; y++) {
            put(OX - 1 + dx, y + dy, accent);
            put(OX + 16 + dx, y + dy, accent);
        }
        for (let x = OX - 1; x <= OX + 16; x++)
            put(x + dx, 1 + dy, accent);
    }

    // --- body ---------------------------------------------------------------
    for (let y = 0; y < BASE.length; y++) {
        for (let x = 0; x < 16; x++) {
            const ch = BASE[y][x];
            if (ch === '.')
                continue;
            put(OX + x + dx, y + dy, ch === 'O' ? O : ch === 'B' ? B : L);
        }
    }
    const px = (x, y, c, a) => put(OX + x + dx, y + dy, c, a); // creature coords

    // --- eyes -----------------------------------------------------------
    let lookX = clamp(Math.round(f.px), -1, 1);
    let lookY = f.py > 0.5 ? 1 : f.py < -0.5 ? -1 : 0;
    if (pose === 'think') { lookX = 1; lookY = -1; }
    if (pose === 'watch') { lookX = 0; lookY = -1; }
    if (pose === 'read' || pose === 'social') { lookX = 0; lookY = 1; }
    if (pose === 'sideeye') { lookX = -1; lookY = 0; }

    const closed = pose === 'sleep' || f.eye < 0.25;
    const narrow = !closed && (f.eye < 0.6 || pose === 'sideeye');
    for (const cx of [4, 10]) {
        if (pose === 'cheer') {
            // happy ^ ^
            px(cx - 1, 6, O); px(cx, 5, O); px(cx + 1, 6, O);
        } else if (closed) {
            px(cx, 6, O); px(cx + 1, 6, O);
        } else if (narrow) {
            px(cx + lookX, 6, O); px(cx + 1 + lookX, 6, O);
            px(cx + lookX, 5, B); px(cx + 1 + lookX, 5, B);
        } else {
            const ex = cx + lookX;
            const ey = 5 + lookY;
            px(ex, ey, WHITE); px(ex + 1, ey, O);
            px(ex, ey + 1, O); px(ex + 1, ey + 1, O);
        }
        if (pose === 'sideeye') { px(cx, 4, O); px(cx + 1, 4, O); }
    }

    // --- cheeks and mouth -----------------------------------------------
    const happy = pose === 'cheer' || pose === 'wave' || f.mouth > 0.45;
    if (f.blush > 0.1 || happy) {
        px(2, 7, PINK); px(3, 7, PINK); px(12, 7, PINK); px(13, 7, PINK);
    }
    if (pose !== 'sleep') {
        if (pose === 'cheer' || f.mouth_open > 0.05) {
            px(7, 7, O); px(8, 7, O); px(7, 8, O); px(8, 8, O);
        } else if (happy) {
            px(6, 7, O); px(9, 7, O); px(7, 8, O); px(8, 8, O);
        } else if (f.mouth < -0.1) {
            px(6, 8, O); px(9, 8, O); px(7, 7, O); px(8, 7, O);
        } else {
            px(7, 7, O); px(8, 7, O);
        }
    }

    // --- pose props -------------------------------------------------------
    const laptop = rate => {
        const k = Math.floor(t * rate) % 2;
        for (let y = 9; y <= 11; y++)
            for (let x = 6; x <= 17; x++) put(x, y + dy, GREY);
        for (let x = 5; x <= 18; x++) put(x, 12 + dy, DGREY);
        put(11, 10 + dy, WHITE); put(12, 10 + dy, WHITE);
        put(5, 10 + k + dy, B); put(18, 11 - k + dy, B);
    };

    if (pose === 'work') {
        laptop(4);
    } else if (pose === 'think') {
        laptop(8);
        const phase = Math.floor(t * 3) % 3;
        [[20, 6], [21, 4], [22, 2]].forEach(([x, y], i) => put(x, y, WHITE, i === phase ? 1 : 0.35));
    } else if (pose === 'watch') {
        for (let y = 10; y <= 13; y++)
            for (let x = 9; x <= 14; x++) put(x, y + dy, x % 2 ? RED : WHITE);
        for (let x = 9; x <= 14; x++) put(x, 9 + dy, CREAM);
        const k = Math.floor(t * 3) % 3;
        put(10 + k * 2, 8 + dy - (Math.floor(t * 6) % 2), CREAM);
    } else if (pose === 'read') {
        for (let y = 9; y <= 12; y++) {
            for (let x = 6; x <= 17; x++) put(x, y + dy, x === 11 || x === 12 ? GREY : BOOK);
        }
        for (let x = 5; x <= 18; x++) put(x, 13, COVER);
        for (const [x0, ln] of [[7, 10], [13, 10], [7, 12], [13, 12]]) {
            for (let x = x0; x < x0 + 3; x++) put(x, ln + dy, DGREY, 0.8);
        }
        if (flip) put(17, 9 + dy, GREY);
    } else if (pose === 'social') {
        for (let y = 9; y <= 13; y++)
            for (let x = 13; x <= 15; x++) put(x, y + dy, PHONE);
        const s = Math.floor(t * 5) % 3;
        for (let y = 10; y <= 12; y++) put(14, y + dy, (y - 10 + s) % 3 === 0 ? SCREEN : PHONE);
        put(13, 10 + dy, SCREEN, 0.5);
        put(16, 11 + (Math.floor(t * 4) % 2) + dy, B);
    } else if (pose === 'sideeye') {
        // sweat drop
        put(20, 6 + dy, rgb(120, 190, 255)); put(20, 7 + dy, rgb(120, 190, 255));
    } else if (pose === 'sleep') {
        const ph = Math.floor(t * 1.5) % 3;
        // 3x4 "Z": ### / ..# / .#. / ###
        const z = (x, y, a) => {
            for (const dxx of [0, 1, 2]) { put(x + dxx, y, ZZZ, a); put(x + dxx, y + 3, ZZZ, a); }
            put(x + 2, y + 1, ZZZ, a);
            put(x + 1, y + 2, ZZZ, a);
        };
        if (ph <= 1) z(20, 7, 1);
        if (ph >= 1) z(21, 2, ph === 2 ? 0.6 : 1);
    } else if (pose === 'cheer') {
        const up = Math.floor(t * 5) % 2;
        for (const [x, ox] of [[3, 2], [20, 21]]) {
            put(x, 6 - up + dy, B); put(x, 5 - up + dy, B); put(x, 4 - up + dy, B);
            put(ox, 5 - up + dy, O); put(ox, 4 - up + dy, O);
        }
    } else if (pose === 'wave') {
        const k = Math.floor(t * 5) % 2;
        put(20, 7 + dy, B); put(20, 6 + dy, B); put(20 + k, 5 + dy, B);
        put(21, 7 + dy, O); put(21, 6 + dy, O);
    }

    // --- music overlay ------------------------------------------------------
    if (f.playing && pose !== 'sleep') {
        // ear cups
        for (let y = 4; y <= 8; y++) {
            put(OX - 2 + dx, y + dy, accent);
            put(OX - 1 + dx, y + dy, accent);
            put(OX + 16 + dx, y + dy, accent);
            put(OX + 17 + dx, y + dy, accent);
        }
        // floating notes
        const note = (x, y0, phase) => {
            const y = 9 - ((Math.floor(t * 2.5) + phase) % 6) * 1;
            const a = clamp((y - 1) / 6, 0.3, 1);
            put(x + 1, y, WHITE, a); put(x + 1, y + 1, WHITE, a);
            put(x, y + 2, WHITE, a); put(x + 1, y + 2, WHITE, a);
        };
        note(0, 0, 0);
        note(22, 0, 3);
    }

    return out;
}

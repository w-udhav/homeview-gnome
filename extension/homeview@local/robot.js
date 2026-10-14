// Expressive eyes: drawScreen() draws eyes (and glyphs) with an optional dark
// screen behind them; drawEyes() is the bare version used on the panel. Pure
// drawing against a cairo-like context so scripts/preview-robot.mjs can render
// it offline.
//
// Context calls used: save restore translate setSourceRGBA setLineWidth
// setLineCap newPath closePath moveTo lineTo curveTo arc fill stroke.

export const OFFLINE_FRAME = {
    eye: 0, px: 0, py: 0, brow: 0, mouth: 0, mouth_open: 0, blush: 0, breathe: 0,
    tilt: 0, hue: 195, playing: false, llm: false, pose: 'sleep', offline: true,
};

export const POSE_LABEL = {
    idle: 'Hanging out',
    work: 'Heads down',
    think: 'Waiting on the AI',
    watch: 'Watching something',
    read: 'Reading',
    social: 'Scrolling',
    sideeye: 'Distracted?',
    sleep: 'Napping',
    cheer: 'All done!',
    wave: 'Welcome back',
};

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

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const K = 0.5523;

function col(cr, c, a = 1) {
    cr.setSourceRGBA(c[0], c[1], c[2], a);
}

function roundRect(cr, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    cr.newPath();
    cr.moveTo(x + r, y);
    cr.lineTo(x + w - r, y);
    cr.curveTo(x + w - r + r * K, y, x + w, y + r - r * K, x + w, y + r);
    cr.lineTo(x + w, y + h - r);
    cr.curveTo(x + w, y + h - r + r * K, x + w - r + r * K, y + h, x + w - r, y + h);
    cr.lineTo(x + r, y + h);
    cr.curveTo(x + r - r * K, y + h, x, y + h - r + r * K, x, y + h - r);
    cr.lineTo(x, y + r);
    cr.curveTo(x, y + r - r * K, x + r - r * K, y, x + r, y);
    cr.closePath();
}

function ellipse(cr, cx, cy, rx, ry) {
    if (rx <= 0 || ry <= 0)
        return;
    cr.newPath();
    cr.moveTo(cx + rx, cy);
    cr.curveTo(cx + rx, cy + ry * K, cx + rx * K, cy + ry, cx, cy + ry);
    cr.curveTo(cx - rx * K, cy + ry, cx - rx, cy + ry * K, cx - rx, cy);
    cr.curveTo(cx - rx, cy - ry * K, cx - rx * K, cy - ry, cx, cy - ry);
    cr.curveTo(cx + rx * K, cy - ry, cx + rx, cy - ry * K, cx + rx, cy);
    cr.closePath();
}

// A squircle (superellipse, |x/rx|^n + |y/ry|^n = 1): rounder than a rounded
// rectangle, squarer than an oval. n = 4 is the classic squircle.
function squircle(cr, cx, cy, rx, ry, n = 4) {
    if (rx <= 0 || ry <= 0)
        return;
    const steps = 48;
    cr.newPath();
    for (let i = 0; i < steps; i++) {
        const t = (i / steps) * 2 * Math.PI;
        const c = Math.cos(t), s = Math.sin(t);
        const x = cx + rx * Math.sign(c) * Math.pow(Math.abs(c), 2 / n);
        const y = cy + ry * Math.sign(s) * Math.pow(Math.abs(s), 2 / n);
        if (i === 0) cr.moveTo(x, y);
        else cr.lineTo(x, y);
    }
    cr.closePath();
}

// Soft glow: a couple of wider, fainter copies under the solid shape.
function glowEye(cr, cx, cy, rx, ry, c, a = 1) {
    for (const [s, al] of [[1.45, 0.07], [1.22, 0.12]]) {
        col(cr, c, al * a);
        squircle(cr, cx, cy, rx * s, ry * s);
        cr.fill();
    }
    col(cr, c, a);
    squircle(cr, cx, cy, rx, ry);
    cr.fill();
}

function archEye(cr, cx, cy, rx, ry, width, c, down = false) {
    // "∩" happy eye, or "∪" sleepy eye.
    const d = down ? 1 : -1;
    for (const [w, al] of [[width * 2.1, 0.1], [width * 1.5, 0.16], [width, 1]]) {
        col(cr, c, al);
        cr.setLineWidth(w);
        cr.newPath();
        cr.moveTo(cx - rx, cy);
        cr.curveTo(cx - rx, cy + d * ry * 1.33, cx + rx, cy + d * ry * 1.33, cx + rx, cy);
        cr.stroke();
    }
}

function star(cr, cx, cy, r, c, a = 1) {
    if (r <= 0)
        return;
    const q = r * 0.16;
    col(cr, c, a);
    cr.newPath();
    cr.moveTo(cx, cy - r);
    cr.curveTo(cx + q, cy - q, cx + q, cy - q, cx + r, cy);
    cr.curveTo(cx + q, cy + q, cx + q, cy + q, cx, cy + r);
    cr.curveTo(cx - q, cy + q, cx - q, cy + q, cx - r, cy);
    cr.curveTo(cx - q, cy - q, cx - q, cy - q, cx, cy - r);
    cr.closePath();
    cr.fill();
}

function drop(cr, x, y, r, c, a = 1) {
    col(cr, c, a);
    cr.newPath();
    cr.moveTo(x, y - r * 1.5);
    cr.curveTo(x + r * 1.1, y - r * 0.3, x + r, y + r, x, y + r);
    cr.curveTo(x - r, y + r, x - r * 1.1, y - r * 0.3, x, y - r * 1.5);
    cr.closePath();
    cr.fill();
}

function zee(cr, x, y, s, c, a) {
    col(cr, c, a);
    cr.setLineWidth(Math.max(1, s * 0.22));
    cr.setLineCap(1);
    cr.newPath();
    cr.moveTo(x, y);
    cr.lineTo(x + s, y);
    cr.lineTo(x, y + s);
    cr.lineTo(x + s, y + s);
    cr.stroke();
}

function note(cr, x, y, s, c, a) {
    col(cr, c, a);
    cr.setLineWidth(Math.max(1, s * 0.16));
    cr.setLineCap(1);
    cr.newPath();
    cr.moveTo(x + s * 0.55, y + s * 0.9);
    cr.lineTo(x + s * 0.55, y);
    cr.curveTo(x + s * 0.55, y + s * 0.3, x + s * 1.0, y + s * 0.3, x + s * 1.0, y + s * 0.7);
    cr.stroke();
    ellipse(cr, x + s * 0.32, y + s * 0.92, s * 0.26, s * 0.2);
    cr.fill();
}

/**
 * Draw the robot's screen into a w x h area.
 * `t` is seconds on any monotonic clock. `scene` adds the glass rim and
 * larger glyphs (used in the hover card).
 */
export function drawScreen(cr, w, h, f, t, {scene = false, radius = null, bare = false} = {}) {
    const pose = f.pose || 'idle';
    const u = h;
    const big = h >= 44;
    const sway = f.playing ? Math.sin(t * 3.2) : 0;

    // --- screen (skipped in bare mode: just eyes on the panel) -----------
    const tint = f.playing ? hsl(f.hue, 0.65, 0.6) : [1, 1, 1];
    const rad = radius === null ? Math.min(u * 0.42, w / 2) : radius;
    if (!bare) {
        col(cr, [0.015, 0.015, 0.02], 1);
        roundRect(cr, 0.5, 0.5, w - 1, h - 1, rad);
        cr.fill();
        col(cr, tint, f.playing ? 0.55 : 0.16);
        cr.setLineWidth(scene ? 1.6 : 1);
        roundRect(cr, 0.5, 0.5, w - 1, h - 1, rad);
        cr.stroke();
    }

    // --- eye colours ------------------------------------------------------
    const eyeC = f.offline ? [0.45, 0.47, 0.5] : f.playing ? hsl(f.hue, 0.8, 0.7) : hsl(201, 0.72, 0.64);
    const gold = [1, 0.82, 0.3];

    // --- layout -----------------------------------------------------------
    const sep = Math.min(w * 0.2, u * 0.46);
    const cy = h * 0.46;
    const rx = u * 0.15 + (scene ? u * 0.01 : 0);
    const ryBase = u * 0.2;

    let gx = clamp(f.px, -1, 1);
    let gy = clamp(f.py, -1, 1);
    let open = clamp(f.eye, 0, 1.05);
    let squint = 1;
    switch (pose) {
    case 'think': gx = 0.9; gy = -0.8; break;
    case 'watch': gx = 0; gy = -0.35; open = Math.max(open, 0.95); break;
    case 'read': gx = 0.15; gy = 0.85; squint = 0.8; break;
    case 'social': gx = 0.5; gy = 0.8; break;
    case 'work': gy = Math.max(gy, 0.1); squint = 0.72; break;
    case 'sideeye': gx = -1; gy = 0.05; squint = 0.55; break;
    default: break;
    }
    const lookX = gx * u * 0.07 + sway * u * 0.03;
    const lookY = gy * u * 0.05;

    const closed = pose === 'sleep' || f.offline;
    const happy = pose === 'cheer' || pose === 'wave' || (pose === 'idle' && f.playing);
    const ew = rx;

    for (const side of [-1, 1]) {
        const ex = w / 2 + side * sep + lookX;
        const ey = cy + lookY;
        if (closed) {
            archEye(cr, ex, ey + u * 0.04, ew * 0.9, u * 0.08, u * 0.06, eyeC, true);
        } else if (happy) {
            archEye(cr, ex, ey + u * 0.08, ew * 0.9, u * 0.12, u * 0.07, eyeC, false);
        } else {
            const ry = Math.max(u * 0.02, ryBase * open * squint);
            glowEye(cr, ex, ey, ew, ry, eyeC);
            if (ry > u * 0.1) {
                col(cr, [1, 1, 1], 0.75);
                ellipse(cr, ex - ew * 0.3, ey - ry * 0.38, ew * 0.2, ry * 0.16);
                cr.fill();
            }
        }
    }

    // --- cheeks & mouth -----------------------------------------------------
    const coral = [1, 0.47, 0.42];
    const blushC = [1, 0.5, 0.6];
    if ((f.blush > 0.1 || happy) && !closed) {
        for (const side of [-1, 1]) {
            col(cr, blushC, 0.38);
            ellipse(cr, w / 2 + side * (sep + ew * 1.25), h * 0.66, u * 0.07, u * 0.045);
            cr.fill();
        }
    }
    if (!closed) {
        const my = h * 0.72;
        const mw = u * 0.075;
        col(cr, coral, 1);
        if (pose === 'cheer' || f.mouth_open > 0.05) {
            const oh = u * (0.05 + 0.08 * Math.max(f.mouth_open, pose === 'cheer' ? 0.6 : 0));
            cr.newPath();
            cr.moveTo(w / 2 - mw, my - oh * 0.4);
            cr.curveTo(w / 2 - mw, my + oh * 1.4, w / 2 + mw, my + oh * 1.4, w / 2 + mw, my - oh * 0.4);
            cr.closePath();
            cr.fill();
        } else {
            const smile = pose === 'sideeye' ? -0.1 : pose === 'work' ? 0.05 : clamp(f.mouth, -0.6, 1) * 0.6 + 0.35;
            cr.setLineWidth(Math.max(1, u * 0.05));
            cr.setLineCap(1);
            cr.newPath();
            cr.moveTo(w / 2 - mw, my);
            cr.curveTo(w / 2 - mw * 0.4, my + smile * u * 0.16, w / 2 + mw * 0.4, my + smile * u * 0.16, w / 2 + mw, my);
            cr.stroke();
        }
    }

    // --- glyphs ---------------------------------------------------------------
    const gs = big ? u * 0.13 : u * 0.2;      // glyph size
    const rightX = w - gs * 1.6 - u * 0.1;
    const tw = (p, s = 1) => 0.5 + 0.5 * Math.sin(t * 6 * s + p);

    if (happy) {
        const a1 = 0.45 + 0.55 * tw(0), a2 = 0.45 + 0.55 * tw(2.1);
        star(cr, w / 2 - sep - ew * 1.9, h * 0.2, gs * (0.55 + 0.45 * a1), gold, a1);
        star(cr, w / 2 + sep + ew * 1.9, h * 0.8, gs * (0.55 + 0.45 * a2), gold, a2);
    }
    if (pose === 'think') {
        for (let i = 0; i < 3; i++) {
            const ph = (Math.floor(t * 3) % 3) === i ? 1 : 0.3;
            col(cr, [1, 1, 1], ph);
            ellipse(cr, rightX + i * gs * 0.55 - gs * 0.4, h * 0.2, gs * 0.2, gs * 0.2);
            cr.fill();
        }
    } else if (pose === 'sleep' && !f.offline) {
        const k = (t * 0.7) % 1;
        zee(cr, w - gs * 2.6, h * (0.42 - 0.2 * k), gs * (0.7 + 0.5 * k), eyeC, 1 - k * 0.8);
        const k2 = (t * 0.7 + 0.5) % 1;
        zee(cr, w - gs * 1.5, h * (0.3 - 0.15 * k2), gs * (0.5 + 0.4 * k2), eyeC, 1 - k2 * 0.8);
    } else if (pose === 'sideeye') {
        drop(cr, w - gs * 1.3, h * 0.3 + (t * 2 % 1) * u * 0.06, gs * 0.45, [0.5, 0.78, 1], 0.9);
    } else if (pose === 'watch' && big) {
        col(cr, [1, 1, 1], 0.85);
        cr.newPath();
        cr.moveTo(rightX, h * 0.14);
        cr.lineTo(rightX + gs * 0.9, h * 0.14 + gs * 0.5);
        cr.lineTo(rightX, h * 0.14 + gs);
        cr.closePath();
        cr.fill();
    } else if (pose === 'work' && big) {
        // </> glyph
        col(cr, eyeC, 0.9);
        cr.setLineWidth(Math.max(1.2, u * 0.03));
        cr.setLineCap(1);
        const x0 = rightX - gs * 0.3, y0 = h * 0.14;
        cr.newPath();
        cr.moveTo(x0 + gs * 0.5, y0); cr.lineTo(x0, y0 + gs * 0.5); cr.lineTo(x0 + gs * 0.5, y0 + gs);
        cr.stroke();
        cr.newPath();
        cr.moveTo(x0 + gs * 1.0, y0); cr.lineTo(x0 + gs * 1.5, y0 + gs * 0.5); cr.lineTo(x0 + gs * 1.0, y0 + gs);
        cr.stroke();
    }
    if (f.playing && pose !== 'sleep') {
        const k = (t * 0.6) % 1;
        note(cr, gs * 0.7 + sway * 2, h * (0.62 - 0.4 * k), gs * (big ? 1.1 : 1.3), tint, 1 - k * 0.85);
    }
}


// ---------------------------------------------------------------------------
// The panel face: the dark screen with its eyes, mouth and glyphs, and nothing
// else (no white head shell, no ear pods).
// ---------------------------------------------------------------------------
export function drawFaceScreen(cr, w, h, f, t) {
    drawScreen(cr, w, h, f, t, {});
}

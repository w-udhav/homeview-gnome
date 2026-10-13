// A little round white robot with a black screen face, big blue eyes and a
// teal accent. drawScreen() is the expressive face; drawMascot() adds the head
// shell, body, arms and props. Pure drawing against a cairo-like context, so
// scripts/preview-robot.mjs can render it offline.
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

// Soft glow: a couple of wider, fainter copies under the solid shape.
function glowEllipse(cr, cx, cy, rx, ry, c, a = 1) {
    for (const [s, al] of [[1.45, 0.07], [1.22, 0.12]]) {
        col(cr, c, al * a);
        ellipse(cr, cx, cy, rx * s, ry * s);
        cr.fill();
    }
    col(cr, c, a);
    ellipse(cr, cx, cy, rx, ry);
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
export function drawScreen(cr, w, h, f, t, {scene = false, radius = null} = {}) {
    const pose = f.pose || 'idle';
    const u = h;
    const big = h >= 44;
    const sway = f.playing ? Math.sin(t * 3.2) : 0;

    // --- screen ---------------------------------------------------------
    const tint = f.playing ? hsl(f.hue, 0.65, 0.6) : [1, 1, 1];
    const rad = radius === null ? Math.min(u * 0.42, w / 2) : radius;
    col(cr, [0.015, 0.015, 0.02], 1);
    roundRect(cr, 0.5, 0.5, w - 1, h - 1, rad);
    cr.fill();
    // glass rim
    col(cr, tint, f.playing ? 0.55 : 0.16);
    cr.setLineWidth(scene ? 1.6 : 1);
    roundRect(cr, 0.5, 0.5, w - 1, h - 1, rad);
    cr.stroke();
    if (scene) {
        col(cr, [1, 1, 1], 0.04);
        roundRect(cr, 3, 3, w - 6, h * 0.42, rad * 0.8);
        cr.fill();
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
            glowEllipse(cr, ex, ey, ew, ry, eyeC);
            if (ry > u * 0.1) {
                col(cr, [1, 1, 1], 0.75);
                ellipse(cr, ex - ew * 0.3, ey - ry * 0.38, ew * 0.2, ry * 0.16);
                cr.fill();
            }
        }
    }

    // Eyes carry all the expression: no mouth, no cheeks.

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
// The mascot is just the face: a white shell around the screen, with ear pods
// and (while music plays) headphones. Eyes carry all the expression.
// ---------------------------------------------------------------------------

const WHITE = [0.965, 0.972, 0.985];
const SHADE = [0.72, 0.77, 0.84];

function shaded(cr, drawPath, dy = 3) {
    // a white shape with a soft darker edge peeking out below
    cr.save();
    cr.translate(0, dy);
    col(cr, SHADE, 1);
    drawPath();
    cr.fill();
    cr.restore();
    col(cr, WHITE, 1);
    drawPath();
    cr.fill();
}

/**
 * mode 'head': the small panel icon. mode 'full': the large face on a dark
 * tile for the hover card.
 */
export function drawMascot(cr, w, h, f, t, {mode = 'head'} = {}) {
    const teal = f.offline ? [0.6, 0.62, 0.65] : f.playing ? hsl(f.hue, 0.5, 0.7) : [0.5, 0.85, 0.82];

    if (mode === 'head') {
        const r = h * 0.46;
        shaded(cr, () => roundRect(cr, 0.5, 0.5, w - 1, h - 2, r), 1.5);
        cr.save();
        cr.translate(2.5, 2.5);
        drawScreen(cr, w - 5, h - 7, f, t, {radius: (h - 7) * 0.42});
        cr.restore();
        if (f.playing && !f.offline) {
            col(cr, teal, 1);
            ellipse(cr, 1.5, h * 0.5, 2, h * 0.2); cr.fill();
            ellipse(cr, w - 1.5, h * 0.5, 2, h * 0.2); cr.fill();
        }
        return;
    }

    // --- hover-card hero --------------------------------------------------
    const pose = f.pose || 'idle';
    const cx = w / 2;
    const sway = f.playing ? Math.sin(t * 3.2) * 4 : 0;
    const bob = pose === 'sleep' ? 6 : pose === 'cheer' ? -Math.abs(Math.sin(t * 5)) * 8 : Math.sin(t * 2) * 1.6;

    col(cr, [0.05, 0.055, 0.075], 1);
    roundRect(cr, 0.5, 0.5, w - 1, h - 1, 26);
    cr.fill();
    col(cr, teal, 0.07);
    ellipse(cr, cx, h * 0.5, w * 0.34, h * 0.46); cr.fill();
    col(cr, teal, 0.045);
    ellipse(cr, cx, h * 0.5, w * 0.44, h * 0.6); cr.fill();

    const hw = Math.min(w * 0.7, h * 1.55);
    const hh = h * 0.72;
    const hx = cx - hw / 2 + sway;
    const hy = (h - hh) / 2 + bob;

    shaded(cr, () => roundRect(cr, hx, hy, hw, hh, hh * 0.44), 4);
    for (const side of [-1, 1]) {
        const ex = side < 0 ? hx - 3 : hx + hw + 3;
        const ey = hy + hh * 0.52;
        shaded(cr, () => ellipse(cr, ex, ey, hh * 0.1, hh * 0.18), 2);
        col(cr, SHADE, 0.6);
        ellipse(cr, ex, ey, hh * 0.05, hh * 0.1); cr.fill();
    }
    cr.save();
    cr.translate(hx + hw * 0.06, hy + hh * 0.1);
    drawScreen(cr, hw * 0.88, hh * 0.8, f, t, {scene: true, radius: hh * 0.36});
    cr.restore();

    if (f.playing && pose !== 'sleep') {
        col(cr, teal, 1);
        cr.setLineWidth(8);
        cr.setLineCap(1);
        cr.newPath();
        cr.moveTo(hx - 3, hy + hh * 0.5);
        cr.curveTo(hx - 3, hy - hh * 0.3, hx + hw + 3, hy - hh * 0.3, hx + hw + 3, hy + hh * 0.5);
        cr.stroke();
        for (const ex of [hx - 4, hx + hw + 4]) {
            ellipse(cr, ex, hy + hh * 0.52, hh * 0.13, hh * 0.22); cr.fill();
        }
    }
}

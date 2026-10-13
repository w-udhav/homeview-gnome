// Pure drawing: turns a frame from the daemon into cairo calls. No state.
import GLib from 'gi://GLib';

export const OFFLINE_FRAME = {
    eye: 0.12, px: 0, py: 0, brow: 0, mouth: 0, mouth_open: 0, blush: 0,
    tilt: 0, bounce: 0, breathe: 0, hue: 210, sat: 0, playing: false,
    llm: false, style: 'classic',
};

function hsl(h, s, l) {
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

function roundRect(cr, x, y, w, h, r) {
    cr.newPath();
    cr.arc(x + w - r, y + r, r, -Math.PI / 2, 0);
    cr.arc(x + w - r, y + h - r, r, 0, Math.PI / 2);
    cr.arc(x + r, y + h - r, r, Math.PI / 2, Math.PI);
    cr.arc(x + r, y + r, r, Math.PI, 1.5 * Math.PI);
    cr.closePath();
}

function ellipse(cr, x, y, rx, ry) {
    if (rx <= 0 || ry <= 0)
        return;
    cr.save();
    cr.translate(x, y);
    cr.scale(rx, ry);
    cr.newPath();
    cr.arc(0, 0, 1, 0, 2 * Math.PI);
    cr.restore();
}

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

export function drawFace(cr, w, h, f) {
    const style = f.style || 'classic';

    // Pill background, tinted by the current track.
    const bg = f.playing ? hsl(f.hue, 0.45 + 0.3 * f.sat, 0.32) : [1, 1, 1];
    cr.setSourceRGBA(bg[0], bg[1], bg[2], f.playing ? 0.92 : 0.12);
    roundRect(cr, 0.5, 0.5, w - 1, h - 1, (h - 1) / 2);
    cr.fill();

    cr.save();
    const s = 1 + 0.03 * f.breathe;
    cr.translate(w / 2, h / 2 - f.bounce * 3);
    cr.rotate((f.tilt * Math.PI) / 180);
    cr.scale(s, s);
    cr.setLineCap(1); // ROUND
    cr.setLineJoin(1);

    const ink = [0.97, 0.97, 0.97];
    const ex = w * 0.2;
    const ey = -h * 0.04;
    const open = clamp(f.eye, 0, 1.1);

    let rx, ry, pr;
    if (style === 'round') {
        rx = h * 0.2;
        ry = Math.max(0.6, h * 0.2 * open);
        pr = Math.min(rx, ry) * 0.62;
    } else if (style === 'minimal') {
        rx = h * 0.08;
        ry = Math.max(0.5, h * 0.1 * open);
        pr = 0;
    } else {
        rx = w * 0.095;
        ry = Math.max(0.6, h * 0.27 * open);
        pr = Math.min(rx, ry) * 0.58;
    }

    for (const side of [-1, 1]) {
        const cx = side * ex;
        cr.setSourceRGBA(ink[0], ink[1], ink[2], 1);
        ellipse(cr, cx, ey, rx, ry);
        cr.fill();
        if (pr > 0 && ry > 1.2) {
            cr.setSourceRGBA(0.08, 0.08, 0.1, 1);
            const ox = f.px * (rx - pr);
            const oy = f.py * (ry - pr);
            ellipse(cr, cx + ox, ey + oy, pr, pr);
            cr.fill();
            if (style === 'round') {
                cr.setSourceRGBA(1, 1, 1, 0.9);
                ellipse(cr, cx + ox - pr * 0.3, ey + oy - pr * 0.3, pr * 0.28, pr * 0.28);
                cr.fill();
            }
        }

        // Brows: inner end drops when focused, lifts when curious.
        if (Math.abs(f.brow) > 0.12 && style !== 'minimal') {
            const y0 = ey - ry - h * 0.1;
            const inner = y0 - f.brow * h * 0.11;
            const outer = y0 + f.brow * h * 0.03;
            cr.setSourceRGBA(ink[0], ink[1], ink[2], 0.9);
            cr.setLineWidth(Math.max(1, h * 0.06));
            cr.moveTo(cx + side * rx * 1.1, outer);
            cr.lineTo(cx - side * rx * 1.1, inner);
            cr.stroke();
        }
    }

    // Blush.
    if (f.blush > 0.05) {
        cr.setSourceRGBA(1, 0.45, 0.55, 0.55 * f.blush);
        for (const side of [-1, 1]) {
            ellipse(cr, side * w * 0.31, h * 0.12, w * 0.05, h * 0.07);
            cr.fill();
        }
    }

    // Mouth.
    const my = h * 0.27;
    const mw = style === 'round' ? w * 0.08 : w * 0.12;
    cr.setSourceRGBA(ink[0], ink[1], ink[2], 0.95);
    if (f.mouth_open > 0.05) {
        ellipse(cr, 0, my, mw * 0.7, h * 0.12 * f.mouth_open + 0.8);
        cr.fill();
    } else {
        cr.setLineWidth(Math.max(1, h * 0.065));
        cr.moveTo(-mw, my);
        const bend = f.mouth * h * 0.28;
        cr.curveTo(-mw * 0.4, my + bend, mw * 0.4, my + bend, mw, my);
        cr.stroke();
    }
    cr.restore();

    // "Thinking" dots while an LLM works.
    if (f.llm) {
        const t = GLib.get_monotonic_time() / 1e6;
        for (let i = 0; i < 3; i++) {
            const a = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(t * 6 - i * 0.9));
            cr.setSourceRGBA(1, 1, 1, a);
            ellipse(cr, w - 9 + i * 0, h * 0.28 + (i - 1) * 4.2, 1.4, 1.4);
            cr.fill();
        }
    }
}

export function drawArc(cr, w, h, arc) {
    cr.setSourceRGBA(1, 1, 1, 0.08);
    cr.rectangle(0, 0, w, h);
    cr.fill();
    if (!arc || arc.length < 1)
        return;
    const series = [['focus', [0.45, 0.75, 1]], ['energy', [1, 0.75, 0.3]], ['joy', [1, 0.5, 0.65]]];
    cr.setLineWidth(1.4);
    for (const [key, c] of series) {
        cr.setSourceRGBA(c[0], c[1], c[2], 0.95);
        let first = true;
        for (const p of arc) {
            const x = (p.hour / 23) * (w - 6) + 3;
            const y = h - 3 - clamp(p[key], 0, 1) * (h - 6);
            if (first) {
                cr.moveTo(x, y);
                first = false;
            } else {
                cr.lineTo(x, y);
            }
        }
        cr.stroke();
        if (arc.length === 1) {
            const p = arc[0];
            cr.arc((p.hour / 23) * (w - 6) + 3, h - 3 - clamp(p[key], 0, 1) * (h - 6), 1.6, 0, 2 * Math.PI);
            cr.fill();
        }
    }
}

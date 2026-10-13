// Cairo-side helpers: the robot (via robot.js) and the mood-arc chart.
import GLib from 'gi://GLib';
import {drawFaceScreen, OFFLINE_FRAME} from './robot.js';

export {OFFLINE_FRAME};

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

export function drawFace(cr, w, h, f) {
    drawFaceScreen(cr, w, h, f, GLib.get_monotonic_time() / 1e6);
}

/** Smooth line chart of focus / energy / joy across the day. */
export const ARC_SERIES = [
    ['focus', [0.45, 0.75, 1]],
    ['energy', [1, 0.76, 0.3]],
    ['joy', [1, 0.5, 0.65]],
];

export function drawArc(cr, w, h, arc) {
    const padX = 4, padY = 6;
    // faint hour grid
    cr.setSourceRGBA(1, 1, 1, 0.07);
    cr.setLineWidth(1);
    for (const hr of [0, 6, 12, 18, 23]) {
        const x = padX + (hr / 23) * (w - padX * 2);
        cr.newPath();
        cr.moveTo(x, 0);
        cr.lineTo(x, h);
        cr.stroke();
    }
    if (!arc || arc.length < 1)
        return;
    const xy = (p, key) => [
        padX + (p.hour / 23) * (w - padX * 2),
        h - padY - clamp(p[key], 0, 1) * (h - padY * 2),
    ];
    cr.setLineCap(1);
    cr.setLineJoin(1);
    for (const [key, c] of ARC_SERIES) {
        const pts = arc.map(p => xy(p, key));
        cr.setSourceRGBA(c[0], c[1], c[2], 1);
        cr.setLineWidth(2);
        if (pts.length === 1) {
            cr.newPath();
            cr.arc(pts[0][0], pts[0][1], 2.5, 0, 2 * Math.PI);
            cr.fill();
            continue;
        }
        // Catmull-Rom -> cubic Bezier
        cr.newPath();
        cr.moveTo(pts[0][0], pts[0][1]);
        for (let i = 0; i < pts.length - 1; i++) {
            const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
            cr.curveTo(
                p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6,
                p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6,
                p2[0], p2[1]);
        }
        cr.stroke();
    }
}

/** Four animated equaliser bars for the now-playing tile. */
export function drawEq(cr, w, h, playing, color) {
    const t = GLib.get_monotonic_time() / 1e6;
    const n = 4, gap = 3, bw = (w - gap * (n - 1)) / n;
    cr.setSourceRGBA(color[0], color[1], color[2], 1);
    for (let i = 0; i < n; i++) {
        const k = playing ? 0.3 + 0.7 * Math.abs(Math.sin(t * (2.1 + i * 0.7) + i)) : 0.2;
        const bh = Math.max(2, h * k);
        cr.rectangle(i * (bw + gap), h - bh, bw, bh);
        cr.fill();
    }
}

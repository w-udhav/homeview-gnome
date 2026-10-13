// Cairo drawing for the creature (via sprite.js) and the mood-arc chart.
import GLib from 'gi://GLib';
import {spritePixels, W, H, OFFLINE_FRAME} from './sprite.js';

export {OFFLINE_FRAME};

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/** Draw the creature centred in w x h at the largest whole-pixel scale. */
export function drawCreature(cr, w, h, f, {scene = false} = {}) {
    const t = GLib.get_monotonic_time() / 1e6;
    const s = Math.max(1, Math.floor(Math.min(w / W, h / H)));
    const ox = Math.floor((w - W * s) / 2);
    const oy = Math.floor((h - H * s) / 2);

    if (scene) {
        // Soft room backdrop with a floor line.
        cr.setSourceRGBA(1, 1, 1, 0.06);
        cr.rectangle(0, 0, w, h);
        cr.fill();
        cr.setSourceRGBA(0, 0, 0, 0.18);
        cr.rectangle(0, oy + H * s - Math.max(1, s), w, Math.max(1, s));
        cr.fill();
    }

    for (const [x, y, c, a] of spritePixels(f, t)) {
        cr.setSourceRGBA(c[0], c[1], c[2], a);
        cr.rectangle(ox + x * s, oy + y * s, s, s);
        cr.fill();
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

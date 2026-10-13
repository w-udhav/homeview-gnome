// Cairo drawing for the popup: tick ring, equaliser bars and the day chart.
// Pure functions of (context, size, data, palette): no GNOME imports, so they
// can be reused by the offline preview script.
import {ORANGE, rgba} from './theme.js';

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

// --- rounded-square tick ring (the Apple Timer face) -------------------------

/** Point on a rounded rectangle's perimeter at fraction f (0 = top centre, clockwise), plus its outward normal. */
export function perimeterPoint(f, w, h, r) {
    const top = w / 2 - r, side = h - 2 * r, bottom = w - 2 * r, arc = (Math.PI * r) / 2;
    const segs = [
        {len: top, at: s => [w / 2 + s, 0, 0, -1]},
        {len: arc, at: s => corner(w - r, r, -90, s / r)},
        {len: side, at: s => [w, r + s, 1, 0]},
        {len: arc, at: s => corner(w - r, h - r, 0, s / r)},
        {len: bottom, at: s => [w - r - s, h, 0, 1]},
        {len: arc, at: s => corner(r, h - r, 90, s / r)},
        {len: side, at: s => [0, h - r - s, -1, 0]},
        {len: arc, at: s => corner(r, r, 180, s / r)},
        {len: top, at: s => [r + s, 0, 0, -1]},
    ];
    const total = segs.reduce((a, s) => a + s.len, 0);
    let s = ((f % 1) + 1) % 1 * total;
    for (const seg of segs) {
        if (s <= seg.len)
            return seg.at(s);
        s -= seg.len;
    }
    return segs[0].at(0);
}

function corner(cx, cy, startDeg, ang) {
    const a = (startDeg * Math.PI) / 180 + ang;
    return [cx + Math.cos(a) * 0, cy + Math.sin(a) * 0, Math.cos(a), Math.sin(a), cx, cy];
}

/**
 * Draw `count` ticks around the edge of a rounded rectangle. Ticks with index
 * >= (count - lit) are lit (remaining time); the rest are dim (elapsed).
 */
export function drawTickRing(cr, w, h, {lit, count = 60, pal, color = ORANGE, inset = 4, len = 9, radius = 30}) {
    cr.setLineCap(1);
    for (let i = 0; i < count; i++) {
        const [px, py, nx, ny, ccx, ccy] = perimeterPoint(i / count, w - inset * 2, h - inset * 2, radius - inset);
        const x = px + inset, y = py + inset;
        let ax = x, ay = y;
        if (ccx !== undefined) {
            // On a corner: the point is on the arc around (ccx, ccy).
            ax = ccx + inset + nx * (radius - inset);
            ay = ccy + inset + ny * (radius - inset);
        }
        const on = i >= count - lit;
        if (on)
            rgba(cr, color, 1);
        else
            rgba(cr, pal.tickDim);
        cr.setLineWidth(on ? 3 : 2.4);
        cr.newPath();
        cr.moveTo(ax, ay);
        cr.lineTo(ax - nx * len, ay - ny * len);
        cr.stroke();
    }
}

// --- equaliser ---------------------------------------------------------------

export function drawEq(cr, w, h, playing, color, t) {
    const n = 4, gap = 3, bw = (w - gap * (n - 1)) / n;
    rgba(cr, color, 1);
    for (let i = 0; i < n; i++) {
        const k = playing ? 0.3 + 0.7 * Math.abs(Math.sin(t * (2.1 + i * 0.7) + i)) : 0.2;
        const bh = Math.max(2, h * k);
        cr.newPath();
        cr.rectangle(i * (bw + gap), h - bh, bw, bh);
        cr.fill();
    }
}

// --- day chart -----------------------------------------------------------------

const SERIES = ['focus', 'energy', 'joy'];

function curve(cr, pts) {
    cr.moveTo(pts[0][0], pts[0][1]);
    for (let i = 0; i < pts.length - 1; i++) {
        const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
        cr.curveTo(
            p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6,
            p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6,
            p2[0], p2[1]);
    }
}

/** Smooth focus/energy/joy curves with a soft fill under the focus line. */
export function drawDayChart(cr, w, h, arc, pal, nowHour) {
    const padX = 6, padT = 8, padB = 16;
    const x = hr => padX + (hr / 23) * (w - padX * 2);
    const y = v => h - padB - clamp(v, 0, 1) * (h - padT - padB);

    // hour grid + labels
    cr.setLineWidth(1);
    for (const hr of [0, 6, 12, 18, 23]) {
        rgba(cr, pal.grid);
        cr.newPath();
        cr.moveTo(x(hr), padT);
        cr.lineTo(x(hr), h - padB);
        cr.stroke();
    }
    if (nowHour !== undefined) {
        rgba(cr, ORANGE, 0.8);
        cr.setLineWidth(1.5);
        cr.newPath();
        cr.moveTo(x(nowHour), padT);
        cr.lineTo(x(nowHour), h - padB);
        cr.stroke();
    }
    if (!arc || arc.length === 0)
        return;

    cr.setLineCap(1);
    cr.setLineJoin(1);
    for (const key of SERIES) {
        const c = pal.series[key];
        const pts = arc.map(p => [x(p.hour), y(p[key])]);
        if (pts.length === 1) {
            rgba(cr, c);
            cr.newPath();
            cr.arc(pts[0][0], pts[0][1], 3, 0, 2 * Math.PI);
            cr.fill();
            continue;
        }
        if (key === 'focus') {
            cr.newPath();
            curve(cr, pts);
            cr.lineTo(pts[pts.length - 1][0], h - padB);
            cr.lineTo(pts[0][0], h - padB);
            cr.closePath();
            rgba(cr, c, 0.18);
            cr.fill();
        }
        rgba(cr, c);
        cr.setLineWidth(2.2);
        cr.newPath();
        curve(cr, pts);
        cr.stroke();
    }
}

// --- segmented timer track -------------------------------------------------------

export const ACCENT = [1.0, 0.76, 0.1];

/**
 * A row of rounded segments. `progress` (0-1) is the time remaining: segments
 * fill left to right with the accent colour, the last lit one partially, and a
 * thin marker sits at the boundary. Elapsed segments stay dim.
 */
export function drawSegments(cr, w, h, {segments = 10, progress = 0, active = false, paused = false}) {
    const gap = 4;
    const sw = (w - gap * (segments - 1)) / segments;
    const r = Math.min(7, h / 2);
    const rr = (x, y, ww, hh, rad) => {
        rad = Math.min(rad, ww / 2, hh / 2);
        cr.newPath();
        cr.moveTo(x + rad, y);
        cr.lineTo(x + ww - rad, y);
        cr.arc(x + ww - rad, y + rad, rad, -Math.PI / 2, 0);
        cr.lineTo(x + ww, y + hh - rad);
        cr.arc(x + ww - rad, y + hh - rad, rad, 0, Math.PI / 2);
        cr.lineTo(x + rad, y + hh);
        cr.arc(x + rad, y + hh - rad, rad, Math.PI / 2, Math.PI);
        cr.lineTo(x, y + rad);
        cr.arc(x + rad, y + rad, rad, Math.PI, 1.5 * Math.PI);
        cr.closePath();
    };
    const lit = active ? progress * segments : 0;
    for (let i = 0; i < segments; i++) {
        const x = i * (sw + gap);
        // dim base
        cr.setSourceRGBA(1, 1, 1, active ? 0.14 : 0.10);
        rr(x, 0, sw, h, r);
        cr.fill();
        const f = Math.max(0, Math.min(1, lit - i));
        if (f > 0) {
            cr.save();
            cr.rectangle(x, 0, sw * f, h);
            cr.clip();
            cr.setSourceRGBA(ACCENT[0], ACCENT[1], ACCENT[2], paused ? 0.55 : 1);
            rr(x, 0, sw, h, r);
            cr.fill();
            cr.restore();
        }
    }
    if (active) {
        // Marker: where the lit part ends, accounting for the gaps.
        const idx = Math.min(segments - 1, Math.floor(lit));
        const frac = lit >= segments ? 1 : lit - idx;
        const x = idx * (sw + gap) + sw * frac;
        cr.setSourceRGBA(1, 1, 1, 0.95);
        cr.setLineWidth(2);
        cr.setLineCap(1);
        cr.newPath();
        cr.moveTo(Math.min(w - 1, Math.max(1, x)), -2);
        cr.lineTo(Math.min(w - 1, Math.max(1, x)), h + 2);
        cr.stroke();
    }
}

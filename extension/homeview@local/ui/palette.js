// Pick two colours from album art for the Now Playing background.
// paletteFromPixels() is pure so it can be unit-tested outside GNOME.

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

function rgbToHsl(r, g, b) {
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const l = (max + min) / 2;
    let h = 0, s = 0;
    if (max !== min) {
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
        else if (max === g) h = ((b - r) / d + 2) / 6;
        else h = ((r - g) / d + 4) / 6;
    }
    return [h * 360, s, l];
}

export function hslToRgb(h, s, l) {
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

/**
 * `px` is a flat [r, g, b, ...] array (0-255) of a small image.
 * Returns {top, bottom}: two RGB triples (0-1) tuned so white text stays
 * readable: a vivid colour from the art on top, a deeper blend below.
 */
export function paletteFromPixels(px) {
    const n = Math.floor(px.length / 3);
    if (n === 0)
        return null;

    let ar = 0, ag = 0, ab = 0;
    // Weight each pixel by saturation so a colourful cover wins over its grey border.
    let vr = 0, vg = 0, vb = 0, vw = 0;
    for (let i = 0; i < n; i++) {
        const r = px[i * 3] / 255, g = px[i * 3 + 1] / 255, b = px[i * 3 + 2] / 255;
        ar += r; ag += g; ab += b;
        const [, s, l] = rgbToHsl(r, g, b);
        const w = s * s * (1 - Math.abs(l - 0.5) * 1.4) + 0.001;
        vr += r * w; vg += g * w; vb += b * w; vw += w;
    }
    const avg = [ar / n, ag / n, ab / n];
    const vib = [vr / vw, vg / vw, vb / vw];

    const [h1, s1] = rgbToHsl(...vib);
    const [h2, s2] = rgbToHsl(...avg);
    // Greyscale art stays neutral instead of inventing a hue.
    const top = hslToRgb(h1, clamp(s1 * 1.15, 0, 0.85), 0.42);
    const bottom = hslToRgb(h2, clamp(s2 * 1.1, 0, 0.7), 0.17);
    return {top, bottom};
}

export function paletteFromHue(hue) {
    return {top: hslToRgb(hue, 0.6, 0.42), bottom: hslToRgb(hue + 30, 0.5, 0.17)};
}

export const toCss = c => `rgb(${c.map(v => Math.round(clamp(v, 0, 1) * 255)).join(',')})`;

// Small St building blocks shared by the tiles.
import Clutter from 'gi://Clutter';
import St from 'gi://St';

export const label = (text, cls, extra = {}) =>
    new St.Label({style_class: cls, text, x_align: Clutter.ActorAlign.START, y_align: Clutter.ActorAlign.CENTER, ...extra});

/** A rounded glass tile. */
export function tile(cls = '', {vertical = true, expand = true} = {}) {
    return new St.BoxLayout({style_class: `hv-tile ${cls}`, vertical, x_expand: expand});
}

export function iconButton(iconName, cls = '', onClick = null) {
    const b = new St.Button({
        style_class: `hv-btn ${cls}`,
        can_focus: true,
        reactive: true,
        child: new St.Icon({icon_name: iconName, style_class: 'hv-btn-icon'}),
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.CENTER,
    });
    if (onClick)
        b.connect('clicked', onClick);
    return b;
}

export function textButton(text, cls = '', onClick = null) {
    const b = new St.Button({style_class: `hv-chip ${cls}`, label: text, can_focus: true, reactive: true});
    if (onClick)
        b.connect('clicked', onClick);
    return b;
}

export function fmtTime(secs) {
    secs = Math.max(0, Math.floor(secs));
    const h = Math.floor(secs / 3600), m = Math.floor((secs % 3600) / 60), s = secs % 60;
    const mm = String(m).padStart(h ? 2 : 1, '0'), ss = String(s).padStart(2, '0');
    return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function fmtDur(secs) {
    secs = Math.max(0, Math.round(secs));
    if (secs < 60) return `${secs}s`;
    const m = Math.floor(secs / 60);
    if (m < 60) return `${m}m ${String(secs % 60).padStart(2, '0')}s`;
    return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
}

export function fmtAgo(secs) {
    secs = Math.round(secs);
    if (secs < 60) return 'just now';
    if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
    return `${Math.floor(secs / 3600)}h ago`;
}

export function compact(n) {
    if (n >= 1e6) return `${(n / 1e6).toFixed(1).replace(/\.0$/, '')}M`;
    if (n >= 1e3) return `${(n / 1e3).toFixed(1).replace(/\.0$/, '')}k`;
    return `${n}`;
}

export const cap = s => (s ? s[0].toUpperCase() + s.slice(1) : s);

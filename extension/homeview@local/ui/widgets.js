// Small St building blocks shared by the tiles.
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import St from 'gi://St';

// Bento grid: two columns of 172 with an 8px gutter, rows of 84. Corner radii
// are concentric: card 34 = tile 22 + 12px inset.
export const GAP = 8;
export const SLOT_SIZE = {
    hero: [352, 176],
    tall: [172, 176],
    square: [172, 84],
    wide: [352, 84],
    strip: [352, 62],
};

/**
 * Base for every bento tile. A tile is rebuilt whenever its slot changes (the
 * layout only changes when the popup opens), then fed frames and daily totals.
 * Subclasses implement build(slot), update(frame) and updateToday(today).
 */
export class BentoTile {
    constructor(id, {send} = {}) {
        this.id = id;
        this.send = send ?? (() => {});
        this.slot = null;
        this.f = null;
        this.today = null;
        this.actor = new St.BoxLayout({style_class: 'hv-tile', vertical: true, reactive: false});
    }

    setSlot(slot) {
        if (slot === this.slot)
            return;
        this.slot = slot;
        const [w, h] = SLOT_SIZE[slot];
        this.actor.set_size(w, h);
        this.actor.style_class = `hv-tile hv-slot-${slot} hv-tile-${this.id}`;
        this.actor.vertical = true;
        this.actor.destroy_all_children();
        this.build(slot);
        if (this.f)
            this.update(this.f);
        if (this.today)
            this.updateToday(this.today);
    }

    setFrame(f) {
        this.f = f;
        if (this.slot)
            this.update(f);
    }

    setToday(t) {
        this.today = t;
        if (this.slot)
            this.updateToday(t);
    }

    build(_slot) {}
    update(_f) {}
    updateToday(_t) {}
}

export const label = (text, cls, extra = {}) =>
    new St.Label({style_class: cls, text, x_align: Clutter.ActorAlign.START, y_align: Clutter.ActorAlign.CENTER, ...extra});

/** A rounded glass tile. */
export function tile(cls = '', {vertical = true, expand = true} = {}) {
    return new St.BoxLayout({style_class: `hv-tile ${cls}`, vertical, x_expand: expand});
}

/**
 * Run `fn` when an St.Button is tapped. Listens for both `clicked` and the
 * raw press, because a press that never produces `clicked` (the release
 * landing elsewhere, or being grabbed by the popup) would otherwise do
 * nothing. Whichever comes first fires; the other is ignored for 300ms.
 */
export function onTap(actor, fn) {
    let last = 0;
    const fire = () => {
        const now = GLib.get_monotonic_time();
        if (now - last < 300000)
            return;
        last = now;
        try {
            fn();
        } catch (e) {
            logError(e, 'homeview: tap handler failed');
        }
    };
    actor.connect('clicked', fire);
    actor.connect('button-press-event', () => {
        fire();
        return Clutter.EVENT_PROPAGATE;
    });
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
        onTap(b, onClick);
    return b;
}

export function textButton(text, cls = '', onClick = null) {
    const b = new St.Button({style_class: `hv-chip ${cls}`, label: text, can_focus: true, reactive: true});
    if (onClick)
        onTap(b, onClick);
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

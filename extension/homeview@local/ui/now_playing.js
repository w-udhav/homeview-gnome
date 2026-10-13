// Now Playing, in every slot: hero / tall / square / wide.
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import St from 'gi://St';

import {artPalette, loadArt} from './art.js';
import {paletteFromHue, toCss} from './palette.js';
import {drawEq} from './draw.js';
import {hsl} from '../robot.js';
import {BentoTile, fmtTime, iconButton, label} from './widgets.js';

const css = toCss;

export class NowPlaying extends BentoTile {
    constructor(opts) {
        super('now_playing', opts);
        this.theme = opts.theme;
    }

    _artWidget(size) {
        const a = new St.Widget({style_class: 'hv-art', y_align: Clutter.ActorAlign.CENTER});
        a.set_size(size, size);
        a.set_style(`border-radius: ${Math.round(size * 0.2)}px;`);
        return a;
    }

    _btn(icon, cmd, big = false) {
        return iconButton(icon, `hv-btn-plain ${big ? 'hv-btn-big' : ''}`, () => this.send({t: 'media', cmd}));
    }

    _scrubber() {
        const track = new St.Widget({style_class: 'hv-scrub', reactive: true, x_expand: true});
        const fill = new St.Widget({style_class: 'hv-scrub-fill'});
        track.add_child(fill);
        track.connect('notify::width', () => this._layoutScrub());
        track.connect('button-press-event', (actor, ev) => {
            if (this._len <= 0)
                return Clutter.EVENT_PROPAGATE;
            const [x] = ev.get_coords();
            const [ax] = actor.get_transformed_position();
            const frac = Math.min(1, Math.max(0, (x - ax) / actor.width));
            this.send({t: 'media', cmd: `seek_to:${(frac * this._len).toFixed(1)}`});
            return Clutter.EVENT_STOP;
        });
        this._track = track;
        this._fill = fill;
        return track;
    }

    _layoutScrub() {
        if (!this._track?.get_stage())
            return;
        const frac = this._len > 0 ? Math.min(1, Math.max(0, this._pos / this._len)) : 0;
        this._fill.set_size(Math.round(this._track.width * frac), this._track.height || 4);
    }

    // The whole tile takes its colours from the cover, with light text on top.
    _tintTile(pal) {
        this._pal = pal;
        this.actor.add_style_class_name('hv-np-colored');
        this.actor.set_style(`background-gradient-direction: vertical; background-gradient-start: ${css(pal.top)}; background-gradient-end: ${css(pal.bottom)};`);
    }

    build(slot) {
        this.actor.add_style_class_name('hv-np-colored');
        if (this._pal)
            this._tintTile(this._pal);
        this._len = 0;
        this._pos = 0;
        this._artUrl = null;
        this._title = this._artist = this._art = this._play = this._eq = this._elapsed = this._remain = this._track = this._fill = null;

        const mkEq = () => {
            const eq = new St.DrawingArea({style_class: 'hv-eq', width: 14, height: 11, y_align: Clutter.ActorAlign.CENTER});
            eq.connect('repaint', a => {
                const [w, h] = a.get_surface_size();
                const cr = a.get_context();
                drawEq(cr, w, h, !!this.f?.playing, this._tint ?? [1, 1, 1], GLib.get_monotonic_time() / 1e6);
                cr.$dispose();
            });
            return eq;
        };
        const texts = (titleCls, artistCls, withEq) => {
            const col = new St.BoxLayout({vertical: true, x_expand: true, y_align: Clutter.ActorAlign.CENTER});
            this._title = label('', titleCls);
            this._title.clutter_text.ellipsize = 3;
            this._artist = label('', artistCls, {x_expand: true});
            this._artist.clutter_text.ellipsize = 3;
            col.add_child(this._title);
            const sub = new St.BoxLayout();
            if (withEq) {
                this._eq = mkEq();
                sub.add_child(this._eq);
            }
            sub.add_child(this._artist);
            col.add_child(sub);
            return col;
        };

        if (slot === 'hero') {
            const top = new St.BoxLayout({style_class: 'hv-gap12'});
            this._art = this._artWidget(78);
            top.add_child(this._art);
            top.add_child(texts('hv-np-title-xl', 'hv-np-artist-lg', true));
            this.actor.add_child(top);
            this.actor.add_child(this._scrubber());
            const times = new St.BoxLayout({style_class: 'hv-times'});
            this._elapsed = label('0:00', 'hv-small');
            this._remain = label('', 'hv-small', {x_expand: true, x_align: Clutter.ActorAlign.END});
            times.add_child(this._elapsed);
            times.add_child(this._remain);
            this.actor.add_child(times);
            const ctl = new St.BoxLayout({x_align: Clutter.ActorAlign.CENTER, style_class: 'hv-gap12'});
            ctl.add_child(this._btn('media-skip-backward-symbolic', 'previous'));
            this._play = this._btn('media-playback-start-symbolic', 'play_pause', true);
            ctl.add_child(this._play);
            ctl.add_child(this._btn('media-skip-forward-symbolic', 'next'));
            this.actor.add_child(ctl);
        } else if (slot === 'tall') {
            this._art = this._artWidget(64);
            this._art.x_align = Clutter.ActorAlign.CENTER;
            this.actor.add_child(this._art);
            const t = texts('hv-np-title', 'hv-np-artist', false);
            t.x_align = Clutter.ActorAlign.FILL;
            this.actor.add_child(t);
            this.actor.add_child(this._scrubber());
            const ctl = new St.BoxLayout({x_align: Clutter.ActorAlign.CENTER});
            ctl.add_child(this._btn('media-skip-backward-symbolic', 'previous'));
            this._play = this._btn('media-playback-start-symbolic', 'play_pause', true);
            ctl.add_child(this._play);
            ctl.add_child(this._btn('media-skip-forward-symbolic', 'next'));
            this.actor.add_child(ctl);
        } else if (slot === 'wide') {
            this.actor.vertical = false;
            this.actor.add_style_class_name('hv-gap12');
            this._art = this._artWidget(56);
            this.actor.add_child(this._art);
            const col = new St.BoxLayout({vertical: true, x_expand: true, y_align: Clutter.ActorAlign.CENTER});
            col.add_child(texts('hv-np-title', 'hv-np-artist', true));
            col.add_child(this._scrubber());
            this.actor.add_child(col);
            const ctl = new St.BoxLayout({y_align: Clutter.ActorAlign.CENTER});
            ctl.add_child(this._btn('media-skip-backward-symbolic', 'previous'));
            this._play = this._btn('media-playback-start-symbolic', 'play_pause', true);
            ctl.add_child(this._play);
            ctl.add_child(this._btn('media-skip-forward-symbolic', 'next'));
            this.actor.add_child(ctl);
        } else { // square: art + titles, tap to play/pause
            this.actor.vertical = false;
            this.actor.reactive = true;
            this.actor.add_style_class_name('hv-gap10');
            this.actor.connect('button-press-event', () => {
                this.send({t: 'media', cmd: 'play_pause'});
                return Clutter.EVENT_STOP;
            });
            this._art = this._artWidget(52);
            this.actor.add_child(this._art);
            this.actor.add_child(texts('hv-np-title-sm', 'hv-np-artist-sm', false));
        }
    }

    update(f) {
        if (this._title && this._title.text !== f.title)
            this._title.text = f.title || 'Nothing playing';
        const artist = f.artist || (f.playing ? 'Playing' : 'Paused');
        if (this._artist && this._artist.text !== artist)
            this._artist.text = artist;

        this._tint = [1, 1, 1];
        if (this._play)
            this._play.child.icon_name = f.playing ? 'media-playback-pause-symbolic' : 'media-playback-start-symbolic';

        if (this._art && f.art_url !== this._artUrl) {
            this._artUrl = f.art_url;
            const size = this._art.width;
            const radius = `border-radius: ${Math.round(size * 0.2)}px;`;
            const a = hsl(f.hue, 0.6, 0.6), b = hsl(f.hue + 40, 0.6, 0.34);
            this._art.set_style(`${radius} background-gradient-direction: vertical; background-gradient-start: ${css(a)}; background-gradient-end: ${css(b)};`);
            // Until the real cover is decoded, tint from the track's hue.
            this._tintTile(paletteFromHue(f.hue));
            const url = f.art_url;
            loadArt(url).then(path => {
                if (!path || url !== this._artUrl || !this._art)
                    return;
                this._art.set_style(`${radius} background-image: url("file://${path}"); background-size: ${size}px ${size}px;`);
                const pal = artPalette(path);
                if (pal)
                    this._tintTile(pal);
            });
        }

        this._len = f.length || 0;
        const pos = f.position || 0;
        if (Math.floor(pos) !== Math.floor(this._pos) || this._len !== this._lastLen) {
            this._pos = pos;
            this._lastLen = this._len;
            if (this._elapsed) this._elapsed.text = fmtTime(pos);
            if (this._remain) this._remain.text = this._len > 0 ? `-${fmtTime(this._len - pos)}` : '';
            this._layoutScrub();
        }
        this._eq?.queue_repaint();
    }
}

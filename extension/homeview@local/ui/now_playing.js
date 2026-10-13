// Now Playing: art, title/artist, scrubber, transport. Hidden when no track.
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import St from 'gi://St';

import {loadArt} from './art.js';
import {drawEq} from './draw.js';
import {hsl} from '../robot.js';
import {fmtTime, iconButton, label, tile} from './widgets.js';

const css = c => `rgb(${c.map(v => Math.round(v * 255)).join(',')})`;

export class NowPlaying {
    constructor({send, theme}) {
        this._send = send;
        this._theme = theme;
        this._len = 0;
        this._f = null;
        this._artUrl = null;
        this._pos = -1;

        this.actor = tile('hv-np');
        this.actor.hide();

        const top = new St.BoxLayout({style_class: 'hv-np-top'});
        this._art = new St.Widget({style_class: 'hv-art', y_align: Clutter.ActorAlign.CENTER});
        const text = new St.BoxLayout({vertical: true, x_expand: true, y_align: Clutter.ActorAlign.CENTER, style_class: 'hv-np-text'});
        this._title = label('', 'hv-np-title');
        this._title.clutter_text.ellipsize = 3;
        this._artist = label('', 'hv-np-artist', {x_expand: true});
        this._artist.clutter_text.ellipsize = 3;
        const sub = new St.BoxLayout();
        this._eq = new St.DrawingArea({style_class: 'hv-eq', width: 14, height: 11, y_align: Clutter.ActorAlign.CENTER});
        this._eq.connect('repaint', a => {
            const [w, h] = a.get_surface_size();
            const cr = a.get_context();
            drawEq(cr, w, h, !!this._f?.playing, this._tint ?? [1, 1, 1], GLib.get_monotonic_time() / 1e6);
            cr.$dispose();
        });
        sub.add_child(this._eq);
        sub.add_child(this._artist);
        text.add_child(this._title);
        text.add_child(sub);
        top.add_child(this._art);
        top.add_child(text);

        const ctl = new St.BoxLayout({style_class: 'hv-transport', y_align: Clutter.ActorAlign.CENTER});
        ctl.add_child(iconButton('media-skip-backward-symbolic', 'hv-btn-plain', () => this._send({t: 'media', cmd: 'previous'})));
        this._play = iconButton('media-playback-start-symbolic', 'hv-btn-plain hv-btn-big', () => this._send({t: 'media', cmd: 'play_pause'}));
        ctl.add_child(this._play);
        ctl.add_child(iconButton('media-skip-forward-symbolic', 'hv-btn-plain', () => this._send({t: 'media', cmd: 'next'})));
        top.add_child(ctl);
        this.actor.add_child(top);

        // scrubber
        this._track = new St.Widget({style_class: 'hv-scrub', reactive: true, x_expand: true});
        this._fill = new St.Widget({style_class: 'hv-scrub-fill'});
        this._track.add_child(this._fill);
        this._track.connect('notify::width', () => this._layout());
        this._track.connect('button-press-event', (actor, ev) => {
            if (this._len <= 0)
                return Clutter.EVENT_PROPAGATE;
            const [x] = ev.get_coords();
            const [ax] = actor.get_transformed_position();
            const frac = Math.min(1, Math.max(0, (x - ax) / actor.width));
            this._send({t: 'media', cmd: `seek_to:${(frac * this._len).toFixed(1)}`});
            return Clutter.EVENT_STOP;
        });
        this.actor.add_child(this._track);

        const times = new St.BoxLayout({style_class: 'hv-times'});
        this._elapsed = label('0:00', 'hv-small');
        this._remain = label('', 'hv-small', {x_expand: true, x_align: Clutter.ActorAlign.END});
        times.add_child(this._elapsed);
        times.add_child(this._remain);
        this.actor.add_child(times);
    }

    _layout() {
        const frac = this._len > 0 ? Math.min(1, Math.max(0, this._pos / this._len)) : 0;
        this._fill.set_size(Math.round(this._track.width * frac), this._track.height || 4);
    }

    setFrame(f) {
        this._f = f;
        const has = !f.offline && !!f.title;
        this.actor.visible = has;
        if (!has)
            return;
        if (this._title.text !== f.title) this._title.text = f.title;
        const artist = f.artist || (f.playing ? 'Playing' : 'Paused');
        if (this._artist.text !== artist) this._artist.text = artist;

        this._tint = hsl(f.hue, 0.8, this._theme.dark ? 0.72 : 0.42);
        this._play.child.icon_name = f.playing ? 'media-playback-pause-symbolic' : 'media-playback-start-symbolic';

        if (f.art_url !== this._artUrl) {
            this._artUrl = f.art_url;
            const a = hsl(f.hue, 0.6, 0.6), b = hsl(f.hue + 40, 0.6, 0.34);
            this._art.set_style(`background-gradient-direction: vertical; background-gradient-start: ${css(a)}; background-gradient-end: ${css(b)};`);
            const url = f.art_url;
            loadArt(url).then(path => {
                if (path && url === this._artUrl)
                    this._art.set_style(`background-image: url("file://${path}"); background-size: 60px 60px;`);
            });
        }

        this._len = f.length || 0;
        const pos = f.position || 0;
        if (Math.floor(pos) !== Math.floor(this._pos) || this._len !== this._lastLen) {
            this._pos = pos;
            this._lastLen = this._len;
            this._elapsed.text = fmtTime(pos);
            this._remain.text = this._len > 0 ? `-${fmtTime(this._len - pos)}` : '';
            this._layout();
        }
        this._eq.queue_repaint();
    }
}

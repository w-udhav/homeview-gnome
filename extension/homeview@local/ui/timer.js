// Timer in every slot. The hero is the Apple Timer face: the tick ring runs
// around the whole tile.
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import St from 'gi://St';

import {drawTickRing} from './draw.js';
import {BentoTile, SLOT_SIZE, fmtTime, label, textButton} from './widgets.js';

const PRESETS = [[5, '5m'], [15, '15m'], [25, '25m']];

export class TimerTile extends BentoTile {
    constructor(opts) {
        super('timer', opts);
        this.theme = opts.theme;
        this._t = {total: 0, left: 0, running: false};
        this._done = false;
    }

    _chips(mode) {
        const row = new St.BoxLayout({style_class: 'hv-chips', x_align: Clutter.ActorAlign.CENTER});
        if (mode === 'idle') {
            for (const [m, text] of PRESETS)
                row.add_child(textButton(text, '', () => this.send({t: 'timer', action: 'start', secs: m * 60})));
        } else {
            row.add_child(textButton(mode === 'running' ? 'Pause' : 'Resume', 'hv-chip-accent', () => this.send({t: 'timer', action: 'toggle'})));
            row.add_child(textButton('+1m', '', () => this.send({t: 'timer', action: 'add', secs: 60})));
            row.add_child(textButton('✕', '', () => this.send({t: 'timer', action: 'cancel'})));
        }
        return row;
    }

    _ringArea(w, h, radius) {
        const ring = new St.DrawingArea({x_expand: true, y_expand: true, reactive: true});
        ring.set_size(w, h);
        ring.connect('repaint', a => {
            const [aw, ah] = a.get_surface_size();
            const cr = a.get_context();
            const t = this._t;
            const lit = t.total > 0 ? Math.ceil(60 * (t.left / t.total)) : 0;
            drawTickRing(cr, aw, ah, {lit, pal: this.theme.palette, radius});
            cr.$dispose();
        });
        ring.connect('button-press-event', () => {
            if (this._t.total > 0)
                this.send({t: 'timer', action: 'toggle'});
            return Clutter.EVENT_STOP;
        });
        return ring;
    }

    build(slot) {
        this._mode = '';
        this._chipsBox = null;
        this._ring = null;
        this._time = new St.Label({style_class: slot === 'hero' ? 'hv-timer-time-xl' : slot === 'square' ? 'hv-timer-time-sm' : 'hv-timer-time', text: '', x_align: Clutter.ActorAlign.CENTER});
        this._cap = new St.Label({style_class: 'hv-timer-cap', text: '', x_align: Clutter.ActorAlign.CENTER});

        if (slot === 'hero' || slot === 'tall') {
            const [w, h] = SLOT_SIZE[slot];
            // The ring hugs the tile edge; inside it, time, caption and (hero)
            // the chips. On the narrow tall tile the chips sit under the ring.
            const stack = new St.Widget({layout_manager: new Clutter.BinLayout(), x_expand: true, y_expand: true});
            this._ring = this._ringArea(w - 28, slot === 'hero' ? h - 28 : h - 64, 26);
            const center = new St.BoxLayout({vertical: true, x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER});
            center.add_child(this._time);
            center.add_child(this._cap);
            this._chipsBox = new St.BoxLayout({x_align: Clutter.ActorAlign.CENTER, style_class: 'hv-chips-gap'});
            if (slot === 'hero')
                center.add_child(this._chipsBox);
            stack.add_child(this._ring);
            stack.add_child(center);
            this.actor.add_child(stack);
            if (slot === 'tall')
                this.actor.add_child(this._chipsBox);
        } else if (slot === 'wide') {
            this.actor.vertical = false;
            this.actor.add_style_class_name('hv-gap12');
            const left = new St.BoxLayout({vertical: true, y_align: Clutter.ActorAlign.CENTER});
            left.add_child(label('Timer', 'hv-tile-label'));
            left.add_child(this._time);
            left.add_child(this._cap);
            this.actor.add_child(left);
            this._chipsBox = new St.BoxLayout({x_expand: true, x_align: Clutter.ActorAlign.END, y_align: Clutter.ActorAlign.CENTER});
            this.actor.add_child(this._chipsBox);
        } else { // square: tap to start 15m / pause / resume
            this.actor.reactive = true;
            this.actor.connect('button-press-event', () => {
                this.send(this._t.total > 0 ? {t: 'timer', action: 'toggle'} : {t: 'timer', action: 'start', secs: 900});
                return Clutter.EVENT_STOP;
            });
            this.actor.add_child(label('Timer', 'hv-tile-label'));
            this.actor.add_child(this._time);
            this.actor.add_child(this._cap);
        }
        this._last = null;
    }

    _setChips(mode) {
        if (!this._chipsBox || mode === this._mode)
            return;
        this._mode = mode;
        this._chipsBox.destroy_all_children();
        this._chipsBox.add_child(this._chips(mode));
    }

    update(f) {
        const t = f.timer || {total: 0, left: 0, running: false};
        const key = `${Math.ceil(t.left)}|${t.total}|${t.running}|${f.timer_done}`;
        this._t = t;
        this._done = !!f.timer_done;
        const idle = t.total === 0;
        if (key === this._last && !(idle && !this._done && (this._n = (this._n ?? 0) + 1) % 30 === 0))
            return;
        this._last = key;

        if (t.total > 0) {
            this._time.text = fmtTime(t.left);
            this._cap.text = t.running ? `${Math.round(t.total / 60)} MIN` : 'PAUSED';
            this._setChips(t.running ? 'running' : 'paused');
        } else if (this._done) {
            this._time.text = 'Done';
            this._cap.text = 'TIMER';
            this._setChips('idle');
        } else if (this.slot === 'square') {
            this._time.text = '15:00';
            this._cap.text = 'TAP TO START';
            this._setChips('idle');
        } else {
            this._time.text = GLib.DateTime.new_now_local().format('%H:%M');
            this._cap.text = 'SET A TIMER';
            this._setChips('idle');
        }
        this._ring?.queue_repaint();
    }
}

// The Timer tile: an Apple-style rounded-square tick ring around a big time.
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import St from 'gi://St';

import {drawTickRing} from './draw.js';
import {fmtTime, label, textButton, tile} from './widgets.js';

const PRESETS = [[5, '5m'], [15, '15m'], [25, '25m']];

export class TimerTile {
    constructor({send, theme}) {
        this._send = send;
        this._theme = theme;
        this._t = {total: 0, left: 0, running: false};
        this._done = false;

        this.actor = tile('hv-timer');
        this.actor.add_child(label('Timer', 'hv-tile-label'));

        const stack = new St.Widget({layout_manager: new Clutter.BinLayout(), x_expand: true, y_expand: true, style_class: 'hv-ring-wrap'});
        this._ring = new St.DrawingArea({x_expand: true, y_expand: true, height: 112, reactive: true});
        this._ring.connect('repaint', a => {
            const [w, h] = a.get_surface_size();
            const cr = a.get_context();
            const t = this._t;
            const lit = t.total > 0 ? Math.ceil(60 * (t.left / t.total)) : 0;
            drawTickRing(cr, w, h, {lit, pal: this._theme.palette, radius: 30});
            cr.$dispose();
        });
        // tap the ring to pause/resume a running timer
        this._ring.connect('button-press-event', () => {
            if (this._t.total > 0)
                this._send({t: 'timer', action: 'toggle'});
            return Clutter.EVENT_STOP;
        });
        const center = new St.BoxLayout({vertical: true, x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER});
        this._time = new St.Label({style_class: 'hv-timer-time', text: '', x_align: Clutter.ActorAlign.CENTER});
        this._cap = new St.Label({style_class: 'hv-timer-cap', text: '', x_align: Clutter.ActorAlign.CENTER});
        center.add_child(this._time);
        center.add_child(this._cap);
        stack.add_child(this._ring);
        stack.add_child(center);
        this.actor.add_child(stack);

        this._chips = new St.BoxLayout({style_class: 'hv-chips', x_align: Clutter.ActorAlign.CENTER});
        this.actor.add_child(this._chips);
        this._chipsMode = '';
        this._buildChips('idle');
    }

    _buildChips(mode) {
        if (mode === this._chipsMode)
            return;
        this._chipsMode = mode;
        this._chips.destroy_all_children();
        if (mode === 'idle') {
            for (const [m, text] of PRESETS)
                this._chips.add_child(textButton(text, '', () => this._send({t: 'timer', action: 'start', secs: m * 60})));
        } else {
            this._toggleChip = textButton(mode === 'running' ? 'Pause' : 'Resume', 'hv-chip-accent', () => this._send({t: 'timer', action: 'toggle'}));
            this._chips.add_child(this._toggleChip);
            this._chips.add_child(textButton('+1m', '', () => this._send({t: 'timer', action: 'add', secs: 60})));
            this._chips.add_child(textButton('✕', '', () => this._send({t: 'timer', action: 'cancel'})));
        }
    }

    setFrame(f) {
        const t = f.timer || {total: 0, left: 0, running: false};
        const secs = Math.ceil(t.left);
        const changed = secs !== Math.ceil(this._t.left) || t.total !== this._t.total || t.running !== this._t.running || f.timer_done !== this._done;
        this._t = t;
        this._done = !!f.timer_done;
        if (!changed) {
            if (t.total === 0 && !this._done && (this._n = (this._n ?? 0) + 1) % 30 === 0)
                this.tickClock();
            return;
        }

        if (t.total > 0) {
            this._time.text = fmtTime(t.left);
            this._cap.text = t.running ? `${Math.round(t.total / 60)} MIN` : 'PAUSED';
            this._buildChips(t.running ? 'running' : 'paused');
        } else if (this._done) {
            this._time.text = 'Done';
            this._cap.text = 'TIMER';
            this._buildChips('idle');
        } else {
            const now = GLib.DateTime.new_now_local();
            this._time.text = now.format('%H:%M');
            this._cap.text = 'SET A TIMER';
            this._buildChips('idle');
        }
        this._ring.queue_repaint();
    }

    // The idle clock needs a refresh even when nothing else changed.
    tickClock() {
        if (this._t.total === 0 && !this._done) {
            this._time.text = GLib.DateTime.new_now_local().format('%H:%M');
        }
    }
}

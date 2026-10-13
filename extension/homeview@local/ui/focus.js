// Focus: the current work streak, today's work, and a one-tap 25 minute timer.
import Clutter from 'gi://Clutter';
import St from 'gi://St';

import {BentoTile, label, textButton} from './widgets.js';

const BLOCK = 20 * 60;

const hm = secs => {
    const m = Math.floor(secs / 60);
    return m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m` : `${m}m`;
};

export class FocusTile extends BentoTile {
    constructor(opts) {
        super('focus', opts);
        this._frac = 0;
    }

    _bar() {
        const bar = new St.Widget({style_class: 'hv-track', x_expand: true});
        const fill = new St.Widget({style_class: 'hv-track-fill'});
        bar.add_child(fill);
        bar.connect('notify::width', () => this._layoutBar());
        this._barW = bar;
        this._barFill = fill;
        return bar;
    }

    _layoutBar() {
        if (this._barW?.get_stage())
            this._barFill.set_size(Math.round(this._barW.width * this._frac), 6);
    }

    _start() {
        return textButton('Start 25m focus', 'hv-chip-accent', () => this.send({t: 'timer', action: 'start', secs: 1500}));
    }

    build(slot) {
        this._barW = this._barFill = this._big = this._cap = this._sub = this._today = null;
        if (slot === 'hero' || slot === 'tall') {
            this.actor.add_child(label('Focus', 'hv-tile-label'));
            this._big = label('', slot === 'hero' ? 'hv-big-num' : 'hv-big-num-md');
            this.actor.add_child(this._big);
            this._cap = label('', 'hv-timer-cap');
            this.actor.add_child(this._cap);
            this.actor.add_child(this._bar());
            this._today = label('', 'hv-small');
            this._today.clutter_text.ellipsize = 3;
            this.actor.add_child(this._today);
            const row = new St.BoxLayout({style_class: 'hv-chips'});
            row.add_child(this._start());
            this.actor.add_child(row);
        } else if (slot === 'wide') {
            this.actor.vertical = false;
            this.actor.add_style_class_name('hv-gap12');
            const left = new St.BoxLayout({vertical: true, x_expand: true, y_align: Clutter.ActorAlign.CENTER});
            left.add_child(label('Focus', 'hv-tile-label'));
            this._big = label('', 'hv-big-num-md');
            left.add_child(this._big);
            this._today = label('', 'hv-small');
            left.add_child(this._today);
            this.actor.add_child(left);
            const right = new St.BoxLayout({y_align: Clutter.ActorAlign.CENTER});
            right.add_child(this._start());
            this.actor.add_child(right);
        } else {
            this.actor.add_child(label('Focus', 'hv-tile-label'));
            this._big = label('', 'hv-big-num-md');
            this.actor.add_child(this._big);
            this._cap = label('', 'hv-small');
            this.actor.add_child(this._cap);
        }
    }

    update(f) {
        const s = f.focus_secs || 0;
        const working = f.category === 'work';
        if (this._big)
            this._big.text = s >= 60 ? hm(s) : working ? '<1m' : '0m';
        if (this._cap)
            this._cap.text = working ? `IN FLOW${f.app ? ` · ${f.app}` : ''}` : 'NOT IN A FOCUS BLOCK';
        this._frac = Math.min(1, s / BLOCK);
        this._layoutBar();
    }

    updateToday(t) {
        const work = (t.minutes?.work || 0) * 60;
        const b = t.focus_blocks || 0;
        if (this._today)
            this._today.text = this.slot === 'tall' ? `${hm(work)} today · ${b} block${b === 1 ? '' : 's'}` : `Today ${hm(work)} work · ${b} block${b === 1 ? '' : 's'}`;
    }
}

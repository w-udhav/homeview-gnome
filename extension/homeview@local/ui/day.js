// "Your day" in hero / tall / wide.
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import St from 'gi://St';

import {drawDayChart} from './draw.js';
import {BentoTile, label} from './widgets.js';

const SPLIT = [
    ['work', [0.42, 0.72, 1]],
    ['watch', [0.62, 0.55, 0.95]],
    ['social', [1, 0.62, 0.2]],
    ['read', [0.4, 0.82, 0.6]],
];

export class DayTile extends BentoTile {
    constructor(opts) {
        super('day', opts);
        this.theme = opts.theme;
        this._arc = [];
        this._minutes = {};
    }

    build(slot) {
        this._chart = this._split = this._story = this._head = null;
        this._head = label('Your day', 'hv-tile-label');
        this.actor.add_child(this._head);
        this._story = new St.Label({style_class: slot === 'hero' ? 'hv-story-lg' : 'hv-story', text: ''});
        this._story.clutter_text.line_wrap = true;
        this._story.clutter_text.ellipsize = 3;
        this._story.clutter_text.line_wrap_mode = 2;
        this.actor.add_child(this._story);

        if (slot !== 'wide') {
            this._chart = new St.DrawingArea({style_class: 'hv-chart', x_expand: true, y_expand: true});
            this._chart.connect('repaint', a => {
                const [w, h] = a.get_surface_size();
                const cr = a.get_context();
                const now = GLib.DateTime.new_now_local();
                drawDayChart(cr, w, h, this._arc, this.theme.palette, now.get_hour() + now.get_minute() / 60);
                cr.$dispose();
            });
            this.actor.add_child(this._chart);
        }
        this._split = new St.DrawingArea({style_class: 'hv-split', height: 6, x_expand: true});
        this._split.connect('repaint', a => {
            const [w, h] = a.get_surface_size();
            const cr = a.get_context();
            const total = SPLIT.reduce((s, [k]) => s + (this._minutes[k] || 0), 0);
            if (total <= 0) {
                cr.setSourceRGBA(...this.theme.palette.tickDim);
                cr.rectangle(0, 0, w, h);
                cr.fill();
            } else {
                let x = 0;
                for (const [k, c] of SPLIT) {
                    const seg = ((this._minutes[k] || 0) / total) * w;
                    cr.setSourceRGBA(c[0], c[1], c[2], 1);
                    cr.rectangle(x, 0, Math.max(0, seg - 1.5), h);
                    cr.fill();
                    x += seg;
                }
            }
            cr.$dispose();
        });
        this.actor.add_child(this._split);
    }

    updateToday(t) {
        this._arc = t.arc || [];
        this._minutes = t.minutes || {};
        const b = t.focus_blocks || 0;
        if (this._head)
            this._head.text = b ? `Your day · ${b} focus block${b === 1 ? '' : 's'}` : 'Your day';
        if (this._story)
            this._story.text = t.story || '';
        this.redraw();
    }

    redraw() {
        this._chart?.queue_repaint();
        this._split?.queue_repaint();
    }
}

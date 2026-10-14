// Timer: a dark card with a big bold time, a segmented progress track with a
// marker and a "N min left" bubble, a primary stop/start button and a +1:00
// button. Works in every bento slot.
import Clutter from 'gi://Clutter';
import St from 'gi://St';

import {ACCENT, drawSegments} from './draw.js';
import {BentoTile, fmtTime, label, onTap} from './widgets.js';

const PRESETS = [5, 15, 25, 45]; // minutes, cycled by the secondary button when idle
const SEGMENTS = 10;

export class TimerTile extends BentoTile {
    constructor(opts) {
        super('timer', opts);
        this.theme = opts.theme;
        this._t = {total: 0, left: 0, running: false};
        this._done = false;
        this._preset = 1;
    }

    _active() {
        return this._t.total > 0;
    }

    _primaryClicked() {
        log(`homeview: timer primary tapped (${this._active() ? 'stop' : 'start'})`);
        if (this._active())
            this.send({t: 'timer', action: 'cancel'});
        else
            this.send({t: 'timer', action: 'start', secs: PRESETS[this._preset] * 60});
    }

    _secondaryClicked() {
        if (this._active()) {
            this.send({t: 'timer', action: 'add', secs: 60});
        } else {
            this._preset = (this._preset + 1) % PRESETS.length;
            this._last = null;
            if (this.f)
                this.update(this.f);
        }
    }

    _primary(compact) {
        const b = new St.Button({
            style_class: `hv-tbtn-primary ${compact ? 'hv-tbtn-compact' : ''}`,
            can_focus: true,
            reactive: true,
            x_expand: !compact,
            child: new St.Icon({icon_name: 'media-playback-start-symbolic', style_class: 'hv-tbtn-icon'}),
        });
        onTap(b, () => this._primaryClicked());
        this._pbtn = b;
        return b;
    }

    _secondary(compact) {
        const b = new St.Button({
            style_class: `hv-tbtn-secondary ${compact ? 'hv-tbtn-compact' : ''}`,
            can_focus: true,
            reactive: true,
            x_expand: !compact,
            label: '+1:00',
        });
        onTap(b, () => this._secondaryClicked());
        this._sbtn = b;
        return b;
    }

    _bar(height) {
        const bar = new St.DrawingArea({x_expand: true, reactive: false});
        bar.set_height(height);
        bar.connect('repaint', a => {
            const [w, h] = a.get_surface_size();
            const cr = a.get_context();
            const t = this._t;
            const progress = t.total > 0 ? t.left / t.total : 0;
            drawSegments(cr, w, h, {segments: SEGMENTS, progress, active: t.total > 0, paused: !t.running && t.total > 0});
            cr.$dispose();
        });
        this._barArea = bar;
        return bar;
    }

    /** The "N min left" bubble rides above the bar's marker. */
    _bubbleRow() {
        const row = new St.Widget({layout_manager: new Clutter.FixedLayout(), x_expand: true, height: 24});
        this._bubble = new St.Label({style_class: 'hv-timer-bubble', text: ''});
        row.add_child(this._bubble);
        this._bubbleRow_ = row;
        row.connect('notify::width', () => this._placeBubble());
        return row;
    }

    _placeBubble() {
        if (!this._bubble || !this._bubbleRow_?.get_stage())
            return;
        const rowW = this._bubbleRow_.width;
        const progress = this._t.total > 0 ? this._t.left / this._t.total : 0;
        const [bw] = this._bubble.get_size();
        const x = Math.min(Math.max(progress * rowW - bw / 2, 0), Math.max(0, rowW - bw));
        this._bubble.set_position(Math.round(x), 0);
        this._bubble.visible = this._active() || this._done;
    }

    build(slot) {
        this._pbtn = this._sbtn = this._barArea = this._bubble = this._bubbleRow_ = this._cap = null;
        this._time = new St.Label({style_class: `hv-timer-${slot}`, text: '', x_align: Clutter.ActorAlign.START, y_align: Clutter.ActorAlign.CENTER, reactive: true});
        this._time.connect('button-press-event', () => {
            if (this._active())
                this.send({t: 'timer', action: 'toggle'});
            return Clutter.EVENT_STOP;
        });
        this._cap = label('', 'hv-timer-cap', {x_align: Clutter.ActorAlign.END, y_align: Clutter.ActorAlign.CENTER, x_expand: true});

        if (slot === 'hero') {
            const top = new St.BoxLayout();
            top.add_child(this._time);
            top.add_child(this._cap);
            this.actor.add_child(top);
            this.actor.add_child(this._bubbleRow());
            this.actor.add_child(this._bar(24));
            const btns = new St.BoxLayout({style_class: 'hv-gap8 hv-tbtn-row'});
            btns.add_child(this._primary(false));
            btns.add_child(this._secondary(false));
            this.actor.add_child(btns);
        } else if (slot === 'tall') {
            this.actor.add_child(label('Timer', 'hv-timer-label'));
            this.actor.add_child(this._time);
            this.actor.add_child(this._cap);
            this.actor.add_child(this._bar(18));
            const btns = new St.BoxLayout({style_class: 'hv-gap8 hv-tbtn-row'});
            btns.add_child(this._primary(false));
            btns.add_child(this._secondary(false));
            this.actor.add_child(btns);
        } else if (slot === 'wide') {
            this.actor.vertical = false;
            this.actor.add_style_class_name('hv-gap12');
            const left = new St.BoxLayout({vertical: true, x_expand: true, y_align: Clutter.ActorAlign.CENTER});
            left.add_child(this._time);
            left.add_child(this._bar(12));
            this.actor.add_child(left);
            const btns = new St.BoxLayout({style_class: 'hv-gap8', y_align: Clutter.ActorAlign.CENTER});
            btns.add_child(this._primary(true));
            btns.add_child(this._secondary(true));
            this.actor.add_child(btns);
        } else { // square: tap to start / pause
            this.actor.reactive = true;
            this.actor.connect('button-press-event', () => {
                this.send(this._active() ? {t: 'timer', action: 'toggle'} : {t: 'timer', action: 'start', secs: PRESETS[this._preset] * 60});
                return Clutter.EVENT_STOP;
            });
            this.actor.add_child(this._cap);
            this.actor.add_child(this._time);
            this.actor.add_child(this._bar(8));
        }
        this._last = null;
    }

    update(f) {
        const t = f.timer || {total: 0, left: 0, running: false};
        const done = !!f.timer_done;
        const key = `${Math.ceil(t.left)}|${t.total}|${t.running}|${done}|${this._preset}`;
        this._t = t;
        this._done = done;
        if (key === this._last)
            return;
        this._last = key;

        const idle = t.total === 0;
        const mins = Math.max(1, Math.ceil(t.left / 60));
        if (!idle) {
            this._time.text = fmtTime(t.left);
            this._cap.text = t.running ? `${Math.round(t.total / 60)} MIN` : 'PAUSED';
        } else if (done) {
            this._time.text = 'Done';
            this._cap.text = 'TIME’S UP';
        } else {
            this._time.text = fmtTime(PRESETS[this._preset] * 60);
            this._cap.text = this.slot === 'square' ? 'TAP TO START' : 'TIMER';
        }
        if (this._bubble)
            this._bubble.text = idle ? (done ? 'Time’s up' : '') : t.running ? `${mins} min left` : 'Paused';
        if (this._pbtn)
            this._pbtn.child.icon_name = idle ? 'media-playback-start-symbolic' : 'media-playback-stop-symbolic';
        if (this._sbtn)
            this._sbtn.label = idle ? `${PRESETS[this._preset]} min` : '+1:00';
        this._placeBubble();
        this._barArea?.queue_repaint();
    }
}

// The hover "today" card.
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import {drawArc, drawCreature, OFFLINE_FRAME} from './face.js';
import {POSE_LABEL} from './sprite.js';

const fmt = m => (m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m` : `${m}m`);

export class Card {
    constructor() {
        this.actor = new St.BoxLayout({vertical: true, style_class: 'hv-card'});

        this._frame = OFFLINE_FRAME;
        this._scene = new St.DrawingArea({style_class: 'hv-scene', height: 112, x_expand: true});
        this._scene.connect('repaint', a => {
            const [w, h] = a.get_surface_size();
            const cr = a.get_context();
            drawCreature(cr, w, h, this._frame, {scene: true});
            cr.$dispose();
        });
        this._pose = new St.Label({style_class: 'hv-pose', text: ''});
        this._now = new St.Label({style_class: 'hv-now', text: ''});
        this._story = new St.Label({style_class: 'hv-story', text: 'Loading today…'});
        this._story.clutter_text.line_wrap = true;
        this._story.clutter_text.ellipsize = 0;
        this._cats = new St.Label({style_class: 'hv-line', text: ''});
        this._misc = new St.Label({style_class: 'hv-line', text: ''});

        this._foodTrack = new St.Widget({style_class: 'hv-bar', x_expand: true});
        this._foodFill = new St.Widget({style_class: 'hv-bar-fill'});
        this._foodTrack.add_child(this._foodFill);
        this._foodLabel = new St.Label({style_class: 'hv-small', text: ''});
        this._foodTrack.connect('notify::width', () => this._layoutFood());

        this._arc = new St.DrawingArea({style_class: 'hv-arc', height: 44, x_expand: true});
        this._arcData = [];
        this._arc.connect('repaint', a => {
            const [w, h] = a.get_surface_size();
            const cr = a.get_context();
            drawArc(cr, w, h, this._arcData);
            cr.$dispose();
        });
        this._arcLabel = new St.Label({style_class: 'hv-small', text: 'focus · energy · joy through the day'});

        for (const a of [this._scene, this._pose, this._now, this._story, this._cats, this._misc, this._foodLabel,
            this._foodTrack, this._arc, this._arcLabel])
            this.actor.add_child(a);

        this._food = 0;
    }

    _layoutFood() {
        const w = this._foodTrack.width;
        this._foodFill.set_size(Math.round(w * this._food), this._foodTrack.height || 6);
    }

    setFrame(f) {
        this._frame = f;
        this._pose.text = f.offline ? '' : (POSE_LABEL[f.pose] || '');
        this._scene.queue_repaint();
    }

    setNow(text) {
        this._now.text = text;
        this._now.visible = !!text;
    }

    setToday(t) {
        const m = t.minutes || {};
        this._story.text = t.story || '';
        this._cats.text = `Work ${fmt(m.work || 0)}   Watch ${fmt(m.watch || 0)}   Social ${fmt(m.social || 0)}   Read ${fmt(m.read || 0)}`;
        this._misc.text = `♪ ${fmt(t.music_min || 0)}   AI ${fmt(t.llm_min || 0)}   Focus blocks ${t.focus_blocks || 0}`;
        const goal = t.tokens_goal || 0;
        this._food = goal ? Math.min(1, t.tokens / goal) : 0;
        this._foodLabel.text = `Tokens eaten: ${Number(t.tokens || 0).toLocaleString()}`;
        this._layoutFood();
        this._arcData = t.arc || [];
        this._arc.queue_repaint();
    }

}

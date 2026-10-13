// AI activity: per-agent status and tokens, the last finished task, and the
// "tokens eaten today" bar.
import Clutter from 'gi://Clutter';
import St from 'gi://St';

import {cap, compact, fmtAgo, fmtDur, label, tile} from './widgets.js';

export class AgentsTile {
    constructor() {
        this.actor = tile('hv-agents');

        const head = new St.BoxLayout();
        head.add_child(label('AI activity', 'hv-tile-label', {x_expand: true}));
        this._total = label('', 'hv-tile-label', {x_align: Clutter.ActorAlign.END});
        head.add_child(this._total);
        this.actor.add_child(head);

        this._bar = new St.Widget({style_class: 'hv-track', x_expand: true});
        this._barFill = new St.Widget({style_class: 'hv-track-fill'});
        this._bar.add_child(this._barFill);
        this._bar.connect('notify::width', () => this._layoutBar());
        this.actor.add_child(this._bar);
        this._frac = 0;

        this._rows = new St.BoxLayout({vertical: true, style_class: 'hv-agent-rows'});
        this.actor.add_child(this._rows);
        this._rowMap = new Map();

        this._last = label('', 'hv-small');
        this._last.clutter_text.ellipsize = 3;
        this.actor.add_child(this._last);
    }

    _layoutBar() {
        this._barFill.set_size(Math.round(this._bar.width * this._frac), 6);
    }

    _row(name) {
        let r = this._rowMap.get(name);
        if (r)
            return r;
        const box = new St.BoxLayout({style_class: 'hv-agent-row'});
        const dot = new St.Widget({style_class: 'hv-agent-dot', y_align: Clutter.ActorAlign.CENTER});
        const nm = label(cap(name), 'hv-agent-name');
        const st = label('', 'hv-agent-status', {x_expand: true});
        const tok = label('', 'hv-agent-tokens', {x_align: Clutter.ActorAlign.END});
        for (const a of [dot, nm, st, tok])
            box.add_child(a);
        this._rows.add_child(box);
        r = {box, dot, st, tok};
        this._rowMap.set(name, r);
        return r;
    }

    setFrame(f) {
        for (const a of f.agents ?? []) {
            const r = this._row(a.name);
            // Keep the tile short: only agents that have done something today.
            r.box.visible = a.busy || a.tokens > 0 || a.name === 'claude';
            const status = a.busy ? `Working · ${fmtDur(a.secs)}` : 'Idle';
            if (r.st.text !== status) r.st.text = status;
            const tok = a.tokens ? compact(a.tokens) : '';
            if (r.tok.text !== tok) r.tok.text = tok;
            if (a.busy) r.dot.add_style_class_name('hv-agent-dot-busy');
            else r.dot.remove_style_class_name('hv-agent-dot-busy');
        }
        const d = f.last_done;
        const last = d ? `${cap(d.agent)} finished ${fmtAgo(d.ago)} · took ${fmtDur(d.secs)}` : '';
        if (this._last.text !== last) this._last.text = last;
    }

    setToday(t) {
        const goal = t.tokens_goal || 0;
        this._frac = goal ? Math.min(1, (t.tokens || 0) / goal) : 0;
        this._total.text = `${compact(t.tokens || 0)} of ${compact(goal)} tokens`;
        this._layoutBar();
    }
}

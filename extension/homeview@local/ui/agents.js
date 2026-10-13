// AI activity in hero / tall / square / wide.
import Clutter from 'gi://Clutter';
import St from 'gi://St';

import {BentoTile, cap, compact, fmtAgo, fmtDur, label} from './widgets.js';

export class AgentsTile extends BentoTile {
    constructor(opts) {
        super('ai', opts);
        this._frac = 0;
        this._tokens = 0;
        this._goal = 0;
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

    _rows() {
        this._rowMap = new Map();
        const box = new St.BoxLayout({vertical: true, style_class: 'hv-agent-rows'});
        this._rowsBox = box;
        return box;
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
        // Narrow tiles: no room for a status column; the dot says busy/idle.
        const parts = this.slot === 'tall' ? [dot, nm, new St.Widget({x_expand: true}), tok] : [dot, nm, st, tok];
        for (const a of parts)
            box.add_child(a);
        this._rowsBox.add_child(box);
        r = {box, dot, st, tok};
        this._rowMap.set(name, r);
        return r;
    }

    build(slot) {
        this._rowMap = new Map();
        this._rowsBox = this._barW = this._barFill = this._big = this._cap = this._headline = this._total = this._last = this._line = null;

        if (slot === 'hero') {
            this.actor.add_child(label('AI activity', 'hv-tile-label'));
            this._headline = label('', 'hv-hero-line');
            this.actor.add_child(this._headline);
            this._big = label('', 'hv-big-num');
            this.actor.add_child(this._big);
            this._total = label('', 'hv-small');
            this.actor.add_child(this._total);
            this.actor.add_child(this._bar());
            this._last = label('', 'hv-small');
            this._last.clutter_text.ellipsize = 3;
            this.actor.add_child(this._last);
        } else if (slot === 'tall') {
            this.actor.add_child(label('AI activity', 'hv-tile-label'));
            this.actor.add_child(this._rows());
            this._line = label('', 'hv-small');
            this._line.clutter_text.ellipsize = 3;
            this.actor.add_child(this._line);
            this.actor.add_child(this._bar());
            this._total = label('', 'hv-small');
            this._total.clutter_text.ellipsize = 3;
            this.actor.add_child(this._total);
        } else if (slot === 'wide') {
            this.actor.add_child(label('AI activity', 'hv-tile-label'));
            this._line = label('', 'hv-agent-name');
            this._line.clutter_text.ellipsize = 3;
            this.actor.add_child(this._line);
            this.actor.add_child(this._bar());
            this._total = label('', 'hv-small');
            this.actor.add_child(this._total);
        } else { // square
            this.actor.add_child(label('AI', 'hv-tile-label'));
            this._headline = label('', 'hv-agent-name');
            this._headline.clutter_text.ellipsize = 3;
            this.actor.add_child(this._headline);
            this._cap = label('', 'hv-small');
            this.actor.add_child(this._cap);
        }
    }

    update(f) {
        const agents = f.agents ?? [];
        const busy = agents.filter(a => a.busy).sort((a, b) => b.secs - a.secs);
        const lead = busy[0];
        const used = agents.filter(a => a.busy || a.tokens > 0);
        const d = f.last_done;

        if (this._rowsBox) {
            for (const a of agents) {
                const r = this._row(a.name);
                r.box.visible = a.busy || a.tokens > 0 || a.name === 'claude';
                const st = a.busy ? `Working · ${fmtDur(a.secs)}` : 'Idle';
                if (r.st.text !== st) r.st.text = st;
                const tk = a.tokens ? compact(a.tokens) : '';
                if (r.tok.text !== tk) r.tok.text = tk;
                if (a.busy) r.dot.add_style_class_name('hv-agent-dot-busy');
                else r.dot.remove_style_class_name('hv-agent-dot-busy');
            }
        }
        if (this._headline && this.slot === 'hero')
            this._headline.text = lead ? `${cap(lead.name)} is working` : used.length ? 'All quiet' : 'No AI activity yet';
        if (this._big)
            this._big.text = lead ? fmtDur(lead.secs) : d ? fmtDur(d.secs) : '—';
        if (this._headline && this.slot === 'square')
            this._headline.text = lead ? `${cap(lead.name)}` : 'Idle';
        if (this._cap)
            this._cap.text = lead ? `Working · ${fmtDur(lead.secs)}` : d ? `Done ${fmtAgo(d.ago)}` : 'No activity';
        if (this._line)
            this._line.text = lead ? `${cap(lead.name)} working · ${fmtDur(lead.secs)}` : d ? `${cap(d.agent)} finished ${fmtAgo(d.ago)}` : 'No AI activity yet';
        if (this._line && this.slot === 'wide')
            this._line.style_class = 'hv-agent-name';
        if (this._last)
            this._last.text = d ? `${cap(d.agent)} finished ${fmtAgo(d.ago)} · took ${fmtDur(d.secs)}` : '';
    }

    updateToday(t) {
        this._tokens = t.tokens || 0;
        this._goal = t.tokens_goal || 0;
        this._frac = this._goal ? Math.min(1, this._tokens / this._goal) : 0;
        if (this._total)
            this._total.text = this.slot === 'tall' ? `${compact(this._tokens)} / ${compact(this._goal)} tokens` : `${compact(this._tokens)} of ${compact(this._goal)} tokens today`;
        this._layoutBar();
    }
}

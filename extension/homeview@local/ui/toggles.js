// Four round buttons in the Home-grid style: lavender when a source is on.
import Clutter from 'gi://Clutter';
import St from 'gi://St';

import {tile} from './widgets.js';

const ITEMS = [
    {id: 'mpris', name: 'Music', icon: 'audio-headphones-symbolic'},
    {id: 'browser', name: 'Browser', icon: 'web-browser-symbolic'},
    {id: 'llm', name: 'AI', icon: 'starred-symbolic'},
    {id: 'hide', name: 'Hide', icon: 'view-conceal-symbolic'},
];

export class Toggles {
    constructor({send, onHide}) {
        this._send = send;
        this._btns = new Map();
        this._on = {};

        this.actor = tile('hv-toggles');
        const grid = new St.BoxLayout({style_class: 'hv-toggle-row', x_expand: true, x_align: Clutter.ActorAlign.CENTER});
        for (const it of ITEMS) {
            const btn = new St.Button({
                style_class: 'hv-toggle',
                can_focus: true,
                reactive: true,
                accessible_name: it.name,
                child: new St.Icon({icon_name: it.icon, style_class: 'hv-toggle-icon'}),
            });
            btn.connect('clicked', () => {
                if (it.id === 'hide') {
                    onHide();
                    return;
                }
                const next = !this._on[it.id];
                this._on[it.id] = next;
                this._paint(it.id);
                this._send({t: 'toggle', source: it.id, on: next});
            });
            grid.add_child(btn);
            this._btns.set(it.id, btn);
        }
        this.actor.add_child(grid);
    }

    _paint(id) {
        const b = this._btns.get(id);
        if (!b || id === 'hide')
            return;
        if (this._on[id]) b.add_style_pseudo_class('checked');
        else b.remove_style_pseudo_class('checked');
    }

    setFrame(f) {
        const s = f.sources || {};
        for (const id of ['mpris', 'browser', 'llm']) {
            if (id in s && this._on[id] !== s[id]) {
                this._on[id] = s[id];
                this._paint(id);
            }
        }
    }
}

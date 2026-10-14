// The bottom strip: four cards, icon over name. Lavender when a source is on.
import Clutter from 'gi://Clutter';
import St from 'gi://St';

import {BentoTile, onTap} from './widgets.js';

const ITEMS = [
    {id: 'mpris', name: 'Music', icon: 'audio-headphones-symbolic'},
    {id: 'browser', name: 'Browser', icon: 'web-browser-symbolic'},
    {id: 'llm', name: 'AI', icon: 'starred-symbolic'},
    {id: 'hide', name: 'Hide', icon: 'view-conceal-symbolic'},
];

export class Toggles extends BentoTile {
    constructor(opts) {
        super('toggles', opts);
        this._onHide = opts.onHide;
        this._on = {};
    }

    build(_slot) {
        this._btns = new Map();
        this.actor.vertical = false;
        this.actor.add_style_class_name('hv-gap8');
        this.actor.layout_manager.homogeneous = true; // four equal cards
        for (const it of ITEMS) {
            const box = new St.BoxLayout({vertical: true, x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER});
            box.add_child(new St.Icon({icon_name: it.icon, style_class: 'hv-card-icon', x_align: Clutter.ActorAlign.CENTER}));
            box.add_child(new St.Label({text: it.name, style_class: 'hv-card-name', x_align: Clutter.ActorAlign.CENTER}));
            const btn = new St.Button({
                style_class: 'hv-card-btn',
                can_focus: true,
                reactive: true,
                x_expand: true,
                y_expand: true,
                accessible_name: it.name,
                child: box,
            });
            onTap(btn, () => {
                if (it.id === 'hide') {
                    this._onHide();
                    return;
                }
                const next = !this._on[it.id];
                this._on[it.id] = next;
                this._paint(it.id);
                this.send({t: 'toggle', source: it.id, on: next});
            });
            this.actor.add_child(btn);
            this._btns.set(it.id, btn);
            this._paint(it.id);
        }
    }

    _paint(id) {
        const b = this._btns?.get(id);
        if (!b || id === 'hide')
            return;
        if (this._on[id]) b.add_style_pseudo_class('checked');
        else b.remove_style_pseudo_class('checked');
    }

    update(f) {
        const s = f.sources || {};
        for (const id of ['mpris', 'browser', 'llm']) {
            if (id in s && this._on[id] !== s[id]) {
                this._on[id] = s[id];
                this._paint(id);
            }
        }
    }
}

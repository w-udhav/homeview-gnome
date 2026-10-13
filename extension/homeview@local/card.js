// The hover popup: a bento grid of glass tiles. The daemon ranks which tiles
// matter right now and which slot each takes; this file only arranges them.
//
// This module is also the "UI bundle": extension.js imports everything it
// draws from here, so `hv reload-ui` can load a fresh copy of the whole UI.
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import St from 'gi://St';

import {drawFace, OFFLINE_FRAME} from './face.js';
import {AgentsTile} from './ui/agents.js';
import {DayTile} from './ui/day.js';
import {FocusTile} from './ui/focus.js';
import {NowPlaying} from './ui/now_playing.js';
import {TimerTile} from './ui/timer.js';
import {Toggles} from './ui/toggles.js';
import {WeatherTile} from './ui/weather.js';
import {GAP, label} from './ui/widgets.js';

export {drawFace, OFFLINE_FRAME};
export {createGlass} from './ui/glass.js';
export {Theme} from './ui/theme.js';
export {destroyArt} from './ui/art.js';

// Used when the daemon has not sent a layout yet.
const DEFAULT_LAYOUT = [
    {id: 'day', slot: 'hero'},
    {id: 'timer', slot: 'tall'},
    {id: 'ai', slot: 'square'},
    {id: 'focus', slot: 'square'},
    {id: 'toggles', slot: 'strip'},
];

export class Card {
    constructor({send, theme, onHide}) {
        this._theme = theme;
        this._frame = OFFLINE_FRAME;
        this._layoutKey = '';

        this.actor = new St.BoxLayout({vertical: true, style_class: `hv-card ${theme.cssClass}`});
        this._scroll = new St.ScrollView({
            style_class: 'hv-scroll',
            hscrollbar_policy: St.PolicyType.NEVER,
            vscrollbar_policy: St.PolicyType.AUTOMATIC,
            overlay_scrollbars: true,
            x_expand: true,
            y_expand: true,
        });
        this.actor.add_child(this._scroll);
        this._body = new St.BoxLayout({vertical: true, style_class: 'hv-body'});
        this._scroll.set_child(this._body);

        this._offline = label('Daemon offline', 'hv-offline');
        this._offline.hide();

        const opts = {send, theme, onHide};
        this.tiles = {
            now_playing: new NowPlaying(opts),
            timer: new TimerTile(opts),
            ai: new AgentsTile(opts),
            focus: new FocusTile(opts),
            day: new DayTile(opts),
            weather: new WeatherTile(opts),
            toggles: new Toggles(opts),
        };
        this._containers = [];

        theme.onChange(() => this._restyle());
        this.applyLayout(DEFAULT_LAYOUT);
    }

    _restyle() {
        this.onTheme?.(this._theme.dark);
        this.actor.remove_style_class_name('hv-dark');
        this.actor.remove_style_class_name('hv-light');
        this.actor.add_style_class_name(this._theme.cssClass);
        for (const t of Object.values(this.tiles)) {
            t.redraw?.();
            t._ring?.queue_repaint();
        }
    }

    /** Arrange tiles into the bento grid described by `layout` ([{id, slot}]). */
    applyLayout(layout) {
        const key = JSON.stringify(layout);
        if (key === this._layoutKey)
            return;
        this._layoutKey = key;

        // Detach everything first; tiles outlive their containers.
        for (const t of Object.values(this.tiles))
            t.actor.get_parent()?.remove_child(t.actor);
        this._offline.get_parent()?.remove_child(this._offline);
        for (const c of this._containers)
            c.destroy();
        this._containers = [];
        this._body.remove_all_children();
        this._body.add_child(this._offline);

        const by = {hero: [], tall: [], square: [], wide: [], strip: []};
        for (const {id, slot} of layout) {
            const tile = this.tiles[id];
            if (!tile || !by[slot])
                continue;
            tile.setSlot(slot);
            by[slot].push(tile);
        }

        const row = (...kids) => {
            const r = new St.BoxLayout({style_class: 'hv-bento-row'});
            for (const k of kids)
                r.add_child(k);
            this._containers.push(r);
            return r;
        };
        const col = (...kids) => {
            const c = new St.BoxLayout({vertical: true, style_class: 'hv-bento-col'});
            for (const k of kids)
                c.add_child(k);
            this._containers.push(c);
            return c;
        };

        for (const t of by.hero)
            this._body.add_child(t.actor);
        const tall = by.tall[0], squares = by.square.slice(0, 2);
        if (tall && squares.length)
            this._body.add_child(row(tall.actor, col(...squares.map(s => s.actor))));
        else if (tall)
            this._body.add_child(row(tall.actor));
        else if (squares.length)
            this._body.add_child(row(...squares.map(s => s.actor)));
        for (const t of by.wide)
            this._body.add_child(t.actor);
        for (const t of by.strip)
            this._body.add_child(t.actor);
    }

    /** Called when the popup opens: the one moment the layout may change. */
    open(frame) {
        this.applyLayout(frame.layout?.length ? frame.layout : DEFAULT_LAYOUT);
        this.setFrame(frame);
    }

    fitToScreen(maxHeight) {
        this._scroll.style = `max-height: ${Math.max(300, Math.floor(maxHeight))}px;`;
    }

    setFrame(f) {
        this._frame = f;
        const offline = !!f.offline;
        this._offline.visible = offline;
        if (offline)
            return;
        for (const t of Object.values(this.tiles))
            if (t.slot)
                t.setFrame(f);
    }

    setToday(t) {
        for (const tile of Object.values(this.tiles))
            tile.setToday(t);
    }
}

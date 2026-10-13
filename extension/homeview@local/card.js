// The hover popup: a glass card of tiles. Composition only; each tile lives
// in ui/. Light or dark follows the system setting.
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import St from 'gi://St';

import {OFFLINE_FRAME} from './face.js';
import {AgentsTile} from './ui/agents.js';
import {DayTile} from './ui/day.js';
import {NowPlaying} from './ui/now_playing.js';
import {TimerTile} from './ui/timer.js';
import {Toggles} from './ui/toggles.js';
import {WeatherTile} from './ui/weather.js';
import {label} from './ui/widgets.js';

export class Card {
    constructor({send, theme, onHide}) {
        this._theme = theme;
        this._send = send;
        this._frame = OFFLINE_FRAME;

        // Outer: the glass surface. Inner: scrolls only if the screen is short.
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
        const body = new St.BoxLayout({vertical: true, style_class: 'hv-body'});
        this._scroll.set_child(body);

        // header
        const header = new St.BoxLayout({style_class: 'hv-header'});
        const titles = new St.BoxLayout({vertical: true, x_expand: true});
        this._title = label('', 'hv-title');
        this._date = label('', 'hv-date');
        titles.add_child(this._title);
        titles.add_child(this._date);
        header.add_child(titles);
        this._offline = label('Daemon offline', 'hv-offline', {x_align: Clutter.ActorAlign.END});
        this._offline.hide();
        header.add_child(this._offline);
        body.add_child(header);

        this.now = new NowPlaying({send, theme});
        this.timer = new TimerTile({send, theme});
        this.weather = new WeatherTile();
        this.toggles = new Toggles({send, onHide});
        this.agents = new AgentsTile();
        this.day = new DayTile({theme});

        body.add_child(this.now.actor);

        const row = new St.BoxLayout({style_class: 'hv-row', x_expand: true});
        row.add_child(this.timer.actor);
        const right = new St.BoxLayout({vertical: true, style_class: 'hv-col', x_expand: true});
        right.add_child(this.weather.actor);
        right.add_child(this.toggles.actor);
        row.add_child(right);
        body.add_child(row);

        body.add_child(this.agents.actor);
        body.add_child(this.day.actor);

        theme.onChange(() => this._restyle());
        this._heartbeat = 0;
        this.updateHeader();
    }

    _restyle() {
        this.actor.remove_style_class_name('hv-dark');
        this.actor.remove_style_class_name('hv-light');
        this.actor.add_style_class_name(this._theme.cssClass);
        this.day.redraw();
        this.timer._ring.queue_repaint();
    }

    updateHeader() {
        const now = GLib.DateTime.new_now_local();
        const h = now.get_hour();
        this._title.text = h < 5 ? 'Still up?' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
        this._date.text = now.format('%A, %-d %B');
    }

    /** Cap the card to the screen so a short display scrolls instead of clipping. */
    fitToScreen(maxHeight) {
        this._scroll.style = `max-height: ${Math.max(300, Math.floor(maxHeight))}px;`;
    }

    setFrame(f) {
        this._frame = f;
        const offline = !!f.offline;
        this._offline.visible = offline;
        if (offline)
            return;
        this.now.setFrame(f);
        this.timer.setFrame(f);
        this.weather.setFrame(f);
        this.toggles.setFrame(f);
        this.agents.setFrame(f);
    }

    setToday(t) {
        this.agents.setToday(t);
        this.day.setToday(t);
        this.updateHeader();
    }
}

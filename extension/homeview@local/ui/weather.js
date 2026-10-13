// Weather: square and wide. Only ever placed when there is data.
import Clutter from 'gi://Clutter';
import St from 'gi://St';

import {BentoTile, label} from './widgets.js';

const ICONS = {
    clear: 'weather-clear-symbolic',
    partly: 'weather-few-clouds-symbolic',
    cloudy: 'weather-overcast-symbolic',
    fog: 'weather-fog-symbolic',
    rain: 'weather-showers-symbolic',
    snow: 'weather-snow-symbolic',
    storm: 'weather-storm-symbolic',
};

export class WeatherTile extends BentoTile {
    build(slot) {
        this._temp = this._desc = this._hl = this._icon = null;
        this._icon = new St.Icon({icon_name: ICONS.partly, style_class: 'hv-weather-icon', x_align: Clutter.ActorAlign.END});
        this._temp = label('', slot === 'wide' ? 'hv-big-num-md' : 'hv-weather-temp');
        this._desc = label('', 'hv-weather-desc');
        this._hl = label('', 'hv-small');
        if (slot === 'wide') {
            this.actor.vertical = false;
            this.actor.add_style_class_name('hv-gap12');
            const left = new St.BoxLayout({vertical: true, x_expand: true, y_align: Clutter.ActorAlign.CENTER});
            left.add_child(label('Weather', 'hv-tile-label'));
            left.add_child(this._temp);
            this.actor.add_child(left);
            const mid = new St.BoxLayout({vertical: true, y_align: Clutter.ActorAlign.CENTER});
            mid.add_child(this._desc);
            mid.add_child(this._hl);
            this.actor.add_child(mid);
            this.actor.add_child(this._icon);
        } else {
            const head = new St.BoxLayout();
            head.add_child(label('Weather', 'hv-tile-label', {x_expand: true}));
            head.add_child(this._icon);
            this.actor.add_child(head);
            this.actor.add_child(this._temp);
            this.actor.add_child(this._desc);
        }
    }

    update(f) {
        const w = f.weather;
        if (!w)
            return;
        this._icon.icon_name = ICONS[w.icon] ?? ICONS.cloudy;
        this._temp.text = `${Math.round(w.temp)}°`;
        this._desc.text = w.label;
        this._hl.text = `H ${Math.round(w.hi)}°  L ${Math.round(w.lo)}°`;
    }
}

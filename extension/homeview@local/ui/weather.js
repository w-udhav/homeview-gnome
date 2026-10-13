// Weather tile. Shows a hint instead of data until the user opts in.
import Clutter from 'gi://Clutter';
import St from 'gi://St';

import {label, tile} from './widgets.js';

const ICONS = {
    clear: 'weather-clear-symbolic',
    partly: 'weather-few-clouds-symbolic',
    cloudy: 'weather-overcast-symbolic',
    fog: 'weather-fog-symbolic',
    rain: 'weather-showers-symbolic',
    snow: 'weather-snow-symbolic',
    storm: 'weather-storm-symbolic',
};

export class WeatherTile {
    constructor() {
        this.actor = tile('hv-weather');
        const head = new St.BoxLayout();
        head.add_child(label('Weather', 'hv-tile-label', {x_expand: true}));
        this._icon = new St.Icon({icon_name: ICONS.partly, style_class: 'hv-weather-icon', x_align: Clutter.ActorAlign.END});
        head.add_child(this._icon);
        this.actor.add_child(head);

        this._temp = label('', 'hv-weather-temp');
        this._desc = label('', 'hv-weather-desc');
        this._hint = label('', 'hv-small');
        this._hint.clutter_text.line_wrap = true;
        this._hint.clutter_text.ellipsize = 0;
        this.actor.add_child(this._temp);
        this.actor.add_child(this._desc);
        this.actor.add_child(this._hint);
        this._key = '';
    }

    setFrame(f) {
        const w = f.weather;
        const key = w ? `${w.temp}|${w.icon}|${w.hi}|${w.lo}` : 'none';
        if (key === this._key)
            return;
        this._key = key;
        if (!w) {
            this._icon.hide();
            this._temp.text = '—';
            this._desc.text = 'Off';
            this._hint.text = 'Opt in under [weather] in config.toml';
            this._hint.show();
            return;
        }
        this._icon.show();
        this._icon.icon_name = ICONS[w.icon] ?? ICONS.cloudy;
        this._temp.text = `${Math.round(w.temp)}°`;
        this._desc.text = w.label;
        this._hint.text = `H ${Math.round(w.hi)}°  L ${Math.round(w.lo)}°`;
        this._hint.show();
    }
}

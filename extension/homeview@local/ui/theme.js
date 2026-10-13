// Light/dark follows GNOME's color-scheme. CSS handles most styling through
// the .hv-dark / .hv-light class on the card; this gives cairo-drawn parts
// (ring, chart, equaliser) the matching colours.
import Gio from 'gi://Gio';

export const ORANGE = [1.0, 0.62, 0.12];
export const LAVENDER = [0.62, 0.55, 0.95];

const PALETTE = {
    dark: {
        text: [1, 1, 1],
        sub: [1, 1, 1, 0.6],
        tickDim: [1, 1, 1, 0.2],
        grid: [1, 1, 1, 0.08],
        chartBg: [1, 1, 1, 0.05],
        series: {focus: [0.45, 0.75, 1], energy: [1, 0.76, 0.3], joy: [1, 0.5, 0.65]},
    },
    light: {
        text: [0.08, 0.08, 0.1],
        sub: [0, 0, 0, 0.55],
        tickDim: [0, 0, 0, 0.16],
        grid: [0, 0, 0, 0.08],
        chartBg: [0, 0, 0, 0.04],
        series: {focus: [0.1, 0.45, 0.9], energy: [0.92, 0.55, 0.05], joy: [0.85, 0.25, 0.5]},
    },
};

export class Theme {
    constructor() {
        this._s = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'});
        this._cbs = new Set();
        this._id = this._s.connect('changed::color-scheme', () => {
            for (const cb of this._cbs)
                cb(this.dark);
        });
    }

    get dark() {
        // 'default' means the OS default, which GNOME treats as light.
        return this._s.get_string('color-scheme') === 'prefer-dark';
    }

    get palette() {
        return this.dark ? PALETTE.dark : PALETTE.light;
    }

    get cssClass() {
        return this.dark ? 'hv-dark' : 'hv-light';
    }

    onChange(cb) {
        this._cbs.add(cb);
    }

    destroy() {
        if (this._id)
            this._s.disconnect(this._id);
        this._id = 0;
        this._cbs.clear();
    }
}

export const rgba = (cr, c, a = 1) => cr.setSourceRGBA(c[0], c[1], c[2], c.length > 3 ? c[3] * a : a);

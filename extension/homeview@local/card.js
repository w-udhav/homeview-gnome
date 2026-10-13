// The hover card. Layout follows the HomeView look: a black glass "screen"
// up top, then rounded tiles with large, light numerals and one warm accent.
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import St from 'gi://St';

import {drawArc, drawEq, drawFace, ARC_SERIES, OFFLINE_FRAME} from './face.js';
import {hsl, POSE_LABEL} from './robot.js';

const esc = s => GLib.markup_escape_text(s ?? '', -1);
const css = c => `rgb(${c.map(v => Math.round(v * 255)).join(',')})`;

function numMarkup(minutes) {
    const big = v => `<span size="x-large" weight="light">${v}</span>`;
    const unit = u => `<span size="small" alpha="55%"> ${u} </span>`;
    if (minutes >= 60)
        return `${big(Math.floor(minutes / 60))}${unit('h')}${big(minutes % 60)}${unit('m')}`;
    return `${big(minutes)}${unit('m')}`;
}

function compact(n) {
    if (n >= 1e6) return `${(n / 1e6).toFixed(1).replace(/\.0$/, '')}M`;
    if (n >= 1e3) return `${(n / 1e3).toFixed(1).replace(/\.0$/, '')}k`;
    return `${n}`;
}

const label = (text, cls) => new St.Label({style_class: cls, text, x_align: Clutter.ActorAlign.START});

export class Card {
    constructor({onHide}) {
        this._frame = OFFLINE_FRAME;
        this._arcData = [];

        this.actor = new St.BoxLayout({vertical: true, style_class: 'hv-card'});

        // --- header -------------------------------------------------------
        const header = new St.BoxLayout({vertical: true, style_class: 'hv-header'});
        this._title = label('', 'hv-title');
        this._date = label('', 'hv-date');
        header.add_child(this._title);
        header.add_child(this._date);
        this.actor.add_child(header);

        // --- hero: the robot's screen ---------------------------------------
        const hero = new St.BoxLayout({vertical: true, style_class: 'hv-hero'});
        this._screen = new St.DrawingArea({style_class: 'hv-screen', height: 150, x_expand: true});
        this._screen.connect('repaint', a => {
            const [w, h] = a.get_surface_size();
            const cr = a.get_context();
            drawFace(cr, w, h, this._frame, {mode: 'full'});
            cr.$dispose();
        });
        const caption = new St.BoxLayout({style_class: 'hv-caption'});
        this._pose = label('', 'hv-pose');
        this._speech = new St.Label({style_class: 'hv-speech', text: '', x_expand: true, x_align: Clutter.ActorAlign.END});
        this._speech.clutter_text.ellipsize = 3; // END
        caption.add_child(this._pose);
        caption.add_child(this._speech);
        hero.add_child(this._screen);
        hero.add_child(caption);
        this.actor.add_child(hero);

        // --- now playing ----------------------------------------------------
        this._np = new St.BoxLayout({style_class: 'hv-tile hv-np', x_expand: true});
        this._art = new St.Widget({style_class: 'hv-art', y_align: Clutter.ActorAlign.CENTER});
        const npText = new St.BoxLayout({vertical: true, x_expand: true, y_align: Clutter.ActorAlign.CENTER});
        this._npTitle = label('', 'hv-np-title');
        this._npTitle.clutter_text.ellipsize = 3;
        this._npArtist = label('', 'hv-np-artist');
        this._npArtist.clutter_text.ellipsize = 3;
        npText.add_child(this._npTitle);
        npText.add_child(this._npArtist);
        this._eq = new St.DrawingArea({style_class: 'hv-eq', width: 26, height: 22, y_align: Clutter.ActorAlign.CENTER});
        this._eq.connect('repaint', a => {
            const [w, h] = a.get_surface_size();
            const cr = a.get_context();
            drawEq(cr, w, h, this._frame.playing, this._eqColor || [1, 1, 1]);
            cr.$dispose();
        });
        this._np.add_child(this._art);
        this._np.add_child(npText);
        this._np.add_child(this._eq);
        this.actor.add_child(this._np);
        this._np.hide();

        // --- stat tiles ---------------------------------------------------------
        this._vals = {};
        const mkStat = (key, name) => {
            const tile = new St.BoxLayout({vertical: true, style_class: 'hv-tile hv-stat', x_expand: true});
            tile.add_child(label(name, 'hv-tile-label'));
            const v = new St.Label({style_class: 'hv-tile-value', text: '', x_align: Clutter.ActorAlign.START});
            tile.add_child(v);
            this._vals[key] = v;
            return tile;
        };
        const row1 = new St.BoxLayout({style_class: 'hv-row'});
        row1.add_child(mkStat('work', 'Work'));
        row1.add_child(mkStat('music', 'Music'));
        row1.add_child(mkStat('llm', 'With AI'));
        this.actor.add_child(row1);

        // --- tokens: the warm tile --------------------------------------------
        const tok = new St.BoxLayout({vertical: true, style_class: 'hv-tile hv-amber', x_expand: true});
        tok.add_child(label('Tokens eaten', 'hv-amber-label'));
        this._tokVal = new St.Label({style_class: 'hv-tile-value', text: '', x_align: Clutter.ActorAlign.START});
        tok.add_child(this._tokVal);
        this._tokTrack = new St.Widget({style_class: 'hv-track', x_expand: true});
        this._tokFill = new St.Widget({style_class: 'hv-track-fill'});
        this._tokTrack.add_child(this._tokFill);
        this._tokTrack.connect('notify::width', () => this._layoutTokens());
        tok.add_child(this._tokTrack);
        this.actor.add_child(tok);
        this._tokFrac = 0;

        // --- your day -------------------------------------------------------------
        const day = new St.BoxLayout({vertical: true, style_class: 'hv-tile hv-day', x_expand: true});
        this._dayLabel = label('Your day', 'hv-tile-label');
        day.add_child(this._dayLabel);
        this._story = new St.Label({style_class: 'hv-story', text: ''});
        this._story.clutter_text.line_wrap = true;
        this._story.clutter_text.ellipsize = 0;
        day.add_child(this._story);
        this._arc = new St.DrawingArea({style_class: 'hv-arc', height: 52, x_expand: true});
        this._arc.connect('repaint', a => {
            const [w, h] = a.get_surface_size();
            const cr = a.get_context();
            drawArc(cr, w, h, this._arcData);
            cr.$dispose();
        });
        day.add_child(this._arc);
        const legend = new St.BoxLayout({style_class: 'hv-legend'});
        for (const [name, c] of ARC_SERIES) {
            const dot = new St.Widget({style_class: 'hv-dot', style: `background-color: ${css(c)};`, y_align: Clutter.ActorAlign.CENTER});
            legend.add_child(dot);
            legend.add_child(label(name, 'hv-small'));
        }
        day.add_child(legend);
        this.actor.add_child(day);

        // --- footer -------------------------------------------------------------------
        const foot = new St.BoxLayout({style_class: 'hv-foot'});
        const hide = new St.Button({style_class: 'hv-pill', label: 'Hide for screen sharing', can_focus: true, reactive: true});
        hide.connect('clicked', () => onHide());
        foot.add_child(hide);
        this.actor.add_child(foot);
    }

    _layoutTokens() {
        const w = this._tokTrack.width;
        this._tokFill.set_size(Math.round(w * this._tokFrac), 6);
    }

    setFrame(f) {
        this._frame = f;
        this._pose.text = f.offline ? 'homeviewd is not running' : (POSE_LABEL[f.pose] || '');
        this._speech.text = f.speech ? `“${f.speech}”` : '';

        const showNp = !f.offline && !!f.title;
        this._np.visible = showNp;
        if (showNp) {
            this._npTitle.text = f.title;
            this._npArtist.text = f.artist || (f.playing ? 'Playing' : 'Paused');
            const a = hsl(f.hue, 0.7, 0.62), b = hsl(f.hue + 40, 0.7, 0.36);
            this._art.set_style(`background-gradient-direction: vertical; background-gradient-start: ${css(a)}; background-gradient-end: ${css(b)};`);
            this._eqColor = hsl(f.hue, 0.8, 0.75);
            this._eq.queue_repaint();
        }
        this._screen.queue_repaint();
    }

    setToday(t) {
        const now = GLib.DateTime.new_now_local();
        const h = now.get_hour();
        this._title.text = h < 5 ? 'Still up?' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
        this._date.text = now.format('%A, %-d %B');

        const m = t.minutes || {};
        const set = (k, markup) => this._vals[k].clutter_text.set_markup(markup);
        set('work', numMarkup(m.work || 0));
        set('music', numMarkup(t.music_min || 0));
        set('llm', numMarkup(t.llm_min || 0));
        const b = t.focus_blocks || 0;
        this._dayLabel.text = b ? `Your day · ${b} focus block${b === 1 ? '' : 's'}` : 'Your day';

        const goal = t.tokens_goal || 0;
        this._tokFrac = goal ? Math.min(1, (t.tokens || 0) / goal) : 0;
        this._tokVal.clutter_text.set_markup(
            `<span size="xx-large" weight="light">${esc(compact(t.tokens || 0))}</span>` +
            `<span size="small" alpha="70%"> of ${esc(compact(goal))}</span>`);
        this._layoutTokens();

        this._story.text = t.story || '';
        this._arcData = t.arc || [];
        this._arc.queue_repaint();
    }
}

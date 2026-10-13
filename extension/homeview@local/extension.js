// Homeview GNOME Shell extension. Thin on purpose: all state and logic live in
// the homeviewd daemon; this draws frames, reports focus/idle/pointer, and
// shows the hover card.
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import St from 'gi://St';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';

import {Client} from './client.js';
import * as ui0 from './card.js';

const IDLE_MS = 90 * 1000;
const FACE_W = 48;
const FACE_H = 28;

const Indicator = GObject.registerClass(
class HomeviewIndicator extends PanelMenu.Button {
    _init(ui) {
        super._init(0.5, 'Homeview', false);
        this.add_style_class_name('hv-button');

        // `ui` is the swappable UI bundle (card.js); see swapUi().
        this._ui = ui;
        this._frame = ui.OFFLINE_FRAME;
        this._area = new St.DrawingArea({width: FACE_W, height: FACE_H, y_align: Clutter.ActorAlign.CENTER});
        this._area.connect('repaint', a => {
            const [w, h] = a.get_surface_size();
            const cr = a.get_context();
            this._ui.drawFace(cr, w, h, this._frame);
            cr.$dispose();
        });
        this.add_child(this._area);

        // The card replaces the default menu content. The popup chrome itself is
        // made invisible (see .hv-popup); the card is the glass.
        this.menu._boxPointer?.add_style_class_name('hv-popup');
        this._buildCard();
        this._todayTimer = 0;

        this._hoverTimeout = 0;
        this.connect('destroy', () => {
            this._dead = true;
            this._cancelClose();
            if (this._todayTimer) {
                GLib.source_remove(this._todayTimer);
                this._todayTimer = 0;
            }
            this._glass?.destroy();
            this._theme?.destroy();
            this._ui.destroyArt();
            this._client = null;
        });
        this.connect('enter-event', () => {
            this._cancelClose();
            if (!this.menu.isOpen) {
                this._card.open(this._frame);
                this._card.fitToScreen(Main.layoutManager.primaryMonitor.height - 90);
                this.menu.open(false);
                this._refreshToday();
                this._startTodayTimer();
            }
            return Clutter.EVENT_PROPAGATE;
        });
        this.connect('leave-event', () => {
            this._scheduleClose();
            return Clutter.EVENT_PROPAGATE;
        });
        this.menu.actor.connect('enter-event', () => {
            this._cancelClose();
            return Clutter.EVENT_PROPAGATE;
        });
        this.menu.actor.connect('leave-event', () => {
            this._scheduleClose();
            return Clutter.EVENT_PROPAGATE;
        });
    }

    attachClient(client) {
        this._client = client;
    }

    _buildCard() {
        this._theme = new this._ui.Theme();
        this._card = new this._ui.Card({
            send: m => this._client?.send(m),
            theme: this._theme,
            onHide: () => this._client?.send({t: 'hide', hidden: true}),
        });
        this._glass = this._ui.createGlass(this._card.actor, {radius: 34});
        this.menu.box.add_child(this._glass.root);
        this._card.onTheme = dark => this._glass.setBrightness(dark ? 0.78 : 1.0);
        this._card.onTheme(this._theme.dark);
        this._card.open(this._frame);
    }

    /** Replace the UI with a freshly loaded bundle (hv reload-ui). */
    swapUi(ui) {
        if (this._dead)
            return;
        const wasOpen = this.menu.isOpen;
        if (wasOpen)
            this.menu.close(false);
        this._glass?.root.destroy();
        this._glass?.destroy();
        this._theme?.destroy();
        this._ui = ui;
        this._buildCard();
        this._card.fitToScreen(Main.layoutManager.primaryMonitor.height - 90);
        this._area.queue_repaint();
        this._refreshToday();
    }

    _startTodayTimer() {
        if (this._todayTimer)
            return;
        this._todayTimer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 5, () => {
            if (this._dead || !this.menu.isOpen) {
                this._todayTimer = 0;
                return GLib.SOURCE_REMOVE;
            }
            this._refreshToday();
            return GLib.SOURCE_CONTINUE;
        });
    }

    _refreshToday() {
        this._client?.send({t: 'today'});
    }

    _cancelClose() {
        if (this._hoverTimeout) {
            GLib.source_remove(this._hoverTimeout);
            this._hoverTimeout = 0;
        }
    }

    _scheduleClose() {
        this._cancelClose();
        this._hoverTimeout = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 350, () => {
            this._hoverTimeout = 0;
            if (!this.hover && !this.menu.actor.hover)
                this.menu.close(false);
            return GLib.SOURCE_REMOVE;
        });
    }

    setFrame(f) {
        if (this._dead)
            return;
        this._frame = f;
        this.visible = !f.hidden;
        if (this.menu.isOpen)
            this._card.setFrame(f);
        this._area.queue_repaint();
    }

    setOffline() {
        if (this._dead)
            return;
        this._frame = this._ui.OFFLINE_FRAME;
        this.visible = true;
        this._card.setFrame(this._ui.OFFLINE_FRAME);
        this._area.queue_repaint();
    }

    setToday(t) {
        if (this._dead)
            return;
        this._card.setToday(t);
    }

    // Centre of the face on screen, for gaze tracking.
    get alive() {
        return !this._dead;
    }

    faceCentre() {
        if (this._dead)
            return [0, 0];
        const [x, y] = this._area.get_transformed_position();
        return [x + FACE_W / 2, y + FACE_H / 2];
    }
});

function copyTree(src, dst) {
    dst.make_directory_with_parents(null);
    const en = src.enumerate_children('standard::name,standard::type', Gio.FileQueryInfoFlags.NONE, null);
    let info;
    while ((info = en.next_file(null)) !== null) {
        const name = info.get_name();
        const s = src.get_child(name), d = dst.get_child(name);
        if (info.get_file_type() === Gio.FileType.DIRECTORY)
            copyTree(s, d);
        else
            s.copy(d, Gio.FileCopyFlags.OVERWRITE, null, null);
    }
}

// Keep only the newest few reload copies on disk.
function pruneOldUi(current) {
    try {
        const root = Gio.File.new_for_path(GLib.path_get_dirname(current));
        const en = root.enumerate_children('standard::name', Gio.FileQueryInfoFlags.NONE, null);
        const names = [];
        let info;
        while ((info = en.next_file(null)) !== null)
            names.push(info.get_name());
        names.sort();
        for (const n of names.slice(0, Math.max(0, names.length - 4))) {
            const GLibRm = (f) => {
                const e2 = f.enumerate_children('standard::name,standard::type', Gio.FileQueryInfoFlags.NONE, null);
                let i2;
                while ((i2 = e2.next_file(null)) !== null) {
                    const c = f.get_child(i2.get_name());
                    if (i2.get_file_type() === Gio.FileType.DIRECTORY) GLibRm(c); else c.delete(null);
                }
                f.delete(null);
            };
            GLibRm(root.get_child(n));
        }
    } catch (e) {
        // best effort
    }
}

export default class HomeviewExtension extends Extension {
    enable() {
        this._ind = new Indicator(ui0);
        Main.panel.addToStatusArea(this.uuid, this._ind, 0, 'right');

        const path = GLib.build_filenamev([GLib.get_user_runtime_dir(), 'homeview.sock']);
        this._client = new Client(path, {
            onLine: msg => this._onMessage(msg),
            onConnect: () => {
                this._sendFocus();
            },
            onDisconnect: () => this._ind?.setOffline(),
        });
        this._ind.attachClient(this._client);
        this._client.start();

        this._focusSignal = global.display.connect('notify::focus-window', () => this._watchFocus());
        this._watchFocus();

        this._setupIdle();

        this._lastCursor = [0, 0];
        this._cursorTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 66, () => {
            this._sendCursor();
            return GLib.SOURCE_CONTINUE;
        });
    }

    disable() {
        if (this._cursorTimer) {
            GLib.source_remove(this._cursorTimer);
            this._cursorTimer = 0;
        }
        if (this._titleDebounce) {
            GLib.source_remove(this._titleDebounce);
            this._titleDebounce = 0;
        }
        if (this._focusSignal) {
            global.display.disconnect(this._focusSignal);
            this._focusSignal = 0;
        }
        this._unwatchTitle();
        if (this._idleMonitor) {
            if (this._idleWatch)
                this._idleMonitor.remove_watch(this._idleWatch);
            if (this._activeWatch)
                this._idleMonitor.remove_watch(this._activeWatch);
        }
        this._idleMonitor = null;
        this._idleWatch = 0;
        this._activeWatch = 0;
        this._client?.destroy();
        this._client = null;
        this._ind?.destroy();
        this._ind = null;
    }

    _onMessage(msg) {
        if (msg.t === 'frame')
            this._ind?.setFrame(msg);
        else if (msg.t === 'today')
            this._ind?.setToday(msg);
        else if (msg.t === 'reload_ui')
            this._reloadUi().catch(e => logError(e, 'homeview: reload-ui failed'));
    }

    // --- hot reload -------------------------------------------------------
    // GNOME caches modules by URL, so edits to this extension's files are only
    // picked up at login. To iterate without logging out, copy the UI files to
    // a fresh directory and import them from there (new URLs, new modules).
    async _reloadUi() {
        this._uiVersion = (this._uiVersion ?? 0) + 1;
        const dest = GLib.build_filenamev([GLib.get_user_runtime_dir(), 'homeview-ui', `v${Date.now()}-${this._uiVersion}`]);
        copyTree(Gio.File.new_for_path(this.path), Gio.File.new_for_path(dest));
        const mod = await import(`file://${dest}/card.js`);

        // Swap the stylesheet too.
        const theme = St.ThemeContext.get_for_stage(global.stage).get_theme();
        for (const prev of [this._loadedCss ?? Gio.File.new_for_path(`${this.path}/stylesheet.css`)]) {
            try {
                theme.unload_stylesheet(prev);
            } catch (e) {
                // not loaded
            }
        }
        this._loadedCss = Gio.File.new_for_path(`${dest}/stylesheet.css`);
        theme.load_stylesheet(this._loadedCss);

        this._ind?.swapUi(mod);
        log(`homeview: UI reloaded from ${dest}`);
        pruneOldUi(dest);
    }

    // --- focus -----------------------------------------------------------
    _watchFocus() {
        this._unwatchTitle();
        const win = global.display.focus_window;
        if (win) {
            this._titleWin = win;
            this._titleSignal = win.connect('notify::title', () => this._debouncedFocus());
        }
        this._sendFocus();
    }

    _unwatchTitle() {
        if (this._titleWin && this._titleSignal) {
            try {
                this._titleWin.disconnect(this._titleSignal);
            } catch (e) {
                // window already gone
            }
        }
        this._titleWin = null;
        this._titleSignal = 0;
    }

    _debouncedFocus() {
        if (this._titleDebounce)
            return;
        this._titleDebounce = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 800, () => {
            this._titleDebounce = 0;
            this._sendFocus();
            return GLib.SOURCE_REMOVE;
        });
    }

    _sendFocus() {
        const win = global.display.focus_window;
        if (!win || !this._client)
            return;
        const app = win.get_wm_class() || win.get_gtk_application_id() || '';
        this._client.send({t: 'focus', app, title: win.get_title() || ''});
    }

    // --- idle ------------------------------------------------------------
    _setupIdle() {
        this._idleMonitor = global.backend.get_core_idle_monitor();
        this._idleWatch = this._idleMonitor.add_idle_watch(IDLE_MS, () => {
            this._client?.send({t: 'idle', idle: true});
            // User-active watches are one-shot.
            this._activeWatch = this._idleMonitor.add_user_active_watch(() => {
                this._activeWatch = 0;
                this._client?.send({t: 'idle', idle: false});
            });
        });
    }

    // --- pointer ---------------------------------------------------------
    _sendCursor() {
        if (!this._client?.connected || !this._ind?.alive || !this._ind.visible)
            return;
        const [px, py] = global.get_pointer();
        const [cx, cy] = this._ind.faceCentre();
        const x = Math.max(-1, Math.min(1, (px - cx) / 500));
        const y = Math.max(-1, Math.min(1, (py - cy) / 300));
        if (Math.abs(x - this._lastCursor[0]) < 0.03 && Math.abs(y - this._lastCursor[1]) < 0.03)
            return;
        this._lastCursor = [x, y];
        this._client.send({t: 'cursor', x, y});
    }
}

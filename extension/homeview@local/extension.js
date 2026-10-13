// Homeview GNOME Shell extension. Thin on purpose: all state and logic live in
// the homeviewd daemon; this draws frames, reports focus/idle/pointer, and
// shows the hover card.
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {Client} from './client.js';
import {Card} from './card.js';
import {drawFace, OFFLINE_FRAME} from './face.js';

const IDLE_MS = 90 * 1000;
const FACE_W = 56;
const FACE_H = 24;

const Indicator = GObject.registerClass(
class HomeviewIndicator extends PanelMenu.Button {
    _init() {
        super._init(0.5, 'Homeview', false);
        this.add_style_class_name('hv-button');

        this._frame = OFFLINE_FRAME;
        this._area = new St.DrawingArea({width: FACE_W, height: FACE_H, y_align: Clutter.ActorAlign.CENTER});
        this._area.connect('repaint', a => {
            const [w, h] = a.get_surface_size();
            const cr = a.get_context();
            drawFace(cr, w, h, this._frame);
            cr.$dispose();
        });
        this.add_child(this._area);

        // Card inside the popup menu.
        this._card = new Card();
        const item = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
        item.add_child(this._card.actor);
        this.menu.addMenuItem(item);
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this._hideItem = this.menu.addAction('Hide (for screen sharing)', () => this._client?.send({t: 'hide', hidden: true}));

        this._hoverTimeout = 0;
        this.connect('destroy', () => {
            this._dead = true;
            this._cancelClose();
            this._client = null;
        });
        this.connect('enter-event', () => {
            this._cancelClose();
            if (!this.menu.isOpen) {
                this.menu.open(false);
                this._refreshToday();
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
        this._card.setNow([f.status, f.speech ? `“${f.speech}”` : ''].filter(Boolean).join('\n'));
        this._area.queue_repaint();
    }

    setOffline() {
        if (this._dead)
            return;
        this._frame = OFFLINE_FRAME;
        this.visible = true;
        this._card.setNow('homeviewd is not running');
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

export default class HomeviewExtension extends Extension {
    enable() {
        this._ind = new Indicator();
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

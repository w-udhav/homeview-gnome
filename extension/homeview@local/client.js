// Reconnecting JSON-lines client for the homeviewd Unix socket.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const RETRY_SECONDS = 2;

export class Client {
    constructor(path, {onLine, onConnect, onDisconnect}) {
        this._path = path;
        this._onLine = onLine;
        this._onConnect = onConnect;
        this._onDisconnect = onDisconnect;
        this._encoder = new TextEncoder();
        this._cancellable = null;
        this._conn = null;
        this._out = null;
        this._in = null;
        this._retryId = 0;
        this._destroyed = false;
    }

    get connected() {
        return this._out !== null;
    }

    start() {
        this._connect();
    }

    _connect() {
        if (this._destroyed)
            return;
        this._cancellable = new Gio.Cancellable();
        const client = new Gio.SocketClient();
        const addr = Gio.UnixSocketAddress.new(this._path);
        client.connect_async(addr, this._cancellable, (c, res) => {
            let conn;
            try {
                conn = c.connect_finish(res);
            } catch (e) {
                this._scheduleRetry();
                return;
            }
            if (this._destroyed) {
                conn.close(null);
                return;
            }
            this._conn = conn;
            this._out = conn.get_output_stream();
            this._in = new Gio.DataInputStream({base_stream: conn.get_input_stream()});
            this.send({t: 'subscribe'});
            this._onConnect?.();
            this._read();
        });
    }

    _read() {
        const stream = this._in;
        if (!stream)
            return;
        stream.read_line_async(GLib.PRIORITY_DEFAULT, this._cancellable, (s, res) => {
            let line;
            try {
                [line] = s.read_line_finish_utf8(res);
            } catch (e) {
                this._drop();
                return;
            }
            if (line === null) {
                this._drop();
                return;
            }
            try {
                this._onLine(JSON.parse(line));
            } catch (e) {
                logError(e, 'homeview: bad line');
            }
            this._read();
        });
    }

    send(obj) {
        if (!this._out)
            return;
        try {
            this._out.write_all(this._encoder.encode(`${JSON.stringify(obj)}\n`), null);
        } catch (e) {
            this._drop();
        }
    }

    _drop() {
        if (this._cancellable) {
            this._cancellable.cancel();
            this._cancellable = null;
        }
        try {
            this._conn?.close(null);
        } catch (e) {
            // already closed
        }
        const was = this._out !== null;
        this._conn = null;
        this._out = null;
        this._in = null;
        if (was)
            this._onDisconnect?.();
        this._scheduleRetry();
    }

    _scheduleRetry() {
        if (this._destroyed || this._retryId)
            return;
        this._retryId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, RETRY_SECONDS, () => {
            this._retryId = 0;
            this._connect();
            return GLib.SOURCE_REMOVE;
        });
    }

    destroy() {
        this._destroyed = true;
        if (this._retryId) {
            GLib.source_remove(this._retryId);
            this._retryId = 0;
        }
        this._cancellable?.cancel();
        this._cancellable = null;
        try {
            this._conn?.close(null);
        } catch (e) {
            // ignore
        }
        this._conn = null;
        this._out = null;
        this._in = null;
    }
}

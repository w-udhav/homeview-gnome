// Album art: whatever image the player already advertises (mpris:artUrl).
// Remote art is downloaded once to the user cache dir and reused. This
// contacts the site the player got the art from (e.g. YouTube's image CDN),
// nothing else.
import Gio from 'gi://Gio';
import GdkPixbuf from 'gi://GdkPixbuf';
import GLib from 'gi://GLib';
import Soup from 'gi://Soup?version=3.0';

import {paletteFromPixels} from './palette.js';

const cacheDir = GLib.build_filenamev([GLib.get_user_cache_dir(), 'homeview', 'art']);
const memo = new Map();   // url -> path | null
const pending = new Map(); // url -> Promise
let session = null;

const enc = new TextEncoder();

export function artPath(url) {
    return GLib.build_filenamev([cacheDir, GLib.compute_checksum_for_string(GLib.ChecksumType.SHA1, url, -1)]);
}

/** Resolves to a local file path, or null if it cannot be had. */
export function loadArt(url) {
    if (!url)
        return Promise.resolve(null);
    if (url.startsWith('file://'))
        return Promise.resolve(GLib.filename_from_uri(url)[0]);
    if (!/^https?:\/\//.test(url))
        return Promise.resolve(null);
    if (memo.has(url))
        return Promise.resolve(memo.get(url));
    if (pending.has(url))
        return pending.get(url);

    const p = (async () => {
        const path = artPath(url);
        if (GLib.file_test(path, GLib.FileTest.EXISTS)) {
            memo.set(url, path);
            return path;
        }
        try {
            GLib.mkdir_with_parents(cacheDir, 0o700);
            session ??= new Soup.Session({timeout: 10});
            const msg = Soup.Message.new('GET', url);
            const bytes = await new Promise((resolve, reject) => {
                session.send_and_read_async(msg, GLib.PRIORITY_LOW, null, (s, res) => {
                    try {
                        resolve(s.send_and_read_finish(res));
                    } catch (e) {
                        reject(e);
                    }
                });
            });
            if (msg.get_status() !== Soup.Status.OK || bytes.get_size() === 0)
                throw new Error(`art http ${msg.get_status()}`);
            Gio.File.new_for_path(path).replace_contents(bytes.get_data(), null, false, Gio.FileCreateFlags.NONE, null);
            memo.set(url, path);
            return path;
        } catch (e) {
            memo.set(url, null);
            return null;
        } finally {
            pending.delete(url);
        }
    })();
    pending.set(url, p);
    return p;
}

const palettes = new Map();

/** Two background colours from the art file at `path`, or null if it cannot be decoded. */
export function artPalette(path) {
    if (palettes.has(path))
        return palettes.get(path);
    let result = null;
    try {
        const pb = GdkPixbuf.Pixbuf.new_from_file_at_scale(path, 24, 24, false);
        const data = pb.get_pixels();
        const ch = pb.get_n_channels(), stride = pb.get_rowstride();
        const px = [];
        for (let y = 0; y < pb.get_height(); y++) {
            for (let x = 0; x < pb.get_width(); x++) {
                const i = y * stride + x * ch;
                // Ignore transparent pixels.
                if (ch === 4 && data[i + 3] < 128)
                    continue;
                px.push(data[i], data[i + 1], data[i + 2]);
            }
        }
        result = paletteFromPixels(px);
    } catch (e) {
        // Unsupported format (e.g. no WebP loader): callers fall back to the hue tint.
    }
    palettes.set(path, result);
    return result;
}

/**
 * A copy of the art centre-cropped to w:h and scaled to 2x, cached on disk.
 * St cannot "cover" a background and does not clip one that overflows, so the
 * full-bleed tiles need an image of exactly their aspect ratio.
 */
export function cropToTile(path, w, h) {
    const out = `${path}-${w}x${h}.png`;
    if (GLib.file_test(out, GLib.FileTest.EXISTS))
        return out;
    try {
        const src = GdkPixbuf.Pixbuf.new_from_file_at_scale(path, 1000, 1000, true);
        const sw = src.get_width(), sh = src.get_height();
        const want = w / h;
        let cw = sw, ch = sh;
        if (sw / sh > want)
            cw = Math.round(sh * want);
        else
            ch = Math.round(sw / want);
        const sub = src.new_subpixbuf(Math.floor((sw - cw) / 2), Math.floor((sh - ch) / 2), cw, ch);
        const scaled = sub.scale_simple(w * 2, h * 2, GdkPixbuf.InterpType.BILINEAR);
        scaled.savev(out, 'png', [], []);
        return out;
    } catch (e) {
        return null;
    }
}

export function destroyArt() {
    palettes.clear();
    session?.abort();
    session = null;
    memo.clear();
    pending.clear();
}

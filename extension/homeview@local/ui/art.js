// Album art: whatever image the player already advertises (mpris:artUrl).
// Remote art is downloaded once to the user cache dir and reused. This
// contacts the site the player got the art from (e.g. YouTube's image CDN),
// nothing else.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Soup from 'gi://Soup?version=3.0';

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

export function destroyArt() {
    session?.abort();
    session = null;
    memo.clear();
    pending.clear();
}

// Real glass: blur whatever is behind the card, then clip to rounded corners.
// Shell.BlurEffect blurs a rectangle, so a small shader trims the corners.
// Everything is best-effort: if any piece is unavailable the card keeps its
// translucent tint (still readable, just not blurred).
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import Cogl from 'gi://Cogl';
import GObject from 'gi://GObject';
import Shell from 'gi://Shell';

const SHADER = `
uniform sampler2D tex;
uniform float radius;
uniform float width;
uniform float height;
void main() {
    vec4 c = texture2D(tex, cogl_tex_coord_in[0].xy);
    vec2 size = vec2(width, height);
    vec2 p = cogl_tex_coord_in[0].xy * size - size * 0.5;
    vec2 q = abs(p) - (size * 0.5 - vec2(radius));
    float d = length(max(q, vec2(0.0))) + min(max(q.x, q.y), 0.0) - radius;
    float a = clamp(0.5 - d, 0.0, 1.0);
    cogl_color_out = c * a;
}`;

// GType names are global, so a reloaded copy of this module needs a fresh one.
const RoundedClip = GObject.registerClass({GTypeName: `HomeviewRoundedClip${GLib.get_monotonic_time()}`},
class HomeviewRoundedClip extends Clutter.ShaderEffect {
    _init(radius) {
        super._init({shader_type: Cogl.ShaderType.FRAGMENT});
        this._radius = radius;
        this.set_shader_source(SHADER);
    }

    vfunc_paint_target(node, paintContext) {
        const actor = this.get_actor();
        if (actor) {
            const [w, h] = actor.get_size();
            this.set_uniform_value('tex', 0);
            this.set_uniform_value('radius', this._radius - 1e-6);
            this.set_uniform_value('width', w + 1e-6);
            this.set_uniform_value('height', h + 1e-6);
        }
        super.vfunc_paint_target(node, paintContext);
    }
});

/**
 * Wrap `content` in a glass surface and return {root, destroy, setBrightness}.
 *
 * Shell.BlurEffect(BACKGROUND) only blurs the wallpaper, so windows behind the
 * popup stay sharp. Instead we paint blurred live clones of the wallpaper and
 * window layers behind the content, aligned to the screen and clipped to the
 * card, then trim the whole thing to rounded corners.
 * Any failure degrades to a plain translucent card (the content's own tint).
 */
export function createGlass(content, {radius = 30, blur = 36, brightness = 0.8} = {}) {
    const root = new St.Widget({layout_manager: new Clutter.BinLayout(), x_expand: true, y_expand: true});
    let backdrop = null, blurFx = null, clones = [];

    try {
        backdrop = new St.Widget({x_expand: true, y_expand: true, clip_to_allocation: true});
        const layers = [Main.layoutManager._backgroundGroup, global.window_group].filter(Boolean);
        const holder = new St.Widget();
        for (const src of layers) {
            const c = new Clutter.Clone({source: src});
            clones.push(c);
            holder.add_child(c);
        }
        backdrop.add_child(holder);
        blurFx = new Shell.BlurEffect({mode: Shell.BlurMode.ACTOR, radius: blur, brightness});
        holder.add_effect_with_name('hv-blur', blurFx);

        // Keep the clones pinned to the screen origin as the card moves.
        const mon = Main.layoutManager.primaryMonitor;
        holder.set_size(mon.x + mon.width, mon.y + mon.height);
        const align = () => {
            const [sx, sy] = backdrop.get_transformed_position();
            if (!Number.isFinite(sx) || !Number.isFinite(sy))
                return;
            holder.set_position(-Math.round(sx), -Math.round(sy));
        };
        // The (screen-sized) clones must not make the card screen-sized: pin the
        // backdrop to exactly the content's size.
        backdrop.set_size(0, 0);
        content.connect('notify::allocation', () => {
            const [w, h] = content.get_size();
            if (w > 0 && h > 0)
                backdrop.set_size(w, h);
            align();
        });
        backdrop.connect('notify::mapped', align);
        root.add_child(backdrop);
    } catch (e) {
        logError(e, 'homeview: backdrop blur unavailable, using a plain tint');
        backdrop = null;
    }
    root.add_child(content);

    try {
        root.add_effect_with_name('hv-clip', new RoundedClip(radius));
    } catch (e) {
        logError(e, 'homeview: rounded clip unavailable');
    }

    return {
        root,
        setBrightness(b) {
            if (blurFx)
                blurFx.brightness = b;
        },
        destroy() {
            clones = [];
        },
    };
}

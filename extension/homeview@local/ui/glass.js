// Real glass: blur whatever is behind the card, then clip to rounded corners.
// Shell.BlurEffect blurs a rectangle, so a small shader trims the corners.
// Everything is best-effort: if any piece is unavailable the card keeps its
// translucent tint (still readable, just not blurred).
import Clutter from 'gi://Clutter';
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

const RoundedClip = GObject.registerClass(
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

/** Returns a function that removes the effects, or null if glass is unavailable. */
export function applyGlass(actor, {radius = 32, blur = 38, brightness = 0.9} = {}) {
    try {
        const blurFx = new Shell.BlurEffect({mode: Shell.BlurMode.BACKGROUND, radius: blur, brightness});
        const clip = new RoundedClip(radius);
        actor.add_effect_with_name('hv-clip', clip);
        actor.add_effect_with_name('hv-blur', blurFx);
        return () => {
            actor.remove_effect_by_name('hv-blur');
            actor.remove_effect_by_name('hv-clip');
        };
    } catch (e) {
        logError(e, 'homeview: glass unavailable, using plain tint');
        return null;
    }
}

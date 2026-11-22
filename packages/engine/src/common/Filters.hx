package common;
import pixi.core.renderers.webgl.filters.Filter;
import pixi.filters.extras.GlowFilter as PixiGlowFilter;
import pixi.filters.blur.BlurFilter as PixiBlurFilter;
import pixi.filters.colormatrix.ColorMatrixFilter as PixiColorMatrixFilter;
import pixi.filters.alpha.AlphaFilter as PixiAlphaFilter;

class GlowFilter  {
    static var CACHE: haxe.ds.StringMap<Filter>;

    static public function create(color:Int, alpha:Float, blurX:Float, blurY:Float, ?strength:Float, ?quality:Int, ?inner:Bool, ?knockout:Bool): Array<Filter> {
        if (CACHE == null) {
            CACHE = new haxe.ds.StringMap();
        }
        var a = alpha == null ? 1.0 : alpha;
        var bx = blurX == null ? 0.0 : blurX;
        var by = blurY == null ? 0.0 : blurY;
        var s = strength == null ? 2.0 : strength;
        if (a <= 0.02 || (bx <= 0.2 && by <= 0.2) || s <= 0.0) {
            return [];
        }
        var rawDist = (bx + by) * 0.5;
        var dist = rawDist <= 3.5 ? 2 : (rawDist <= 7.0 ? 4 : (rawDist <= 14.0 ? 8 : 12));
        var eff = Math.min(3.5, s <= 1.5 ? s * 1.8 : 1.5 + Math.log(s) * 0.6) * Math.min(1.0, a);
        eff = Math.round(eff * 10.0) / 10.0;
        if (eff <= 0.05) {
            return [];
        }
        var isInner = inner == true;
        var isKnockout = knockout == true;
        var key = dist + ":" + (isInner ? 1 : 0) + ":" + (isKnockout ? 1 : 0) + ":" + color + ":" + eff;
        var cached = CACHE.get(key);
        if (cached == null) {
            var opts: Dynamic = {
                distance: dist,
                outerStrength: isInner ? 0.0 : eff,
                innerStrength: isInner ? eff : 0.0,
                color: color,
                quality: 0.25,
                knockout: isKnockout
            };
            cached = untyped __js__("new PIXI.filters.GlowFilter({0})", opts);
            CACHE.set(key, cached);
        }
        return [cached];
    }
}

class BlurFilter  {
    static public function create(blurX:Float, blurY:Float, quality:Float = 1): PixiBlurFilter {
        var filter = new PixiBlurFilter();
        filter.blurX = blurX;
        filter.blurY = blurY;
        filter.passes = Math.ceil(quality);
        return filter;
    }
}

class ColorMatrixFilter  {
    static public function create(matrix: Array<Float>): PixiColorMatrixFilter {
        var filter = new PixiColorMatrixFilter();
        if (Manager.app != null && Manager.app.renderer != null) {
            (untyped filter).resolution = Manager.app.renderer.resolution;
        }
        if (matrix != null && matrix.length == 20) {
            var norm = matrix.slice(0);
            norm[4] /= 255.0;
            norm[9] /= 255.0;
            norm[14] /= 255.0;
            norm[19] /= 255.0;
            filter.matrix = norm;
        }
        return filter;
    }
}

@:native("PIXI.filters.DropShadowFilter")
extern class PixiDropShadowFilter extends Filter {
	function new(options: Dynamic);
}

class DropShadowFilter {
    static public function create(distance:Float, angle:Float, color:Int, alpha:Float, blurX:Float, blurY:Float, ?strength:Float, ?quality:Float, ?inner:Bool, ?knockout:Bool, ?hideObject:Bool):PixiDropShadowFilter {
        return new PixiDropShadowFilter({
            rotation: angle,
            distance: distance,
            blur: (blurX + blurY) / 10,
            color: color,
            alpha: alpha
        });
    }
}
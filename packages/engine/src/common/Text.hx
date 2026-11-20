package common;

import pixi.core.text.Text as PixiText;
import pixi.core.text.DefaultStyle;
import pixi.core.math.shapes.Rectangle;

@:build(common.macros.Alias.build("x", "_x"))
@:build(common.macros.Alias.build("y", "_y"))
@:build(common.macros.Alias.build("width", "_width"))
@:build(common.macros.Alias.build("height", "_height"))
@:build(common.macros.Alias.build("visible", "_visible"))
@:build(common.macros.Alias.build("text", "htmlText"))
@:build(common.macros.Alias.build("width", "textWidth"))
class Text extends PixiText {
    var containerWidth: Float;
    var containerHeight: Float;
    var currentWidth: Float;
    var currentHeight: Float;
    var align: String;

	public var onChanged(default, set):String->Void;

    public var wordWrap(get, set): Bool;
    public var multiline(get, set): Bool;
    public var textColor(get, set): Dynamic;
    public var textHeight(get, set): Float;

    public function new(containerWidth: Float, containerHeight: Float, initialText: String, align: String = "left", ?style:DefaultStyle) {
        super(initialText, style);
        this.align = align;
        this.containerWidth = containerWidth;
        this.containerHeight = containerHeight;
        this.currentWidth = containerWidth;
        this.currentHeight = containerHeight;

        var dpr: Float = 2.0;
        if (js.Browser.window.devicePixelRatio != null && js.Browser.window.devicePixelRatio > 2.0) {
            dpr = js.Browser.window.devicePixelRatio;
        }
        untyped this.resolution = dpr;
        untyped this.roundPixels = true;
    }

    public function get_wordWrap(): Bool {
        return this.style.wordWrap;
    }
    public function set_wordWrap(value: Bool): Bool {
        this.style.wordWrap = value;
        return value;
    }

    public function get_multiline(): Bool {
        return this.style.breakWords;
    }
    public function set_multiline(value: Bool): Bool {
        this.style.breakWords = value;
        return value;
    }

    public function get_textColor(): Dynamic {
        return this.style.fill;
    }
    public function set_textColor(value: Dynamic): Dynamic {
        this.style.fill = value;
        return value;
    }

    public function get_textHeight(): Float {
        return this.style.lineHeight;
    }
    public function set_textHeight(value: Float): Float {
        this.style.lineHeight = value;
        return value;
    }

    public function set_onChanged(v:String->Void):String->Void {
		return v;
	}

    override function updateTransform(): Void {
        super.updateTransform();
    }

    public function get_x(): Float {
        if (this.width != currentWidth) {
            switch (align) {
                case "left":
                case "right":
                    this.x = this.x + currentWidth - this.width;
                case "center":
                    this.x = this.x + (currentWidth - this.width) / 2;
            }
        }
        return this.x;
    }

    override public function getLocalBounds(?rect: Rectangle): Rectangle {
        return super.getLocalBounds(rect);
    }
}

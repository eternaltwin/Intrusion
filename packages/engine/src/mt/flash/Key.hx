package mt.flash;

import haxe.ds.IntMap;
import js.html.KeyboardEvent;

class Key {
	static public inline var ARROW_DOWN = 40;
	static public inline var ARROW_UP = 38;
	static public inline var ARROW_LEFT = 37;
	static public inline var ARROW_RIGHT = 39;
	static public inline var ESCAPE = 27;
	static public inline var DELETE = 46;
	static public inline var BACKSPACE = 8;
	static public inline var TAB = 9;
	static public inline var CONTROL = 17;
	static public inline var SHIFT = 16;
	static public inline var ALT = 18;
	static public inline var ENTER = 13;
	static public inline var SPACE = 32;
	static public inline var PGUP = 33;
	static public inline var PGDN = 34;

	static private var keyState:IntMap<Bool> = new IntMap();
	static private var initialized:Bool = false;

	static public var lastDown:Int;

	static var ktime:Int = 0;
	static var kcodes = new Array<Null<Int>>();

	static public function init() {
		keyState = new IntMap();
		kcodes = new Array<Null<Int>>();
		if (initialized) return;
		initialized = true;
		js.Browser.window.addEventListener("keydown", onKeyDown);
		js.Browser.window.addEventListener("keyup", onKeyUp);
	}

	static public function destroy() {
		if (!initialized) return;
		initialized = false;
		js.Browser.window.removeEventListener("keydown", onKeyDown);
		js.Browser.window.removeEventListener("keyup", onKeyUp);
		keyState = new IntMap();
		kcodes = new Array<Null<Int>>();
	}

	static private function onKeyUp(e:KeyboardEvent):Void {
		keyState.remove(e.keyCode);
		kcodes[e.keyCode] = null;
	}

	static private function onKeyDown(e:KeyboardEvent) {
		keyState.set(e.keyCode, true);
		lastDown = e.keyCode;
		kcodes[e.keyCode] = ktime;
	}

	static public function isArrowDown():Bool {
		return isDown(ARROW_RIGHT) || isDown(ARROW_UP) || isDown(ARROW_LEFT) || isDown(ARROW_DOWN);
	}

	public static function isDown(c:Int) {
		return kcodes[c] != null;
	}

	public static function isToggled(c:Int) {
		return kcodes[c] == ktime;
	}

	static function onEnterFrame(_) {
		ktime++;
	}
}

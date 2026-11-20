package common;

import haxe.ds.IntMap;
import js.html.KeyboardEvent;

class KeyboardManager {
	static public inline var ARROW_DOWN = 40;
	static public inline var ARROW_UP = 38;
	static public inline var ARROW_LEFT = 37;
	static public inline var ARROW_RIGHT = 39;
	static public inline var SPACE = 32;
	static public inline var ESCAPE = 27;

	static private var keyState:IntMap<Bool> = new IntMap();
	static private var initialized:Bool = false;

	static public var lastDown:Int;

	static private function isFormField(e:KeyboardEvent):Bool {
		var t:Dynamic = e.target;
		if (t == null || t.tagName == null) return false;
		var tag:String = Std.string(t.tagName).toUpperCase();
		return tag == "INPUT" || tag == "TEXTAREA" || tag == "SELECT";
	}

	static public function init() {
		keyState = new IntMap();
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
	}

	static private function onKeyUp(e:KeyboardEvent):Void {
		if (isFormField(e)) return;
		keyState.remove(e.keyCode);
	}

	static private function onKeyDown(e:KeyboardEvent) {
		if (isFormField(e)) return;
		keyState.set(e.keyCode, true);
		lastDown = e.keyCode;
		if (e.keyCode == SPACE || e.keyCode == ARROW_DOWN || e.keyCode == ARROW_UP || e.keyCode == 9)
			e.preventDefault();
	}

	static public function isDown(keyCode:Int):Bool {
		return keyState != null && keyState.exists(keyCode);
	}

	static public function isArrowDown():Bool {
		return isDown(ARROW_RIGHT) || isDown(ARROW_UP) || isDown(ARROW_LEFT) || isDown(ARROW_DOWN);
	}
}

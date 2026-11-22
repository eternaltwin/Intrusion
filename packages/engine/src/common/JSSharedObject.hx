package common;

import haxe.Json;
import js.Browser;
import haxe.ds.StringMap;

class JSSharedObject {
	static var sharedObjects:StringMap<JSSharedObject> = new StringMap();

	public var data:Dynamic;
	public var name:String;

	public function new(name:String) {
		this.name = name;
		this.data = {};
		try {
			var existing = Browser.window.localStorage.getItem(name);
			if (existing != null) {
				var parsed: Dynamic = Json.parse(existing);
				if (parsed != null) this.data = parsed;
			}
		} catch (e: Dynamic) {
			this.data = {};
		}
	}

	public function flush() {
		try {
			Browser.window.localStorage.setItem(name, Json.stringify(data));
		} catch (e: Dynamic) {}
	}

	static public function getLocal(name:String):Dynamic {
		if (sharedObjects.exists(name))
			return sharedObjects.get(name);

		var o = new JSSharedObject(name);
		sharedObjects.set(name, o);
		return o;
    }
}

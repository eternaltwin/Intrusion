import pixi.core.utils.Utils;
import pixi.core.Application;
import common.KeyboardManager;
import mt.flash.Key;

class Boot {
	public static var man: Manager = null;

	static function main() {
		untyped js.Browser.window.IntrusionEngine = {
			mount: mountEngine,
			unmount: unmountEngine,
			nextTutoStep: function() { Tutorial.onAutoNext(); },
			anotherTip: function() { UserTerminal.printTip(); }
		};
		untyped js.Browser.window.nextTutoStep = function() { Tutorial.onAutoNext(); };
		untyped js.Browser.window.anotherTip = function() { UserTerminal.printTip(); };

		// Auto-boot if canvas & legacy window.init are already present
		var existingView = js.Browser.document.getElementById("main");
		if (existingView != null && (untyped js.Browser.window.init != null || untyped js.Browser.window.__INTRUSION_CONFIG__ != null)) {
			mountEngine(existingView);
		}
	}

	public static function mountEngine(viewElem: Dynamic) {
		unmountEngine();

		KeyboardManager.init();
		Key.init();
		Utils.skipHello();

		var dpr: Float = 2.0;
		if (js.Browser.window.devicePixelRatio != null && js.Browser.window.devicePixelRatio > 2.0) {
			dpr = js.Browser.window.devicePixelRatio;
		}

		js.Syntax.code("if (window.PIXI && PIXI.settings) { PIXI.settings.ROUND_PIXELS = true; }");
		js.Syntax.code("if (window.PIXI && PIXI.TextMetrics) { PIXI.TextMetrics.HEIGHT_MULTIPLIER = 4.5; PIXI.TextMetrics.BASELINE_MULTIPLIER = 3.0; PIXI.TextMetrics.METRICS_STRING = '|ÉÈÀÂÊÎÔÛÇMÉqgyp'; PIXI.TextMetrics._fonts = {}; }");

		var view = viewElem != null ? viewElem : cast js.Browser.document.getElementById("main");
		Manager.app = new pixi.core.Application(cast {
			width: Data.WID,
			height: Data.HEI,
			view: view,
			resolution: dpr,
			autoDensity: true,
			antialias: true
		});

		untyped globalThis.__PIXI_APP__ = Manager.app;
		man = new Manager();
	}

	public static function unmountEngine() {
		if (man != null) {
			man.dispose();
			man = null;
		}
		KeyboardManager.destroy();
		Key.destroy();
		common.Sound.stopAndDestroyAll();
		js.Syntax.code("try { if (window.PIXI && PIXI.sound) PIXI.sound.stopAll(); } catch(e) {}");
		if (Manager.app != null) {
			try {
				Manager.app.destroy(false);
			} catch (e: Dynamic) {}
			Manager.app = null;
		}
	}
}

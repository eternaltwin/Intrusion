import Protocol;
import mt.bumdum.Lib;
import Types;
import MissionGen;
import pixi.core.Application;
import haxe.CallStack;
import common.MovieClipBuilder;

import haxe.Unserializer;

class Manager {
	public static var LANG		 = "fr";
	public static var ASSET_ROOT = "/";
	
	public static var app:Application;
	public static var ROOT		: common.MovieClip;
	public static var ME		: Manager;
	public static var DM		: mt.DepthManager;
	public static var PARAMS	: PInit;
	public static var OWNED_VIRUSES : Hash<Int> = null;
	//public static var fc 		: mt.flash.FastCrypt = null;

	static var xmlData			: Hash<String>;
	static var fl_decrypted		: Bool;
	static var textures_loaded  : Bool = false;

	#if debug
		public static var STANDALONE	= false;
	#end

	static var mcLoading	: MCField;
	public var term			: UserTerminal;
	public var disposed		: Bool = false;
	static var timers		: List<haxe.Timer>;



	public function new() {
		var cfg: Dynamic = untyped js.Browser.window.__INTRUSION_CONFIG__;
		if (cfg != null && cfg.profile != null && cfg.profile.lang != null) {
			Manager.LANG = Std.string(cfg.profile.lang);
		} else if (cfg != null && cfg.lang != null) {
			Manager.LANG = Std.string(cfg.lang);
		}

		// INIT
		textures_loaded = false;
		var spriteBuilder = new MovieClipBuilder("xml_sprites", ASSET_ROOT);
		spriteBuilder.preloadAssets(() -> {
			textures_loaded = true;
		});
		ROOT = new common.MovieClip(spriteBuilder);
		Manager.app.stage.addChild(ROOT);

		//ROOT.tabEnabled = false;
		//ROOT.tabChildren = false;
		/*
		try {
			var raw = haxe.Resource.getString("soundData");
			fc = new mt.flash.FastCrypt( raw );
		}
		catch(e:String) {
			fatal("FC : "+e);
		}
		*/
		ME = this;
		DM = new mt.DepthManager(ROOT);
		timers = new List();
		fl_decrypted = false;
		js.Browser.window.requestAnimationFrame(update);
	}

	function onDecrypt() {
		// initialisation des XML crypt�s
		data.VirusXml.init(Manager.LANG);
		data.AntivirusXml.init();
		data.ValuablesXml.init(Manager.LANG);
		data.ChipsetsXml.init(Manager.LANG);

		PARAMS = getParams();
		Lang.reinit();
		Tutorial.reinit();
		data.VirusXml.init(Manager.LANG);
		data.AntivirusXml.init();
		data.ValuablesXml.init(Manager.LANG);
		data.ChipsetsXml.init(Manager.LANG);

		term = new UserTerminal();
		stopLoading();
	}

	static function getStacks() {
		var list = new List();
		list.add("EXCEPTION STACK :");
		list.add(CallStack.exceptionStack().join("\n"));
		list.add("\n");
		list.add("CALL STACK :");
		list.add(CallStack.callStack().join("\n"));
		return list.join("\n");
	}

	public static function fatal(str:String) {
		trace("FATAL ["+PARAMS._seed+"] : "+str+"\n"+getStacks());

		var mc : MCSprite = cast Manager.DM.attach("pop", Data.DP_TOPTOP);
		var padX = 10;
		var padY = 8;
		mc.field._x = padX;
		mc.field._y = padY;
		mc.field.text = Lang.get.Fatal+"\n\n"+str;
		mc.bg._width = Math.ceil(mc.field.textWidth) + padX * 2;
		mc.bg._height = Math.ceil(mc.field.textHeight) + padY * 2;
		mc._x = Math.round(Data.WID*0.5 - mc.bg._width*0.5);
		mc._y = Math.round(Data.HEI*0.5 - mc.bg._height*0.5);
		mc.onRelease = function() {
			// TODO: Fix?
			//flash.Lib.getURL(Manager.PARAMS._errorUrl);
		}

		Col.setPercentColor( ROOT, 25, 0xff0000 );
		Reflect.deleteField(ROOT,"onEnterFrame");
		throw str;
	}

	public static function loading(?str:String) {
		if ( mcLoading==null ) {
			mcLoading = cast Manager.DM.attach("loading",Data.DP_TOPTOP);
			mcLoading._x = Math.round(Data.WID*0.5);
			mcLoading._y = Math.round(Data.HEI*0.5);
		}
		if ( str!=mcLoading.field.text ) {
			mcLoading.field.text = str;
			mcLoading.field.visible = str!=null;
		}
	}

	public static function stopLoading() {
		if (mcLoading==null) return;
		mcLoading.interactive = false;
		mcLoading.interactiveChildren = false;
		Manager.ME.term.startAnim(A_FadeRemove,mcLoading).spd*=0.5;
		mcLoading.smc._visible = false;
//		Manager.ME.term.startAnim(A_FadeOut,mcLoading.smc).spd*=2;
		mcLoading = null;
	}


	static function getParams() : PInit {
		OWNED_VIRUSES = null;
		var cfg: Dynamic = untyped js.Browser.window.__INTRUSION_CONFIG__;
		if (cfg != null) {
			if (cfg.ownedViruses != null) {
				OWNED_VIRUSES = new Hash();
				for (k in Reflect.fields(cfg.ownedViruses)) {
					var cnt = Std.int(Reflect.field(cfg.ownedViruses, k));
					if (cnt > 0) OWNED_VIRUSES.set(k, cnt);
				}
			}
			var profileCfg: Dynamic = cfg.profile != null ? cfg.profile : {};
			var adult: Bool = profileCfg.adult != null ? (profileCfg.adult == true) : true;
			var lang: String = profileCfg.lang != null ? Std.string(profileCfg.lang) : Manager.LANG;
			Manager.LANG = lang;

			var fsNames = new data.TextXml(0, haxe.Resource.getString("xml_fsNames_" + lang), "xml_fsNames", adult);
			fsNames.fl_underscoreRep = true;
			var texts = new data.TextXml(0, haxe.Resource.getString("xml_texts_" + lang), "xml_texts", adult);
			texts.fl_autoCaps = true;
			var names = new data.TextXml(0, haxe.Resource.getString("xml_names_" + lang), "xml_names", adult);
			names.fl_autoCaps = true;
			texts.registerOtherXml(names);
			fsNames.registerOtherXml(names);

			var seed: Int = Std.int(cfg.seed);
			var gl: Int = Std.int(cfg.gl);
			var mdata = new MissionGen(texts, fsNames, names).generate(gl, seed);

			if (cfg.cards != null) {
				var rawCards: Array<Dynamic> = cast cfg.cards;
				for (c in rawCards) {
					mdata._cards.add(Std.string(c));
				}
			}

			var isChallenge: Bool = cfg.isChallenge == true;
			var decks = new List<{_name: String, _content: Array<String>}>();
			if (cfg.decks != null) {
				var rawDecks: Array<Dynamic> = cast cfg.decks;
				for (d in rawDecks) {
					var arr = new Array<String>();
					if (d.content != null) {
						var rawContent: Array<Dynamic> = cast d.content;
						for (vid in rawContent) arr.push(Std.string(vid));
					}
					decks.add({
						_name: d.name != null ? Std.string(d.name) : "Deck",
						_content: arr
					});
					if (isChallenge) break;
				}
			}

			var chip: String = (cfg.chipset == null || cfg.chipset == "" || cfg.chipset == "none") ? null : Std.string(cfg.chipset);
			return {
				_sfxVer		: 1,
				_musicVer	: 2,
				_startUrl	: "",
				_endUrl		: "/api/missions/end",
				_errorUrl	: "/",
				_iconsUrl	: ASSET_ROOT + "img/dockicons/",
				_iconsVer	: 1,
				_sfxUrl		: ASSET_ROOT + "sfx/",
				_seed		: seed,
				_gl			: gl,
				_m			: mdata,
				_decks		: decks,
				_chip		: chip,
				_c			: cfg.isChallenge == true,
				_bios		: cfg.biosLevel != null ? Std.int(cfg.biosLevel) : 1,
				_profile	: {
					_uname		: profileCfg.username != null ? Std.string(profileCfg.username) : "Haxxor",
					_low		: false,
					_adult		: adult,
					_ulevel		: profileCfg.level != null ? Std.int(profileCfg.level) : 1,
					_leet		: profileCfg.leet == true,
					_cfg		: profileCfg.cfg != null ? Std.string(profileCfg.cfg) : "",
					_sfx		: profileCfg.sfx != null ? (profileCfg.sfx == true) : true,
					_ambiant	: profileCfg.ambiant != null ? (profileCfg.ambiant == true) : true,
					_beat		: profileCfg.beat != null ? (profileCfg.beat == true) : true,
				},
			};
		}

		var p : PInit = null;
		try {
			var unserializer = new Unserializer(untyped js.Browser.window.init);
			p = unserializer.unserialize();
		}
		catch(e:Dynamic) {
			#if debug
				var stack = CallStack.exceptionStack().join("\n");
				trace("getParams : "+e);
				STANDALONE = true;
				p = {
					_sfxVer		: 1,
					_musicVer	: 2,
					_startUrl	: "",
					_endUrl		: "",
					_errorUrl	: "",
					_iconsUrl	: "dockIcons/",
					_iconsVer	: 1,
					_sfxUrl		: "sfx/",
					_seed		: Std.random(999999)*1000,
					_gl			: 3,
					_m			: null,
					_decks		: new List(),
					_chip		: "unmask",
					_c			: false,
					_bios		: 1,
					_profile	: {
						_uname		: "Haxxor",
						_low		: false,
						_adult		: true,
						_ulevel		: 4,
						_leet		: false,
						_cfg		: "
							alias d=avdmg1
							alias    up = cd ..
						",
						_sfx		: true,
						_ambiant	: true,
						_beat		: true,
					},
				};

				var d = new Array();
				d.push( data.VirusXml.get.dmgm.id );
				d.push( data.VirusXml.get.dmgxl.id );
				d.push( data.VirusXml.get.corrup.id );
				d.push( data.VirusXml.get.shld2.id );
				d.push( data.VirusXml.get.scan3.id );
				d.push( data.VirusXml.get.exploi.id );
				d.push( data.VirusXml.get.dckswi.id );
				d.push( data.VirusXml.get.cchrge.id );
				d.push( data.VirusXml.get.copy.id );
				d.push( data.VirusXml.get.libxpl.id );
				p._decks.add({
					_name	: "superLongNameFuckingBastard",
					_content	: d,
				});

				var d = new Array();
				d.push( data.VirusXml.get.dmgm.id );
				d.push( data.VirusXml.get.dec3.id );
				d.push( data.VirusXml.get.corrup.id );
				d.push( data.VirusXml.get.copy.id );
				d.push( data.VirusXml.get.rconv.id );
				d.push( data.VirusXml.get.mana3.id );
				d.push( data.VirusXml.get.dckswi.id );
				p._decks.add({
					_name		: "toolset",
					_content	: d,
				});

				p._gl = 5;
				p._seed = 617554000;
//				p._profile._sfx = false;
				p._profile._beat = false;
				p._profile._ambiant = false;
			#else
				fatal("init failed");
			#end
		}
		if (p != null && p._c && p._decks != null && p._decks.length > 1) {
			var firstDeck = p._decks.first();
			p._decks = new List();
			if (firstDeck != null) p._decks.add(firstDeck);
		}
		return p;
	}




	public static function delay( cb:Void->Void, d:Float ) : haxe.Timer {
		var t = haxe.Timer.delay(cb,Std.int(d));
		timers.add(t);
		return t;
	}

	public static function stopTimers() {
		for (t in timers ) {
			t.stop();
			t.run = null;
		}
		timers = new List();
	}


	public function decryptXml() {
		if ( fl_decrypted )
			return true;
		// TODO: we can probably just remove that since the XMLs arent' encrypted
		//fl_decrypted = !fc.run(400+Std.random(800));
		fl_decrypted = true;
		if ( !fl_decrypted )
			return false;
			//loading( Lang.fmt.LoadCounter({_n:fc.getOutput().length*2}) );
		else {
			/*
			try {
				var r = fc.getOutput();
				xmlData = haxe.Unserializer.run( r );
			}
			catch(e:String) {
				fatal("Unserializer failed : "+e);
			}
			*/
			onDecrypt();
		}
		return fl_decrypted;
	}

	public function dispose() {
		disposed = true;
		stopTimers();
		Progress.resetAll();
		if (term != null) {
			term.dispose();
			term = null;
		}
		mcLoading = null;
		if (ME == this) ME = null;
	}

	public function update(ts:Float) {
		if (disposed || Manager.app == null) return;
		mt.Timer.update(ts);
		js.Browser.window.requestAnimationFrame(update);

		Manager.DM.getMC().update();

		if (!textures_loaded) return;

		// DEBUG
		//loading( Lang.fmt.LoadCounter({_n:0}));
		//return;

		/*
			Loading order:
				- Empty screen, "loading" only with Mo downloaded: decryptXml
				- Boot screen with "Loading System": onLoadingStep
				- " Reading data": onLoading
				- Spam log


			UserTerminal initialiation:
				- fl_generated: set on onGenerate. Called from GNetwork updateGenerate
				- GNetwork created in initGenerate. Called when onLoading reaches 0

			GNetwork initialization:
				- fl_generated Set after updateGenerate, called from update()
				- called from UserTerminal.update()
		*/

		if ( !decryptXml() || term==null) {
			// TODO: can't display this earlier as it requires textures..
			// There's a race condition if decryptXML tries to remove the loading screen before we display it.
			loading( Lang.fmt.LoadCounter({_n:0}));
			return;
		}
		term.update();
	}
}

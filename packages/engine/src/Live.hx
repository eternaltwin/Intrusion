class Live {
	public static var term : UserTerminal = null;

	static var CINE_GIFS = [
		"/img_cine/camera_on.gif",
		"/img_cine/camera_zoom.gif",
		"/img_cine/laptop_on.gif",
		"/img_cine/laptop_screen.gif",
		"/img_cine/keyboard_on.gif"
	];

	static var CINE_IMGS = [
		"/img_cine/camera.jpg",
		"/img_cine/terminal.jpg"
	];

	public static function loadVideo(f:FSNode) {
		var gif = CINE_GIFS[f.id % CINE_GIFS.length];
		f.embedData = "video|" + gif;
		if (term != null) term.updateCopies(f);
		Manager.delay(function() {
			if (term != null && term.fs != null && term.fs.target == f) {
				UserTerminal.jsMain.embedVideo(f.name, gif);
			}
		}, 450);
	}

	public static function loadImage(f:FSNode) {
		var img = CINE_IMGS[f.id % CINE_IMGS.length];
		f.embedData = "image|" + img + "|" + img;
		if (term != null) term.updateCopies(f);
		Manager.delay(function() {
			if (term != null && term.fs != null && term.fs.target == f) {
				UserTerminal.jsMain.embedImage(f.name, img, img);
			}
		}, 400);
	}
}

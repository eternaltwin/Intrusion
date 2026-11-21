package common;

import pixi.sound.Sound as PixiSound;

class Sound {
    public static var ALL: Array<Sound> = [];

    var container: MovieClip;
    var sound: PixiSound;
    var disposed: Bool = false;

    public function new(container: MovieClip) {
        this.container = container;
        ALL.push(this);
    }

    public static function stopAndDestroyAll() {
        var copy = ALL.copy();
        ALL = [];
        for (s in copy) {
            if (s != null) s.destroy();
        }
    }

    public function start(secondOffset: Float, loops: Int) {
        if (disposed || this.sound == null) return;
        if (loops != 1 && loops < 9000)
            throw "Playing sound with " + loops + " loops is not supported";
        this.sound.loop = loops > 1;
        if (!this.sound.isLoaded)
            this.sound.autoPlayStart();
        else
            this.sound.play({start: secondOffset});
    }

    public function stop(?linkageID: String) {
        if (disposed || this.sound == null) return;
        try {
            this.sound.stop();
        } catch (e: Dynamic) {}
    }

    public function setVolume(value: Float) {
        if (disposed || this.sound == null) return;
        this.sound.volume = value / 100.0;
    }

    public function getVolume() {
        if (disposed || this.sound == null) return 0.0;
        return this.sound.volume * 100;
    }

    public function destroy() {
        disposed = true;
        if (this.sound != null) {
            try {
                this.sound.stop();
                this.sound.destroy();
            } catch (e: Dynamic) {}
            this.sound = null;
        }
    }


    dynamic public function onLoad(success: Bool): Void {}

    public function loadSound(url: String, isStreaming: Bool): Void {
        if (disposed) return;
        this.sound = PixiSound.from({
            url: url,
            preload: true,
            loaded: function(err, sound) {
                if (disposed) {
                    if (sound != null) {
                        try {
                            sound.stop();
                            sound.destroy();
                        } catch (e: Dynamic) {}
                    }
                    return;
                }
                this.sound = sound;
                onLoad(err==null);
            }
        });
    }
}
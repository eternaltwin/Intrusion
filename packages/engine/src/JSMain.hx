import haxe.Serializer;
import js.Browser;
import js.html.FormElement;
import js.html.InputElement;
import Protocol;

class JSMain {
    public function new() {}

    public function lockBar() {}

    function htmlize(str: String) {
        return "<p>" + str.split("\n").join("</p><p>") + "</p>";
    }

    function normalizeFaces(str: String): String {
        if (str == null) return "";
        return StringTools.replace(str, "src='img_faces/", "src='/img_faces/");
    }

    public function print(title: String, str: String) {
        var dom = js.Browser.document.getElementById("sideContent");
        if (dom == null) return;
        var clean = normalizeFaces(str);
        if (title != null) dom.innerHTML = "<h1>" + title + "</h1>" + clean;
        else dom.innerHTML = clean;
    }

    public function printTutorial(title: String, str: String) {
        var dom = js.Browser.document.getElementById("tutorial");
        if (dom == null) dom = js.Browser.document.getElementById("sideContent");
        if (dom == null) return;
        dom.innerHTML = "<div>" + (title != null ? "<h1>" + title + "</h1>" : "") + normalizeFaces(str) + "</div>";
    }

    public function clearTutorial() {
        var dom = js.Browser.document.getElementById("tutorial");
        if (dom != null) dom.innerHTML = "";
    }

    public function printTip(title: String, str: String) {
        var dom = js.Browser.document.getElementById("clientTipContent");
        var box = js.Browser.document.getElementById("clientTip");
        if (dom != null && box != null) {
            dom.innerHTML = "<div>" + (title != null ? "<h1>" + title + "</h1>" : "") + str + "</div>";
            box.style.display = "block";
        }
    }

    public function anotherTip() {
        UserTerminal.printTip();
    }

    public function clearTip() {
        var dom = js.Browser.document.getElementById("clientTipContent");
        var box = js.Browser.document.getElementById("clientTip");
        if (dom != null) dom.innerHTML = "";
        if (box != null) box.style.display = "none";
    }

    public function printBriefing(short: String, full: String) {
        var dom = js.Browser.document.getElementById("briefingContent");
        if (dom == null) return;
        dom.innerHTML = htmlize("<strong>" + short + "</strong>") + htmlize(normalizeFaces(full));
    }

    public function clear() {
        var dom = js.Browser.document.getElementById("sideContent");
        if (dom != null) dom.innerHTML = "";
    }

    public function embedVideo(title: String, gifUrl: String) {
        var dom = js.Browser.document.getElementById("sideContent");
        if (dom == null) return;
        dom.innerHTML = "<h1>" + title + "</h1><div class='pic'><img src='" + gifUrl + "' alt='Video stream' style='max-width:100%;border:1px solid #71754c;'/></div>";
    }

    public function embedImage(title: String, thumb: String, big: String) {
        var dom = js.Browser.document.getElementById("sideContent");
        if (dom == null) return;
        dom.innerHTML = "<h1>" + title + "</h1><a href='" + big + "' target='_blank' class='pic'><img src='" + thumb + "' alt='Image' style='max-width:100%;'/></a>";
    }

    public function send(url: String, msg: _Message, cb: _Message -> Void) {
        var onEnd: Dynamic = untyped js.Browser.window.__INTRUSION_ON_END__;
        if (onEnd != null) {
            switch (msg) {
                case MISSION_RESULT(end):
                    var valuables = new Array<String>();
                    for (v in end._valuables) valuables.push(v);

                    var copied = new Array<Dynamic>();
                    for (f in end._storage) {
                        copied.push({
                            name: f._name,
                            content: f._content,
                            embed: f._embed
                        });
                    }

                    var goals: Dynamic = {};
                    for (g in end._goals) {
                        var prev: Int = Reflect.field(goals, g._gid) != null ? Reflect.field(goals, g._gid) : 0;
                        Reflect.setField(goals, g._gid, prev + g._n);
                    }

                    var summary = {
                        success: end._success,
                        kills: end._kills,
                        remainingSec: end._rt,
                        valuables: valuables,
                        copiedFiles: copied,
                        goals: goals
                    };
                    cb(msg);
                    onEnd(summary);
                    return;
                default:
            }
        }

        // Legacy fallback form submit
        var form: FormElement = cast js.Browser.document.createElement('form');
        form.method = "post";
        form.action = url;
        var input: InputElement = cast js.Browser.document.createElement('input');
        input.type = "text";
        input.name = "msg";
        var serializer = new Serializer();
        serializer.serialize(msg);
        input.value = serializer.toString();
        form.appendChild(input);
        js.Browser.document.body.appendChild(form);
        form.submit();
        cb(msg);
    }

    public function nextTutoStep() {
        Tutorial.onAutoNext();
    }
}

package common;

import mt.gx.HashEx;
import mt.bumdum.Lib;
import pixi.core.textures.Texture;
import hx.concurrent.collection.SynchronizedMap;
import pixi.core.sprites.Sprite;
import pixi.core.display.DisplayObject;
import pixi.core.text.TextStyle;
import common.Text;
import common.Types;
import common.Filters;
import pixi.core.math.shapes.Rectangle;
import pixi.core.math.Matrix;
import pixi.core.renderers.webgl.filters.Filter;


class TextureCache {
  var shapes = ["1", "100", "101", "102", "103", "104", "105", "106", "107", "108", "109", "110", "111", "112", "113", "114", "115", "117", "118", "12", "121", "124", "127", "129", "132", "138", "140", "141", "142", "143", "144", "145", "146", "147", "148", "149", "150", "151", "152", "153", "156", "157", "16", "167", "168", "169", "170", "171", "172", "173", "174", "175", "176", "178", "179", "180", "181", "182", "183", "184", "185", "186", "187", "188", "191", "192", "199", "20", "205", "207", "21", "216", "219", "22", "221", "227", "228", "23", "232", "235", "237", "239", "241", "243", "245", "247", "249", "251", "253", "255", "257", "259", "261", "263", "265", "269", "27", "271", "272", "274", "280", "281", "284", "286", "288", "29", "290", "292", "294", "296", "298", "300", "302", "305", "307", "309", "312", "316", "317", "322", "326", "328", "329", "33", "333", "335", "336", "337", "339", "342", "344", "346", "348", "349", "351", "353", "355", "357", "358", "360", "362", "364", "366", "368", "370", "372", "374", "376", "378", "380", "381", "383", "386", "389", "391", "392", "394", "43", "46", "47", "49", "50", "52", "55", "58", "62", "64", "66", "68", "70", "72", "75", "77", "78", "82", "86", "9", "90", "94", "95",   ];

  var assetRoot: String;
  var cache: SynchronizedMap<String, Texture> = SynchronizedMap.newStringMap();

  public function new(assetRoot: String) {
    this.assetRoot = assetRoot;
  }

  public function loadAllTextures(cb: Void -> Void) {
    var promises = [];
    var opts: Dynamic = { resolution: 2, resourceOptions: { scale: 2 } };
    for (shape in shapes) {
      var svg_url = assetRoot + "shapes_svg/" + shape + ".svg";
      var promise = ((untyped Texture).fromURL(svg_url, opts))
        .then((texture) ->
          cache.set(svg_url, texture)
        );
      promises.push(promise);
    }
    js.lib.Promise.all(promises).then((_) -> cb());
  }

  public function getTexture(url: String):Texture {
    return cache.get(url);
  }
}


class MovieClipBuilder {

    var xml: haxe.xml.Access;
    var assetRoot: String;
    var textureCache: TextureCache;
    var assetTags: Hash<String>;


    public function new (xmlResource: String, assetRoot: String) {
      this.assetRoot = assetRoot;
      this.textureCache = new TextureCache(assetRoot);
      var raw = haxe.Resource.getString(xmlResource);
      this.xml = new haxe.xml.Access( Xml.parse(raw) ).node.swf;
      this.assetTags = collectAssetTags(xml);
    }

    public function preloadAssets(cb:Void->Void) {
      textureCache.loadAllTextures(cb);
    }

    private function collectAssetTags(xml: haxe.xml.Access):Hash<String> {
      var tags = new Hash();
      for (tag in xml.node.tags.nodes.item) {
        if (tag.att.type == "ExportAssetsTag") {
          tags.set(tag.node.names.node.item.innerData, tag.node.tags.node.item.innerData);
        }
      }
      return tags;
    }

    public function buildMovieClip(identifier: String, name: String): MovieClip {
      var mc = new MovieClip(this);
      var id = assetTags.get(identifier) ?? identifier;
      var spriteTag = getSpriteTag(id);
      var frameId = 1;
      var frameName = null;

      var objects: IntHash<FrameSpriteEntry> = new IntHash();
      var sprites: Hash<DisplayObject> = new Hash();

      for (tag in spriteTag.nodes.item) {
        switch(tag.att.type) {
          case "RemoveObject2Tag":       
            objects.remove(Std.parseInt(tag.att.depth));
          case "PlaceObject2Tag" | "PlaceObject3Tag":
            placeObject(tag, objects, sprites);
          case "FrameLabelTag":
            frameName = tag.att.name;
          case "DoActionTag":
            if (tag.has.actionBytes) {
              var ab = tag.att.actionBytes.toLowerCase();
              if (ab.length >= 14 && ab.substr(0, 6) == "810200" && ab.substr(10, 4) == "0600") {
                var lo = Std.parseInt("0x" + ab.substr(6, 2));
                var hi = Std.parseInt("0x" + ab.substr(8, 2));
                if (lo != null && hi != null) {
                  mc.loopStartFrame = ((hi << 8) | lo) + 1;
                }
              } else if (ab == "0700") {
                mc.stopOnFrame.push(frameId);
              }
            }
          case "ShowFrameTag":
            addFrame(mc, frameName, frameId, objects);
            objects = objects.copy();
            frameName = null;
            frameId++;
          }
        }
        mc._name = name;
        mc.setSprites(sprites);
        mc.showFrame(true);
        return mc;
    }

    private function addFrame(mc: MovieClip, frameName: String, frameId: Int, objects: IntHash<FrameSpriteEntry>) {
      var name = frameName ?? Std.string(frameId);
      mc.addFrame(name, objects);
    }

    private function parseColorState(tag: haxe.xml.Access, prevAlpha: Null<Float>, prevTint: Null<Int>): {alpha: Null<Float>, tint: Null<Int>} {
      if (!tag.hasNode.colorTransform) {
        return {alpha: prevAlpha, tint: prevTint};
      }
      var ct = tag.node.colorTransform;
      var aMult = ct.has.alphaMultTerm ? Std.parseInt(ct.att.alphaMultTerm) : 256;
      var aAdd = ct.has.alphaAddTerm ? Std.parseInt(ct.att.alphaAddTerm) : 0;
      var alpha = Math.max(0.0, Math.min(1.0, (aMult / 256.0) + (aAdd / 255.0)));

      var rMult = ct.has.redMultTerm ? Std.parseInt(ct.att.redMultTerm) : 256;
      var gMult = ct.has.greenMultTerm ? Std.parseInt(ct.att.greenMultTerm) : 256;
      var bMult = ct.has.blueMultTerm ? Std.parseInt(ct.att.blueMultTerm) : 256;
      var rAdd = ct.has.redAddTerm ? Std.parseInt(ct.att.redAddTerm) : 0;
      var gAdd = ct.has.greenAddTerm ? Std.parseInt(ct.att.greenAddTerm) : 0;
      var bAdd = ct.has.blueAddTerm ? Std.parseInt(ct.att.blueAddTerm) : 0;

      var isIdentityColor = (rMult == 256 && gMult == 256 && bMult == 256 && rAdd == 0 && gAdd == 0 && bAdd == 0);
      if (isIdentityColor) {
        return {alpha: alpha, tint: 0xFFFFFF};
      }
      var r = Std.int(Math.max(0, Math.min(255, Math.round(255 * (rMult / 256.0) + rAdd))));
      var g = Std.int(Math.max(0, Math.min(255, Math.round(255 * (gMult / 256.0) + gAdd))));
      var b = Std.int(Math.max(0, Math.min(255, Math.round(255 * (bMult / 256.0) + bAdd))));
      return {alpha: alpha, tint: Col.objToCol({r: r, g: g, b: b})};
    }

    private function placeObject(tag: haxe.xml.Access, objects: IntHash<FrameSpriteEntry>, sprites: Hash<DisplayObject>) {
          var depth = Std.parseInt(tag.att.depth);
          var prev = objects.exists(depth) ? objects.get(depth) : null;
          var isMove = tag.has.placeFlagMove && tag.att.placeFlagMove == "true";

          if (tag.att.characterId == "0") {
            if (prev == null)
              throw "Moving an object that is not present";
            var nextTransform = tag.hasNode.matrix ? getTransform(tag) : prev.transform;
            var nextColor = parseColorState(tag, prev.alpha, prev.tint);
            objects.set(depth, {
              name: prev.name,
              sprite: prev.sprite,
              transform: nextTransform,
              alpha: nextColor.alpha,
              tint: nextColor.tint,
              isMask: prev.isMask
            });
            return;
          }

          var transform = tag.hasNode.matrix ? getTransform(tag) : (isMove && prev != null ? prev.transform : getTransform(tag));
          var t = getTag(tag.att.characterId);
          var objectId = getObjectId(t);
          var name = if (tag.has.name) tag.att.name else getSpriteName(objectId) ?? objectId;

          var sprite: DisplayObject = switch (t.att.type) {
            case "DefineSpriteTag":
              buildMovieClip(t.att.spriteId, name);
            case "DefineEditTextTag" | "DefineTextTag":
              var bounds = getBounds(if (t.att.type == "DefineEditTextTag") t.node.bounds else t.node.textBounds);
              var text: Text = buildTextField(t, bounds.width, bounds.height);
              transform = {
                x: transform.x + bounds.x,
                y: transform.y + bounds.y,
                scaleX: transform.scaleX,
                scaleY: transform.scaleY,
                rotation: transform.rotation,
                skewX: transform.skewX,
                skewY: transform.skewY,
                pivotX: 0.0,
                pivotY: 0.0
              };
              text;
            case "DefineShapeTag" | "DefineShape2Tag" | "DefineShape3Tag" | "DefineShape4Tag":
              var baseTexture = textureCache.getTexture(this.assetRoot + 'shapes_svg/${t.att.shapeId}.svg');
              var bounds = getBounds(t.node.shapeBounds);
              var rw = Math.floor(Math.min(Math.ceil(bounds.width), Math.floor(baseTexture.width)));
              var rh = Math.floor(Math.min(Math.ceil(bounds.height), Math.floor(baseTexture.height)));
              if (rw < 1) rw = 1;
              if (rh < 1) rh = 1;
              var texture = new Texture(baseTexture.baseTexture, new Rectangle(0, 0, rw, rh));
              var sprite = new Sprite(texture);
              sprite.pivot.set(-bounds.x, -bounds.y);
              sprite;
            case other:
              throw "Unsupported tag definition: " + other;
          }

          var isMask = tag.has.clipDepth && tag.att.clipDepth != "0";
          var colorState = parseColorState(tag, 1.0, null);
          if (isMask) {
            sprite.visible = false;
          } else {
            if (colorState.alpha != null) sprite.alpha = colorState.alpha;
            if (colorState.tint != null) {
              if (Std.is(sprite, InternalMovieClip)) {
                (cast sprite : MovieClip).tint = colorState.tint;
              } else if (Std.is(sprite, Sprite)) {
                (cast sprite : Sprite).tint = colorState.tint;
              }
            }
          }
          applyFilters(tag, sprite);
          if (!sprites.exists(name)) {
            sprites.set(name, sprite);
          }
          objects.set(depth, {
            name: name,
            sprite: sprite,
            transform: transform,
            alpha: colorState.alpha,
            tint: colorState.tint,
            isMask: isMask
          });
    }

    private function applyColor(tag: haxe.xml.Access, sprite: DisplayObject) {
      if (tag.att.clipDepth != "0") {
        // clipDepth seems used to mark sprites that should be hidden 
        sprite.alpha = 0;
        return;
      }

      if (!(tag.hasNode.colorTransform))
        return;

      var colorTransform = tag.node.colorTransform;
      if (colorTransform.att.type != "CXFORMWITHALPHA")
        throw "Unsupported colorTransform: " + colorTransform.att.type;

      var tint = null;
      var r = getColorTransform(colorTransform.att.redAddTerm, colorTransform.att.redMultTerm);
      var g = getColorTransform(colorTransform.att.greenAddTerm, colorTransform.att.greenMultTerm);
      var b = getColorTransform(colorTransform.att.blueAddTerm, colorTransform.att.blueMultTerm);
      var alpha = Std.parseInt(colorTransform.att.alphaMultTerm);

      if ((r!=null || b!=null || g!=null) && (r==null || b==null || g==null))
        throw "Invalid color transform: red, green or blue have non constant values";

      sprite.alpha = alpha / 256.0;
      if (r!= null) {
        var tint = Col.objToCol({ r: r, g: g, b: b });
        if (Std.is(sprite, InternalMovieClip)) {
          var mc: MovieClip = cast sprite;
          mc.tint = tint;
        } else {
          var s: Sprite = cast sprite;
          s.tint = tint;
        }
      }
    }

    private function applyFilters(tag: haxe.xml.Access, sprite: DisplayObject) {
      if (!tag.hasNode.surfaceFilterList) return;
      
      var filters = new Array();
      for (item in tag.node.surfaceFilterList.nodes.item)
        filters = filters.concat(buildFilter(item));
      sprite.filters = filters;
    }

    private function rgbToHex(r:Int, g:Int, b:Int):String
      {
        var hexCodes = "0123456789ABCDEF";
        var hexString = "#";
        //Red
        hexString += hexCodes.charAt(Math.floor(r/16));
        hexString += hexCodes.charAt(r%16);
        //Green
        hexString += hexCodes.charAt(Math.floor(g/16));
        hexString += hexCodes.charAt(g%16);
        //Blue
        hexString += hexCodes.charAt(Math.floor(b/16));
        hexString += hexCodes.charAt(b%16);
        
        return hexString;
      }

    private function getColor(colorTag: haxe.xml.Access): String {
      return rgbToHex(Std.parseInt(colorTag.att.red), Std.parseInt(colorTag.att.green), Std.parseInt(colorTag.att.blue));
    }

    private function buildTextField(textTag: haxe.xml.Access, width: Float, height: Float):Text {
      switch (textTag.att.type) {
        case "DefineTextTag":
          return buildTextFieldFromTextTag(textTag, width, height);
        case "DefineEditTextTag":
          return buildTextFieldFromEditTextTag(textTag, width, height);
        default:
          throw "Invalid Text tag: " + textTag.att.type;
      }
    }
    private function buildTextFieldFromTextTag(textTag: haxe.xml.Access, width: Float, height: Float):Text {
      var record = textTag.node.textRecords.node.item;

      // TODO: parse glyphEntries to get initial text;
      var initialText = "";
      var textField = new Text(width, height, initialText);

      var style = new TextStyle();
      var colorTag = record.node.textColor;
      style.fontFamily = '${record.att.fontId}';
      style.fontSize = Std.parseInt(record.att.textHeight) / 20;
      style.lineHeight = style.fontSize;
      style.fill = getColor(colorTag);

      textField.style = style;
      return textField;
    }


    private function buildTextFieldFromEditTextTag(textTag: haxe.xml.Access, width: Float, height: Float):Text {
      var initialText = if (textTag.has.initialText) textTag.att.initialText else "";
      var regex = ~/\\r/g;
      initialText = regex.replace(initialText, "\r");

      if (textTag.has.useOutlines && textTag.att.useOutlines == "true") {
        initialText = initialText + '\n';
      }

      var alignments = ["left", "right", "center", "justify"];

      var textField = new Text(width, height, initialText, alignments[Std.parseInt(textTag.att.align)]);

      var style = new TextStyle();
      // TODO: dropshadow can be set on textstyle directly.
      style.fontFamily = '${textTag.att.fontId}';
      style.fontSize = Std.parseInt(textTag.att.fontHeight) / 20;
      style.lineHeight = style.fontSize;
      style.leading = Std.parseInt(textTag.att.leading) / 20;
      //style.letterSpacing = style.leading;
      style.fill = getColor(textTag.node.textColor);
      style.wordWrap = textTag.att.wordWrap == "true";
      style.wordWrapWidth = width;
      textField.style = style;
      return textField;
    }

    private function getSpriteTag(id: String): haxe.xml.Access {
      for (tag in xml.node.tags.nodes.item) {
        if (tag.att.type == "DefineSpriteTag" && tag.att.spriteId == id) {
          return tag.node.subTags;
        }
      }
      throw "Sprite tag node found: " + id;
    }

    private function getSpriteName(id: String): Null<String> {
      for (s in assetTags.keyValueIterator()) {
        if (s.value == id) return s.key;
      }
      return null;
    }

    private function getObjectId(tag: haxe.xml.Access): String {
      switch (tag.att.type) {
        case "DefineSpriteTag":
          return tag.att.spriteId;
        case "DefineEditTextTag" | "DefineTextTag":
          return tag.att.characterID;
        case "DefineShapeTag" | "DefineShape2Tag" | "DefineShape3Tag" | "DefineShape4Tag":
          return tag.att.shapeId;
        default:
          throw 'Unsupported tag: ${tag.att.type}';
      }
    }

    private function getTag(characterId: String): haxe.xml.Access {
      for (tag in xml.node.tags.nodes.item) {
        switch (tag.att.type) {
          case "DefineSpriteTag" if (tag.att.spriteId == characterId):
            return tag;
          case "DefineShapeTag" | "DefineShape2Tag" | "DefineShape3Tag" | "DefineShape4Tag" if (tag.att.shapeId == characterId):
            return tag;
          case "DefineEditTextTag" | "DefineTextTag" if (tag.att.characterID == characterId):
            return tag;
        }
      }
      throw "Tag node found: " + characterId;
    }

    private function getTransform(tag: haxe.xml.Access): Null<Transform> {
      if (!tag.hasNode.matrix) return {
          x: 0,
          y: 0,
          scaleX: 1,
          scaleY: 1,
          rotation: 0,
          skewX: 0,
          skewY: 0,
          pivotX: 0,
          pivotY: 0
      };
        var m = tag.node.matrix;
        return decomposeMatrix(tag.node.matrix);
        /*
        return {
          // TODO: twips to px conversion may not be correct.
          x: Std.parseFloat(m.att.translateX) / 20,
          y: Std.parseFloat(m.att.translateY) / 20,
          skewX: Std.parseFloat(m.att.rotateSkew0),//   -> c
          skewY: Std.parseFloat(m.att.rotateSkew1),// -> b
          scaleX: Std.parseFloat(m.att.scaleX),//  -> a
          scaleY:Std.parseFloat(m.att.scaleY)//  -> d
        };
        */
    }

    private function decomposeMatrix(m: haxe.xml.Access) {
      var a = (!m.has.hasScale || m.att.hasScale == "true") ? Std.parseFloat(m.att.scaleX) : 1.0;
      var d = (!m.has.hasScale || m.att.hasScale == "true") ? Std.parseFloat(m.att.scaleY) : 1.0;
      var b = (!m.has.hasRotate || m.att.hasRotate == "true") ? Std.parseFloat(m.att.rotateSkew0) : 0.0;
      var c = (!m.has.hasRotate || m.att.hasRotate == "true") ? Std.parseFloat(m.att.rotateSkew1) : 0.0;
      var tx = Std.parseFloat(m.att.translateX) / 20.0;
      var ty = Std.parseFloat(m.att.translateY) / 20.0;

      if (b == 0.0 && c == 0.0) {
        return {
          x: tx,
          y: ty,
          scaleX: a,
          scaleY: d,
          rotation: 0.0,
          skewX: 0.0,
          skewY: 0.0,
          pivotX: 0.0,
          pivotY: 0.0
        };
      }

      var scaleX = Math.sqrt((a * a) + (b * b));
      var scaleY = Math.sqrt((c * c) + (d * d));
      var skewY = Math.atan2(b, a);
      var skewX = Math.atan2(c, d);
      var rotation: Float = 0.0;

      if (Math.abs(skewX + skewY) < 0.0001) {
        rotation = skewY;
        skewX = 0.0;
        skewY = 0.0;
      }

      return {
        x: tx,
        y: ty,
        scaleX: scaleX,
        scaleY: scaleY,
        rotation: rotation,
        skewX: skewX,
        skewY: skewY,
        pivotX: 0.0,
        pivotY: 0.0
      };
  }

    private function getMatrix(tag: haxe.xml.Access): Null<Matrix> {
      if (!tag.hasNode.matrix) return null;
        var m = tag.node.matrix;
        // TODO: what should we do for rotation & pivot?
        return new Matrix (
          Std.parseFloat(m.att.scaleX),
          Std.parseFloat(m.att.rotateSkew1),
          Std.parseFloat(m.att.rotateSkew0),
          Std.parseFloat(m.att.scaleY),
          Std.parseFloat(m.att.translateX) / 20,
          Std.parseFloat(m.att.translateY) / 20
          );
    }

    private function getBounds(boundTag: haxe.xml.Access): {x: Float, y: Float, width: Float, height: Float} {
      var Xmin = Std.parseInt(boundTag.att.Xmin) / 20;
      var Xmax = Std.parseInt(boundTag.att.Xmax) / 20;
      var Ymin = Std.parseInt(boundTag.att.Ymin) / 20;
      var Ymax = Std.parseInt(boundTag.att.Ymax) / 20;
      return {x: Xmin, y: Ymin, width: Xmax - Xmin, height: Ymax - Ymin};
    }

    private function getIntCol(colorTag: haxe.xml.Access): Int {
      var color = Std.parseInt(colorTag.att.red);
      color = (color << 8) + Std.parseInt(colorTag.att.green);
      color = (color << 8) + Std.parseInt(colorTag.att.blue);
      return color;
    }

    private function buildFilter(filterTag: haxe.xml.Access): Array<Filter> {
      switch(filterTag.att.type) {
        case "GLOWFILTER":
          return [];
        case "DROPSHADOWFILTER":
          var distance = Std.parseFloat(filterTag.att.distance);
          var angle = Std.parseFloat(filterTag.att.angle);
          var color = getIntCol(filterTag.node.dropShadowColor);
          var alpha = Std.parseInt(filterTag.node.dropShadowColor.att.alpha) / 255;
          var blurX = Std.parseFloat(filterTag.att.blurX);
          var blurY = Std.parseFloat(filterTag.att.blurY);
          var strength = Std.parseFloat(filterTag.att.strength);
          var quality = Std.parseInt(filterTag.att.passes);
          var inner = filterTag.att.innerShadow == "true";
          var knockout = filterTag.att.knockout == "true";
          return [DropShadowFilter.create(distance, angle, color, alpha, blurX, blurY, strength, quality, inner, knockout)];
        case "COLORMATRIXFILTER":
          var matrix = new Array();
          for (value in filterTag.node.matrix.nodes.item)
            matrix.push(Std.parseFloat(value.innerData));
          return [ColorMatrixFilter.create(matrix)];
        default:
          throw "Unsupported filter: " + filterTag.att.type;
      }
    }

    private function getColorTransform(addTerm: String, multTerm: String): Int {
      if (addTerm == "0" && multTerm == "256")
        return null;
      if (addTerm == "0" && multTerm == "0")
        return 0;
      if (addTerm == "-255")
        return 0;
      if (addTerm == "255")
        return 255;
      throw "Unsupported color transform: addTerm=" + addTerm + ", multTerm=" + multTerm;
    }

}
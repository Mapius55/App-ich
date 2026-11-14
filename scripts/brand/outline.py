# Converts "I am" set in Bodoni Moda (display optical size) into SVG path data.
import json, sys
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.pens.boundsPen import BoundsPen

font = TTFont(sys.argv[1])
inst = instantiateVariableFont(font, {"wght": float(sys.argv[3]), "opsz": 96}, inplace=False)
gs = inst.getGlyphSet()
cmap = inst.getBestCmap()
upm = inst["head"].unitsPerEm
text = sys.argv[2]
x = 0
parts, boxes = [], []
for ch in text:
    if ch == " ":
        x += gs[cmap[ord(ch)]].width * 0.62  # tighter word space for a logo
        continue
    g = gs[cmap[ord(ch)]]
    pen = SVGPathPen(gs)
    g.draw(TransformPen(pen, (1, 0, 0, -1, x, 0)))
    bp = BoundsPen(gs); g.draw(bp)
    b = bp.bounds
    boxes.append({"ch": ch, "x0": x + b[0], "x1": x + b[2], "y0": -b[3], "y1": -b[1]})
    parts.append(pen.getCommands())
    x += g.width
print(json.dumps({"d": " ".join(parts), "boxes": boxes, "width": x, "upm": upm,
                  "capHeight": getattr(inst["OS/2"], "sCapHeight", 0), "xHeight": getattr(inst["OS/2"], "sxHeight", 0)}))

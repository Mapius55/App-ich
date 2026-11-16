# Converts the logo's words, set in Bodoni Moda, into SVG path data: one entry per line.
#   python outline.py <BodoniModa[opsz,wght].ttf> <wght> <opsz> [--tracking=<units>] "Bucket" "List" > glyphs.json
# Needs fontTools (pip install fonttools). The variable font is instanced at the given weight (400-900)
# and optical size (6-96: lower = sturdier hairlines, better at small sizes), with the font's own
# kerning (GPOS "kern") applied, plus optional tracking between letters (font units, 2000 per em:
# keeps letters apart when the icon is small). Paths are in font units: baseline y=0, y grows downwards.
import json, sys
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.pens.boundsPen import BoundsPen

args = [a for a in sys.argv[1:] if not a.startswith("--tracking=")]
tracking = sum(float(a.split("=", 1)[1]) for a in sys.argv[1:] if a.startswith("--tracking="))
if len(args) < 4:
    sys.exit('usage: python outline.py <font.ttf> <wght> <opsz> [--tracking=<units>] <line> [<line> ...]')

font = TTFont(args[0])
wght, opsz = float(args[1]), float(args[2])
inst = instantiateVariableFont(font, {"wght": wght, "opsz": opsz}, inplace=False)
gs = inst.getGlyphSet()
cmap = inst.getBestCmap()
upm = inst["head"].unitsPerEm


def kern_lookups(f):
    if "GPOS" not in f:
        return []
    t = f["GPOS"].table
    idx = sorted({i for fr in t.FeatureList.FeatureRecord if fr.FeatureTag == "kern" for i in fr.Feature.LookupListIndex})
    return [t.LookupList.Lookup[i] for i in idx]


LOOKUPS = kern_lookups(inst)


def pair_kern(a, b):
    """Horizontal kerning between glyphs a and b (first matching subtable of each kern lookup)."""
    total = 0
    for lk in LOOKUPS:
        for st in lk.SubTable:
            if lk.LookupType == 9:
                st = st.ExtSubTable
            if getattr(st, "LookupType", 2) != 2 or a not in st.Coverage.glyphs:
                continue
            v = None
            if st.Format == 1:
                ps = st.PairSet[st.Coverage.glyphs.index(a)]
                v = next((r.Value1 for r in ps.PairValueRecord if r.SecondGlyph == b), None)
            elif st.Format == 2:
                c1 = st.ClassDef1.classDefs.get(a, 0)
                c2 = st.ClassDef2.classDefs.get(b, 0)
                v = st.Class1Record[c1].Class2Record[c2].Value1
            if v is not None:
                total += getattr(v, "XAdvance", 0) or 0
                break
    return total


def line(text):
    x = 0
    parts = []
    x0 = y0 = float("inf")
    x1 = y1 = float("-inf")
    prev = None
    for ch in text:
        name = cmap[ord(ch)]
        if prev is not None:
            x += pair_kern(prev, name) + tracking
        g = gs[name]
        if ch != " ":
            pen = SVGPathPen(gs, ntos=lambda n: f"{n:.1f}".rstrip("0").rstrip("."))  # 0.1 unit is plenty
            g.draw(TransformPen(pen, (1, 0, 0, -1, x, 0)))
            parts.append(pen.getCommands())
            bp = BoundsPen(gs)
            g.draw(bp)
            if bp.bounds:
                b = bp.bounds
                x0, x1 = min(x0, x + b[0]), max(x1, x + b[2])
                y0, y1 = min(y0, -b[3]), max(y1, -b[1])
        x += g.width
        prev = name
    return {"text": text, "d": " ".join(parts), "width": x, "x0": x0, "x1": x1, "y0": y0, "y1": y1}


os2 = inst["OS/2"]
print(json.dumps({
    "wght": wght, "opsz": opsz, "tracking": tracking, "upm": upm,
    "capHeight": getattr(os2, "sCapHeight", 0), "xHeight": getattr(os2, "sxHeight", 0),
    "lines": [line(t) for t in args[3:]],
}))

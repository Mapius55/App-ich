import json, math, collections
cols = json.load(open('colors.json'))
def lin(c):
    c/=255; return c/12.92 if c<=0.04045 else ((c+0.055)/1.055)**2.4
def oklab(rgb):
    r,g,b=[lin(x) for x in rgb]
    l=(0.4122214708*r+0.5363325363*g+0.0514459929*b)**(1/3)
    m=(0.2119034982*r+0.6806995451*g+0.1073969566*b)**(1/3)
    s=(0.0883024619*r+0.2817188376*g+0.6299787005*b)**(1/3)
    L=0.2104542553*l+0.793617785*m-0.0040720468*s
    a=1.9779984951*l-2.428592205*m+0.4505937099*s
    bb=0.0259040371*l+0.7827717662*m-0.808675766*s
    return L,math.hypot(a,bb),(math.degrees(math.atan2(bb,a))+360)%360
combos=collections.defaultdict(list)
for i,c in enumerate(cols):
    for k in c['combinations']: combos[k].append(i)
print('colours',len(cols),'combos',len(combos), 'sizes', collections.Counter(len(v) for v in combos.values()))
# features
for k in sorted(combos)[:5]:
    print(k,[ (cols[i]['name'],cols[i]['hex'], tuple(round(x,2) for x in oklab(cols[i]['rgb']))) for i in combos[k]])

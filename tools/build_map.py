"""Convert an OpenStreetMap Overpass export of the USyd Camperdown/Darlington campus into map.json.

Usage:  python -I tools/build_map.py <overpass.json> map.json
Coordinates are projected to metres (x east, y south) from the north-west corner of BOUNDS.
Map data (c) OpenStreetMap contributors, ODbL.
"""
import json, math, sys

S, W_, N, E_ = -33.8935, 151.1795, -33.8835, 151.1960   # south, west, north, east
LAT0 = (S + N) / 2
KX = math.cos(math.radians(LAT0)) * 111320
KY = 110540
WIDTH, HEIGHT = round((E_ - W_) * KX), round((N - S) * KY)

def proj(lat, lon):
    return ((lon - W_) * KX, (N - lat) * KY)

def inside_box(pts, pad=40):
    return any(-pad <= x <= WIDTH + pad and -pad <= y <= HEIGHT + pad for x, y in pts)

def dp(pts, eps):
    """Douglas-Peucker simplification."""
    if len(pts) < 3: return pts
    a, b = pts[0], pts[-1]
    dx, dy = b[0] - a[0], b[1] - a[1]; L = math.hypot(dx, dy) or 1e-9
    best, idx = -1, 0
    for i in range(1, len(pts) - 1):
        d = abs(dy * pts[i][0] - dx * pts[i][1] + b[0] * a[1] - b[1] * a[0]) / L if L > 1e-9 else math.dist(pts[i], a)
        if d > best: best, idx = d, i
    if best <= eps: return [a, b]
    return dp(pts[:idx + 1], eps)[:-1] + dp(pts[idx:], eps)

def flat(pts, eps):
    closed = len(pts) > 3 and pts[0] == pts[-1]
    p = dp(pts, eps)
    if closed and p[0] == p[-1]: p = p[:-1]
    return [round(v, 1) for xy in p for v in xy]

def area(pts):
    return sum(pts[i][0] * pts[i - 1][1] - pts[i - 1][0] * pts[i][1] for i in range(len(pts))) / 2

def join_rings(segs):
    """Stitch multipolygon member ways into closed rings."""
    segs = [s[:] for s in segs if len(s) > 1]; rings = []
    while segs:
        ring = segs.pop(0)
        while ring[0] != ring[-1]:
            for i, s in enumerate(segs):
                if s[0] == ring[-1]: ring += s[1:]
                elif s[-1] == ring[-1]: ring += s[::-1][1:]
                elif s[-1] == ring[0]: ring = s[:-1] + ring
                elif s[0] == ring[0]: ring = s[::-1][:-1] + ring
                else: continue
                segs.pop(i); break
            else: break
        if ring[0] == ring[-1] and len(ring) > 3: rings.append(ring)
    return rings

HERITAGE = ('great hall', 'anderson-stuart', 'madsen', 'holme', 'old teachers', 'macleay', 'edgeworth', "st paul", "st. john",
            "st john", "st. andrew", "st andrew", "women's college", 'wesley', 'sancta', 'gatekeeper', 'gardener', 'science road cottage',
            'principals lodge', 'quadrangle', 'old darlington', 'badham', 'chaplaincy', 'mandelbaum', 'the elms')
ROADW = {'trunk': 20, 'trunk_link': 9, 'primary': 16, 'primary_link': 8, 'secondary': 13, 'tertiary': 11, 'unclassified': 9,
         'residential': 8, 'living_street': 6, 'service': 5, 'pedestrian': 4.5, 'footway': 2.4, 'path': 1.8, 'cycleway': 2.4,
         'steps': 2.6, 'track': 3}

def main(src, dst):
    els = json.load(open(src, encoding='utf-8'))['elements']
    nodes = {e['id']: proj(e['lat'], e['lon']) for e in els if e['type'] == 'node'}
    ways = {e['id']: e for e in els if e['type'] == 'way'}
    def wpts(w): return [nodes[n] for n in w['nodes'] if n in nodes]

    areas, lines, bars, blds, trees, cross, labels = [], [], [], [], [], [], []
    shapes = []  # (tags, rings[list of point lists], id)
    member_ways = set()
    for e in els:
        if e['type'] == 'relation' and e.get('tags', {}).get('type') == 'multipolygon':
            outer = join_rings([wpts(ways[m['ref']]) for m in e['members'] if m['type'] == 'way' and m['role'] != 'inner' and m['ref'] in ways])
            inner = join_rings([wpts(ways[m['ref']]) for m in e['members'] if m['type'] == 'way' and m['role'] == 'inner' and m['ref'] in ways])
            for o in outer: shapes.append((e['tags'], [o] + inner, 'r%d' % e['id']))
            member_ways.update(m['ref'] for m in e['members'] if m['type'] == 'way')
    for w in ways.values():
        t = w.get('tags', {}); p = wpts(w)
        if len(p) < 2 or not inside_box(p): continue
        closed = w['nodes'][0] == w['nodes'][-1] and len(p) > 3
        if closed and (('building' in t) or any(k in t for k in ('landuse', 'leisure', 'natural', 'amenity', 'area:highway', 'place')) or t.get('area') == 'yes'):
            if not (t.get('highway') and t.get('area') != 'yes' and 'building' not in t):
                shapes.append((t, [p], 'w%d' % w['id']))
                if 'building' in t or t.get('area') == 'yes' or 'highway' not in t: continue
        hw, rw, bar = t.get('highway'), t.get('railway'), t.get('barrier')
        if hw in ROADW and t.get('area') != 'yes':
            kind = 'aisle' if hw == 'service' and t.get('service') in ('parking_aisle', 'driveway') else hw
            lines.append([kind, ROADW[hw] if kind != 'aisle' else 3.5, flat(p, .4), t.get('name', ''), 1 if t.get('bridge') else 0, int(t.get('layer', 0) or 0)])
        elif rw == 'rail':
            lines.append(['rail', 3, flat(p, .4), '', 1 if t.get('bridge') else 0, 0])
        elif bar in ('fence', 'wall', 'retaining_wall', 'hedge', 'guard_rail'):
            bars.append([bar, flat(p, .3)])
        elif t.get('natural') == 'tree_row':
            for i in range(len(p) - 1):
                (x0, y0), (x1, y1) = p[i], p[i + 1]; n = max(1, int(math.dist(p[i], p[i + 1]) / 7))
                for k in range(n): trees.append([round(x0 + (x1 - x0) * k / n, 1), round(y0 + (y1 - y0) * k / n, 1), 3.5, 0])

    quad_park = None
    for t, rings, sid in shapes:
        if t.get('name') == 'The Quadrangle' and t.get('leisure') == 'park': quad_park = rings[0]
    qx0 = min(x for x, y in quad_park); qx1 = max(x for x, y in quad_park); qy0 = min(y for x, y in quad_park); qy1 = max(y for x, y in quad_park)

    for t, rings, sid in shapes:
        if not inside_box(rings[0]): continue
        r = [flat(x, .35 if 'building' in t else .6) for x in rings]
        if len(r[0]) < 6: continue
        if 'building' in t and t.get('building') not in ('no',):
            if t.get('demolished:building') or t.get('building') in ('construction',): continue
            name = t.get('name', '')
            cx = sum(x for x, y in rings[0]) / len(rings[0]); cy = sum(y for x, y in rings[0]) / len(rings[0])
            if not name and qx0 - 40 < cx < qx1 + 40 and qy0 - 40 < cy < qy1 + 40 and abs(area(rings[0])) > 600: name = 'The Quadrangle'
            try: lv = float(str(t.get('building:levels', '')).split(';')[0])
            except ValueError: lv = 0
            try: h = float(str(t.get('height', '')).replace('m', '').strip())
            except ValueError: h = 0
            if not h: h = (lv or (1 if t.get('building') in ('roof', 'shed', 'garage', 'kiosk') else 2)) * 3.6 + (1.5 if t.get('roof:shape') in ('gabled', 'hipped') else 0)
            low = name.lower()
            uni = t.get('building') in ('university', 'college', 'school', 'office', 'hospital', 'public', 'civic') or 'operator' in t
            mat = 'sand' if any(k in low for k in HERITAGE) else 'uni' if uni or name else 'house' if t.get('building') in ('house', 'terrace', 'residential', 'semidetached_house', 'detached', 'apartments') else 'misc'
            roof = 'gable' if t.get('roof:shape') in ('gabled', 'hipped', 'pyramidal') or mat in ('house', 'sand') else 'flat'
            if t.get('building') == 'roof': mat, roof = 'canopy', 'flat'
            blds.append([name, round(min(h, 70), 1), mat, roof] + r)
            continue
        k = None
        if t.get('name') == 'Victoria Park' and t.get('leisure') == 'park': k = 'wild'
        elif t.get('natural') == 'water' or 'water' in t: k = 'water'
        elif t.get('leisure') == 'swimming_pool': k = 'pool'
        elif t.get('leisure') == 'pitch' or t.get('leisure') == 'track': k = 'pitch'
        elif t.get('natural') in ('wood', 'scrub', 'wetland'): k = 'wood'
        elif t.get('landuse') in ('grass', 'recreation_ground', 'cemetery', 'meadow', 'village_green') or t.get('leisure') in ('park', 'garden', 'common', 'playground', 'dog_park') or t.get('natural') == 'grassland': k = 'grass'
        elif t.get('amenity') == 'parking' or t.get('amenity') == 'motorcycle_parking': k = 'parking'
        elif t.get('highway') in ('pedestrian', 'footway', 'service') or 'area:highway' in t or t.get('place') == 'square' or t.get('leisure') in ('sports_centre', 'outdoor_seating'): k = 'plaza'
        elif t.get('landuse') in ('residential', 'retail', 'commercial', 'railway', 'brownfield', 'construction', 'industrial', 'farmland'): k = 'land'
        elif t.get('amenity') in ('university', 'college', 'school', 'hospital'): k = 'campus'
        if k: areas.append([k] + r)
        if t.get('name') and (t.get('leisure') in ('park', 'garden', 'pitch') or t.get('natural') == 'water') and abs(area(rings[0])) > 400:
            labels.append([t['name'], round(sum(x for x, y in rings[0]) / len(rings[0]), 1), round(sum(y for x, y in rings[0]) / len(rings[0]), 1)])

    for e in els:
        t = e.get('tags', {})
        if e['type'] != 'node' or e['id'] not in nodes: continue
        x, y = nodes[e['id']]
        if not (0 <= x <= WIDTH and 0 <= y <= HEIGHT): continue
        if t.get('natural') == 'tree':
            sp = (t.get('species', '') + t.get('genus', '') + t.get('taxon', '')).lower()
            kind = 2 if 'jacaranda' in sp else 1 if t.get('leaf_type') == 'needleleaved' else 0
            try: r = float(t.get('diameter_crown', 0)) / 2
            except ValueError: r = 0
            trees.append([round(x, 1), round(y, 1), round(r, 1) if r else 0, kind])
        if t.get('highway') == 'crossing':
            # orient zebra along the road the crossing sits on
            for w in ways.values():
                hw = w.get('tags', {}).get('highway')
                if hw in ROADW and hw not in ('footway', 'path', 'cycleway', 'steps', 'pedestrian') and e['id'] in w['nodes']:
                    i = w['nodes'].index(e['id']); j = i + 1 if i + 1 < len(w['nodes']) else i - 1
                    if w['nodes'][j] in nodes:
                        x2, y2 = nodes[w['nodes'][j]]
                        cross.append([round(x, 1), round(y, 1), round(math.atan2(y2 - y, x2 - x), 2), ROADW[hw]])
                    break

    # NPC anchors: nearest walkable path point to each named building
    walk = [l for l in lines if l[0] in ('footway', 'pedestrian', 'path', 'service', 'steps', 'cycleway', 'living_street')]
    def nearest_path(poly):
        best = (1e9, None)
        P = list(zip(poly[::2], poly[1::2]))
        for l in walk:
            q = list(zip(l[2][::2], l[2][1::2]))
            for (ax, ay), (bx, by) in zip(q, q[1:]):
                dx, dy = bx - ax, by - ay; L2 = dx * dx + dy * dy or 1e-9
                for px, py in P:
                    k = max(0, min(1, ((px - ax) * dx + (py - ay) * dy) / L2)); cx, cy = ax + dx * k, ay + dy * k
                    d = math.hypot(px - cx, py - cy)
                    if d < best[0]: best = (d, (round(cx, 1), round(cy, 1)))
        return best[1]
    anchors = {}
    want = {'fisher': 'Fisher Library', 'manning': 'Manning House', 'holme': 'Holme Building', 'jfr': 'Jane Foss Russell Building',
            'wentworth': 'Wentworth Building', 'cpc': 'Charles Perkins Centre', 'abercrombie': 'H70 Abercrombie Building',
            'law': 'Law Building', 'greathall': 'Great Hall'}
    for key, nm in want.items():
        b = max((b for b in blds if b[0] == nm), key=lambda b: len(b[4]), default=None)
        if b: anchors[key] = nearest_path(b[4])
    anchors['quad'] = [round(sum(x for x, y in quad_park) / len(quad_park), 1), round(sum(y for x, y in quad_park) / len(quad_park), 1)]
    for l in labels:
        if l[0] == 'The Front Lawn': anchors['frontlawn'] = [l[1], l[2]]
        if l[0] == 'Victoria Park': anchors['vicpark'] = [l[1], l[2]]

    out = {'w': WIDTH, 'h': HEIGHT, 'bounds': [S, W_, N, E_], 'areas': areas, 'lines': lines, 'bars': bars, 'blds': blds,
           'trees': trees, 'cross': cross, 'labels': labels, 'anchors': anchors,
           'attribution': 'Map data (c) OpenStreetMap contributors, ODbL'}
    json.dump(out, open(dst, 'w', encoding='utf-8'), separators=(',', ':'), ensure_ascii=False)
    print(f'{WIDTH}x{HEIGHT} m | areas {len(areas)} lines {len(lines)} bars {len(bars)} blds {len(blds)} trees {len(trees)} cross {len(cross)}')
    print('anchors', anchors)

if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])

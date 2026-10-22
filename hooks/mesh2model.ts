// Convierte una malla STL (binaria o ASCII) u OBJ en un modelo animable: la normaliza (y arriba, pies en 0, 44 unidades de alto), la simplifica por
// agrupacion de vertices y asigna cada vertice a un hueso humanoide (torso, cabeza, brazos, antebrazos, piernas, pantorrillas) con mezcla suave en las
// articulaciones. Salida: JSON con la malla empaquetada en base64. Solo biblioteca estandar.
export const MESH_PY = String.raw`
import sys, os, json, math, struct, base64, re, urllib.request, tempfile

src, up, turn, target, torso_arg = sys.argv[1], sys.argv[2], float(sys.argv[3]), int(sys.argv[4]), float(sys.argv[5])
H = 44.0
def fail(msg):
    print(json.dumps({"error": msg})); sys.exit(0)
try:
    if re.match(r'^https?://', src):
        req = urllib.request.Request(src, headers={"User-Agent": "Mozilla/5.0"})
        data = urllib.request.urlopen(req, timeout=40).read()
    else:
        with open(os.path.expanduser(src), 'rb') as f: data = f.read()
except Exception as e:
    fail("No pude leer el archivo: %s" % e)
if len(data) > 60_000_000: fail("El archivo es demasiado grande (maximo 60 MB).")

V, F = [], []
def add_tri(a, b, c): F.append((a, b, c))
head = data[:300].lstrip().lower()
ext = src.lower().split('?')[0]
try:
    if ext.endswith('.obj') or (head.startswith(b'#') or head.startswith(b'v ') or head.startswith(b'mtllib') or head.startswith(b'o ') ) and b'\nf ' in data[:2000000] and not ext.endswith('.stl'):
        for line in data.decode('utf-8', 'ignore').splitlines():
            if line.startswith('v '):
                p = line.split(); V.append((float(p[1]), float(p[2]), float(p[3])))
            elif line.startswith('f '):
                idx = []
                for tok in line.split()[1:]:
                    i = int(tok.split('/')[0]); idx.append(i - 1 if i > 0 else len(V) + i)
                for k in range(1, len(idx) - 1): add_tri(idx[0], idx[k], idx[k + 1])
    else:
        binary = True
        if data[:5].lower() == b'solid':
            n = struct.unpack_from('<I', data, 80)[0] if len(data) >= 84 else 0
            if 84 + n * 50 != len(data): binary = False
        if binary:
            n = struct.unpack_from('<I', data, 80)[0]
            off = 84
            for i in range(n):
                vals = struct.unpack_from('<12f', data, off); off += 50
                base = len(V)
                V.extend([(vals[3], vals[4], vals[5]), (vals[6], vals[7], vals[8]), (vals[9], vals[10], vals[11])])
                add_tri(base, base + 1, base + 2)
        else:
            vs = re.findall(r'vertex\s+(\S+)\s+(\S+)\s+(\S+)', data.decode('utf-8', 'ignore'))
            for i in range(0, len(vs) - 2, 3):
                base = len(V)
                V.extend([tuple(map(float, vs[i + k])) for k in range(3)])
                add_tri(base, base + 1, base + 2)
except Exception as e:
    fail("Formato no reconocido (uso STL u OBJ): %s" % e)
if len(F) < 20: fail("La malla no tiene triangulos suficientes.")

# a Y arriba (los STL suelen venir con Z arriba), giro alrededor de Y y normalizacion
if up == 'auto':
    ey = max(v[1] for v in V) - min(v[1] for v in V); ez = max(v[2] for v in V) - min(v[2] for v in V)
    up = 'z' if ez > ey * 1.05 else 'y'
if up == 'z': V = [(x, z, -y) for (x, y, z) in V]
t = math.radians(turn); c, s = math.cos(t), math.sin(t)
V = [(x * c + z * s, y, -x * s + z * c) for (x, y, z) in V]
xs = [v[0] for v in V]; ys = [v[1] for v in V]; zs = [v[2] for v in V]
sc = H / max(1e-9, (max(ys) - min(ys)))
cx, cz, y0 = (max(xs) + min(xs)) / 2, (max(zs) + min(zs)) / 2, min(ys)
V = [((x - cx) * sc, (y - y0) * sc, (z - cz) * sc) for (x, y, z) in V]

def cluster(cell):
    m, out, remap = {}, [], []
    acc = []
    for (x, y, z) in V:
        k = (math.floor(x / cell), math.floor(y / cell), math.floor(z / cell))
        j = m.get(k)
        if j is None:
            j = len(acc); m[k] = j; acc.append([x, y, z, 1])
        else:
            a = acc[j]; a[0] += x; a[1] += y; a[2] += z; a[3] += 1
        remap.append(j)
    verts = [(a[0] / a[3], a[1] / a[3], a[2] / a[3]) for a in acc]
    seen, tris = set(), []
    for (a, b, c2) in F:
        a, b, c2 = remap[a], remap[b], remap[c2]
        if a == b or b == c2 or a == c2: continue
        key = tuple(sorted((a, b, c2)))
        if key in seen: continue
        seen.add(key); tris.append((a, b, c2))
    return verts, tris
lo, hi = 0.02, 6.0
verts, tris = cluster(lo)
if len(tris) > target:
    for _ in range(18):
        mid = (lo + hi) / 2
        v2, t2 = cluster(mid)
        if len(t2) > target: lo = mid
        else: hi = mid; verts, tris = v2, t2
    if len(tris) > target: verts, tris = cluster(hi)
# solo vertices usados
used = sorted({i for t3 in tris for i in t3}); newi = {o: n for n, o in enumerate(used)}
verts = [verts[i] for i in used]; tris = [(newi[a], newi[b], newi[c3]) for (a, b, c3) in tris]
if len(verts) > 65000: fail("Quedan demasiados vertices tras simplificar.")

# rig humanoide por regiones (fracciones de la altura)
band = sorted(abs(v[0]) for v in verts if 0.58 * H <= v[1] <= 0.72 * H)
auto_wt = band[int(len(band) * 0.3)] * 1.25 if len(band) > 20 else 0.15 * H
wt = (torso_arg * H if torso_arg > 0 else min(0.2 * H, max(0.09 * H, auto_wt)))   # medio ancho del torso
legw = 0.19 * H                                           # por fuera de esto, a baja altura, es brazo
G = {'body': 0, 'head': 1, 'armL': 2, 'armR': 3, 'armLlow': 4, 'armRlow': 5, 'legL': 6, 'legR': 7, 'legLlow': 8, 'legRlow': 9}
def sm(a, b, x): u = min(1.0, max(0.0, (x - a) / (b - a))); return u * u * (3 - 2 * u)
sh_y = 0.80 * H
def classify(x, y, z):
    side = 'R' if x >= 0 else 'L'
    ax = abs(x)
    # cabeza (con cuello mezclado)
    if y >= 0.80 * H:
        w = sm(0.80 * H, 0.84 * H, y)
        if ax > wt * 1.15 and y < 0.88 * H: pass
        else: return 'body', 'head', w
    # brazos
    arm = (ax > wt and y > 0.50 * H) or (ax > legw and y > 0.20 * H)
    if arm:
        d = math.hypot(ax - wt, y - sh_y)
        w = sm(0.20 * H, 0.26 * H, d)
        wb = sm(wt * 0.8, wt * 1.1, ax) if y > 0.5 * H else 1.0
        return ('body', 'arm' + side, wb) if wb < 1 else ('arm' + side, 'arm' + side + 'low', w)
    # piernas
    if y < 0.52 * H:
        w = sm(0.25 * H, 0.31 * H, y)
        g1 = 'leg' + side + 'low'; g0 = 'leg' + side
        wh = 1 - sm(0.46 * H, 0.52 * H, y)
        if y < 0.25 * H: return g1, g1, 0
        if y < 0.31 * H: return g1, g0, w
        if wh < 1: return 'body', g0, wh
        return g0, g0, 0
    return 'body', 'body', 0
gs, gs2, ws = [], [], []
for (x, y, z) in verts:
    a, b, w = classify(x, y, z)
    gs.append(G[a]); gs2.append(G[b]); ws.append(int(round(255 * w)))

# piezas: Int16 posiciones (x100), grupos, segundo grupo, peso, triangulos Uint16
buf = bytearray()
for (x, y, z) in verts: buf += struct.pack('<hhh', int(round(x * 100)), int(round(y * 100)), int(round(z * 100)))
buf += bytes(gs) + bytes(gs2) + bytes(ws)
for (a, b, c3) in tris: buf += struct.pack('<HHH', a, b, c3)
hw = 0.085 * H
pivots = {'body': [0, 0.50 * H, 0], 'head': [0, 0.82 * H, 0],
  'armL': [-wt, sh_y, 0], 'armR': [wt, sh_y, 0], 'armLlow': [-(wt + 0.04 * H), 0.63 * H, 0], 'armRlow': [wt + 0.04 * H, 0.63 * H, 0],
  'legL': [-hw, 0.50 * H, 0], 'legR': [hw, 0.50 * H, 0], 'legLlow': [-hw, 0.27 * H, 0], 'legRlow': [hw, 0.27 * H, 0]}
print(json.dumps({"n": len(verts), "m": len(tris), "b64": base64.b64encode(bytes(buf)).decode(), "pivots": pivots, "h": H, "torso": wt}))
`

// Convierte una imagen (ruta o URL) en un dibujo de 32x32 con paleta: fondo transparente, busto si es de cuerpo entero, colores con mas vida.
// Se ejecuta con python3 (solo biblioteca estandar) y sips de macOS; imprime un JSON { palette, art } o { error }.
export const IMG2ART_PY = String.raw`import sys, os, struct, subprocess, json, hashlib

SIZE = 32
FIT = 31
src = sys.argv[1]
cache = os.path.expanduser('~/.cache/claude-pets')
os.makedirs(cache, exist_ok=True)
if src.startswith('http'):
    f = os.path.join(cache, hashlib.md5(src.encode()).hexdigest() + '.img')
    subprocess.run(['curl', '-sL', '--max-time', '30', '-o', f, src], check=True)
    src = f
bmp = os.path.join(cache, 'ref.bmp')
subprocess.run(['sips', '-Z', '480', '-s', 'format', 'bmp', src, '--out', bmp], check=True, capture_output=True)
d = open(bmp, 'rb').read()
off = struct.unpack_from('<I', d, 10)[0]
w, h = struct.unpack_from('<ii', d, 18)
bpp = struct.unpack_from('<H', d, 28)[0] // 8
bottom_up = h > 0
h = abs(h)
row = (w * bpp + 3) // 4 * 4

def px(x, y):
    o = off + (h - 1 - y if bottom_up else y) * row + x * bpp
    a = d[o + 3] if bpp == 4 else 255
    return (d[o + 2], d[o + 1], d[o], a)

pix = [[px(x, y) for x in range(w)] for y in range(h)]
has_alpha = any(p[3] < 250 for r in pix for p in r)

def dist(a, b):
    return abs(a[0] - b[0]) + abs(a[1] - b[1]) + abs(a[2] - b[2])

# fondo: transparencia real o color de las esquinas, propagado desde el borde
bg = [[False] * w for _ in range(h)]
if has_alpha:
    for y in range(h):
        for x in range(w):
            bg[y][x] = pix[y][x][3] < 128
else:
    corners = [pix[0][0], pix[0][w - 1], pix[h - 1][0], pix[h - 1][w - 1]]
    base = max(corners, key=lambda c: sum(1 for k in corners if dist(c, k) < 30))
    stack = [(x, y) for x in range(w) for y in (0, h - 1)] + [(x, y) for y in range(h) for x in (0, w - 1)]
    while stack:
        x, y = stack.pop()
        if x < 0 or y < 0 or x >= w or y >= h or bg[y][x] or dist(pix[y][x], base) > 60:
            continue
        bg[y][x] = True
        stack += [(x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)]

if not has_alpha:
    for y in range(h):
        for x in range(w):
            if dist(pix[y][x], base) <= 24:
                bg[y][x] = True

ys = [y for y in range(h) for x in range(w) if not bg[y][x]]
xs = [x for y in range(h) for x in range(w) if not bg[y][x]]
if not xs:
    print(json.dumps({'error': 'no encontre al personaje en la imagen'})); sys.exit(0)
x0, x1, y0, y1 = min(xs), max(xs) + 1, min(ys), max(ys) + 1
cw, ch = x1 - x0, y1 - y0
if ch > 1.35 * cw:          # personaje de cuerpo entero: se queda con cabeza y torso para que la cara tenga detalle
    y1 = y0 + int(cw * 1.2)
    ch = y1 - y0
sc = min(FIT / cw, FIT / ch)
tw, th = max(1, round(cw * sc)), max(1, round(ch * sc))
ox, oy = (SIZE - tw) // 2, (SIZE - th) // 2
cells = {}
for ty in range(th):
    for tx in range(tw):
        sx0, sx1 = x0 + int(tx * cw / tw), x0 + max(int((tx + 1) * cw / tw), int(tx * cw / tw) + 1)
        sy0, sy1 = y0 + int(ty * ch / th), y0 + max(int((ty + 1) * ch / th), int(ty * ch / th) + 1)
        cols = [pix[y][x] for y in range(sy0, sy1) for x in range(sx0, sx1) if not bg[y][x]]
        total = (sx1 - sx0) * (sy1 - sy0)
        if len(cols) * 2 > total:
            cells[(ox + tx, oy + ty)] = tuple(sum(c[i] for c in cols) // len(cols) for i in range(3))

def quantize(colors, k):
    # puntos de partida por distancia maxima (conserva acentos pequenos como el verde o el naranja) + 4 iteraciones de k-means
    uniq = list(dict.fromkeys(colors))
    count = {c: colors.count(c) for c in uniq}
    pal = [max(uniq, key=lambda c: count[c])]
    while len(pal) < min(k, len(uniq)):
        pal.append(max(uniq, key=lambda c: min(dist(c, p) for p in pal) * (1 + count[c] ** 0.5)))
    for _ in range(4):
        groups = {i: [] for i in range(len(pal))}
        for c in colors:
            groups[min(range(len(pal)), key=lambda i: dist(pal[i], c))].append(c)
        pal = [tuple(sum(c[j] for c in g) // len(g) for j in range(3)) if g else pal[i] for i, g in groups.items()]
    return pal

pal = quantize(list(cells.values()), 14)

def punch(c):
    import colorsys
    r, g, b = [v / 255 for v in c]
    hh, ss, vv = colorsys.rgb_to_hsv(r, g, b)
    ss = min(1.0, ss * 1.35)
    vv = min(1.0, max(0.0, (vv - 0.5) * 1.15 + 0.5))
    return tuple(int(v * 255) for v in colorsys.hsv_to_rgb(hh, ss, vv))

pal = [punch(c) for c in pal]
letters = 'ABCDEFGHIJKLMN'
rows = [['.'] * SIZE for _ in range(SIZE)]
for (x, y), c in cells.items():
    rows[y][x] = letters[min(range(len(pal)), key=lambda i: dist(pal[i], c))]
print(json.dumps({
    'palette': {letters[i]: '#%02x%02x%02x' % pal[i] for i in range(len(pal))},
    'art': [''.join(r) for r in rows],
}))
`

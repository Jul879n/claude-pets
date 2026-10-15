// Convierte una imagen (ruta o URL) en una "foto ASCII" a color: fondo transparente, un caracter por celda segun su luminosidad y con el color del pixel.
// python3 (solo biblioteca estandar) + sips de macOS; argumentos: origen y numero de columnas; imprime JSON { cols, rows, chars, colors } o { error }.
export const IMG2ASCII_PY = String.raw`import sys, os, struct, subprocess, json, hashlib

src = sys.argv[1]
COLS = max(16, min(56, int(sys.argv[2]))) if len(sys.argv) > 2 else 32
MAXROWS = 24
cache = os.path.expanduser('~/.cache/claude-pets')
os.makedirs(cache, exist_ok=True)
if src.startswith('http'):
    f = os.path.join(cache, hashlib.md5(src.encode()).hexdigest() + '.img')
    subprocess.run(['curl', '-sL', '--max-time', '30', '-o', f, src], check=True)
    src = f
bmp = os.path.join(cache, 'ref-ascii.bmp')
subprocess.run(['sips', '-Z', '640', '-s', 'format', 'bmp', src, '--out', bmp], check=True, capture_output=True)
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
cols = COLS
rows = max(4, round(cols * ch / cw / 2))     # una celda de terminal mide ~1:2
if rows > MAXROWS:
    rows = MAXROWS
    cols = max(8, round(rows * 2 * cw / ch))
RAMP = ' .\'^",:;Il!i><~+_-?][}{1)(|/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$'
chars, colors = [], []
for r in range(rows):
    for c in range(cols):
        sx0, sx1 = x0 + c * cw // cols, max(x0 + (c + 1) * cw // cols, x0 + c * cw // cols + 1)
        sy0, sy1 = y0 + r * ch // rows, max(y0 + (r + 1) * ch // rows, y0 + r * ch // rows + 1)
        cs = [pix[y][x] for y in range(sy0, sy1) for x in range(sx0, sx1) if not bg[y][x]]
        total = (sx1 - sx0) * (sy1 - sy0)
        if len(cs) * 2 <= total:
            chars.append(' '); colors.append('000000'); continue
        r_ = sum(p[0] for p in cs) // len(cs); g_ = sum(p[1] for p in cs) // len(cs); b_ = sum(p[2] for p in cs) // len(cs)
        lum = (0.299 * r_ + 0.587 * g_ + 0.114 * b_) / 255
        lum = min(1.0, max(0.0, (lum - 0.5) * 1.35 + 0.55))      # contraste
        chars.append(RAMP[min(len(RAMP) - 1, int(lum * (len(RAMP) - 1)) + 1)])
        # color vivo y nunca casi negro, para que se lea sobre fondo oscuro
        m = max(r_, g_, b_, 1)
        k = max(1.0, 150 / m)
        colors.append('%02x%02x%02x' % (min(255, int(r_ * k)), min(255, int(g_ * k)), min(255, int(b_ * k))))
print(json.dumps({'cols': cols, 'rows': rows, 'chars': ''.join(chars), 'colors': ''.join(colors)}))
`

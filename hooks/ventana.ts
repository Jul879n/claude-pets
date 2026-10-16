// Ventana aparte con fuente diminuta: la terminal no deja achicar la letra solo en el pane, asi que el ASCII ultradetallado
// (unas 110 columnas) se anima en una ventana de Terminal propia con el perfil "claude-pets" (fuente de 5 pt; no toca los demas perfiles).
// El visor lee ~/.cache/claude-pets/ventana.json (la foto) y ~/.cache/claude-pets/estado (el animo, que escribe el mod).
export const VENTANA_PY = String.raw`import sys, os, json, time, math
D = os.path.expanduser('~/.cache/claude-pets')
d = json.load(open(os.path.join(D, 'ventana.json')))
cols, rows, chars = d['cols'], d['rows'], d['chars']
cs = [int(d['colors'][i * 6:i * 6 + 6], 16) for i in range(cols * rows)]
rgb = [((c >> 16) & 255, (c >> 8) & 255, c & 255) for c in cs]
viv = [max(p) - min(p) > 90 for p in rgb]
GESTO = {'sleep': 'zZz', 'happy': '♥♥♥', 'wait': '???', 'error': '!!!'}
TONO = {'sleep': (150, 200, 255), 'happy': (255, 120, 170), 'wait': (250, 204, 21), 'error': (248, 113, 113)}
def animo():
    try:
        p = os.path.join(D, 'estado')
        m = open(p).read().strip() or 'sleep'
        if m == 'happy' and time.time() - os.path.getmtime(p) > 8:
            return 'sleep'
        return m
    except Exception:
        return 'sleep'
out = sys.stdout
out.write('\x1b[?25l\x1b[2J')
t = 0
try:
    while True:
        m = animo()
        lento = m in ('sleep', 'wait')
        dy = (t // (8 if lento else 4)) % 2                      # respira
        dx = (-1, 1)[t % 2] if m in ('run', 'error') else 0       # vibra al ejecutar o con error
        pulso = 1 + 0.3 * math.sin(t / 2.5)                       # las luces laten
        buf = ['\x1b[H']
        for y in range(rows + 3):
            sy = y - 1 - dy
            last = None
            line = []
            for x in range(cols + 4):
                g = 2 if m == 'run' and (sy * 7 + t * 3) % 13 == 0 else 0
                sx = x - 2 - dx - g
                if 0 <= sy < rows and 0 <= sx < cols and chars[sy * cols + sx] != ' ':
                    i = sy * cols + sx
                    r, gg, b = rgb[i]
                    if m == 'sleep':
                        r, gg, b = r * 0.75, gg * 0.75, b * 0.8
                    elif m == 'error':
                        r, gg, b = r * 0.5 + 127, gg * 0.5, b * 0.5
                    elif viv[i]:
                        r, gg, b = r * pulso, gg * pulso, b * pulso
                    seq = '\x1b[38;2;%d;%d;%dm' % (min(255, r), min(255, gg), min(255, b))
                    if seq != last:
                        line.append(seq)
                        last = seq
                    line.append(chars[i])
                else:
                    line.append(' ')
            buf.append(''.join(line) + '\x1b[0m' + ('\n' if y < rows + 2 else ''))
        if m in GESTO:
            k = (t // 3) % 4
            for n, ch in enumerate(GESTO[m]):
                yy, xx = max(1, 3 + n * 3 - k), cols - 6 + n * 3
                buf.append('\x1b[%d;%dH\x1b[1;38;2;%d;%d;%dm%s\x1b[0m' % ((yy, xx) + TONO[m] + (ch,)))
        out.write(''.join(buf))
        out.flush()
        t += 1
        time.sleep(0.12)
except KeyboardInterrupt:
    pass
finally:
    out.write('\x1b[0m\x1b[?25h\n')
`

// Abre la ventana: crea (si falta) el perfil "claude-pets" con fuente de 5 pt y fondo negro, y corre el visor en una pestana nueva.
export const ventanaOsa = (cols: number, rows: number) => `
tell application "Terminal"
  if not (exists settings set "claude-pets") then make new settings set with properties {name:"claude-pets"}
  set s to settings set "claude-pets"
  set font name of s to "Menlo"
  set font size of s to 5
  set background color of s to {0, 0, 0}
  set number of columns of s to ${cols + 4}
  set number of rows of s to ${rows + 3}
  set t to do script "clear; python3 -I ~/.cache/claude-pets/ventana.py; exit"
  set current settings of t to s
  set number of columns of t to ${cols + 4}
  set number of rows of t to ${rows + 3}
  activate
end tell`

import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Cfg, Live, Model, SavedLook, SetDef } from '../types'
import { IMG2ART_PY } from './img2art'
import { IMG2ASCII_PY } from './img2ascii'
import { VENTANA_PY, ventanaOsa } from './ventana'
import type { IaLook } from './sprites'
import {
  ACCESSORIES, COLORS, photoCells, KIND_COLOR, LABEL, PETS, SETS, actOf, ago, bar, bigArt, moodOf,
  ASCII_SPEC, DESIGN_SPEC, fitPhoto, IA_SYSTEM, animCells, compactArt, generateSet, iaPrompt, lookFromSeed, parseLooks, parseColor, pixelCells, randomSeed, scene, skin, uniqueLooks,
} from './sprites'

const PANE = 'mascotas'
const TICK_MS = 250
const IDLE_MS = 8000
const STUCK_MS = 30000
const MAX_AGENTS = 50
const CARD_W = 46
const MAX_CARDS = 4
const MAX_LINE = 120
const STORE_CFG = 'mascotas.cfg'
const STORE_HIST = 'mascotas.hist'
const STORE_SETS = 'mascotas.sets'
const STORE_COL = 'mascotas.coleccion'
const MAX_COL = 30
const LEFT_W = 34
const PANE_ROWS = 18
// Con una foto ASCII el pane pide mas alto para que quepa entera.
const effRender = () => (cfg.render === 'auto' ? detectedRender : cfg.render)
const paneRows = () => (cfg.photo || cfg.anim ? Math.min(64, (cfg.photo ?? cfg.anim)!.rows + 11) : PANE_ROWS)
const openArgs = () => ({ id: PANE, title: 'Mascotas', rows: paneRows() })

const fresh = (): Live => ({ tools: 0, errors: 0, last: 0, since: Date.now(), by: {} })
const defaults: Cfg = { on: true, pet: 'cat', name: '', color: '', accessory: 'ninguno', accent: '', custom: null, photo: null, design: null, anim: null, asciiCols: 40, src: '', render: 'auto', eyes: 'auto', set: '', style: 'pixel', narrow: false, web: true, calm: false, history: false, notify: true }
const initial: Model = { main: { ...fresh(), st: 'idle' }, agents: {}, tick: 0, timeline: [], summary: '', cfg: defaults, custom: {}, edit: false }
const model = atom({ plugin: 'mascotas', key: 's' } as const, initial)

const ICON = { running: '*', waiting: 'z', idle: 'z', pending: '.', completed: '+', failed: 'x', killed: 'x' } as const
const COLOR = { running: '#60a5fa', waiting: '#fbbf24', idle: '#fbbf24', pending: '#9aa3b2', completed: '#4ade80', failed: '#f87171', killed: '#f87171' } as const
const HINT = '<ventana [ruta] | render <auto|medios|celdas> | foto <ruta|url> [nombre] | ascii <ruta|url> [nombre] | img <ruta|url> [nombre] | mis | ia web <descripcion> | usar <nombre> | ia <descripcion> | decir <nombre> <mensaje> | tipo <mascota> | nombre <texto> | color <#hex|nombre> | accesorio <x> | ojos <o.o> | set <nombre> | generar [texto] | estilo <pixel|ascii> | on | off | editar | reset>'
const HELP = [
  '/pets tipo <cat|owl|robot|fox|dog|bunny|ghost>   cambia la mascota principal',
  '/pets nombre <texto>   /pets color <#rrggbb|naranja|rosa|...|auto>   /pets acento <color secundario|auto>   /pets accesorio <ninguno|sombrero|corona|lentes|corbata>',
  '/pets ojos <3 caracteres, ej. ^.^>|auto   /pets estilo <pixel|ascii>   /pets reset',
  '/pets generar [texto]   mascota al azar, o fija a partir del texto   /pets generar set <nombre> [n]',
  '/pets set [<nombre>|ninguno|guardar <nombre>|borrar <nombre>]   sets: animales, robots, fantasia, espacio',
  '/pets mis   /pets usar <nombre>   /pets guardar [nombre]   /pets quitar <nombre>   listado propio: lo que generes se guarda solo',
  '/pets ia <descripcion>   busca referencias en la web y dibuja con el modelo principal (/pets web off = solo Haiku)   /pets ia rapido <descripcion>   solo Haiku',
  '/pets ia set <nombre> <descripcion del equipo>   crea un set de 6 con Haiku',
  '/pets img <ruta o URL de una imagen> [nombre]   convierte una imagen en mascota de 32x32 (sin tokens)',
  '/pets foto <ruta o URL de una imagen> [nombre]   casi una imagen: cada celda es un color de fondo, sin costuras (sin tokens; usa el mismo detalle que ascii)   /pets foto fino <ruta>   medios bloques con dos colores por celda (el doble de alto, puede mostrar lineas segun la terminal)',
  '/pets ascii <ruta o URL de una imagen> [nombre]   ASCII real con letras de colores (sin tokens); /pets foto <ruta> para pixel art   /pets ascii braille <ruta>   puntos braille   /pets ascii cuerpo <ruta>   /pets ascii detalle <16-120>   /pets ascii off',
  '/pets decir <nombre> <mensaje>   o  /pets <nombre> <mensaje>   o  @<nombre> <mensaje> en el prompt: habla con ese subagente',
  '/pets render auto|medios|celdas   celdas = sin medios bloques (terminales como Warp los dibujan con rendijas); auto lo detecta',
  '/pets ia ascii <descripcion>   Sonnet escoge la mejor imagen y el generador ASCII la convierte, animada (consume tokens)',
  '/pets ventana [ruta]   el ASCII ultradetallado en una ventana aparte de Terminal con fuente diminuta, animado   /pets ventana off',
  '/pets editar (vista previa)   /pets on|off|abrir|cerrar   /pets angosto|calma|avisos|historial [ver]|estado|tipos',
].join('\n')

let cfg = defaults
let custom: Record<string, SetDef> = {}
let detectedRender: 'medios' | 'celdas' = 'medios'   // 'celdas' donde los medios bloques salen con rendijas (Warp)
let loaded = false   // las preferencias vienen del almacen del plugin; $.state se reinicia con cada sesion (p. ej. al aceptar un plan), las variables del modulo no
let coleccion: Record<string, SavedLook> = {}
// Investigaciones web en curso: agente de referencias -> lo que se quiere crear.
const pendientes = new Map<string, string>()
const pendientesAscii = new Map<string, string>()   // subagentes que dibujan arte ASCII animado
let esperandoRecibo = 0   // resultados de esas investigaciones que aun llegaran al modelo principal (se consumen: no gastan tokens)
let busyUntil = 0
let watching = false
let n = 0
const warned = new Set<string>()
let timer: { cancel: () => void } | undefined

// Revisa agentes vivos: deja de vigilar si no hay ninguno y avisa de los atascados.
async function watch($: EngineInterface) {
  const list = await $.agent.list()
  const running = list.filter(a => a.status === 'running')
  watching = running.length > 0
  const m = await read($, model)
  for (const a of running) {
    const last = m.agents[a.id]?.last
    if (last && Date.now() - last > STUCK_MS && !warned.has(a.id)) {
      warned.add(a.id)
      await alert($, `Agente sin actividad: ${a.description}`)
    }
  }
  $.ui.status(running.length > 0 ? `${running.length} agente${running.length > 1 ? 's' : ''}` : undefined)
}

async function alert($: EngineInterface, text: string) {
  $.ui.toast(text)
  if (cfg.notify) await $.ui.notify(text)
}

// Mapa nombre -> agente, con las mismas mascotas que dibuja el pane.
async function mascotas($: EngineInterface) {
  const agents = await $.agent.list()
  const looks = uniqueLooks(agents.slice(-30).map(a => a.id), setOf(cfg.set, custom))
  return agents.slice(-30).map(a => ({ id: a.id, name: looks[a.id]?.name ?? a.id, type: a.type, status: a.status }))
}

// Pide a Haiku n mascotas a partir de una descripcion; la respuesta se valida antes de usarse.
async function generarIA($: EngineInterface, descripcion: string, n: number, refs = ''): Promise<{ looks: IaLook[]; error?: string }> {
  if (!descripcion.trim()) return { looks: [], error: 'Describe la mascota, ej. /pets ia un zorro astronauta naranja' }
  $.ui.toast(n === 1 ? 'Haiku esta dibujando la mascota (puede tardar hasta 1 minuto)...' : 'Haiku esta creando el set...')
  const r = await $.model.complete({ model: 'haiku', system: IA_SYSTEM, prompt: iaPrompt(descripcion, n, refs), maxTokens: 700 * n, effort: 'low', timeoutMs: 120000 })
  if (!r.isAnswered) return { looks: [], error: `Haiku no respondio (${r.reason}).` }
  const looks = parseLooks(r.text, n)
  return looks.length ? { looks } : { looks: [], error: 'Haiku no devolvio mascotas validas; prueba con otra descripcion.' }
}

// Convierte una imagen (ruta o URL) en mascota de 32x32: python3 + sips hacen el trabajo y se valida lo que devuelven.
async function imagenAMascota($: EngineInterface, origen: string, nombre: string): Promise<{ look?: IaLook; error?: string }> {
  let out: { palette?: Record<string, string>; art?: string[]; error?: string }
  try {
    const r = await $.process.run(['python3', '-I', '-c', IMG2ART_PY, origen], { timeoutMs: 60000 })
    if (r.exitCode !== 0) return { error: `No pude convertir la imagen: ${r.stderr.trim().split('\n').pop() || 'error desconocido'}` }
    out = JSON.parse(r.stdout)
  } catch (err) {
    return { error: `No pude convertir la imagen (${err instanceof Error ? err.message : 'error'}).` }
  }
  if (out.error || !out.palette || !out.art) return { error: out.error ?? 'La imagen no se pudo convertir.' }
  const first = Object.values(out.palette)[0] ?? '#808080'
  const look = parseLooks(JSON.stringify([{ name: nombre, pet: 'robot', color: first, palette: out.palette, art: out.art }]), 1)[0]
  return look?.custom ? { look } : { error: 'El dibujo convertido no es valido.' }
}

// Convierte una imagen (ruta o URL) en una "foto ASCII" a color, muy detallada: python3 + sips; se valida lo que devuelven.
async function fotoAAscii($: EngineInterface, origen: string, nombre: string, cuerpo = false, modo: 'ascii' | 'celdas' | 'fino' | 'braille' = 'ascii', anchoCols = cfg.asciiCols): Promise<{ look?: SavedLook; error?: string }> {
  let out: { cols?: number; rows?: number; chars?: string; colors?: string; bg?: string; error?: string }
  try {
    const r = await $.process.run(['python3', '-I', '-c', IMG2ASCII_PY, origen, String(anchoCols), cuerpo ? 'cuerpo' : 'busto', modo], { timeoutMs: 60000 })
    if (r.exitCode !== 0) return { error: `No pude convertir la imagen: ${r.stderr.trim().split('\n').pop() || 'error desconocido'}` }
    out = JSON.parse(r.stdout)
  } catch (err) {
    return { error: `No pude convertir la imagen (${err instanceof Error ? err.message : 'error'}).` }
  }
  const { cols, rows, chars, colors } = out
  if (out.error || !cols || !rows || !chars || !colors) return { error: out.error ?? 'La imagen no se pudo convertir.' }
  if ([...chars].length !== cols * rows || colors.length !== cols * rows * 6 || !/^[0-9a-f]+$/i.test(colors)) return { error: 'La foto convertida no es valida.' }
  if (out.bg !== undefined && (out.bg.length !== cols * rows * 6 || !/^[0-9a-f-]+$/i.test(out.bg))) return { error: 'La foto convertida no es valida.' }
  return { look: { pet: cfg.pet, accessory: 'ninguno', color: '#808080', name: nombre, eyes: 'o.o', photo: { cols, rows, chars: [...chars].join(''), colors, bg: out.bg } } }
}

// Lanza un subagente (modelo principal, con busqueda web) que reune referencias; al terminar, turn.complete afina la mascota.
async function investigarWeb($: EngineInterface, descripcion: string): Promise<string> {
  const res = await $.agent.spawn({
    description: `Referencias para la mascota: ${descripcion.slice(0, 40)}`,
    subagentType: 'general-purpose',
    model: 'sonnet',   // el que mira la imagen y decide: un modelo con vision y buen criterio
    prompt: 'Eres un artista de pixel art. Necesito una mascota de este personaje u objeto: ' + JSON.stringify(descripcion.slice(0, 300)) +
      '. PASO 1: reune VARIAS imagenes candidatas del tema (de 4 a 6, de fuentes distintas: sprites o pixel art profesional, arte oficial, wikis de fans con buena calidad, Wikimedia Commons, etc.). ' +
      'Busca en la web y, si hace falta, usa la API de Wikimedia Commons con curl ' +
      '(https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrsearch=<tema>&gsrnamespace=6&prop=imageinfo&iiprop=url&iiurlwidth=480&format=json, campo thumburl) ' +
      'o URLs directas de imagen (terminan en .png, .jpg o .gif). Descargalas con curl -sL a ~/.cache/claude-pets/refs/<nombre>-1.png, -2.png... (crea la carpeta; comprueba con el comando file que son imagenes). ' +
      'NO te quedes con la primera: MIRA cada candidata con la herramienta Read y ESCOGE LA MEJOR segun estos criterios, en orden: (1) calidad profesional y buena resolucion, (2) el personaje completo y bien visible, de frente o 3/4, sin recortes, ' +
      '(3) fondo liso o transparente, (4) colores fieles al personaje oficial, (5) sin marcas de agua, texto, collage ni varios personajes, (6) preferir pixel art limpio o arte oficial antes que dibujos de aficionados. Descarta las demas. ' +
      'PASO 2: con la imagen ganadora DISENA LA MASCOTA DESDE CERO basandote en ella (no uses una silueta generica): ' +
      'recrea su silueta y sus colores reales como un diseno vectorial pequeno de 16x16. ' +
      'PASO 3: responde UNICAMENTE (sin markdown) la linea `IMAGEN: <ruta absoluta de la ganadora>` (omitela si no conseguiste ninguna) y debajo el arreglo JSON de un elemento. Cada elemento: ' + IA_SYSTEM.replace('Responde SOLO un arreglo JSON, sin texto ni markdown. ', '').replace(/^Eres un generador de mascotas de pixel art\. /, '') + ' ADEMAS: ' + DESIGN_SPEC,
  })
  const { agentId, deny } = res
  if (deny || !agentId) return `No pude lanzar la busqueda web${deny ? `: ${deny}` : ''}.`
  pendientes.set(agentId, descripcion)
  return 'Busco referencias en la web y dibujo la mascota con el modelo principal (puede tardar un par de minutos y consume tokens); la aplico al terminar.'
}

// /pets ia ascii: Sonnet reune candidatas y escoge la mejor imagen; el generador ASCII del mod la convierte (muy detallada, con animacion por cuadros: respiracion, brillo y glitch).
async function dibujarAscii($: EngineInterface, descripcion: string): Promise<string> {
  const res = await $.agent.spawn({
    description: `Imagen para ASCII: ${descripcion.slice(0, 40)}`,
    subagentType: 'general-purpose',
    model: 'sonnet',
    prompt: 'Necesito la mejor imagen de este personaje para convertirla en arte ASCII: ' + JSON.stringify(descripcion.slice(0, 300)) +
      '. Reune de 4 a 6 candidatas (web, Wikimedia Commons con curl, URLs directas .png/.jpg), descargalas con curl -sL a ~/.cache/claude-pets/refs/<nombre>-N.png (crea la carpeta; comprueba con file) y MIRA cada una con Read. ' +
      'ESCOGE LA MEJOR: debe MOSTRAR AL PERSONAJE PEDIDO (no un paisaje, ciudad, logo ni portada), completo o busto de frente, fondo liso u oscuro, alto contraste y buena resolucion, colores fieles, sin marcas de agua ni texto, un solo personaje. Descarta toda imagen en que el personaje no sea el protagonista claro; es mejor 1 buena que 6 dudosas. ' +
      'Responde UNICAMENTE `IMAGEN: <ruta absoluta de la ganadora>` y una linea con un nombre corto de maximo 12 letras: `NOMBRE: <nombre>`. Si no consigues ninguna imagen valida, responde `IMAGEN: ninguna`.',
  })
  const { agentId, deny } = res
  if (deny || !agentId) return `No pude lanzar la busqueda${deny ? `: ${deny}` : ''}.`
  pendientesAscii.set(agentId, descripcion)
  return 'Sonnet escoge la mejor imagen y el generador ASCII la convierte (puede tardar un par de minutos; consume tokens de Sonnet); la aplico al terminar.'
}

async function aplicarAscii($: EngineInterface, descripcion: string, texto: string) {
  const img = /IMAGEN:\s*(\/\S+)/.exec(texto)?.[1]
  if (!img) { $.ui.toast('No se encontro una imagen valida; la mascota queda como estaba.'); return }
  const nombre = (/NOMBRE:\s*([^\n]+)/.exec(texto)?.[1] ?? descripcion.split(/\s+/)[0]!).replace(/[^\p{L}\p{N} -]/gu, '').trim().slice(0, 12) || 'ASCII'
  const { look, error } = await fotoAAscii($, img, nombre, false, 'ascii', 40)
  if (error || !look) { $.ui.toast(error ?? 'No pude convertir la imagen.'); return }
  cfg.src = img
  await respaldar($)
  await guardarMascota($, look)
  await setCfg($, { ...lookToCfg(look), anim: null })
  if (cfg.on) await $.ui.open(openArgs())
  $.ui.toast(`Mascota ASCII creada: ${look.name} (${look.photo!.cols}x${look.photo!.rows})`)
}

// /pets ventana: el ASCII ultradetallado (unas 110 columnas) en una ventana de Terminal aparte con fuente diminuta, animado segun el animo de la sesion.
let ventana = false
let ultimoAnimo = ''
const CACHE = '~/.cache/claude-pets'
const ESCRIBIR = 'import sys, os\np = os.path.expanduser(sys.argv[1])\nos.makedirs(os.path.dirname(p), exist_ok=True)\nopen(p, "w").write(sys.argv[2])'
const escribir = ($: EngineInterface, ruta: string, texto: string) => $.process.run(['python3', '-I', '-c', ESCRIBIR, ruta, texto], { timeoutMs: 10000 })

async function abrirVentana($: EngineInterface, origen: string): Promise<string> {
  if (!origen) return 'Uso: /pets ventana <ruta o URL de una imagen>   (o crea antes una mascota con /pets ascii, foto o ia ascii y usa /pets ventana)   /pets ventana off'
  const r = await $.process.run(['python3', '-I', '-c', IMG2ASCII_PY, origen, '110', 'cuerpo', 'ascii', '80'], { timeoutMs: 60000 })
  let foto: { cols?: number; rows?: number; error?: string }
  try { foto = JSON.parse(r.stdout) } catch { return `No pude convertir la imagen: ${r.stderr.trim().split('\n').pop() || 'error'}` }
  if (foto.error || !foto.cols || !foto.rows) return foto.error ?? 'La imagen no se pudo convertir.'
  await escribir($, `${CACHE}/ventana.json`, r.stdout)
  await escribir($, `${CACHE}/ventana.py`, VENTANA_PY)
  await escribir($, `${CACHE}/estado`, 'sleep')
  const o = await $.process.run(['osascript', '-e', ventanaOsa(foto.cols, foto.rows)], { timeoutMs: 20000 })
  if (o.exitCode !== 0) return `No pude abrir la ventana de Terminal: ${o.stderr.trim().split('\n').pop() || 'error'}`
  ventana = true
  ultimoAnimo = 'sleep'
  return `Ventana abierta: ${foto.cols}x${foto.rows} letras con fuente de 5 pt (perfil "claude-pets" de Terminal), animada segun lo que haga la sesion. /pets ventana off la cierra.`
}

// Avisa al visor el animo de la sesion principal (solo si la ventana esta abierta y el animo cambio).
async function animoVentana($: EngineInterface, animo: string) {
  if (!ventana || animo === ultimoAnimo) return
  ultimoAnimo = animo
  await escribir($, `${CACHE}/estado`, animo).catch(() => undefined)
}

// Cuando vuelve el subagente (que miro la imagen y diseno la mascota desde cero): se aplica su diseno (o su silueta predefinida si no hubo diseno valido)
// y la imagen convertida a 32x32 queda en el listado ("Nombre (img)"). Sin diseno ni silueta se usa la imagen; sin nada, Haiku elige con el texto de referencias.
async function afinarConWeb($: EngineInterface, descripcion: string, refs: string) {
  let look: IaLook | undefined = parseLooks(refs, 1)[0]
  const img = /IMAGEN:\s*(\S+)/.exec(refs)?.[1]
  if (img) {
    const conv = await imagenAMascota($, img, (look?.name ?? descripcion.split(/\s+/)[0]!).slice(0, 9) + ' (img)')
    if (conv.look) {
      await guardarMascota($, conv.look)
      look ??= conv.look
    } else $.ui.toast(conv.error ?? 'No pude usar la imagen.')
  }
  if (!look) {
    const r = await generarIA($, descripcion, 1, refs)
    look = r.looks[0]
    if (r.error || !look) { $.ui.toast(r.error ?? 'No pude afinar la mascota con las referencias.'); return }
  }
  await respaldar($)
  await guardarMascota($, look)
  await setCfg($, lookToCfg(look))
  $.ui.toast(`Mascota creada con referencias web: ${look.name}`)
}

// Manda un mensaje a un subagente por el nombre de su mascota (sin pasar por el modelo).
async function decir($: EngineInterface, nombre: string, texto: string): Promise<string> {
  const todas = await mascotas($)
  const hit = todas.find(a => a.name.toLowerCase() === nombre.toLowerCase())
  if (!hit) return `No hay una mascota llamada "${nombre}". Ahora: ${todas.map(a => a.name).join(', ') || '(ninguna)'}`
  if (!texto.trim()) return `Uso: /pets decir ${hit.name} <mensaje>`
  await $.session.send({ to: { agentId: hit.id }, text: texto.trim() })
  return `Mensaje enviado a ${hit.name} (${hit.type}, ${hit.status}).`
}

// Carga preferencias, sets y listado una vez por modulo; se reintenta si falla.
async function ensureLoaded($: EngineInterface) {
  if (loaded) return
  try {
    const saved = (await $.store.get(STORE_CFG)) as Partial<Cfg> | undefined
    cfg = { ...defaults, ...saved }
    if ((cfg.style as string) === 'tarjetas') cfg = { ...cfg, style: 'pixel' }
    custom = ((await $.store.get(STORE_SETS)) as Record<string, SetDef> | undefined) ?? {}
    coleccion = ((await $.store.get(STORE_COL)) as Record<string, SavedLook> | undefined) ?? {}
    try { detectedRender = (await $.env.get('TERM_PROGRAM')) === 'WarpTerminal' ? 'celdas' : 'medios' } catch { /* sin entorno: medios bloques */ }
    loaded = true
  } catch {
    // se usan los valores por defecto y se reintenta en el siguiente evento
  }
}

async function saveSets($: EngineInterface, next: Record<string, SetDef>) {
  custom = next
  await $.store.set(STORE_SETS, custom)
  await update($, model, m => ({ ...m, custom }))
}

const setOf = (name: string, mine: Record<string, SetDef>): SetDef | undefined =>
  mine[name] ?? (SETS[name] ? { pool: SETS[name] } : undefined)

// Espacios duros: el renderizador no debe recortar ni colapsar la sangria del arte ASCII.
const nbsp = (line: string) => line.replace(/ /g, '\u00a0')

const principal = (c: Cfg): SavedLook => ({ pet: c.pet, accessory: c.accessory, color: c.color || '#fbbf24', accent: c.accent || undefined, custom: c.custom ?? undefined, photo: c.photo ?? undefined, design: c.design ?? undefined, anim: c.anim ?? undefined, name: c.name, eyes: c.eyes === 'auto' ? 'o.o' : c.eyes })

// Lo que hay que escribir en la configuracion para vestir a la principal con una mascota guardada.
const lookToCfg = (l: SavedLook): Partial<Cfg> => ({
  pet: l.pet as Cfg['pet'], color: l.color, accent: l.accent ?? '', custom: l.custom ?? null, photo: l.photo ?? null, design: l.design ?? null, anim: l.anim ?? null,
  accessory: l.accessory as Cfg['accessory'], eyes: l.eyes, name: l.name,
})

// Agrega una mascota al listado propio (persistente): mismo nombre y misma mascota no se duplica; otra con el mismo nombre queda como "Nombre 2".
async function guardarMascota($: EngineInterface, look: SavedLook): Promise<string> {
  const base = look.name || look.pet
  let key = base
  for (let i = 2; coleccion[key] && JSON.stringify(coleccion[key]) !== JSON.stringify({ ...look, name: coleccion[key]!.name }); i++) key = `${base} ${i}`
  if (coleccion[key] && JSON.stringify(coleccion[key]) === JSON.stringify({ ...look, name: coleccion[key]!.name })) return key
  const next = { ...coleccion, [key]: { ...look, name: look.name || key } }
  const keys = Object.keys(next)
  for (const k of keys.slice(0, Math.max(0, keys.length - MAX_COL))) delete next[k]
  coleccion = next
  await $.store.set(STORE_COL, coleccion)
  return key
}

// Antes de cambiar la mascota, la actual se respalda en el listado si ya esta personalizada.
async function respaldar($: EngineInterface) {
  if (cfg.name || cfg.custom || cfg.photo || cfg.design || cfg.color || cfg.accessory !== 'ninguno') await guardarMascota($, principal(cfg))
}

async function setCfg($: EngineInterface, patch: Partial<Cfg>) {
  cfg = { ...cfg, ...patch }
  await $.store.set(STORE_CFG, cfg)
  await update($, model, m => ({ ...m, cfg }))
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    loaded = false
    await ensureLoaded($)
    await update($, model, m => ({ ...m, cfg, custom }))
    await $.command.register({
      name: 'pets',
      description: 'Mascotas: abrir, cerrar, personalizar, sets y generador',
      argumentHint: HINT,
    })
    if (cfg.on) $.ui.open(openArgs()).catch(() => undefined)
    timer?.cancel()
    // Con actividad (herramientas o agentes vivos) las mascotas se mueven 4 veces por segundo; en reposo respiran 1 vez por segundo.
    timer = $.clock.every(TICK_MS, () => {
      if (!cfg.on) return
      n++
      const active = watching || Date.now() <= busyUntil
      if (!cfg.calm && (active || n % 4 === 0)) void update($, model, m => ({ ...m, tick: m.tick + 1 }))
      if (active && n % 20 === 0) void watch($)
    })
    return next(e)
  })

  on('command.run', { command: 'pets' }, async ($, e) => {
    await ensureLoaded($)
    const [sub = '', arg = '', ...more] = e.args.trim().split(/\s+/)
    const rest = [arg, ...more].join(' ')
    const flip = async (key: 'narrow' | 'calm' | 'notify' | 'web', name: string) => {
      await setCfg($, { [key]: !cfg[key] })
      return { text: `${name}: ${cfg[key] ? 'activado' : 'desactivado'}` }
    }
    switch (sub) {
      case 'off':
        await setCfg($, { on: false })
        await $.ui.close({ id: PANE })
        $.ui.status(undefined)
        return { text: 'Mascotas desactivadas (no registra ni dibuja). /pets on para volver.' }
      case 'on':
        await setCfg($, { on: true })
        await $.ui.open(openArgs())
        return { text: 'Mascotas activadas.' }
      case 'cerrar':
        await $.ui.close({ id: PANE })
        return { text: 'Pane cerrado. /pets abrir para verlo de nuevo.' }
      case 'tema':
      case 'tipo': {
        const pet = PETS.find(p => p === arg)
        if (!pet) return { text: `Uso: /pets tipo ${PETS.join('|')}` }
        await respaldar($)
        await setCfg($, { pet, custom: null, photo: null, design: null, anim: null })
        return { text: `Mascota: ${pet}` }
      }
      case 'tipos':
        return { text: `Mascotas: ${PETS.join(', ')}\nAccesorios: ${ACCESSORIES.join(', ')}\nColores: ${Object.keys(COLORS).join(', ')} o #rrggbb` }
      case 'nombre': {
        const name = rest.replace(/[^\p{L}\p{N} ]/gu, '').trim().slice(0, 12)
        await setCfg($, { name })
        return { text: name ? `Nombre: ${name}` : 'Nombre borrado.' }
      }
      case 'color': {
        const color = arg === 'auto' || arg === '' ? '' : parseColor(arg)
        if (arg !== 'auto' && arg !== '' && !color) return { text: 'Uso: /pets color #rrggbb | naranja|rosa|verde|azul|morado|amarillo|rojo|blanco|cian | auto' }
        await setCfg($, { color })
        return { text: color ? `Color: ${color}` : 'Color: automatico' }
      }
      case 'acento': {
        const accent = arg === 'auto' || arg === '' ? '' : parseColor(arg)
        if (arg !== 'auto' && arg !== '' && !accent) return { text: 'Uso: /pets acento <#rrggbb|naranja|rosa|...|auto>   (color secundario: hocico, vientre, placa)' }
        await setCfg($, { accent })
        return { text: accent ? `Acento: ${accent}` : 'Acento: automatico' }
      }
      case 'accesorio': {
        const accessory = ACCESSORIES.find(a => a === arg)
        if (!accessory) return { text: `Uso: /pets accesorio ${ACCESSORIES.join('|')}` }
        await setCfg($, { accessory })
        return { text: `Accesorio: ${accessory}` }
      }
      case 'ojos': {
        if (arg !== 'auto' && [...arg].length !== 3) return { text: 'Uso: /pets ojos <3 caracteres, p. ej. o.o ^.^ @.@> | auto' }
        await setCfg($, { eyes: arg })
        return { text: `Ojos: ${arg} (leer, ejecutar, error y dormir mantienen los suyos)` }
      }
      case 'ventana': {
        if (arg === 'off') {
          ventana = false
          await $.process.run(['pkill', '-f', 'claude-pets/ventana.py'], { timeoutMs: 5000 }).catch(() => undefined)
          return { text: 'Ventana cerrada (puedes cerrar la ventana de Terminal que quede).' }
        }
        return { text: await abrirVentana($, more.length ? [arg, ...more].join(' ') : arg || cfg.src) }
      }
      case 'render': {
        if (arg !== 'auto' && arg !== 'medios' && arg !== 'celdas') return { text: `Render actual: ${cfg.render}${cfg.render === 'auto' ? ` (aqui: ${detectedRender})` : ''}. Uso: /pets render auto|medios|celdas   (celdas = sin medios bloques, para terminales que los dibujan con rendijas, como Warp; el sprite ocupa el doble)` }
        await setCfg($, { render: arg })
        if (cfg.on) await $.ui.open(openArgs())
        return { text: `Render: ${arg}${arg === 'auto' ? ` (aqui: ${detectedRender})` : ''}` }
      }
      case 'foto':
      case 'ascii': {
        if (arg === 'off') {
          await setCfg($, { photo: null, anim: null })
          if (cfg.on) await $.ui.open(openArgs())
          return { text: 'Foto desactivada: vuelve la mascota de pixel art.' }
        }
        if (arg === 'detalle') {
          const cols = Math.round(Number(more[0]))
          if (!(cols >= 16 && cols <= 120)) return { text: `Detalle actual: ${cfg.asciiCols} columnas. Uso: /pets ascii detalle <16-120> (mas columnas = mas detalle y mas alto el pane)` }
          await setCfg($, { asciiCols: cols })
          return { text: `Detalle: ${cols} columnas (se aplica a la proxima /pets ascii).` }
        }
        const words = e.args.trim().split(/\s+/).slice(1)
        // /pets foto: celdas de color (casi una imagen, sin costuras); /pets foto fino: medios bloques con dos colores por celda; /pets ascii: letras
        const fino = sub === 'foto' && words[0] === 'fino'
        // /pets ascii: letras de colores (ASCII real); /pets ascii braille: puntos braille; /pets foto: pixel art de celdas solidas (sin costuras); /pets foto fino: medios bloques
        const braille = sub === 'ascii' && words[0] === 'braille'
        const modo = sub === 'ascii' ? (braille ? 'braille' : 'ascii') : fino ? 'fino' : 'celdas'
        const rest1 = fino || braille ? words.slice(1) : words
        const cuerpo = rest1[0] === 'cuerpo'   // cuerpo <ruta>: figura entera en vez de cabeza y torso
        const [origen = '', ...nombre] = cuerpo ? rest1.slice(1) : rest1
        if (!origen) return { text: 'Uso: /pets ascii <ruta o URL de una imagen> [nombre]   foto ASCII a color, muy detallada (sin tokens); una figura alta se recorta a cabeza y torso\n/pets ascii cuerpo <ruta> [nombre]   figura entera   /pets ascii detalle <16-120>   /pets ascii off' }
        const { look, error } = await fotoAAscii($, origen, (nombre.join(' ') || origen.split('/').pop()!.replace(/\.\w+$/, '')).slice(0, 12), cuerpo, modo)
        if (error || !look) return { text: error ?? 'Sin resultado.' }
        await respaldar($)
        await guardarMascota($, look)
        await setCfg($, { ...lookToCfg(look), src: origen })
        if (cfg.on) await $.ui.open(openArgs())
        return { text: `Mascota ${modo === 'ascii' ? 'ASCII' : 'foto'} creada: ${look.name} (${look.photo!.cols}x${look.photo!.rows} celdas a color). Sin costo de tokens.` }
      }
      case 'img': {
        const [, origen = '', ...nombre] = e.args.trim().split(/\s+/)
        if (!origen) return { text: 'Uso: /pets img <ruta o URL de una imagen> [nombre]   (convierte la imagen en una mascota de 32x32)' }
        const { look, error } = await imagenAMascota($, origen, (nombre.join(' ') || origen.split('/').pop()!.replace(/\.\w+$/, '')).slice(0, 12))
        if (error || !look) return { text: error ?? 'Sin resultado.' }
        await respaldar($)
        await guardarMascota($, look)
        await setCfg($, lookToCfg(look))
        return { text: `Mascota creada desde la imagen: ${look.name} (${Object.keys(look.custom!.palette).length} colores). Sin costo de tokens.` }
      }
      case 'ia': {
        if (arg === 'ascii') {
          const desc = more.join(' ')
          if (!desc.trim()) return { text: 'Uso: /pets ia ascii <descripcion>   (Sonnet escoge la mejor imagen y el generador ASCII la convierte, muy detallada y animada; consume tokens)' }
          return { text: await dibujarAscii($, desc) }
        }
        if (arg === 'web') {
          const desc = more.join(' ')
          if (!desc.trim()) return { text: 'Uso: /pets ia web <descripcion>   (busca referencias en internet con el modelo principal y luego Haiku dibuja)' }
          return { text: await investigarWeb($, desc) }
        }
        if (arg === 'set') {
          const [, , name = '', ...words] = e.args.trim().split(/\s+/)
          if (!name) return { text: 'Uso: /pets ia set <nombre> <descripcion del equipo>' }
          const { looks, error } = await generarIA($, words.join(' '), 6)
          if (error) return { text: error }
          await saveSets($, { ...custom, [name]: { looks } })
          return { text: `Set "${name}" creado con Haiku: ${looks.map(l => l.name).join(', ')}. /pets set ${name} para usarlo.` }
        }
        const quick = arg === 'rapido'
        const desc = quick ? more.join(' ') : rest
        if (!quick && cfg.web) {
          if (!desc.trim()) return { text: 'Describe la mascota, ej. /pets ia EVA-01 de Evangelion' }
          return { text: await investigarWeb($, desc) }
        }
        const { looks, error } = await generarIA($, desc, 1)
        const look = looks[0]
        if (error || !look) return { text: error ?? 'Sin resultado.' }
        await respaldar($)
        await guardarMascota($, look)
        await setCfg($, { pet: look.pet as Cfg['pet'], color: look.color, accent: look.accent ?? '', custom: look.custom ?? null, photo: null, design: null, anim: null, accessory: look.accessory as Cfg['accessory'], eyes: look.eyes, name: look.name })
        const colors = look.accent ? `${look.color} + ${look.accent}` : look.color
        const doubt = look.isSure ? '' : `\nNo estoy seguro de los colores${look.question ? `: ${look.question}` : ''}. Ajusta con /pets color <#hex|nombre> y /pets acento <#hex|nombre|auto>, o repite /pets ia con mas detalle (ej. los colores que quieres).`
        const web = ''
        return { text: `Mascota creada con Haiku: ${look.name} (${look.custom ? 'forma propia' : look.pet}, ${look.accessory}, ${colors}, ojos ${look.eyes}). Cuesta unos cientos de tokens de Haiku.${doubt}${web}` }
      }
      case 'mis':
      case 'lista': {
        const items = Object.entries(coleccion).map(([k, l]) => `${l.name === cfg.name && l.name ? '* ' : '  '}${k}: ${l.photo ? 'foto ascii' : l.design ? 'diseno propio' : l.custom ? 'forma propia' : l.pet}, ${l.accessory}, ${l.color}${l.accent ? ` + ${l.accent}` : ''}`)
        return { text: items.length ? `Mis mascotas (${items.length}/${MAX_COL}); * = la actual:\n${items.join('\n')}\n/pets usar <nombre> | guardar [nombre] | quitar <nombre>` : 'Aun no hay mascotas guardadas. Las que generes (/pets ia, /pets generar) se guardan solas; /pets guardar guarda la actual.' }
      }
      case 'usar': {
        const hit = Object.entries(coleccion).find(([k, l]) => [k, l.name].some(n => n.toLowerCase() === rest.toLowerCase()))
        if (!hit) return { text: `No hay una mascota guardada llamada "${rest}". /pets mis para ver el listado.` }
        await respaldar($)
        await setCfg($, lookToCfg(hit[1]))
        return { text: `Mascota actual: ${hit[0]}` }
      }
      case 'guardar': {
        const look = rest ? { ...principal(cfg), name: rest.slice(0, 12) } : principal(cfg)
        const key = await guardarMascota($, look)
        if (rest) await setCfg($, { name: look.name })
        return { text: `Guardada como "${key}" (${Object.keys(coleccion).length}/${MAX_COL}). /pets mis para ver el listado.` }
      }
      case 'quitar': {
        const key = Object.keys(coleccion).find(k => k.toLowerCase() === rest.toLowerCase())
        if (!key) return { text: `No hay una mascota guardada llamada "${rest}".` }
        const { [key]: gone, ...left } = coleccion
        coleccion = left
        await $.store.set(STORE_COL, coleccion)
        return { text: `Quitada "${key}" del listado.` }
      }
      case 'decir':
        return { text: await decir($, arg, more.join(' ')) }
      case 'generar': {
        if (arg === 'set') {
          const [, , name = '', count = '6'] = e.args.trim().split(/\s+/)
          if (!name) return { text: 'Uso: /pets generar set <nombre> [cantidad 1-12]' }
          const n = Math.min(12, Math.max(1, Number(count) || 6))
          const pool = SETS[name] ?? SETS[cfg.set]
          const looks = generateSet(`${name}:${randomSeed()}`, n, pool)
          await saveSets($, { ...custom, [name]: { looks } })
          return { text: `Set "${name}" generado con ${looks.length} mascotas: ${looks.map(l => l.name).join(', ')}. /pets set ${name} para usarlo.` }
        }
        const seed = rest || randomSeed()
        const look = lookFromSeed(seed, setOf(cfg.set, custom)?.pool)
        await respaldar($)
        await guardarMascota($, look)
        await setCfg($, { pet: look.pet as Cfg['pet'], color: look.color, accessory: look.accessory as Cfg['accessory'], eyes: look.eyes, name: look.name, custom: null, photo: null, design: null, anim: null })
        return { text: `Mascota generada${rest ? ` desde "${rest}"` : ''}: ${look.name} (${look.pet}, ${look.accessory}, ${look.color}, ojos ${look.eyes}). Repite /pets generar para otra.` }
      }
      case 'set': {
        const [, verb = '', name = ''] = e.args.trim().split(/\s+/)
        if (arg === '') {
          const mine = Object.keys(custom).map(k => `${k} (${custom[k]!.looks?.length ?? 0} propias)`)
          return { text: `Set activo: ${cfg.set || 'ninguno'}\nTematicos: ${Object.keys(SETS).join(', ')}\nPropios: ${mine.join(', ') || '(ninguno)'}\n/pets set <nombre> | ninguno | guardar <nombre> | borrar <nombre>` }
        }
        if (verb === 'guardar') {
          if (!name) return { text: 'Uso: /pets set guardar <nombre>' }
          const prev = custom[name]?.looks ?? []
          await saveSets($, { ...custom, [name]: { looks: [...prev, principal(cfg)].slice(-12) } })
          return { text: `Mascota "${cfg.name || cfg.pet}" agregada al set "${name}" (${prev.length + 1}).` }
        }
        if (verb === 'borrar') {
          const { [name]: gone, ...left } = custom
          if (!gone) return { text: `No existe el set propio "${name}".` }
          await saveSets($, left)
          if (cfg.set === name) await setCfg($, { set: '' })
          return { text: `Set "${name}" borrado.` }
        }
        if (arg === 'ninguno' || arg === 'todos') { await setCfg($, { set: '' }); return { text: 'Set desactivado: se usan todas las mascotas.' } }
        if (!setOf(arg, custom)) return { text: `No existe el set "${arg}". /pets set para ver la lista.` }
        await setCfg($, { set: arg })
        return { text: `Set activo: ${arg}` }
      }
      case 'editar':
        await update($, model, m => ({ ...m, edit: !m.edit }))
        return { text: 'Editor: vista previa de la principal en todos sus animos. /pets editar de nuevo para salir.' }
      case 'reset':
        await respaldar($)
        await setCfg($, { pet: 'cat', name: '', color: '', accent: '', custom: null, photo: null, design: null, anim: null, accessory: 'ninguno', eyes: 'auto' })
        return { text: 'Mascota restablecida.' }
      case 'estilo':
        const style = arg === 'ascii' || arg === 'tarjetas' ? 'ascii' : arg === 'pixel' ? 'pixel' : undefined
        if (!style) return { text: 'Uso: /pets estilo pixel|ascii' }
        await setCfg($, { style })
        return { text: `Estilo: ${style}` }
      case 'web': return flip('web', 'Busqueda web cuando Haiku no esta seguro (usa el modelo principal)')
      case 'angosto': return flip('narrow', 'Pane angosto')
      case 'calma': return flip('calm', 'Modo calmado (sin animacion)')
      case 'avisos': return flip('notify', 'Avisos de terminal')
      case 'historial': {
        if (arg === 'ver') {
          const h = ((await $.store.get(STORE_HIST)) as string[] | undefined) ?? []
          return { text: h.length ? h.slice(-10).join('\n') : 'Historial vacio.' }
        }
        await setCfg($, { history: !cfg.history })
        return { text: `Historial: ${cfg.history ? 'activado' : 'desactivado'}` }
      }
      case 'estado':
        return { text: Object.entries(cfg).map(([k, v]) => `${k}=${v}`).join(' | ') }
      case 'ayuda':
        return { text: HELP }
      case 'abrir':
      case '':
        if (cfg.on) await $.ui.open(openArgs())
        return { text: cfg.on ? HELP : 'Mascotas desactivadas. /pets on para activarlas.' }
      default: {
        // /pets <Nombre> <mensaje>: atajo para hablar con una mascota.
        const todas = await mascotas($)
        if (todas.some(a => a.name.toLowerCase() === sub.toLowerCase())) return { text: await decir($, sub, rest) }
        return { text: HELP }
      }
    }
  })

  // "@Nombre mensaje" en el prompt: se entrega al subagente y no llega al modelo principal.
  on('prompt.submit', async ($, e, next) => {
    if (!cfg.on || e.command || e.isMeta) return next(e)
    const hit = /^@([\p{L}\p{N}_-]+)\s+([\s\S]+)/u.exec(e.text)
    if (!hit) return next(e)
    const todas = await mascotas($)
    if (!todas.some(a => a.name.toLowerCase() === hit[1]!.toLowerCase())) return next(e)
    return { drop: await decir($, hit[1]!, hit[2]!) }
  }).catch(($, e, next) => next(e))

  // El resultado del subagente de referencias ya se aplico aqui: no hace falta que el modelo principal lo lea.
  on('session.receive', async ($, e, next) => {
    if (cfg.on && esperandoRecibo > 0 && (e.text.includes('"design"') || e.text.includes('"anim"') || e.text.includes('IMAGEN:') || (e.text.includes('"palette"') && e.text.includes('"art"')) || (e.text.includes('"pet"') && e.text.includes('"color"')))) {
      esperandoRecibo--
      return { consumed: 'resultado de mascota ya aplicado por el mod' }
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('session.end', async ($, e, next) => {
    timer?.cancel()
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    await ensureLoaded($)
    if (!cfg.on) return next(e)
    busyUntil = Date.now() + IDLE_MS
    if (!e.agentId) {
      await update($, model, m => ({ ...m, main: { ...fresh(), st: 'running' as const }, timeline: [] }))
      await animoVentana($, 'think')
    }
    return next(e)
  })

  on('agent.spawn', async ($, e, next) => {
    const ran = await next(e)
    if (cfg.on) watching = true
    return ran
  })

  on('tool.call', async ($, e, next) => {
    await ensureLoaded($)
    if (!cfg.on) return next(e)
    busyUntil = Date.now() + IDLE_MS
    const act = actOf(e.tool, e as unknown as Record<string, unknown>)
    if (!e.agentId) await animoVentana($, moodOf(act.kind, 'running'))
    const touch = (l: Live, isError = false): Live => ({
      ...l, act, last: Date.now(), tools: isError ? l.tools : l.tools + 1, errors: l.errors + (isError ? 1 : 0),
      by: isError ? l.by : { ...l.by, [act.kind]: (l.by[act.kind] ?? 0) + 1 },
    })
    await update($, model, m => {
      const id = e.agentId
      const timeline = [...m.timeline, act.kind].slice(-MAX_LINE)
      if (!id) return { ...m, timeline, main: { ...touch(m.main), st: 'running' as const } }
      return { ...m, timeline, agents: trim({ ...m.agents, [id]: touch(m.agents[id] ?? fresh()) }) }
    })
    const ran = await next(e)
    if ('isError' in ran && ran.isError) {
      await update($, model, m => {
        const id = e.agentId
        if (!id) return { ...m, main: { ...touch(m.main, true), st: 'failed' as const } }
        return { ...m, agents: { ...m.agents, [id]: touch(m.agents[id] ?? fresh(), true) } }
      })
    }
    return ran
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    if (!cfg.on) return next(e)
    const ascii = e.agentId ? pendientesAscii.get(e.agentId) : undefined
    if (e.agentId && ascii !== undefined) {
      pendientesAscii.delete(e.agentId)
      esperandoRecibo++
      const r = await next(e)
      if (e.reason === 'answer' && r.text.trim()) await aplicarAscii($, ascii, r.text)
      else $.ui.toast('El dibujo ASCII no devolvio resultado; la mascota queda como estaba.')
      return r
    }
    const wanted = e.agentId ? pendientes.get(e.agentId) : undefined
    if (e.agentId && wanted !== undefined) {
      pendientes.delete(e.agentId)
      esperandoRecibo++
      const r = await next(e)
      if (e.reason === 'answer' && r.text.trim()) await afinarConWeb($, wanted, r.text)
      else $.ui.toast('La busqueda web no devolvio referencias; la mascota queda como estaba.')
      return r
    }
    if (!e.agentId) {
      await animoVentana($, e.reason === 'answer' ? 'happy' : 'sleep')
      const m = await read($, model)
      const summary = `Turno ${ago(Date.now() - m.main.since)} | ${m.main.tools} herr. | ${Object.keys(m.agents).length} agentes`
      await update($, model, s => ({ ...s, summary, main: { ...s.main, st: 'idle' as const, act: undefined } }))
      if (cfg.history) {
        const h = ((await $.store.get(STORE_HIST)) as string[] | undefined) ?? []
        await $.store.set(STORE_HIST, [...h, `${new Date().toISOString().slice(0, 16)} ${summary}`].slice(-50))
      }
    } else {
      const info = (await $.agent.list()).find(a => a.id === e.agentId)
      const name = info?.description || e.agentId
      if (e.reason === 'answer') $.ui.toast(`Agente termino: ${name}`)
      else await alert($, `Agente con problemas (${e.reason}): ${name}`)
    }
    await watch($)
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const els = $.ui.resolve(e)
    const { Box, Text } = els
    const RasterEl = 'Raster' in els ? els.Raster : undefined
    const m = await read($, model)
    await ensureLoaded($)
    const C = cfg   // preferencias del modulo (no se pierden al reiniciar la sesion)
    if (!C.on) return <Text dimColor>Mascotas desactivadas. /pets on para activarlas.</Text>
    const agents = await $.agent.list()
    const now = Date.now()
    const tick = C.calm ? 0 : m.tick
    const narrow = C.narrow || (e.viewport?.columns ?? 99) < 40
    const main = m.main
    const alive = agents.filter(a => a.status === 'running').length
    const waiting = main.st === 'idle' && alive > 0
    const kind = waiting ? 'delegate' : main.st === 'running' ? main.act?.kind ?? 'think' : undefined
    const mood = moodOf(kind, waiting ? 'running' : main.st)
    const mainColor = main.st === 'failed' ? '#f87171' : main.st === 'idle' && !waiting ? '#9aa3b2' : C.color || '#c084fc'
    const total = main.tools + Object.values(m.agents).reduce((t, l) => t + l.tools, 0)
    const state = waiting ? 'Esperando agentes' : main.st === 'idle' ? 'Descansando' : main.st === 'failed' ? 'Algo fallo' : LABEL[kind ?? 'think'] ?? ''
    const label = C.name ? `${C.name} | ${state}` : state
    const usePixel = C.style === 'pixel' && RasterEl !== undefined
    const art = bigArt(mood, tick, C.pet, C)

    // El pane tiene alto fijo: principal a la izquierda, subagentes a la derecha (tarjetas hasta 4, tabla desde 5).
    const rows = e.viewport?.rows ?? 40
    const cols = e.viewport?.columns ?? 100
    const stacked = narrow || cols < 60
    // rows es el alto de toda la pantalla; el pane pide PANE_ROWS (marco 2 + pie 1 fuera del cuerpo).
    const avail = Math.max(5, Math.min(paneRows(), Math.max(8, rows - 10)) - 3)
    // Sprites de pixel art de 16x16 (16 columnas x 8 filas): chibi de cabeza grande, siempre pequenos.
    const photo = C.photo && RasterEl !== undefined ? fitPhoto(C.photo, Math.max(6, avail - 8)) : undefined   // foto ASCII: se achica para que quepa completa en el pane
    const anim = !photo && C.anim && RasterEl !== undefined ? C.anim : undefined   // arte ASCII animado dibujado por la IA
    const celdas = effRender() === 'celdas'
    const spriteW = 16
    const spriteH = 8
    const mainW = photo ? photo.cols : anim ? anim.cols : spriteW
    const mainH = photo ? photo.rows : anim ? anim.rows : spriteH
    const leftW = Math.max(LEFT_W, mainW + 4)
    const cardW = CARD_W
    const sprite = photo ? photoCells(photo, mood, tick) : anim ? animCells(anim, mood, tick) : usePixel ? pixelCells(mood, tick, C.pet, C.color, C.accessory, C.accent, C.custom, C.design, celdas) : undefined
    const perRow = Math.max(1, Math.floor((cols - leftW - 3) / (cardW + 1)))
    const compactH = usePixel ? spriteH + 2 : 5
    const capFull = perRow * Math.floor(avail / (usePixel ? spriteH + 2 : 7))
    const capCompact = perRow * Math.floor(avail / compactH)
    const asTable = agents.length > Math.min(MAX_CARDS, capCompact)
    const fullCards = agents.length <= capFull
    const cardH = fullCards ? 7 : compactH
    const roomy = avail >= (usePixel || photo || anim ? mainH + 8 : 10)
    const mine = setOf(C.set, custom)
    const shown = asTable ? agents.slice(-Math.max(1, avail - 2)) : agents.slice(-Math.max(1, Math.floor(avail / cardH)) * perRow)
    const looks = uniqueLooks(agents.slice(-30).map(a => a.id), mine)
    const counts = (by: Record<string, number>) =>
      Object.entries(by).sort((x, y) => y[1] - x[1]).slice(0, 3).map(([k, v]) => (
        <Text key={k} color={KIND_COLOR[k]}>{k} {v}  </Text>
      ))
    const line = <Text>{m.timeline.slice(-28).map(k => <Text color={KIND_COLOR[k]}>#</Text>)}</Text>
    const mainArt = compactArt(art, C.accessory)

    if (m.edit) {
      const moods = ['think', 'read', 'write', 'run', 'wait', 'error', 'sleep', 'happy'] as const
      return (
        <Box borderStyle="round" borderColor={mainColor} paddingX={1} flexDirection="column">
          <Text color={mainColor} weight="bold">EDITOR DE MASCOTA {C.name ? `| ${C.name.toUpperCase()}` : ''}</Text>
          <Box gap={2}>
            {moods.map(md => (
              <Box key={md} flexDirection="column">
                {bigArt(md, 0, C.pet, C).map(l => <Text color={mainColor}>{nbsp(l)}</Text>)}
                <Text dimColor>{md}</Text>
              </Box>
            ))}
          </Box>
          <Text dimColor>tipo {C.pet} | color {C.color || 'auto'} | accesorio {C.accessory} | ojos {C.eyes} | set {C.set || 'ninguno'}</Text>
          <Text dimColor>/pets tipo|color|accesorio|ojos|nombre ... | generar | set guardar X | editar (salir)</Text>
        </Box>
      )
    }

    const mainCard = (
      <Box width={stacked ? undefined : leftW} borderStyle="round" borderColor={mainColor} paddingX={1} flexDirection="column">
        <Text color={mainColor} weight="bold">{label.toUpperCase().slice(0, leftW - 4)}</Text>
        <Box gap={1}>
          {sprite && RasterEl ? <RasterEl key="main" {...sprite} /> : (
            <Box flexDirection="column">{(roomy ? art : mainArt).map(l => <Text color={mainColor}>{nbsp(l)}</Text>)}</Box>
          )}
          {mainW <= 16 && (
            <Box flexDirection="column">
              {main.act && main.st !== 'idle' ? <Text>{main.act.target.slice(0, sprite ? leftW - 4 - mainW - 1 : 18)}</Text> : <Text dimColor> </Text>}
              {kind && !sprite ? <Text color={KIND_COLOR[kind]}>{scene(kind, tick)}</Text> : <Text dimColor> </Text>}
            </Box>
          )}
        </Box>
        {sprite && <Text> </Text>}
        {mainW > 16 && main.act && main.st !== 'idle' && <Text>{main.act.target.slice(0, leftW - 4)}</Text>}
        {kind && sprite && <Text color={KIND_COLOR[kind]}>{scene(kind, tick).slice(0, leftW - 4)}</Text>}
        <Text color={mainColor}>{bar(main.tools)} {main.tools} herr. {ago(now - main.since)}</Text>
        {roomy && Object.keys(main.by).length > 0 && <Text>{counts(main.by)}</Text>}
        {roomy && m.timeline.length > 0 && line}
      </Box>
    )

    const faceOf = (a: (typeof agents)[number], me: SavedLook, bad: boolean) =>
      skin(bad ? '(x.x)' : a.status === 'idle' || a.status === 'waiting' ? '(-.-)' : `(${me.eyes})`, me.pet)

    const agentsView = asTable ? (
      <Box flexGrow={1} borderStyle="round" borderColor="#9aa3b2" paddingX={1} flexDirection="column">
        {shown.map(a => {
          const live = m.agents[a.id]
          const me = looks[a.id] ?? lookFromSeed(a.id)
          const bad = a.status === 'failed' || a.status === 'killed'
          const act = a.status === 'running' ? live?.act : undefined
          const text = `${me.name.slice(0, 7).padEnd(8)}${faceOf(a, me, bad).padEnd(8)}${ICON[a.status]} ${a.type.slice(0, 8).padEnd(9)}${(act ? `${LABEL[act.kind]} ${act.target}` : a.status).slice(0, 22).padEnd(23)}${bar(live?.tools ?? 0, 6)} ${live?.tools ?? 0} ${ago(now - (live?.since ?? now))}`
          return <Text key={a.id} color={bad ? COLOR[a.status] : me.color}>{text}</Text>
        })}
      </Box>
    ) : (
      <Box flexDirection="row" flexWrap="wrap" gap={fullCards ? 1 : 0}>
        {shown.map(a => {
          const live = m.agents[a.id]
          const me = looks[a.id] ?? lookFromSeed(a.id)
          const stuck = a.status === 'running' && live && now - live.last > STUCK_MS
          const bad = a.status === 'failed' || a.status === 'killed'
          const act = a.status === 'running' ? live?.act : undefined
          const amood = bad ? 'error' : stuck ? 'wait' : a.status === 'running' ? moodOf(act?.kind ?? 'think', 'running') : a.status === 'completed' ? 'happy' : 'sleep'
          const tone = bad ? COLOR[a.status] : me.color
          const full = bigArt(amood, tick, me.pet, { eyes: me.eyes, accessory: me.accessory })
          const face = fullCards ? full : compactArt(full, me.accessory)
          const doing = act ? <Text color={KIND_COLOR[act.kind]}>{LABEL[act.kind]} {act.target.slice(0, 8)}</Text> : <Text dimColor>{stuck ? 'sin actividad' : ' '}</Text>
          return (
            <Box key={a.id} width={cardW} borderStyle="round" borderColor={COLOR[a.status]} paddingX={2} gap={1}>
              {usePixel && RasterEl ? (
                <RasterEl key={`px-${a.id}`} {...pixelCells(amood, tick, me.pet, bad ? '#f87171' : me.color, me.accessory, bad ? '' : me.accent ?? '', me.custom, me.design, celdas)} />
              ) : (
                <Box flexDirection="column">{face.map(l => <Text color={tone}>{nbsp(l)}</Text>)}</Box>
              )}
              <Box flexDirection="column">
                <Text color={tone} weight="bold">{me.name.toUpperCase()} <Text color={COLOR[a.status]}>{ICON[a.status]} {a.status}</Text></Text>
                {fullCards ? <Text>{a.description.slice(0, cardW - 6 - (usePixel ? spriteW : 9) - 1)}</Text> : act ? doing : <Text>{a.description.slice(0, cardW - 6 - (usePixel ? spriteW : 9) - 1)}</Text>}
                {fullCards && doing}
                <Text color={tone}>{bar(live?.tools ?? 0, 6)} {live?.tools ?? 0} {ago(now - (live?.since ?? now))}</Text>
              </Box>
            </Box>
          )
        })}
      </Box>
    )

    const footer = (
      <Text dimColor>herramientas {total} | vivos {alive} | terminados {agents.length - alive}{agents.length > shown.length ? ` | +${agents.length - shown.length} mas` : ''}{C.set ? ` | set ${C.set}` : ''}</Text>
    )

    if (stacked) {
      return (
        <Box flexDirection="column">
          {mainCard}
          {agents.slice(-6).map(a => {
            const me = looks[a.id] ?? lookFromSeed(a.id)
            const act = a.status === 'running' ? m.agents[a.id]?.act : undefined
            return <Text key={a.id} color={me.color}>{me.name} {ICON[a.status]} {a.type} {act ? LABEL[act.kind] : a.status}</Text>
          })}
          {footer}
        </Box>
      )
    }
    return (
      <Box flexDirection="column">
        <Box flexDirection="row" gap={1}>
          {mainCard}
          {agentsView}
        </Box>
        {footer}
      </Box>
    )
  })
}

function trim(agents: Model['agents']): Model['agents'] {
  const keys = Object.keys(agents)
  if (keys.length <= MAX_AGENTS) return agents
  return Object.fromEntries(keys.slice(-MAX_AGENTS).map(k => [k, agents[k]!]))
}

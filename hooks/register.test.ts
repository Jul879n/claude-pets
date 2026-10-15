import { describe, expect, mock, test } from 'claude-code/testing'

import { actOf, bar, bigArt, moodOf, generateSet, lookFromSeed, parseLooks, parseColor, pixelCells, scene, SETS, skin, uniqueLooks } from './sprites'

describe('actOf', () => {
  test('copiar y mover archivos', () => {
    expect(actOf('Bash', { command: 'cp a/x.txt b/y.txt' })).toEqual({ kind: 'copy', target: 'x.txt > y.txt' })
    expect(actOf('Bash', { command: 'mv -f a.txt b.txt && ls' }).kind).toBe('move')
  })
  test('leer documentos vs codigo', () => {
    expect(actOf('Read', { file_path: '/x/informe.pdf' }).kind).toBe('doc')
    expect(actOf('Read', { file_path: '/x/app.ts' }).kind).toBe('read')
  })
  test('otras herramientas', () => {
    expect(actOf('Grep', { pattern: 'useAuth' }).kind).toBe('search')
    expect(actOf('Bash', { command: 'npm install zod' }).kind).toBe('install')
    expect(actOf('Bash', { command: 'rm -rf dist' }).kind).toBe('delete')
    expect(actOf('Bash', { command: 'echo hola' }).kind).toBe('run')
  })
})

describe('visual', () => {
  test('la marca de la escena viaja con el tick', () => {
    expect(scene('copy', 0)).toBe('[f] >...... [f]')
    expect(scene('copy', 3)).toBe('[f] ...>... [f]')
    expect(scene('think', 1)).toBe('')
  })
  test('mascota grande por animo y tema', () => {
    expect(bigArt('think', 1, 'cat')).toHaveLength(3)
    expect(bigArt('read', 0, 'cat')).not.toEqual(bigArt('read', 1, 'cat'))
    expect(bigArt('run', 0, 'robot')[1]).toContain('O.O')
    expect(moodOf('doc', 'running')).toBe('read')
    expect(moodOf(undefined, 'idle')).toBe('sleep')
    expect(skin('(o.o)', 'owl')).toBe('{o.o}')
  })
  test('barra y pixel art', () => {
    expect(bar(10, 10, 20)).toBe('[#####-----]')
    const px = pixelCells('think', 0, 'cat')
    expect(px.columns * px.rows).toBe(128)
    expect([px.columns, px.rows]).toEqual([16, 8])
    const big = pixelCells('think', 0, 'cat')
    // las mascotas se mueven: el cuerpo cambia entre ticks, tambien dormida
    for (const m of ['think', 'read', 'write', 'run', 'wait', 'error', 'sleep', 'happy'] as const) {
      expect(new Set([0, 1, 2, 3].map(t => pixelCells(m, t, 'fox').cells)).size).toBeGreaterThan(1)
    }
    for (const a of ['sombrero', 'corona', 'lentes', 'corbata']) expect(pixelCells('think', 1, 'cat', '', a).cells).not.toBe(big.cells)
    expect(big.cells).not.toBe(pixelCells('think', 0, 'fox').cells)
    expect(pixelCells('read', 0, 'cat').cells).not.toBe(pixelCells('read', 1, 'cat').cells)
    expect(pixelCells('think', 0, 'fox').cells).not.toBe(pixelCells('think', 0, 'dog').cells)
  })
})

describe('personalizacion', () => {
  test('tipos, accesorios, ojos propios y color', () => {
    expect(bigArt('think', 1, 'fox')[0]).toContain('/\\___/\\')
    expect(bigArt('think', 1, 'cat', { eyes: 'auto', accessory: 'sombrero' })).toHaveLength(4)
    expect(bigArt('think', 1, 'cat', { eyes: '@.@', accessory: 'ninguno' })[1]).toContain('@.@')
    expect(bigArt('run', 0, 'cat', { eyes: '@.@', accessory: 'ninguno' })[1]).toContain('O.O')
    expect(bigArt('think', 1, 'cat', { eyes: 'auto', accessory: 'lentes' })[1]).toContain('=o.o=')
    expect(parseColor('naranja')).toBe('#fb923c')
    expect(parseColor('#12abEF')).toBe('#12abEF')
    expect(parseColor('nada')).toBe('')
    expect(pixelCells('think', 0, 'bunny', '#ff0000', 'corona').cells).not.toBe(pixelCells('think', 0, 'bunny').cells)
  })
})

describe('mascotas unicas', () => {
  test('cada agente tiene nombre y combinacion distintos, y son estables', () => {
    const ids = Array.from({ length: 30 }, (_, i) => `agent-${i}`)
    const looks = uniqueLooks(ids)
    expect(new Set(ids.map(i => looks[i]!.name)).size).toBe(30)
    expect(new Set(ids.map(i => `${looks[i]!.pet}${looks[i]!.accessory}${looks[i]!.color}`)).size).toBe(30)
    expect(uniqueLooks(ids)).toEqual(looks)
  })
})

describe('pane', () => {
  test('dibuja la mascota principal y una escena al leer un documento', async ($, on) => {
    mock.store(on, {})
    // Lo que el motor haria por debajo del mod.
    on('session.start', (_$, e) => ({ cwd: e.cwd }))
    on('command.register', () => ({ value: { command: 'pets' } }))
    on('ui.open', () => ({ value: { isPlaced: true } }))
    on('ui.status', () => ({ value: undefined }))
    on('ui.toast', () => ({ value: undefined }))
    on('agent.list', () => ({ value: [] }))
    on('turn.start', (_$, e) => ({ turnId: e.turnId }))
    on('tool.call', () => ({ result: {} }) as never)
    await $.session.start({ cwd: '/x', surface: 'terminal', isInteractive: true })
    await $.turn.start({ text: 'lee', turnId: 't1' })
    await $.tool.call({ tool: 'Read', file_path: '/x/informe.pdf', tool_use_id: 'u1' } as never)
    const pane = await $.ui.mount({
      plugin: 'mascotas', surface: 'terminal', component: 'Pane', requestId: 'mascotas', props: {} as never,
    })
    const texts = (await pane.findAll({ type: 'Text' })).map(t => t.text).join('\n')
    expect(texts).toContain('LEYENDO DOCUMENTO')
    expect(texts).toContain('informe.pdf')
    expect(texts).toContain('[D]')
  })
})

describe('subcomandos', () => {
  test('off desactiva el pane y on lo vuelve a activar; pixel dibuja Raster', async ($, on) => {
    mock.store(on, {})
    on('command.register', () => ({ value: { command: 'pets' } }))
    on('ui.open', () => ({ value: { isPlaced: true } }))
    on('ui.close', () => ({ value: undefined }))
    on('ui.status', () => ({ value: undefined }))
    on('agent.list', () => ({ value: [] }))
    const pane = await $.ui.mount({ plugin: 'mascotas', surface: 'terminal', component: 'Pane', requestId: 'mascotas', props: {} as never, viewport: { columns: 170, rows: 40 } })
    const text = async () => (await pane.findAll({ type: 'Text' })).map(t => t.text).join('\n')
    const run = (args: string) => $.command.run({ command: 'pets', args } as never)

    await run('off')
    expect(await text()).toContain('desactivadas')
    await run('on')
    expect(await text()).toContain('DESCANSANDO')
    await run('nombre Michi')
    await run('color rosa')
    await run('accesorio sombrero')
    expect(await text()).toContain('MICHI | DESCANSANDO')
    await run('estilo ascii')
    expect((await pane.findAll({ type: 'Raster' })).length).toBe(0)
    await run('estilo pixel')
    expect((await pane.findAll({ type: 'Raster' })).length).toBe(1)
  })
})

describe('grilla de subagentes', () => {
  test('dibuja una tarjeta por agente, en fila', async ($, on) => {
    mock.store(on, {})
    on('command.register', () => ({ value: { command: 'pets' } }))
    on('ui.open', () => ({ value: { isPlaced: true } }))
    const info = (id: string, type: string) => ({ id, type, description: `tarea ${id}`, status: 'running' as const })
    on('agent.list', () => ({ value: [info('a1', 'Explore'), info('a2', 'Plan'), info('a3', 'general-purpose')] }))
    const pane = await $.ui.mount({ plugin: 'mascotas', surface: 'terminal', component: 'Pane', requestId: 'mascotas', props: {} as never, viewport: { columns: 300, rows: 40 } })
    const cards = await pane.findAll({ type: 'Box', key: undefined })
    const texts = (await pane.findAll({ type: 'Text' })).map(t => t.text).join('\n')
    expect(texts).toContain('ESPERANDO AGENTES')
    for (const id of ['a1', 'a2', 'a3']) expect(texts).toContain(`tarea ${id}`)
    expect(cards.length).toBeGreaterThan(3)
    expect(await pane.findAll({ type: 'Button' })).toHaveLength(0)
    expect((await pane.findAll({ type: 'Raster' })).length).toBe(4)
  })
})

describe('sets y generador', () => {
  test('un set tematico restringe tipos, nombres y colores', () => {
    const looks = uniqueLooks(Array.from({ length: 8 }, (_, i) => `a${i}`), { pool: SETS.robots })
    for (const l of Object.values(looks)) {
      expect(l.pet).toBe('robot')
      expect(SETS.robots!.names).toContain(l.name)
    }
    expect(new Set(Object.values(looks).map(l => l.name)).size).toBe(8)
  })
  test('un set propio usa sus mascotas fijas primero', () => {
    const fixed = [{ pet: 'fox', accessory: 'corona', color: '#f472b6', name: 'Reina', eyes: '^.^' }]
    const looks = uniqueLooks(['x', 'y'], { looks: fixed })
    expect(Object.values(looks).filter(l => l.name === 'Reina')).toHaveLength(1)
  })
  test('la misma semilla da la misma mascota; generateSet da n distintas', () => {
    expect(lookFromSeed('hola')).toEqual(lookFromSeed('hola'))
    const set = generateSet('s', 8)
    expect(set).toHaveLength(8)
    expect(new Set(set.map(l => l.name)).size).toBe(8)
  })
})

describe('layout y comandos', () => {
  const base = ($: any, on: any) => {
    mock.store(on, {})
    on('command.register', () => ({ value: { command: 'pets' } }))
    on('ui.open', () => ({ value: { isPlaced: true } }))
    on('ui.close', () => ({ value: undefined }))
    on('ui.status', () => ({ value: undefined }))
    return $
  }
  const mount = ($: any) => $.ui.mount({ plugin: 'mascotas', surface: 'terminal', component: 'Pane', requestId: 'mascotas', props: {} as never, viewport: { columns: 170, rows: 40 } })

  test('con mas de 4 agentes pasa a tabla (una linea por agente)', async ($, on) => {
    base($, on)
    const info = (i: number) => ({ id: `t${i}`, type: 'Explore', description: `tarea ${i}`, status: 'running' as const })
    on('agent.list', () => ({ value: [1, 2, 3, 4, 5, 6].map(info) }))
    const pane = await mount($)
    const texts = (await pane.findAll({ type: 'Text' })).map((t: { text: string }) => t.text)
    expect(texts.filter((t: string) => t.includes('Explore'))).toHaveLength(6)
  })

  test('generar, set tematico, set propio y editor', async ($, on) => {
    base($, on)
    on('agent.list', () => ({ value: [] }))
    const pane = await mount($)
    const run = (args: string) => $.command.run({ command: 'pets', args } as never)
    const text = async () => (await pane.findAll({ type: 'Text' })).map((t: { text: string }) => t.text).join('\n')

    const r = await run('generar hola')
    expect(r.text).toContain('Mascota generada desde "hola"')
    expect((await run('generar hola')).text).toBe(r.text)
    expect((await run('set robots')).text).toContain('robots')
    expect((await run('set guardar mios')).text).toContain('mios')
    expect((await run('generar set equipo 4')).text).toContain('4 mascotas')
    expect((await run('set')).text).toContain('equipo (4 propias)')
    await run('editar')
    expect(await text()).toContain('EDITOR DE MASCOTA')
    await run('editar')
    expect(await text()).not.toContain('EDITOR DE MASCOTA')
    expect((await run('set borrar equipo')).text).toContain('borrado')
  })
})

describe('avisos', () => {
  test('un agente que falla dispara toast y notify', async ($, on) => {
    mock.store(on, {})
    const sent: string[] = []
    on('ui.toast', () => ({ value: undefined }))
    on('ui.status', () => ({ value: undefined }))
    on('ui.notify', (_$, e) => { sent.push(e.text); return { value: { isSent: true, channel: 'terminal_bell' } } })
    on('agent.list', () => ({ value: [{ id: 'z1', type: 'Explore', description: 'busca algo', status: 'failed' as const }] }))
    on('turn.complete', () => ({ text: '' }))
    await $.turn.complete({ agentId: 'z1', reason: 'error', turnId: 't' } as never)
    expect(sent.join(' ')).toContain('busca algo')
  })
})

describe('hablar con subagentes por nombre', () => {
  test('decir, atajo /pets <nombre> y @nombre en el prompt entregan al agente correcto', async ($, on) => {
    mock.store(on, {})
    const sent: { to: unknown; text: string }[] = []
    on('session.send', (_$, e) => { sent.push({ to: e.to, text: e.text }); return { isDelivered: true } as never })
    const info = (id: string) => ({ id, type: 'Explore', description: `tarea ${id}`, status: 'running' as const })
    on('agent.list', () => ({ value: [info('a1'), info('a2')] }))
    on('prompt.submit', (_$, e) => ({ text: e.text }))
    const looks = uniqueLooks(['a1', 'a2'])
    const run = (args: string) => $.command.run({ command: 'pets', args } as never)

    expect((await run(`decir ${looks.a2!.name} para ya`)).text).toContain(looks.a2!.name)
    expect((await run(`${looks.a1!.name.toUpperCase()} sigue`)).text).toContain('Mensaje enviado')
    expect((await run('decir Nadie hola')).text).toContain('No hay una mascota llamada "Nadie"')
    const r = await $.prompt.submit({ text: `@${looks.a1!.name} revisa el log` } as never)
    expect('drop' in r && r.drop).toContain('Mensaje enviado')
    const r2 = await $.prompt.submit({ text: '@archivo.ts explicame' } as never)
    expect('text' in r2 && r2.text).toBe('@archivo.ts explicame')
    expect(sent.map(s => s.text)).toEqual(['para ya', 'sigue', 'revisa el log'])
    expect(sent[0]!.to).toBe('a2')
  })
})

describe('mascotas con IA', () => {
  test('parseLooks valida y normaliza lo que responde el modelo', () => {
    const out = parseLooks('Claro:\n[{"name":"Zorro Astro!!","pet":"fox","color":"naranja","accessory":"lentes","eyes":"^.^"},{"pet":"dragon","color":"xx","eyes":"muy largo"},5]')
    expect(out).toHaveLength(2)
    expect(out[0]).toEqual({ name: 'Zorro Astro', pet: 'fox', color: '#fb923c', accessory: 'lentes', eyes: '^.^', accent: undefined, isSure: true, question: '' })
    expect(out[1]!.pet).toBe('cat')
    expect(out[1]!.eyes).toBe('o.o')
    expect(parseLooks('no es json')).toEqual([])
    const eva = parseLooks('[{"name":"EVA01","pet":"robot","color":"#6b21a8","accent":"#84cc16","confianza":"baja","pregunta":"¿morado oscuro o claro?"}]')[0]!
    expect(eva.accent).toBe('#84cc16')
    expect(eva.isSure).toBe(false)
    expect(eva.question).toContain('morado')
    expect(pixelCells('think', 0, 'robot', '#6b21a8', 'ninguno', '#84cc16').cells).not.toBe(pixelCells('think', 0, 'robot', '#6b21a8').cells)
    expect(pixelCells('sleep', 0, 'cat', '#ff0000').cells).not.toBe(pixelCells('sleep', 0, 'cat', '#00ff00').cells)
  })

  test('/pets ia aplica la mascota que devuelve Haiku', async ($, on) => {
    mock.store(on, {})
    on('command.register', () => ({ value: { command: 'pets' } }))
    on('ui.open', () => ({ value: { isPlaced: true } }))
    on('agent.list', () => ({ value: [] }))
    let asked = ''
    on('model.complete', (_$, e) => {
      asked = String(e.model)
      return { value: { isAnswered: true, text: '[{"name":"Astra","pet":"robot","color":"#22d3ee","accessory":"corona","eyes":"@.@"}]', usage: {} } } as never
    })
    const pane = await $.ui.mount({ plugin: 'mascotas', surface: 'terminal', component: 'Pane', requestId: 'mascotas', props: {} as never, viewport: { columns: 170, rows: 40 } })
    const run = (args: string) => $.command.run({ command: 'pets', args } as never)
    expect((await run('ia rapido')).text).toContain('Describe la mascota')
    expect((await run('ia rapido un robot espacial')).text).toContain('Astra (robot, corona, #22d3ee')
    expect(asked).toBe('haiku')
    expect((await pane.findAll({ type: 'Text' })).map(t => t.text).join('\n')).toContain('ASTRA')
    expect((await run('ia set astros un equipo espacial')).text).toContain('Set "astros" creado')
  })
})

describe('listado de mascotas y forma propia', () => {
  const row = 'A'.repeat(32)
  const art = Array.from({ length: 32 }, (_, i) => (i === 0 ? '..A' + '.'.repeat(26) + 'A..' : i < 31 ? 'A'.repeat(32) : '.' + 'A'.repeat(30) + '.'))
  const eva = `[{"name":"EVA01","pet":"robot","color":"#6b21a8","accent":"#84cc16","confianza":"alta","palette":{"A":"#6b21a8","B":"#84cc16"},"art":${JSON.stringify(art)},"cara":{"izq":7,"der":21,"fila":14,"boca":13,"bocaFila":21}}]`

  test('parseLooks acepta una forma propia valida y descarta una invalida', () => {
    const ok = parseLooks(eva)[0]!
    expect(ok.custom?.palette.A).toBe('#6b21a8')
    expect(ok.custom?.art).toHaveLength(32)
    expect(parseLooks(eva.replace('"izq":7', '"izq":30'))[0]!.custom).toBeUndefined()
    expect(parseLooks(eva.replace(JSON.stringify(art), JSON.stringify(art.slice(0, 10))))[0]!.custom).toBeUndefined()   // muy corto: se descarta
    expect(parseLooks(eva.replace(art[3]!, row.slice(1)))[0]!.custom?.art[3]).toHaveLength(32)   // una fila corta se completa
    expect(row).toHaveLength(32)
    expect(pixelCells('think', 0, 'robot', '', 'ninguno', '', ok.custom).cells).not.toBe(pixelCells('think', 0, 'robot').cells)
  })

  test('lo generado se guarda solo y al cambiar de mascota la anterior se conserva', async ($, on) => {
    mock.store(on, {})
    on('command.register', () => ({ value: { command: 'pets' } }))
    on('ui.open', () => ({ value: { isPlaced: true } }))
    on('agent.list', () => ({ value: [] }))
    on('model.complete', () => ({ value: { isAnswered: true, text: eva, usage: {} } }) as never)
    const pane = await $.ui.mount({ plugin: 'mascotas', surface: 'terminal', component: 'Pane', requestId: 'mascotas', props: {} as never, viewport: { columns: 170, rows: 40 } })
    const run = (args: string) => $.command.run({ command: 'pets', args } as never)
    expect((await run('mis')).text).toContain('Aun no hay mascotas')
    expect((await run('ia rapido eva-01')).text).toContain('forma propia')
    expect((await run('mis')).text).toContain('EVA01: forma propia')
    await run('tipo ghost')                                   // cambia: EVA01 ya estaba guardada
    expect((await run('nombre Casper')).text).toContain('Casper')
    await run('generar semilla')                              // respalda a Casper antes de reemplazarla
    const lista = (await run('mis')).text
    expect(lista).toContain('EVA01')
    expect(lista).toContain('Casper')
    expect((await run('usar eva01')).text).toContain('EVA01')
    expect((await pane.findAll({ type: 'Text' })).map(t => t.text).join('\n')).toContain('EVA01')
    expect((await run('quitar Casper')).text).toContain('Quitada')
    expect((await run('mis')).text).not.toContain('Casper:')
  })
})

describe('referencias web', () => {
  test('/pets ia lanza la busqueda web con la especificacion y /pets web off vuelve a solo Haiku', async ($, on) => {
    mock.store(on, {})
    on('command.register', () => ({ value: { command: 'pets' } }))
    on('ui.open', () => ({ value: { isPlaced: true } }))
    on('ui.toast', () => ({ value: undefined }))
    on('agent.list', () => ({ value: [] }))
    let calls = 0
    on('model.complete', () => {
      calls++
      return { value: { isAnswered: true, usage: {}, text: '[{"name":"Rapida","pet":"robot","color":"#6b21a8","confianza":"alta"}]' } } as never
    })
    let spawned = ''
    on('agent.spawn', (_$, e) => { spawned = e.prompt; return { model: 'inherit' } as never })
    const run = (args: string) => $.command.run({ command: 'pets', args } as never)
    await run('ia EVA-01 de Evangelion')              // por defecto: investiga en la web y dibuja el modelo principal
    expect(spawned).toContain('EVA-01 de Evangelion')
    expect(spawned).toContain('"art"')                  // lleva la especificacion del dibujo de 32x32
    expect(calls).toBe(0)
    spawned = ''
    expect((await run('ia rapido un cohete')).text).toContain('Rapida')   // solo Haiku
    expect(spawned).toBe('')
    expect((await run('web')).text).toContain('desactivado')
    expect((await run('ia otra cosa')).text).toContain('Rapida')
    expect(spawned).toBe('')
  })
})

describe('imagen a mascota', () => {
  test('/pets img convierte la salida de python en una mascota sin cara marcada', async ($, on) => {
    mock.store(on, {})
    on('command.register', () => ({ value: { command: 'pets' } }))
    on('ui.open', () => ({ value: { isPlaced: true } }))
    on('agent.list', () => ({ value: [] }))
    const art = Array.from({ length: 32 }, (_, i) => (i > 3 && i < 28 ? '.'.repeat(8) + 'AB'.repeat(8) + '.'.repeat(8) : '.'.repeat(32)))
    on('process.run', () => ({ value: { exitCode: 0, stdout: JSON.stringify({ palette: { A: '#6b21a8', B: '#84cc16' }, art }), stderr: '' } }) as never)
    const run = (args: string) => $.command.run({ command: 'pets', args } as never)
    expect((await run('img')).text).toContain('Uso: /pets img')
    expect((await run('img /x/eva.png EVA')).text).toContain('Mascota creada desde la imagen: EVA (2 colores)')
    expect((await run('mis')).text).toContain('EVA: forma propia')
  })
})

describe('preferencias persistentes', () => {
  test('el pane usa la mascota guardada aunque la sesion se reinicie sin session.start (p. ej. al aceptar un plan)', async ($, on) => {
    mock.store(on, { 'mascotas.cfg': { name: 'Zeta', pet: 'owl', color: '#336699', style: 'pixel' } })
    on('agent.list', () => ({ value: [] }))
    const pane = await $.ui.mount({ plugin: 'mascotas', surface: 'terminal', component: 'Pane', requestId: 'mascotas', props: {} as never, viewport: { columns: 170, rows: 40 } })
    const text = (await pane.findAll({ type: 'Text' })).map(t => t.text).join('\n')
    expect(text).toContain('ZETA')
  })
})

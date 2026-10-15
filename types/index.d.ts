export type Act = { kind: string; target: string }
export type Live = {
  act?: Act
  tools: number
  errors: number
  last: number
  since: number
  by: Record<string, number>
}
// Foto ASCII a color: un caracter por celda (cols x rows) y su color (6 hex por celda).
export type AsciiPhoto = { cols: number; rows: number; chars: string; colors: string }
// Forma propia dibujada por la IA: 14 filas de 14 caracteres ('.' vacio, letras = claves de palette) y donde van los ojos y la boca.
export type Face = { l: number; r: number; y: number; mx: number; my: number }
export type CustomArt = { art: string[]; palette: Record<string, string>; face?: Face }
export type SavedLook = { pet: string; accessory: string; color: string; name: string; eyes: string; accent?: string; custom?: CustomArt; photo?: AsciiPhoto }
export type Pool = { pets: string[]; colors: string[]; names: string[]; accessories: string[] }
// Un set fija las mascotas de los subagentes: un pool (se generan a partir de el) y/o mascotas fijas.
export type SetDef = { pool?: Pool; looks?: SavedLook[] }
export type Cfg = {
  on: boolean
  pet: 'cat' | 'owl' | 'robot' | 'fox' | 'dog' | 'bunny' | 'ghost' | 'dragon' | 'monster'
  name: string
  color: string
  accent: string
  custom: CustomArt | null
  photo: AsciiPhoto | null
  asciiCols: number
  accessory: 'ninguno' | 'sombrero' | 'corona' | 'lentes' | 'corbata'
  eyes: string
  style: 'ascii' | 'pixel'
  set: string
  narrow: boolean
  web: boolean
  calm: boolean
  history: boolean
  notify: boolean
}
export type Model = {
  main: Live & { st: 'idle' | 'running' | 'failed' }
  agents: Record<string, Live>
  tick: number
  timeline: string[]
  summary: string
  cfg: Cfg
  custom: Record<string, SetDef>
  edit: boolean
}

declare module 'claude-code' {
  interface PluginState {
    mascotas: { s: Model }
  }
}

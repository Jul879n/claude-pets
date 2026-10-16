export type Act = { kind: string; target: string }
export type Live = {
  act?: Act
  tools: number
  errors: number
  last: number
  since: number
  by: Record<string, number>
}
// Diseno vectorial hecho por la IA sobre un lienzo de 16x16 (x a la derecha, y hacia abajo): formas con color, `m` las refleja; `face` dice donde van ojos (2x3) y boca (2x1).
export type DesignPart = { s: 'ellipse' | 'rect' | 'tri' | 'poly'; c: string; m?: boolean; cx?: number; cy?: number; rx?: number; ry?: number; x?: number; y?: number; w?: number; h?: number; p?: number[][] }
export type Design = { parts: DesignPart[]; face: Face; frames?: number[][][] }
// Animacion de arte ASCII dibujada por la IA: cuadros de cols x rows caracteres (cada cuadro, sus filas unidas), color por caracter y uno base.
export type AsciiAnim = { cols: number; rows: number; frames: string[]; colors: Record<string, string>; base: string }
// Foto ASCII a color: un caracter por celda (cols x rows) y su color (6 hex por celda).
export type AsciiPhoto = { cols: number; rows: number; chars: string; colors: string; bg?: string }
// Forma propia dibujada por la IA: 14 filas de 14 caracteres ('.' vacio, letras = claves de palette) y donde van los ojos y la boca.
export type Face = { l: number; r: number; y: number; mx: number; my: number }
export type CustomArt = { art: string[]; palette: Record<string, string>; face?: Face }
export type SavedLook = { pet: string; accessory: string; color: string; name: string; eyes: string; accent?: string; custom?: CustomArt; photo?: AsciiPhoto; design?: Design; anim?: AsciiAnim }
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
  design: Design | null
  anim: AsciiAnim | null
  asciiCols: number
  src: string
  render: 'auto' | 'medios' | 'celdas'
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
  gallery: boolean
}

declare module 'claude-code' {
  interface PluginState {
    mascotas: { s: Model }
  }
}

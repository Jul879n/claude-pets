// Animales completos como modelos 3D procedurales: piezas elipsoidales articuladas (cuerpo, cabeza, orejas, patas, cola, ojos) que se
// proyectan por trazado de rayos analitico y se dibujan en ASCII con color e iluminacion. Cada accion tiene su propio guion de articulaciones.
import { RAMP, readable } from './sprites'
import type { Mood } from './sprites'
import type { Model3D, Part3D } from '../types'

type V3 = [number, number, number]
type M3 = number[]   // 3x3 por filas
type Node = { R: M3; t: V3 }
type Prim = { c: V3; R: M3; r: V3; color: number | ((p: V3) => number); solid?: boolean; glyph?: string; noGround?: boolean }
type Cells = { columns: number; rows: number; cells: string }

const TAU = Math.PI * 2
const mul = (a: M3, b: M3): M3 => [
  a[0]! * b[0]! + a[1]! * b[3]! + a[2]! * b[6]!, a[0]! * b[1]! + a[1]! * b[4]! + a[2]! * b[7]!, a[0]! * b[2]! + a[1]! * b[5]! + a[2]! * b[8]!,
  a[3]! * b[0]! + a[4]! * b[3]! + a[5]! * b[6]!, a[3]! * b[1]! + a[4]! * b[4]! + a[5]! * b[7]!, a[3]! * b[2]! + a[4]! * b[5]! + a[5]! * b[8]!,
  a[6]! * b[0]! + a[7]! * b[3]! + a[8]! * b[6]!, a[6]! * b[1]! + a[7]! * b[4]! + a[8]! * b[7]!, a[6]! * b[2]! + a[7]! * b[5]! + a[8]! * b[8]!,
]
const apply = (m: M3, v: V3): V3 => [m[0]! * v[0] + m[1]! * v[1] + m[2]! * v[2], m[3]! * v[0] + m[4]! * v[1] + m[5]! * v[2], m[6]! * v[0] + m[7]! * v[1] + m[8]! * v[2]]
const Rx = (a: number): M3 => { const c = Math.cos(a), s = Math.sin(a); return [1, 0, 0, 0, c, -s, 0, s, c] }
const Ry = (a: number): M3 => { const c = Math.cos(a), s = Math.sin(a); return [c, 0, s, 0, 1, 0, -s, 0, c] }
const Rz = (a: number): M3 => { const c = Math.cos(a), s = Math.sin(a); return [c, -s, 0, s, c, 0, 0, 0, 1] }
const I3: M3 = [1, 0, 0, 0, 1, 0, 0, 0, 1]
const child = (p: Node, off: V3, R: M3 = I3): Node => { const o = apply(p.R, off); return { R: mul(p.R, R), t: [p.t[0] + o[0], p.t[1] + o[1], p.t[2] + o[2]] } }
const at = (n: Node, off: V3): V3 => { const o = apply(n.R, off); return [n.t[0] + o[0], n.t[1] + o[1], n.t[2] + o[2]] }
const shade = (c: number, k: number) => (Math.min(255, ((c >> 16) & 255) * k) << 16) | (Math.min(255, ((c >> 8) & 255) * k) << 8) | Math.min(255, (c & 255) * k) | 0

type Pose = {
  yaw: number; bob: number; crouch: number; stretch: number; breathe: number; shake: number
  headYaw: number; headPitch: number; headRoll: number; earL: number; earR: number
  tailYaw: number; tailAmp: number; tailSpeed: number; tailPitch: number; puff: number
  legs: [number, number, number, number]; lift: [number, number, number, number]; pitch: number; ground: number; roll: number; twist: number
  blink: number; lookX: number; lookY: number; mouth: number; wide: number
}

// Banco de animaciones del gato. Cada clip devuelve la pose para el tiempo local t (ticks a 8 por segundo). Angulos en radianes; las patas "adelante"
// son positivas. Las acciones de la sesion (pensar, leer, correr...) y el reposo (que encadena varias conductas) escogen entre estos clips.
const TWO = Math.PI * 2
const smooth01 = (u: number) => { const x = Math.max(0, Math.min(1, u)); return x * x * (3 - 2 * x) }
const pulse = (t: number, a: number, b: number, soft = 4) => smooth01((t - a) / soft) * (1 - smooth01((t - b) / soft))   // 0..1 entre a y b con bordes suaves
type Clip = { len: number; pose: (t: number, T: number) => Partial<Pose> }
const S = (p: number, t: number, ph = 0) => Math.sin((TWO * t) / p + ph)

const SIT = { pitch: 0.55, legs: [-0.55, -0.55, 1.2, 1.2] as Pose['legs'], lift: [0, 0, 1.7, 1.7] as Pose['lift'], yaw: 0.55 }
const LIE = { pitch: 0, legs: [1.35, 1.35, 1.3, 1.3] as Pose['legs'], lift: [1.5, 1.5, 1.9, 1.9] as Pose['lift'], headPitch: 0.7, yaw: 0.35, crouch: 0.4 }
// Marcha de cuadrupedo con fases de apoyo y de vuelo: en el apoyo la pata va hacia atras en linea recta y empuja; en el vuelo se levanta y se adelanta con
// arco. `offs` da el desfase de cada pata [del. izq, del. der, tras. izq, tras. der] (paso lateral 0.25/0.75/0/0.5; galope casi en pares).
const GAIT_WALK = [0.25, 0.75, 0, 0.5], GAIT_BOUND = [0.0, 0.08, 0.5, 0.58]
const gait = (t: number, per: number, amp: number, lift: number, duty = 0.62, offs = GAIT_WALK) => {
  const legs: number[] = [], lifts: number[] = []
  for (const o of offs) {
    const u = (((t / per + o) % 1) + 1) % 1
    if (u < duty) { legs.push(amp * (1 - (2 * u) / duty)); lifts.push(0) }
    else { const s = smooth01((u - duty) / (1 - duty)); legs.push(-amp + 2 * amp * s); lifts.push(lift * Math.sin(Math.PI * (u - duty) / (1 - duty))) }
  }
  return { legs: legs as Pose['legs'], lift: lifts as Pose['lift'] }
}
// Cuerpo de la marcha: sube y baja dos veces por zancada, cabecea hacia delante, se balancea de lado a lado y el torso se retuerce un poco.
const walkBody = (t: number, per: number, k: number) => ({
  bob: 0.75 * k * (0.5 - 0.5 * Math.cos((TWO * 2 * t) / per)), roll: 0.06 * k * S(per, t, 0.4), twist: 0.07 * k * S(per, t), pitch: 0.035 * k * S(per / 2, t, 0.8),
  headPitch: -0.04 + 0.07 * k * S(per / 2, t, 2.2), headYaw: -0.05 * k * S(per, t, 0.4), earL: 0.12 * S(per / 2, t, 1), earR: 0.12 * S(per / 2, t, 1.6),
  tailAmp: 0.28, tailSpeed: per * 1.4, tailPitch: 0.55,
})
const walkLegs = (t: number, per: number, amp: number, lift: number) => gait(t, per, amp, lift)

const CLIPS: Record<string, Clip> = {
  sit: { len: 56, pose: (t) => ({ ...SIT, tailAmp: 0.6, tailSpeed: 44, tailPitch: 0.2, headYaw: 0.25 * S(70, t), headRoll: 0.1 * S(50, t, 1) }) },
  lookAround: { len: 64, pose: (t) => ({ ...SIT, headYaw: 0.9 * S(64, t), lookX: S(64, t, 0.6), headPitch: -0.05, earL: 0.3 * S(64, t, 1.5), earR: -0.3 * S(64, t, 1.5), tailAmp: 0.3 }) },
  groom: { len: 72, pose: (t) => ({ ...SIT, legs: [-0.55, 1.5 * pulse(t, 6, 66) - 0.55 * (1 - pulse(t, 6, 66)), 1.2, 1.2], lift: [0, 1.4 * pulse(t, 6, 66), 1.7, 1.7],
    headPitch: 0.55 * pulse(t, 6, 66) + 0.1 * Math.sin(t * 1.5) * pulse(t, 10, 62), headYaw: 0.5 * pulse(t, 6, 66), blink: 0.9 * pulse(t, 8, 64), mouth: 0.22 * Math.max(0, Math.sin(t * 1.5)) * pulse(t, 12, 60), tailAmp: 0.2 }) },
  scratch: { len: 48, pose: (t) => ({ ...SIT, legs: [-0.55, -0.55, 1.2, 1.9 * pulse(t, 4, 44) + 1.2 * (1 - pulse(t, 4, 44)) + 0.25 * Math.sin(t * 2.4) * pulse(t, 8, 40)], lift: [0, 0, 1.7, 1.2],
    headRoll: -0.45 * pulse(t, 4, 44), headPitch: 0.1, blink: 0.8 * pulse(t, 6, 42), earR: 0.4 * Math.sin(t * 2.4) * pulse(t, 8, 40) }) },
  yawn: { len: 44, pose: (t) => ({ ...SIT, mouth: pulse(t, 8, 30, 8), headPitch: -0.5 * pulse(t, 8, 32, 8), blink: pulse(t, 10, 30, 6), stretch: 1 + 0.04 * pulse(t, 8, 30, 8), earL: -0.3 * pulse(t, 8, 30), earR: -0.3 * pulse(t, 8, 30) }) },
  stretch: { len: 64, pose: (t) => { const u = pulse(t, 8, 52, 10); return { pitch: -0.45 * u, legs: [1.15 * u, 1.15 * u, 0, 0], lift: [0.2 * u, 0.2 * u, 0, 0], headPitch: 0.5 * u, stretch: 1 + 0.1 * u, blink: 0.9 * u, tailPitch: 1.4, tailAmp: 0.3, mouth: 0.3 * u, yaw: 0.55 + 0.25 * u } } },
  walk: { len: 112, pose: (t) => ({ ...gait(t, 22, 0.5, 0.95), ...walkBody(t, 22, 1), yaw: Math.PI / 2 + 0.1 * S(112, t), ground: 1.0, lookX: 0.3 * S(112, t) }) },
  sniff: { len: 48, pose: (t) => ({ ...gait(t, 38, 0.12, 0.3), ...walkBody(t, 38, 0.3), yaw: Math.PI / 2, headPitch: 0.55 + 0.1 * Math.sin(t * 1.3), lookY: 0.7, pitch: -0.1, ground: 0.18, mouth: 0.1 * Math.max(0, Math.sin(t * 1.3)) }) },
  lie: { len: 80, pose: (t) => ({ ...LIE, breathe: 0.05 * S(40, t), tailYaw: 0.7, tailAmp: 0.1, tailPitch: 0.1, blink: 0.4 + 0.5 * pulse(t, 20, 70, 12), earR: 0.3 * Math.max(0, S(60, t)) }) },
}
// Reposo: encadena conductas (cada una un clip). Cuando la sesion no hace nada la mascota vive su vida en vez de repetirse.
const IDLE = ['sit', 'groom', 'lookAround', 'yawn', 'stretch', 'walk', 'sniff', 'sit', 'scratch', 'walk', 'lookAround', 'lie']
const IDLE_LEN = IDLE.reduce((a, k) => a + CLIPS[k]!.len, 0)

function idleClip(T: number): { key: string; t: number } {
  let u = ((T % IDLE_LEN) + IDLE_LEN) % IDLE_LEN
  for (let i = 0; i < IDLE.length; i++) { const L = CLIPS[IDLE[i]!]!.len; if (u < L) return { key: `${i}:${IDLE[i]}`, t: u }; u -= L }
  return { key: '0:sit', t: 0 }
}


// ---------------------------------------------------------------------------------------------------------------------------------------------
// Animaciones por tipo de cuerpo. 'quad' = cuadrupedo (clips de arriba); 'biped' = humanoide (de pie, brazos que se balancean, codos y rodillas);
// 'float' = flotante (fantasma, espiritus: sin patas, ondula y mueve los brazos). En los bipedos legs[0],[1] son los brazos y legs[2],[3] las piernas;
// lift[0],[1] doblan los codos y lift[2],[3] las rodillas.
// ---------------------------------------------------------------------------------------------------------------------------------------------
export type Kind = 'quad' | 'biped' | 'float'
const basePose = (T: number): Pose => ({
  yaw: 0.55, bob: 0, crouch: 0, stretch: 1, breathe: 0.02 * S(30, T), shake: 0, headYaw: 0, headPitch: 0, headRoll: 0, earL: 0, earR: 0,
  tailYaw: 0, tailAmp: 0.35, tailSpeed: 40, tailPitch: 0.9, puff: 1, legs: [0, 0, 0, 0], lift: [0, 0, 0, 0], pitch: 0, ground: 0, roll: 0, twist: 0,
  blink: (() => { const u = T % 34; return u < 3 ? Math.sin((Math.PI * u) / 3) : 0 })(), lookX: 0, lookY: 0, mouth: 0, wide: 1,
})
const arms = (l: number, r: number, el = 0, er = 0): Pick<Pose, 'legs' | 'lift'> => ({ legs: [l, r, 0, 0], lift: [el, er, 0, 0] })
const limbs = (a: Pose['legs'], l: Pose['lift']) => ({ legs: a, lift: l })
// Marcha humana: cada brazo va opuesto a su pierna; la rodilla se dobla al adelantar la pierna y el codo acompana.
const humanGait = (t: number, per: number, leg: number, arm: number, knee: number, elbow: number, duty = 0.55) => {
  const g = gait(t, per, 1, 1, duty, [0.5, 0, 0, 0.5])
  return limbs([g.legs[0]! * arm, g.legs[1]! * arm, g.legs[2]! * leg, g.legs[3]! * leg], [g.lift[0]! * elbow + 0.15, g.lift[1]! * elbow + 0.15, g.lift[2]! * knee, g.lift[3]! * knee])
}
const humanBody = (t: number, per: number, k: number) => ({
  bob: 0.7 * k * (0.5 - 0.5 * Math.cos((TWO * 2 * t) / per)), roll: 0.045 * k * S(per, t, 0.4), twist: 0.09 * k * S(per, t), pitch: -0.03 * k,
  headYaw: -0.07 * k * S(per, t), headPitch: 0.03 + 0.03 * k * S(per / 2, t, 1.5),
})
const SITH = { legs: [0.35, 0.35, 1.5, 1.5] as Pose['legs'], lift: [0.4, 0.4, 0.25, 0.25] as Pose['lift'], pitch: 0.04, yaw: 0.55 }

const HCLIPS: Record<string, Clip> = {
  stand: { len: 56, pose: (t) => ({ yaw: 0.55 + 0.12 * S(56, t), roll: 0.03 * S(56, t), ...arms(0.06 * S(28, t), -0.06 * S(28, t), 0.15, 0.15), headYaw: 0.15 * S(70, t), headPitch: 0.04 * S(40, t, 1) }) },
  lookAround: { len: 64, pose: (t) => ({ yaw: 0.55, twist: 0.2 * S(64, t), headYaw: 0.95 * S(64, t), lookX: S(64, t, 0.6), headPitch: -0.04, ...arms(0.05, 0.05, 0.15, 0.15) }) },
  wave: { len: 48, pose: (t) => { const u = pulse(t, 5, 43, 5); return { yaw: 0.35, ...arms(0.05, 2.5 * u, 0.12, 0.9 * u + 0.55 * Math.sin(t * 1.5) * u), headRoll: 0.12 * u, mouth: 0.25 * u, headYaw: -0.25 * u } } },
  stretch: { len: 60, pose: (t) => { const u = pulse(t, 8, 50, 10); return { pitch: -0.14 * u, ...arms(3.0 * u, 3.0 * u, 0.1, 0.1), headPitch: -0.45 * u, blink: 0.9 * u, mouth: 0.8 * pulse(t, 18, 40, 6), yaw: 0.55 + 0.1 * u } } },
  scratch: { len: 44, pose: (t) => { const u = pulse(t, 5, 40, 5); return { ...arms(0.05, 2.6 * u, 0.1, 1.9 * u), headRoll: -0.2 * u, headYaw: 0.2 * u, lookX: -0.4 * u, ...(u > 0.5 ? { headPitch: 0.1 * Math.sin(t * 2.4) } : {}) } } },
  sit: { len: 60, pose: (t) => ({ ...SITH, headYaw: 0.25 * S(70, t), headPitch: 0.05 * S(40, t, 1) }) },
  walk: { len: 112, pose: (t) => ({ ...humanGait(t, 24, 0.62, 0.5, 1.0, 0.7), ...humanBody(t, 24, 1), yaw: Math.PI / 2 + 0.1 * S(112, t), ground: 1.0, lookX: 0.2 * S(112, t) }) },
  turn: { len: 56, pose: (t) => ({ yaw: 0.55 + TWO * smooth01(t / 52), ...humanGait(t, 28, 0.2, 0.15, 0.3, 0.2), headYaw: 0.2 * S(56, t) }) },
}
const HIDLE = ['stand', 'lookAround', 'scratch', 'wave', 'stand', 'walk', 'stretch', 'sit', 'lookAround', 'walk', 'turn', 'sit']
const HIDLE_LEN = HIDLE.reduce((a, k) => a + HCLIPS[k]!.len, 0)
function humanIdle(T: number): { key: string; t: number } {
  let u = ((T % HIDLE_LEN) + HIDLE_LEN) % HIDLE_LEN
  for (let i = 0; i < HIDLE.length; i++) { const L = HCLIPS[HIDLE[i]!]!.len; if (u < L) return { key: `${i}:${HIDLE[i]}`, t: u }; u -= L }
  return { key: '0:stand', t: 0 }
}

function humanPose(mood: Mood, T: number): { pose: Pose; key: string } {
  const sn = (p: number, ph = 0) => S(p, T, ph)
  const spin = (p: number, share: number) => { const u = (T % p) / p; return u < share ? TWO * smooth01(u / share) : 0 }
  const base = basePose(T)
  let key: string = mood
  let delta: Partial<Pose>
  switch (mood) {
    case 'think': delta = { yaw: 0.45 + 0.25 * sn(90), ...arms(0.1, 1.5, 0.15, 1.95 + 0.05 * sn(30)), headPitch: 0.25 + 0.05 * sn(40), headRoll: 0.18 * sn(60), headYaw: 0.2 * sn(70, 1), lookY: -0.5, roll: 0.03 * sn(50) }; break
    case 'read': delta = { yaw: 0.5, ...arms(1.1 + 0.03 * sn(20), 1.1 + 0.03 * sn(20, 1), 1.3, 1.3), headPitch: 0.35, headYaw: 0.1 * sn(36), lookX: 0.9 * sn(18), lookY: 0.55 }; break
    case 'write': delta = { yaw: 0.5, ...arms(1.15 + 0.12 * Math.max(0, sn(8)), 1.15 + 0.12 * Math.max(0, -sn(8)), 1.1 + 0.25 * Math.max(0, sn(8)), 1.1 + 0.25 * Math.max(0, -sn(8))), headPitch: 0.3 + 0.04 * sn(6), lookY: 0.6, twist: 0.04 * sn(16) }; break
    case 'run': delta = { ...humanGait(T, 14, 1.0, 1.15, 1.6, 1.5, 0.4), ...humanBody(T, 14, 2.4), yaw: Math.PI / 2 + 0.15 * sn(60), pitch: -0.2, bob: 1.9 * Math.abs(sn(14)), ground: 3.4, mouth: 0.2, wide: 1.1 }; break
    case 'wait': { const c = humanIdle(T); key = `wait:${c.key}`; delta = HCLIPS[c.key.split(':')[1]!]!.pose(c.t, T); break }
    case 'error': delta = { yaw: 0.55 + 0.25 * sn(6), shake: 0.7 * sn(3), ...arms(2.9, 2.9, 1.9, 1.9), pitch: 0.1, headPitch: 0.35, mouth: 0.9, wide: 1.35, blink: 0, legs: [2.9, 2.9, 0.1 * sn(3), -0.1 * sn(3)] }; break
    case 'sleep': delta = { ...SITH, yaw: 0.45, headPitch: 0.75 + 0.03 * sn(48), headRoll: 0.2, blink: 1, breathe: 0.05 * sn(48), pitch: 0.12 }; break
    default: delta = { yaw: 0.55 + spin(48, 0.55), bob: 6 * Math.abs(sn(20)), crouch: 0.4 * (1 - Math.abs(sn(20))), ...arms(2.8 + 0.2 * sn(5), 2.8 + 0.2 * sn(5, 1), 0.3, 0.3), headPitch: -0.2, blink: 0.75, mouth: 0.7 * Math.abs(sn(10)), legs: [2.8 + 0.2 * sn(5), 2.8 + 0.2 * sn(5, 1), 0.5 * Math.abs(sn(20)), -0.5 * Math.abs(sn(20))], lift: [0.3, 0.3, 0.7 * Math.abs(sn(20)), 0.7 * Math.abs(sn(20))] }
  }
  const out = { ...base, ...delta } as Pose
  out.yaw += 0.03 * sn(11); out.headYaw += 0.04 * sn(7, 1); out.headPitch += 0.02 * sn(13, 2)
  return { pose: out, key }
}

function floatPose(mood: Mood, T: number): { pose: Pose; key: string } {
  const sn = (p: number, ph = 0) => S(p, T, ph)
  const spin = (p: number, share: number) => { const u = (T % p) / p; return u < share ? TWO * smooth01(u / share) : 0 }
  const base = basePose(T)
  const sway = { roll: 0.08 * sn(46), yaw: 0.55 + 0.35 * sn(120), bob: 1.2 * (0.5 + 0.5 * sn(34)), legs: [0.5 + 0.35 * sn(30), 0.5 + 0.35 * sn(30, 1.6), 0, 0] as Pose['legs'] }
  const P: Partial<Record<Mood, Partial<Pose>>> = {
    think: { ...sway, headRoll: 0.3 * sn(60), headPitch: -0.2, legs: [0.3, 1.5, 0, 0], lookY: -0.5 },
    read: { ...sway, headPitch: 0.3, lookX: 0.9 * sn(18), legs: [1, 1, 0, 0] },
    write: { ...sway, headPitch: 0.3, legs: [1 + 0.4 * Math.max(0, sn(8)), 1 + 0.4 * Math.max(0, -sn(8)), 0, 0], tailAmp: 0.6 },
    run: { yaw: Math.PI / 2 + 0.2 * sn(40), roll: 0.18, pitch: -0.25, bob: 3 + 1.5 * sn(12), legs: [-0.9, -0.9, 0, 0], ground: 3.4, mouth: 0.3 },
    wait: { ...sway, headYaw: 0.5 * sn(80) * pulse(T % 160, 20, 120, 20), headRoll: 0.1 * sn(70) },
    error: { yaw: 0.55 + 0.3 * sn(6), shake: 0.8 * sn(3), puff: 1.3, legs: [2.5, 2.5, 0, 0], mouth: 0.9, wide: 1.35, blink: 0 },
    sleep: { yaw: 0.45, roll: 0.05 * sn(70), bob: -3 + 0.8 * sn(60), headPitch: 0.5, legs: [0.2, 0.2, 0, 0], blink: 1, breathe: 0.05 * sn(48) },
    happy: { yaw: 0.55 + spin(48, 0.55), bob: 6 * Math.abs(sn(20)), legs: [2.6, 2.6, 0, 0], blink: 0.75, mouth: 0.7 * Math.abs(sn(10)), roll: 0.12 * sn(14) },
  }
  const out = { ...base, ...(P[mood] ?? sway) } as Pose
  out.headYaw += 0.04 * sn(7, 1)
  return { pose: out, key: mood }
}

function catPose(mood: Mood, T: number, kind: Kind = 'quad'): { pose: Pose; key: string } {
  if (kind === 'biped') return humanPose(mood, T)
  if (kind === 'float') return floatPose(mood, T)
  const blinkAt = (p: number, d: number) => { const u = T % p; return u < d ? Math.sin((Math.PI * u) / d) : 0 }
  const spin = (p: number, share: number) => { const u = (T % p) / p; return u < share ? TWO * smooth01(u / share) : 0 }
  const sn = (p: number, ph = 0) => S(p, T, ph)
  const base: Pose = {
    yaw: 0.55, bob: 0, crouch: 0, stretch: 1, breathe: 0.02 * sn(30), shake: 0, headYaw: 0, headPitch: 0, headRoll: 0, earL: 0, earR: 0,
    tailYaw: 0, tailAmp: 0.35, tailSpeed: 40, tailPitch: 0.9, puff: 1, legs: [0, 0, 0, 0], lift: [0, 0, 0, 0], pitch: 0, ground: 0, roll: 0, twist: 0,
    blink: blinkAt(34, 3), lookX: 0, lookY: 0, mouth: 0, wide: 1,
  }
  let key: string = mood
  let delta: Partial<Pose>
  switch (mood) {
    case 'think': delta = { ...SIT, yaw: 0.55 + 0.45 * sn(80), headPitch: -0.3 + 0.1 * sn(40), headRoll: 0.25 * sn(60), headYaw: 0.3 * sn(70, 1), earL: 0.5 * pulse(T % 70, 10, 30), lookY: -0.5,
      legs: [-0.55, -0.55 + 1.7 * pulse(T % 90, 15, 60, 8), 1.2, 1.2], lift: [0, 1.2 * pulse(T % 90, 15, 60, 8), 1.7, 1.7], tailAmp: 0.5, tailSpeed: 50 }; break
    case 'read': delta = { ...SIT, yaw: 0.55 + 0.3 * sn(70), headPitch: 0.3, headYaw: 0.5 * sn(36), lookX: 0.9 * sn(18), lookY: 0.5, tailAmp: 0.3, tailSpeed: 60 }; break
    case 'write': delta = { ...SIT, headPitch: 0.35 + 0.05 * sn(6), lookY: 0.6, legs: [-0.55 + 0.9 * Math.max(0, sn(8)), -0.55 + 0.9 * Math.max(0, -sn(8)), 1.2, 1.2], lift: [0.4 * Math.max(0, sn(8)), 0.4 * Math.max(0, -sn(8)), 1.7, 1.7], tailAmp: 0.6, tailSpeed: 24, earL: 0.15, earR: 0.15 }; break
    case 'run': delta = { ...gait(T, 13, 0.95, 1.3, 0.45, GAIT_BOUND), ...walkBody(T, 13, 2.2), yaw: Math.PI / 2 + 0.18 * sn(60), bob: 1.9 * Math.abs(sn(13)), stretch: 1.05 + 0.06 * sn(13), earL: -0.6 + 0.2 * sn(6), earR: -0.6 + 0.2 * sn(6), tailAmp: 0.3, tailSpeed: 13, tailPitch: -0.3, mouth: 0.25, wide: 1.1, ground: 3.4 }; break
    case 'wait': { const c = idleClip(T); key = `wait:${c.key}`; delta = CLIPS[c.key.split(':')[1]!]!.pose(c.t, T); break }
    case 'error': delta = { yaw: 0.55 + 0.3 * sn(6), stretch: 0.88, pitch: 0.12, shake: 0.7 * sn(3), puff: 1.7, tailPitch: -1.15, tailAmp: 0.15, tailSpeed: 5, earL: -1, earR: -1, mouth: 0.9, wide: 1.35, legs: [0.15, 0.15, -0.15, -0.15], headPitch: -0.1, blink: 0 }; break
    case 'sleep': delta = { ...CLIPS.lie!.pose(T % 80, T), breathe: 0.06 * sn(48), blink: 1, earL: -0.2, earR: -0.2 }; break
    default: delta = { yaw: 0.55 + spin(48, 0.55), bob: 6 * Math.abs(sn(20)), crouch: 0.5 * (1 - Math.abs(sn(20))), earL: 0.3 + 0.3 * sn(9), earR: 0.3 + 0.3 * sn(9, 1), headPitch: -0.15, blink: 0.75, mouth: 0.7 * Math.abs(sn(10)),
      legs: [0.7 * Math.abs(sn(20)), 0.7 * Math.abs(sn(20)), -0.7 * Math.abs(sn(20)), -0.7 * Math.abs(sn(20))], tailAmp: 0.7, tailSpeed: 8, tailPitch: -0.8 }
  }
  const out = { ...base, ...delta } as Pose
  // micromovimiento siempre presente (periodos inconmensurables, nunca se repite igual)
  const twitch = (T % 53) < 4 ? Math.sin((Math.PI * (T % 53)) / 4) : 0
  out.yaw += 0.04 * sn(11); out.headYaw += 0.05 * sn(7, 1); out.headPitch += 0.03 * sn(13, 2); out.earR += 0.35 * twitch * (mood === 'sleep' ? 0.3 : 1); out.tailYaw += 0.06 * sn(17)
  return { pose: out, key }
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const lerpPose = (a: Pose, b: Pose, t: number): Pose => {
  const o = { ...b } as Record<string, unknown>
  for (const k of Object.keys(b) as (keyof Pose)[]) if (typeof b[k] === 'number') o[k] = lerp(a[k] as number, b[k] as number, t)
  const dy = ((b.yaw - a.yaw + Math.PI) % TAU + TAU) % TAU - Math.PI   // el giro toma el camino corto
  o.yaw = a.yaw + dy * t
  o.legs = b.legs.map((v, i) => lerp(a.legs[i]!, v, t))
  o.lift = b.lift.map((v, i) => lerp(a.lift[i]!, v, t))
  return o as unknown as Pose
}
// Mezcla suave al cambiar de accion (no salta de una pose a otra) y seguimiento retrasado de cabeza, orejas y cola.
const slots = new Map<string, { mood: string; pose: Pose; from: Pose; since: number }>()
function smoothPose(slot: string, mood: Mood, tick: number, kind: Kind): Pose {
  const now = catPose(mood, tick, kind)
  // Seguimiento retrasado de cabeza, orejas y cola; solo dentro del mismo clip (al cambiar de clip el tiempo previo era de otro movimiento).
  const lag = (d: number) => { const c = catPose(mood, tick - d, kind); return c.key === now.key ? c.pose : now.pose }
  const h = lag(1.6), e = lag(2.6), tl = lag(3.2)
  const target: Pose = { ...now.pose, headYaw: h.headYaw, headPitch: h.headPitch, headRoll: h.headRoll, earL: e.earL, earR: e.earR, tailYaw: tl.tailYaw, tailPitch: tl.tailPitch }
  let st = slots.get(slot)
  if (!st) { st = { mood: now.key, pose: target, from: target, since: -99 }; slots.set(slot, st) }
  if (st.mood !== now.key) { st.from = st.pose; st.mood = now.key; st.since = tick }
  const u = Math.max(0, Math.min(1, (tick - st.since) / 8))
  st.pose = lerpPose(st.from, target, u * u * (3 - 2 * u))
  return st.pose
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// Especies. Cada una arma sus piezas a partir de la pose comun: cuadrupedos (gato, perro, zorro, conejo, dragon) con una sola receta
// parametrizada; ave (buho), bipedos (robot, monstruo) y fantasma tienen la suya. Las patas [0..3] son [del. izq, del. der, tras. izq, tras. der];
// en los bipedos [0],[1] son los brazos y [2],[3] las piernas.
// ---------------------------------------------------------------------------------------------------------------------------------------------
type Mesh = { x: Float32Array; y: Float32Array; z: Float32Array; tri: Uint16Array; g: Uint8Array; color: number }
type Built = { prims: Prim[]; head: V3; floats?: boolean; mesh?: Mesh }
type QuadSpec = {
  torso: V3; chest: V3; chestAt: V3; torsoCol: (q: V3) => number; chestCol: (q: V3) => number
  neckAt: V3; head: V3; headAt: V3; headCol: (q: V3) => number
  snout: V3; snoutAt: V3; snoutCol: number; noseR: V3; noseAt: V3; noseCol: number
  eyeX: number; eyeY: number; eyeZ: number; eyeR: V3; iris: number
  ear: { r: V3; at: V3; kind: 'point' | 'floppy' | 'long'; col: (q: V3) => number } | null
  tail: { n: number; r: number; seg: number; at: V3; col: (i: number) => number; pitch: number } | null
  leg: { up: [number, number]; low: [number, number]; r: [number, number]; hip: V3[]; col: (q: V3) => number; lowCol: (q: V3) => number; paw: V3; pawCol: number }
  hop?: boolean; wings?: { col: number; bone: number; span: number }; horns?: number; spikes?: number; whiskers?: boolean; tuft?: boolean
}

const ORANGE = 0xe8923a, STRIPE = 0xa8561a, CREAM = 0xf6e3c0, PINK = 0xf4a6b8
const tabby = (base: number, stripe: number, belly: number) => (q: V3) => (q[1] < -3.6 ? belly : Math.sin(q[2] * 0.55 + q[1] * 0.12) > 0.55 && q[1] > -3 ? stripe : base)

const QUADS: Record<string, QuadSpec> = {
  cat: {
    torso: [9, 7.2, 15], chest: [8.2, 6.4, 7], chestAt: [0, 1, 9], torsoCol: tabby(ORANGE, STRIPE, CREAM), chestCol: (q) => (q[1] < -3.2 ? CREAM : Math.sin(q[1] * 0.9 + 1) > 0.7 ? STRIPE : ORANGE),
    neckAt: [0, 5.8, 12.5], head: [8, 7, 7], headAt: [0, 0.5, 2], headCol: (q) => (Math.abs(q[0]) < 1.2 && q[1] > 2 ? STRIPE : Math.abs(Math.abs(q[0]) - 3.4) < 0.6 && q[1] > 3 ? STRIPE : ORANGE),
    snout: [3.7, 2.6, 2.5], snoutAt: [0, -2.4, 8.6], snoutCol: CREAM, noseR: [1.2, 0.9, 0.8], noseAt: [0, -1, 10.6], noseCol: 0xe0708a,
    eyeX: 3.4, eyeY: 1.6, eyeZ: 7.7, eyeR: [1.9, 2.2, 1.1], iris: 0x7fe35f,
    ear: { r: [2.6, 4.4, 1.2], at: [4.8, 5.6, 0], kind: 'point', col: (q) => (q[2] > 0.3 && q[1] > -1.5 ? PINK : ORANGE) },
    tail: { n: 6, r: 1.9, seg: 4.6, at: [0, 2.4, -14], col: (i) => (i % 2 ? STRIPE : i === 5 ? 0x6b3410 : ORANGE), pitch: 0.9 },
    leg: { up: [6.4, 6.8], low: [5.4, 5.8], r: [2.9, 2.4], hip: [[-5.2, -4.4, 9.8], [5.2, -4.4, 9.8], [-5.6, -3.6, -10], [5.6, -3.6, -10]], col: (q) => (Math.sin(q[1] * 1.1) > 0.75 ? STRIPE : ORANGE), lowCol: () => ORANGE, paw: [2.8, 1.7, 3.9], pawCol: CREAM },
    whiskers: true,
  },
  dog: {
    torso: [8.6, 7.6, 16.5], chest: [8.2, 7, 7.5], chestAt: [0, 1, 10], torsoCol: (q) => (q[1] < -3.6 ? 0xf2dcb4 : q[1] > 3.5 && Math.abs(q[0]) < 3 ? 0x8a5a2c : 0xc88a4a), chestCol: (q) => (q[1] < -2.4 ? 0xf2dcb4 : 0xc88a4a),
    neckAt: [0, 6, 13.5], head: [7.2, 6.6, 7.4], headAt: [0, 0.4, 2.2], headCol: (q) => (Math.abs(q[0]) < 1.4 && q[2] > 3 ? 0xf2dcb4 : 0xc88a4a),
    snout: [3.4, 3, 5.2], snoutAt: [0, -2.3, 8.4], snoutCol: 0xf2dcb4, noseR: [1.7, 1.3, 1.2], noseAt: [0, -0.6, 13], noseCol: 0x15110e,
    eyeX: 3.1, eyeY: 2, eyeZ: 7.3, eyeR: [1.5, 1.7, 1], iris: 0x5a3417,
    ear: { r: [2.4, 5, 1.8], at: [5.4, 4.4, -0.4], kind: 'floppy', col: () => 0x6e4220 },
    tail: { n: 5, r: 1.9, seg: 4, at: [0, 3.4, -15], col: (i) => (i === 4 ? 0xf2dcb4 : 0xc88a4a), pitch: 1.5 },
    leg: { up: [7.2, 7.6], low: [6.2, 6.6], r: [3, 2.5], hip: [[-5, -4.8, 10.5], [5, -4.8, 10.5], [-5.4, -4, -11], [5.4, -4, -11]], col: () => 0xc88a4a, lowCol: () => 0xe3c294, paw: [3, 1.8, 4.2], pawCol: 0xf2dcb4 },
  },
  fox: {
    torso: [7.4, 6.4, 15.5], chest: [7, 6, 7], chestAt: [0, 1, 9.5], torsoCol: (q) => (q[1] < -2.8 ? 0xfbf3e4 : 0xe2661c), chestCol: (q) => (q[1] < -1.6 ? 0xfbf3e4 : 0xe2661c),
    neckAt: [0, 5.2, 13], head: [6.6, 5.8, 6.2], headAt: [0, 0.4, 2], headCol: (q) => (Math.abs(q[0]) > 3.4 && q[1] < 0.5 ? 0xfbf3e4 : 0xe2661c),
    snout: [2.5, 2.1, 5.6], snoutAt: [0, -1.8, 8.2], snoutCol: 0xfbf3e4, noseR: [1.1, 0.9, 0.9], noseAt: [0, -1.1, 12.8], noseCol: 0x14100c,
    eyeX: 3, eyeY: 1.9, eyeZ: 6.4, eyeR: [1.5, 1.4, 1], iris: 0xffc233,
    ear: { r: [2.5, 6, 1.1], at: [4.2, 6, 0], kind: 'point', col: (q) => (q[2] > 0.3 ? 0xfbf3e4 : 0x2a1a10) },
    tail: { n: 6, r: 3.1, seg: 4.4, at: [0, 2.4, -14], col: (i) => (i === 5 ? 0xfbf3e4 : 0xe2661c), pitch: 0.7 },
    leg: { up: [6.6, 7], low: [5.6, 6], r: [2.5, 2.1], hip: [[-4.4, -4, 9.6], [4.4, -4, 9.6], [-4.8, -3.4, -10], [4.8, -3.4, -10]], col: () => 0xe2661c, lowCol: () => 0x2b1b12, paw: [2.4, 1.5, 3.5], pawCol: 0x14100c },
  },
  bunny: {
    torso: [8.4, 8, 11], chest: [7.4, 7, 6], chestAt: [0, 1, 6.5], torsoCol: (q) => (q[1] < -3.6 ? 0xffffff : 0xe3dfee), chestCol: (q) => (q[1] < -3 ? 0xffffff : 0xe3dfee),
    neckAt: [0, 5.8, 8.5], head: [6.4, 6, 6.2], headAt: [0, 0.5, 2], headCol: () => 0xe9e6f2,
    snout: [2.6, 2, 2.4], snoutAt: [0, -2.1, 6.9], snoutCol: 0xffffff, noseR: [0.9, 0.8, 0.7], noseAt: [0, -1.3, 8.9], noseCol: 0xf08aa8,
    eyeX: 3, eyeY: 1.4, eyeZ: 6, eyeR: [1.5, 1.9, 1], iris: 0x7a2f4a,
    ear: { r: [2, 8.6, 1], at: [3, 5.2, 0], kind: 'long', col: (q) => (q[2] > 0.25 && Math.abs(q[1]) < 6 ? PINK : 0xe9e6f2) },
    tail: { n: 1, r: 3.2, seg: 3, at: [0, 0.5, -10.5], col: () => 0xffffff, pitch: 0.1 },
    leg: { up: [4.6, 6], low: [3.2, 4.6], r: [3.2, 2.2], hip: [[-4.8, -4.6, 6.4], [4.8, -4.6, 6.4], [-5.6, -3.4, -6.4], [5.6, -3.4, -6.4]], col: () => 0xe3dfee, lowCol: () => 0xe3dfee, paw: [2.4, 1.5, 4.4], pawCol: 0xffffff },
    hop: true,
  },
  dragon: {
    torso: [8.6, 7.6, 17], chest: [8, 7, 7.5], chestAt: [0, 1, 11], torsoCol: (q) => (q[1] < -3.4 ? 0xd8e68a : Math.sin(q[2] * 0.7) > 0.8 ? 0x2f8f4a : 0x4caf50), chestCol: (q) => (q[1] < -2.6 ? 0xd8e68a : 0x4caf50),
    neckAt: [0, 6, 14], head: [6.4, 5.6, 7.4], headAt: [0, 0.5, 2.6], headCol: () => 0x4caf50,
    snout: [3, 2.5, 5.8], snoutAt: [0, -1.8, 8.6], snoutCol: 0x6bc46b, noseR: [1, 0.8, 0.8], noseAt: [0, 0.2, 13.4], noseCol: 0x1c3a22,
    eyeX: 3, eyeY: 2.4, eyeZ: 6.4, eyeR: [1.6, 1.4, 1], iris: 0xffd23a,
    ear: null,
    tail: { n: 9, r: 2.6, seg: 4.4, at: [0, 2.4, -15], col: (i) => (i === 8 ? 0xd94a3a : i % 2 ? 0x2f8f4a : 0x4caf50), pitch: 0.6 },
    leg: { up: [6.6, 7], low: [5.4, 5.8], r: [3.1, 2.6], hip: [[-5.4, -4.4, 11], [5.4, -4.4, 11], [-5.8, -3.6, -11], [5.8, -3.6, -11]], col: () => 0x4caf50, lowCol: () => 0x3f9d44, paw: [3, 1.8, 4.4], pawCol: 0xe8e0c0 },
    wings: { col: 0x2e7d52, bone: 0x1f5a3a, span: 15 }, horns: 5, spikes: 6, tuft: false,
  },
}

type Added = { prims: Prim[]; add: (n: Node, off: V3, r: V3, color: Prim['color'], extra?: Partial<Prim>) => void }
const collect = (): Added => { const prims: Prim[] = []; return { prims, add: (n, off, r, color, extra = {}) => { prims.push({ c: at(n, off), R: n.R, r, color, ...extra }) } } }

// Apoyo automatico: el punto mas bajo (sin contar la cola ni piezas flotantes) toca el suelo; el salto se suma despues.
// Cabeza del ultimo modelo armado y cuanto se subio al apoyarlo: ahi se montan los accesorios.
let curHead: Node | undefined, curLift = 0
const groundPrims = (prims: Prim[], bob: number, head: V3): V3 => {
  let low = Infinity
  for (const q of prims) if (!q.noGround) low = Math.min(low, q.c[1] - Math.hypot(q.R[3]! * q.r[0], q.R[4]! * q.r[1], q.R[5]! * q.r[2]))
  const lift = -low + bob
  curLift = lift
  for (const q of prims) q.c[1] += lift
  return [head[0], head[1] + lift, head[2]]
}

function buildQuad(sp: QuadSpec, p: Pose, T: number): Built {
  const { prims, add } = collect()
  const hop = !!sp.hop
  const legsA = hop ? [p.legs[0], p.legs[0], p.legs[2], p.legs[2]] : p.legs
  const liftA = hop ? [p.lift[0], p.lift[0], p.lift[2], p.lift[2]] : p.lift
  const legScale = 1 - 0.5 * p.crouch
  const root: Node = { R: Ry(Math.PI + p.yaw), t: [p.shake, 30, 0] }
  const torso = child(root, [0, 0, 0], mul(mul(Ry(p.twist), Rx(-p.pitch)), Rz(p.roll)))
  const ts: V3 = [sp.torso[0] * (1 + p.breathe), sp.torso[1] * (1 + p.breathe) * (p.stretch < 1 ? 1.12 : 1), sp.torso[2] * p.stretch]
  add(torso, [0, 0, 0], ts, sp.torsoCol)
  add(torso, sp.chestAt, sp.chest, sp.chestCol)
  // cabeza
  const head = child(torso, [sp.neckAt[0], sp.neckAt[1], sp.neckAt[2] * p.stretch], mul(mul(Ry(p.headYaw), Rx(p.headPitch + p.pitch * 0.8)), Rz(p.headRoll)))
  add(head, sp.headAt, sp.head, sp.headCol)
  if (sp.ear) {
    for (const [s, flick] of [[-1, p.earL], [1, p.earR]] as const) {
      const e = sp.ear
      const rot = e.kind === 'floppy' ? Rz(s * (0.3 + flick * 0.5)) : mul(Rz(-s * ((e.kind === 'long' ? 0.12 : 0.3) + flick * 0.5)), Rx(-flick * 0.6))
      const ear = child(head, [s * e.at[0], e.at[1], e.at[2]], rot)
      add(ear, [0, e.kind === 'floppy' ? -e.r[1] * 0.85 : e.r[1] * 0.8, 0], e.r, e.col)
    }
  }
  if (sp.horns) for (const s of [-1, 1]) { const h = child(head, [s * 3.2, 5.2, 0], mul(Rz(-s * 0.3), Rx(-0.9))); add(h, [0, sp.horns * 0.8, 0], [1.2, sp.horns, 1.2], 0xe8e0c0) }
  if (sp.spikes) for (let i = 0; i < sp.spikes; i++) add(torso, [0, ts[1] * 0.92, 10 - i * 4.4], [1, 2.2, 1.5], 0xd8e68a)
  add(head, sp.snoutAt, sp.snout, sp.snoutCol)
  add(head, sp.noseAt, sp.noseR, sp.noseCol, { glyph: '@' })
  if (p.mouth > 0.05) {
    add(head, [0, sp.snoutAt[1] - 2, sp.snoutAt[2] + 0.6], [sp.snout[0] * 0.6, 0.3 + p.mouth * 1.9, Math.min(3, sp.snout[2] * 0.8)], 0x4a1020, { solid: true })
    add(head, [0, sp.snoutAt[1] - 2.6 - p.mouth, sp.snoutAt[2]], [1.3, 0.5 + p.mouth * 0.4, 1], 0xe8607a, { glyph: 'o' })
  }
  if (sp.whiskers) for (const s of [-1, 1]) for (const dy of [-0.8, -2.4]) add(head, [s * 6.6, -2 + dy, 9.2], [3.2, 0.18, 0.18], 0xf4efe6, { glyph: '-' })
  // ojos
  const lid = Math.max(0.1, 1 - p.blink * 0.92)
  for (const s of [-1, 1]) {
    if (p.blink > 0.85) add(head, [s * sp.eyeX, sp.eyeY - 0.2, sp.eyeZ + 0.6], [sp.eyeR[0] * 1.15, 0.35, 0.7], 0x2a1608, { solid: true })
    else {
      add(head, [s * sp.eyeX, sp.eyeY, sp.eyeZ], [sp.eyeR[0] * p.wide, sp.eyeR[1] * lid * p.wide, sp.eyeR[2]], sp.iris, { glyph: 'O' })
      add(head, [s * sp.eyeX + p.lookX * 0.9, sp.eyeY + p.lookY * 0.8, sp.eyeZ + 0.8], [sp.eyeR[0] * 0.34, sp.eyeR[1] * 0.78 * lid * p.wide, 0.5], 0x10140a, { solid: true })
    }
  }
  // patas
  for (let i = 0; i < 4; i++) {
    const front = i < 2
    const L = sp.leg
    const hip = child(torso, [L.hip[i]![0], L.hip[i]![1], L.hip[i]![2] * (hop ? 1 : p.stretch)], Rx(-legsA[i]!))
    const up = L.up[front ? 0 : 1] * legScale, low = L.low[front ? 0 : 1] * legScale
    add(hip, [0, -up / 2, 0], [L.r[0], up / 2 + 0.6, L.r[0]], L.col)
    const knee = child(hip, [0, -up, 0], Rx((front ? 0.12 : -0.35 + Math.max(0, legsA[i]!) * 0.2) + liftA[i]!))
    add(knee, [0, -low / 2, 0], [L.r[1], low / 2 + 0.5, L.r[1] + 0.1], L.lowCol)
    const paw = child(knee, [0, -low, 0.8])
    add(paw, [0, -0.6, 1.2], L.paw, L.pawCol)
  }
  // cola
  if (sp.tail) {
    const t = sp.tail
    let seg = child(torso, [t.at[0], t.at[1], t.at[2] * p.stretch], Rx(-0.5 - (t.pitch + p.tailPitch - 0.9) * 0.5))
    for (let i = 0; i < t.n; i++) {
      const r = (t.r - i * (t.r * 0.04)) * p.puff
      prims.push({ c: at(seg, [0, 0, -t.seg / 2]), R: seg.R, r: [r, r, t.seg * 0.58], color: t.col(i), noGround: true })
      const wag = p.tailYaw + p.tailAmp * 0.5 * Math.sin((TWO * T) / p.tailSpeed - i * 0.7)
      seg = child(seg, [0, 0, -t.seg], mul(Ry(wag), Rx(-(t.pitch + p.tailPitch - 0.9) * 0.22)))
    }
  }
  // alas del dragon: aletean segun el ritmo (rapido al correr y al celebrar, lento en reposo)
  if (sp.wings) {
    const flap = 0.55 + 0.45 * Math.sin((TWO * T) / (p.ground > 2 ? 9 : p.bob > 3 ? 8 : 40)) * (p.ground > 2 || p.bob > 3 ? 1 : 0.35)
    for (const s of [-1, 1]) {
      const w = child(torso, [s * 6.6, 5.4, 3], mul(Rz(s * (0.35 + flap * 0.9)), Rx(0.15)))
      add(w, [s * sp.wings.span * 0.5, 0, 0], [sp.wings.span * 0.52, 0.7, 7.5], (q) => (Math.abs(q[2]) < 0.9 || Math.abs(q[0]) < 1.2 ? sp.wings!.bone : sp.wings!.col), { noGround: true })
      add(w, [s * sp.wings.span * 0.95, 0, -3], [1.1, 0.8, 5], sp.wings.bone, { noGround: true })
    }
  }
  curHead = head
  return { prims, head: groundPrims(prims, p.bob, at(head, [0, 0, 0])) }
}

// Buho: cuerpo vertical, cabeza grande que gira mucho, ojos enormes, alas a los lados y patas cortas.
function buildOwl(p: Pose, T: number): Built {
  const { prims, add } = collect()
  const BR = 0x8a6a46, BR2 = 0x5e4630, CR = 0xf0dcb4
  const root: Node = { R: Ry(Math.PI + p.yaw), t: [p.shake, 24, 0] }
  const body = child(root, [0, 0, 0], mul(Ry(p.twist), Rz(p.roll)))
  add(body, [0, 0, 0], [8.4 * (1 + p.breathe), 11 * (1 + p.breathe), 8], (q) => (q[2] > 3 && q[1] < 6 ? (Math.sin(q[1] * 1.6) > 0.2 ? 0xe0c898 : CR) : Math.sin(q[1] * 1.4 + q[0] * 0.5) > 0.6 ? BR2 : BR))
  const head = child(body, [0, 10.6, 0.5], mul(mul(Ry(p.headYaw * 2.4), Rx(p.headPitch)), Rz(p.headRoll)))
  add(head, [0, 0, 0], [8.6, 7.4, 7.6], () => BR)
  add(head, [0, -0.4, 4], [7, 6, 3.4], CR)                                       // disco facial
  for (const s of [-1, 1]) {
    const tuft = child(head, [s * 5, 6.2, 0], Rz(-s * (0.4 + p.earL * 0.5)))
    add(tuft, [0, 2, 0], [1.6, 3.2, 1.2], BR2)
    const lid = Math.max(0.1, 1 - p.blink * 0.92)
    if (p.blink > 0.85) add(head, [s * 3.7, 1.3, 7], [3, 0.4, 0.8], 0x2a1608, { solid: true })
    else {
      add(head, [s * 3.7, 1.3, 6.2], [3.3, 3.6 * lid, 1.5], 0xfff2b8, { glyph: 'O' })
      add(head, [s * 3.7 + p.lookX, 1.3 + p.lookY, 7.4], [1.5, 2 * lid, 0.8], 0x10140a, { solid: true })
    }
  }
  add(head, [0, -2.4, 8.2], [1.6, 2.4, 1.9], 0xf0a030, { glyph: 'V' })          // pico
  if (p.mouth > 0.05) add(head, [0, -4.6, 7.8], [1.4, 0.3 + p.mouth * 1.4, 1], 0x4a1020, { solid: true })
  // alas: las patas [0],[1] mueven las alas (arriba/abajo) y al celebrar o correr aletean
  for (const [i, s] of [[0, -1], [1, 1]] as const) {
    const flap = p.legs[i]! * 0.9 + (p.bob > 3 ? 0.9 * Math.sin((TWO * T) / 8) : 0) - 0.12
    const w = child(body, [s * 7.6, 4, -0.5], Rz(s * (0.14 + flap * 0.5)))
    add(w, [s * 1.4, -4.6, 0], [2.2, 7.6, 5], (q) => (Math.sin(q[1] * 1.2) > 0.5 ? BR2 : BR))
  }
  add(body, [0, -10.6, -3.4], [3.8, 1.8, 5.6], BR2)                               // cola corta
  for (const [i, s] of [[2, -1], [3, 1]] as const) {
    const leg = child(body, [s * 3.2, -10.2, 1.4], Rx(-p.legs[i]! * 0.7))
    add(leg, [0, -1.2, 1], [1.4, 1.6, 1.6], 0xf0a030)
    const foot = child(leg, [0, -2, 0], Rx(p.lift[i]!))
    add(foot, [0, -0.4, 1.8], [2.4, 1, 3.4], 0xf0a030)
  }
  curHead = head
  return { prims, head: groundPrims(prims, p.bob, at(head, [0, 0, 0])) }
}

// Robot: piezas rigidas (cabeza con visor, torso, brazos y piernas), antena que rebota.
function buildRobot(p: Pose, T: number): Built {
  const { prims, add } = collect()
  const M1 = 0xaab4c4, M2 = 0x7d8798, ACC = 0xff7043, GLOW = 0x4ee8ff
  const root: Node = { R: Ry(Math.PI + p.yaw), t: [p.shake, 24, 0] }
  const torso = child(root, [0, 0, 0], mul(Ry(p.twist * 0.5), Rz(p.roll * 0.5)))
  add(torso, [0, 0, 0], [8.2, 8.4, 6.2], (q) => (Math.abs(q[1]) > 6.8 ? M2 : M1))
  add(torso, [0, 2, 5.2], [4.4, 3.4, 1.4], 0x2a3140)                                  // panel
  add(torso, [0, 2, 6], [2.2 + 0.6 * Math.sin(T / 3), 1.4, 0.9], GLOW, { glyph: '@' })   // luz del pecho
  const head = child(torso, [0, 11.4, 0], mul(mul(Ry(p.headYaw), Rx(p.headPitch)), Rz(p.headRoll)))
  add(head, [0, 0, 0], [7.2, 5.8, 6], M1)
  add(head, [0, 0.6, 4.6], [6, 3, 1.8], 0x1c2230)                                     // visor
  const lid = Math.max(0.1, 1 - p.blink * 0.92)
  for (const s of [-1, 1]) {
    if (p.blink > 0.85) add(head, [s * 2.6, 0.6, 5.8], [1.8, 0.3, 0.6], GLOW, { solid: true })
    else add(head, [s * 2.6 + p.lookX * 0.7, 0.6 + p.lookY * 0.5, 5.6], [1.7 * p.wide, 1.5 * lid * p.wide, 0.9], GLOW, { glyph: 'O' })
  }
  if (p.mouth > 0.05) add(head, [0, -2.4, 5], [2.6, 0.4 + p.mouth * 0.8, 1], GLOW, { glyph: '=' })
  const ant = child(head, [0, 5.4, 0], Rz(0.2 * Math.sin((TWO * T) / 14) + (p.earL + p.earR) * 0.3))
  add(ant, [0, 2.4, 0], [0.5, 2.6, 0.5], M2)
  add(ant, [0, 5.2, 0], [1.3, 1.3, 1.3], ACC, { glyph: '@' })
  for (const [i, s] of [[0, -1], [1, 1]] as const) {
    const arm = child(torso, [s * 9.4, 5.4, 0], mul(Rz(s * Math.max(0, Math.min(0.9, (p.legs[i]! - 1.1) * 0.55))), Rx(-p.legs[i]! * 1.1 - (p.pitch > 0.3 ? 0.1 : 0))))
    add(arm, [0, -3.2, 0], [2.1, 3.8, 2.1], M2)
    const fore = child(arm, [0, -6.4, 0], Rx(0.15 + p.lift[i]! * 0.6))
    add(fore, [0, -2.8, 0], [1.9, 3.2, 1.9], M1)
    add(fore, [0, -6, 0.4], [2.2, 1.6, 2], ACC)
  }
  for (const [i, s] of [[2, -1], [3, 1]] as const) {
    const a = Math.max(-1.6, Math.min(1.6, p.legs[i]!))
    const leg = child(torso, [s * 4, -9, 0], Rx(-a))
    add(leg, [0, -3.4, 0], [2.6, 4, 2.6], M2)
    const shin = child(leg, [0, -6.8, 0], Rx(Math.min(1.2, p.lift[i]! * 0.7)))
    add(shin, [0, -3, 0], [2.3, 3.4, 2.3], M1)
    const foot = child(shin, [0, -6.2, 0])
    add(foot, [0, -0.6, 1.6], [2.8, 1.5, 4.2], ACC)
  }
  curHead = head
  return { prims, head: groundPrims(prims, p.bob, at(head, [0, 0, 0])) }
}

// Monstruo: cuerpo redondo peludo, cuernos, un par de ojos grandes, boca con dientes, brazos y patas cortas.
function buildMonster(p: Pose, T: number): Built {
  const { prims, add } = collect()
  const PU = 0x8d52d8, PU2 = 0x6a37ad, BELLY = 0xc9a3f2
  const root: Node = { R: Ry(Math.PI + p.yaw), t: [p.shake, 24, 0] }
  const body = child(root, [0, 0, 0], mul(Ry(p.twist), Rz(p.roll)))
  add(body, [0, 0, 0], [11 * (1 + p.breathe), 10.4 * (1 + p.breathe), 10], (q) => (q[1] < -2 && q[2] > 2 ? BELLY : Math.sin(q[0] * 1.1 + q[1] * 0.7) > 0.8 ? PU2 : PU))
  const head = child(body, [0, 7.2, 3], mul(mul(Ry(p.headYaw), Rx(p.headPitch)), Rz(p.headRoll)))
  for (const s of [-1, 1]) {
    const horn = child(head, [s * 5.4, 4.6, 0], Rz(-s * (0.5 + p.earL * 0.4)))
    add(horn, [0, 2.6, 0], [1.7, 3.6, 1.7], 0xf4e6b8)
  }
  const lid = Math.max(0.1, 1 - p.blink * 0.92)
  for (const s of [-1, 1]) {
    if (p.blink > 0.85) add(head, [s * 3.6, 2.4, 8.4], [2.6, 0.4, 0.8], 0x1a0f2a, { solid: true })
    else {
      add(head, [s * 3.6, 2.4, 7.8], [3 * p.wide, 3.3 * lid * p.wide, 1.5], 0xfdfdfd, { glyph: 'O' })
      add(head, [s * 3.6 + p.lookX * 1.2, 2.4 + p.lookY, 9], [1.3, 1.8 * lid, 0.8], 0x10091c, { solid: true })
    }
  }
  const mh = 0.9 + p.mouth * 2.4
  add(head, [0, -2.4, 8.2], [4.8, mh, 1.8], 0x35101c, { solid: true })
  for (const x of [-2.8, -0.9, 0.9, 2.8]) add(head, [x, -2.4 + mh * 0.7, 9.2], [0.7, 0.9, 0.7], 0xffffff, { glyph: 'v' })
  for (const [i, s] of [[0, -1], [1, 1]] as const) {
    const arm = child(body, [s * 10.4, 1.4, 0], Rz(s * (0.6 - Math.max(0, -p.legs[i]!) * 0.6)))
    const sw = child(arm, [0, 0, 0], Rx(-p.legs[i]! * 1.2))
    add(sw, [s * 1.4, -4.2, 0], [2.6, 5, 2.6], PU2)
    add(sw, [s * 1.8, -9, 0.4], [2.4, 2.2, 2.4], BELLY)
  }
  for (const [i, s] of [[2, -1], [3, 1]] as const) {
    const leg = child(body, [s * 4.6, -9, 0], Rx(-Math.max(-1.6, Math.min(1.6, p.legs[i]!))))
    add(leg, [0, -2, 0], [3.4, 3.2, 3.4], PU2)
    const foot = child(leg, [0, -4, 0], Rx(p.lift[i]! * 0.6))
    add(foot, [0, -0.6, 1.6], [3.4, 1.8, 4.6], BELLY)
  }
  curHead = head
  return { prims, head: groundPrims(prims, p.bob, at(head, [0, 0, 0])) }
}

// Fantasma: cupula con falda ondulante, flota (sin apoyo en el suelo), brazos redondos, ojos y boca.
function buildGhost(p: Pose, T: number): Built {
  const { prims, add } = collect()
  const WH = 0xe6e8ff, WH2 = 0xb9bff0
  const fl = 8 + p.bob + 1.6 * Math.sin((TWO * T) / 34)
  const root: Node = { R: Ry(Math.PI + p.yaw), t: [p.shake, fl + 16, 0] }
  const body = child(root, [0, 0, 0], mul(Ry(p.twist), Rz(p.roll + 0.05 * Math.sin((TWO * T) / 42))))
  add(body, [0, 3, 0], [9.6 * (1 + p.breathe), 10, 9], (q) => (q[1] < -4 ? WH2 : WH), { noGround: true })
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TWO, w = Math.sin((TWO * T) / 22 - i * 1.3)
    add(body, [Math.cos(a) * 6.6, -7.4 + w * 1.4, Math.sin(a) * 6.2], [3.4, 5.2 + w * 1, 3.4], i % 2 ? WH2 : WH, { noGround: true })
  }
  add(body, [0, -5.4, 0], [6.4, 4, 6], WH2, { noGround: true })
  const head = child(body, [0, 5, 0], mul(mul(Ry(p.headYaw), Rx(p.headPitch)), Rz(p.headRoll)))
  const lid = Math.max(0.1, 1 - p.blink * 0.92)
  for (const s of [-1, 1]) {
    if (p.blink > 0.85) add(head, [s * 3.4, 1.4, 8.4], [2.2, 0.35, 0.7], 0x1a1030, { solid: true, noGround: true })
    else add(head, [s * 3.4 + p.lookX, 1.4 + p.lookY, 8.4], [2 * p.wide, 2.8 * lid * p.wide, 1.2], 0x1a1030, { solid: true, noGround: true })
  }
  const mh = 0.7 + p.mouth * 2.8
  add(head, [0, -3.2, 8.6], [1.8 + p.mouth, mh, 1.2], 0x1a1030, { solid: true, noGround: true })
  for (const [i, s] of [[0, -1], [1, 1]] as const) {
    const arm = child(body, [s * 9, -1, 0], Rz(s * (0.5 + Math.sin((TWO * T) / 30 + i * 2) * 0.3 - p.legs[i]! * 0.6)))
    add(arm, [s * 2.4, -1.8, 0], [2.2, 3.6, 2.2], WH, { noGround: true })
  }
  const hp = at(head, [0, 0, 0])
  // el fantasma flota: sin apoyo; la sombra queda en el suelo
  curHead = head; curLift = 0
  return { prims, head: hp, floats: true }
}

export const MODELS = ['cat', 'dog', 'fox', 'bunny', 'dragon', 'owl', 'robot', 'monster', 'ghost'] as const

// Medidas de la cabeza por especie para los accesorios: [altura de la coronilla, radio, ojo x, ojo y, ojo z, cuello y]
const HEAD: Record<string, [number, number, number, number, number]> = {
  cat: [7.5, 8, 3.4, 1.6, 7.7], dog: [7, 7.2, 3.1, 2, 7.3], fox: [6.2, 6.6, 3, 1.9, 6.4], bunny: [6.5, 6.4, 3, 1.4, 6], dragon: [6.1, 6.4, 3, 2.4, 6.4],
  owl: [7.4, 8.6, 3.7, 1.3, 6.4], robot: [5.8, 7.2, 2.6, 0.6, 5.8], monster: [4.2, 7, 3.6, 2.4, 8], ghost: [8, 8, 3.4, 1.4, 8.4],
}
function accessoryPrims(kind: string, pet: string): Prim[] {
  const hd = curHead
  if (!hd || kind === 'ninguno') return []
  const [top, w, ex, ey, ez] = pet === '#custom' ? customDims! : HEAD[pet] ?? HEAD.cat!
  const n: Node = { R: hd.R, t: [hd.t[0], hd.t[1] + curLift, hd.t[2]] }
  const { prims, add } = collect()
  const GOLD = 0xfacc15
  if (kind === 'sombrero') {
    add(n, [0, top - 0.6, 0], [w * 1.2, 0.7, w * 1.2], 0x4c3a7a, { noGround: true })
    add(n, [0, top + 2.4, 0], [w * 0.62, 3.2, w * 0.62], 0x5b3a8c, { noGround: true })
    add(n, [0, top + 0.6, 0], [w * 0.66, 0.9, w * 0.66], 0xf59e0b, { noGround: true })
  } else if (kind === 'corona') {
    add(n, [0, top, 0], [w * 0.74, 1.3, w * 0.74], GOLD, { noGround: true })
    for (const x of [-0.5, 0, 0.5]) add(n, [x * w * 0.9, top + 1.9, 0], [0.9, 1.9, 0.9], GOLD, { noGround: true })
    add(n, [0, top + 0.1, w * 0.72], [0.8, 0.8, 0.5], 0xef4444, { noGround: true })
  } else if (kind === 'lentes') {
    for (const s of [-1, 1]) {
      for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; add(n, [s * ex + Math.cos(a) * 2.7, ey + Math.sin(a) * 2.7, ez + 1.6], [0.6, 0.6, 0.6], 0x111827, { noGround: true }) }
    }
    add(n, [0, ey, ez + 1.6], [1.2, 0.5, 0.5], 0x111827, { noGround: true })
  } else if (kind === 'corbata') {
    add(n, [0, -w * 0.62, w * 0.55], [1.5, 1.3, 1.1], 0xdc2626, { noGround: true })
    add(n, [0, -w * 0.62 - 2.6, w * 0.55], [1.7, 2.8, 0.9], 0xb91c1c, { noGround: true })
  }
  return prims
}

// Modelo disenado por la IA: piezas elipsoidales en grupos articulados (cabeza, orejas, cola, patas, alas) que se animan con la misma pose que las especies.
const modelIds = new WeakMap<object, number>()
let modelSeq = 0
const modelId = (m: Model3D) => { let id = modelIds.get(m); if (id === undefined) { id = ++modelSeq; modelIds.set(m, id) } return id }
const LEG_IDX: Record<string, number> = { legFL: 0, legFR: 1, legBL: 2, legBR: 3, armL: 0, armR: 1, legL: 2, legR: 3 }
let customDims: [number, number, number, number, number] | undefined

// Si la IA no separo la parte baja de una pata, se parte sola por la mitad: arriba queda en el grupo y abajo pasa a "<grupo>low" con la rodilla en medio.
const kneed = new WeakMap<Model3D, Model3D>()
// Soldadura: la IA a veces deja una extremidad separada del cuerpo; cada grupo se acerca a su padre hasta que sus piezas se toquen.
const dirRadius = (r: V3, d: V3) => 1 / Math.sqrt((d[0] / r[0]) ** 2 + (d[1] / r[1]) ** 2 + (d[2] / r[2]) ** 2)
function weld(m: Model3D): Model3D {
  const parts = m.parts.map(q => ({ ...q, c: [...q.c] as V3 })), pivots: Model3D['pivots'] = {}
  for (const [k, v] of Object.entries(m.pivots)) pivots[k] = [v[0], v[1], v[2]]
  const parentOf = (g: string) => (g.endsWith('low') ? g.slice(0, -3) : g === 'earL' || g === 'earR' ? 'head' : 'body')
  const groups = ['head', 'legFL', 'legFR', 'legBL', 'legBR', 'armL', 'armR', 'legL', 'legR', 'wingL', 'wingR', 'earL', 'earR', 'tail',
    'legFLlow', 'legFRlow', 'legBLlow', 'legBRlow']
  for (const g of groups) {
    const mine = parts.filter(q => q.g === g)
    if (!mine.length) continue
    let par = parentOf(g)
    if (!parts.some(q => q.g === par)) par = 'body'
    const others = parts.filter(q => q.g === par)
    // La parte baja arranca en la rodilla: se suelda contra la parte alta de su propia pata, no contra el cuerpo.
    let best = Infinity, move: V3 = [0, 0, 0], joint: V3 | undefined
    for (const a of mine) for (const b of others) {
      const d: V3 = [b.c[0] - a.c[0], b.c[1] - a.c[1], b.c[2] - a.c[2]], dist = Math.hypot(...d) || 1e-6
      const u: V3 = [d[0] / dist, d[1] / dist, d[2] / dist]
      const gap = dist - dirRadius(a.r, u) - dirRadius(b.r, u)
      if (gap < best) { const ra = dirRadius(a.r, u); best = gap; move = [u[0] * gap, u[1] * gap, u[2] * gap]; joint = [a.c[0] + u[0] * (ra + gap / 2), a.c[1] + u[1] * (ra + gap / 2), a.c[2] + u[2] * (ra + gap / 2)] }
    }
    if (best > 0.4 && best < 30) {
      for (const q of mine) { q.c[0] += move[0]; q.c[1] += move[1]; q.c[2] += move[2] }
      if (pivots[g]) pivots[g] = [pivots[g]![0] + move[0], pivots[g]![1] + move[1], pivots[g]![2] + move[2]]
      if (joint) joint = [joint[0] + move[0], joint[1] + move[1], joint[2] + move[2]]
    }
    // El pivote real es el punto de contacto con el padre (hombro, cadera, rodilla, cuello): girar alrededor de otro punto despega la extremidad.
    if (joint && g !== 'body' && !g.startsWith('tail')) pivots[g] = joint
  }
  return { ...m, parts, pivots }
}

// La IA a veces deja en "body" la parte baja de una extremidad (antebrazo, mano, pantorrilla, pie) y solo la parte alta en su grupo: se queda atras al moverla.
// Se recorre la cadena de piezas de "body" que tocan la extremidad hacia abajo y del mismo lado, y pasan a su grupo.
function absorb(m: Model3D): Model3D {
  const parts = m.parts.map(q => ({ ...q }))
  const surfGap = (a: Part3D, b: Part3D) => {
    const d: V3 = [b.c[0] - a.c[0], b.c[1] - a.c[1], b.c[2] - a.c[2]], dist = Math.hypot(d[0], d[1], d[2]) || 1e-6
    const u: V3 = [d[0] / dist, d[1] / dist, d[2] / dist]
    return dist - dirRadius(a.r, u) - dirRadius(b.r, u)
  }
  for (const g of ['legFL', 'legFR', 'legBL', 'legBR', 'armL', 'armR', 'legL', 'legR']) {
    const mine = parts.filter(q => q.g === g)
    if (!mine.length) continue
    const px = m.pivots[g]?.[0] ?? mine.reduce((a, q) => a + q.c[0], 0) / mine.length
    const side = (q: Part3D) => (Math.abs(px) < 1.5 ? Math.abs(q.c[0] - px) < 3.5 : q.c[0] * px > 0 && Math.abs(q.c[0]) >= Math.abs(px) * 0.6)
    const front = [...mine]
    while (front.length) {
      const a = front.pop()!
      for (const b of parts) {
        if (b.g !== 'body' || !side(b) || b.c[1] > a.c[1] + 0.5 || surfGap(a, b) > 1) continue
        b.g = g
        front.push(b)
      }
    }
  }
  return { ...m, parts }
}

function withKnees(m0: Model3D): Model3D {
  const hit = kneed.get(m0)
  if (hit) return hit
  const m = weld(absorb(m0))
  const parts = m.parts.map(q => ({ ...q })), pivots = { ...m.pivots }
  for (const g of ['legFL', 'legFR', 'legBL', 'legBR', 'armL', 'armR', 'legL', 'legR']) {
    const mine = parts.filter(q => q.g === g)
    if (!mine.length || parts.some(q => q.g === g + 'low')) continue
    const pv = pivots[g] ?? [0, 18, 0]
    const bottom = Math.min(...mine.map(q => q.c[1] - q.r[1])), knee = pv[1] - (pv[1] - bottom) * 0.5
    if (pv[1] - bottom < 4) continue
    for (const q of mine) if (q.c[1] < knee) q.g = g + 'low'
    if (parts.some(q => q.g === g + 'low')) pivots[g + 'low'] = [pv[0], knee, pv[2]]
  }
  const out = { ...m, parts, pivots }
  kneed.set(m0, out)
  return out
}

// Malla importada (STL/OBJ): vertices con dos huesos y un peso, decodificados una vez por modelo.
type MeshData = { pos: Float32Array; g1: Uint8Array; g2: Uint8Array; w: Float32Array; tri: Uint16Array; gd: Uint8Array }
const MESH_G = ['body', 'head', 'armL', 'armR', 'armLlow', 'armRlow', 'legL', 'legR', 'legLlow', 'legRlow']
const meshCache = new WeakMap<object, MeshData>()
function meshData(m: Model3D): MeshData {
  let d = meshCache.get(m)
  if (d) return d
  const { n, m: nt, b64 } = m.mesh!
  const u8 = (Uint8Array as unknown as { fromBase64: (s: string) => Uint8Array }).fromBase64(b64)
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength)
  const pos = new Float32Array(n * 3)
  for (let i = 0; i < n * 3; i++) pos[i] = dv.getInt16(i * 2, true) / 100
  const g1 = u8.slice(n * 6, n * 7), g2 = u8.slice(n * 7, n * 8), w = new Float32Array(n), gd = new Uint8Array(n)
  for (let i = 0; i < n; i++) { w[i] = u8[n * 8 + i]! / 255; gd[i] = w[i]! < 0.5 ? g1[i]! : g2[i]! }
  const tri = new Uint16Array(nt * 3)
  for (let i = 0; i < nt * 3; i++) tri[i] = dv.getUint16(n * 9 + i * 2, true)
  d = { pos, g1, g2, w, tri, gd }
  meshCache.set(m, d)
  return d
}

function buildMesh(m: Model3D, p: Pose, T: number): Built {
  const md = meshData(m), n = md.w.length
  const piv = (g: string): V3 => m.pivots[g] ?? [0, 18, 0]
  const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
  const root: Node = { R: Ry(Math.PI + p.yaw), t: [p.shake, 30, 0] }
  const pb = piv('body')
  const body = child(root, pb, mul(mul(Ry(p.twist), Rx(-p.pitch)), Rz(p.roll)))
  const nodes: Record<string, Node> = { body }
  const mk = (g: string, rot: M3) => { nodes[g] = child(body, sub(piv(g), pb), rot) }
  mk('head', mul(mul(Ry(p.headYaw), Rx(p.headPitch + p.pitch * 0.8)), Rz(p.headRoll)))
  for (const g of ['armL', 'armR', 'legL', 'legR']) {
    const i = LEG_IDX[g]!
    const abd = g.startsWith('arm') ? Math.max(0, Math.min(0.9, (p.legs[i]! - 1.1) * 0.55)) : 0
    mk(g, abd ? mul(Rz(g.endsWith('L') ? -abd : abd), Rx(-p.legs[i]!)) : Rx(-p.legs[i]!))
    nodes[g + 'low'] = child(nodes[g]!, sub(piv(g + 'low'), piv(g)), Rx(Math.min(1.4, p.lift[i]! * 0.9 + Math.max(0, p.legs[i]!) * 0.15)))
  }
  const nd = MESH_G.map(g => nodes[g]!), pv = MESH_G.map(g => piv(g))
  const x = new Float32Array(n), y = new Float32Array(n), z = new Float32Array(n)
  let low = Infinity
  for (let i = 0; i < n; i++) {
    const vx = md.pos[i * 3]!, vy = md.pos[i * 3 + 1]!, vz = md.pos[i * 3 + 2]!
    const a = md.g1[i]!, w = md.w[i]!
    let o = at(nd[a]!, [vx - pv[a]![0], vy - pv[a]![1], vz - pv[a]![2]])
    if (w > 0 && md.g2[i] !== a) {
      const b = md.g2[i]!, o2 = at(nd[b]!, [vx - pv[b]![0], vy - pv[b]![1], vz - pv[b]![2]])
      o = [o[0] + (o2[0] - o[0]) * w, o[1] + (o2[1] - o[1]) * w, o[2] + (o2[2] - o[2]) * w]
    }
    x[i] = o[0]; y[i] = o[1]; z[i] = o[2]
    if (o[1] < low) low = o[1]
  }
  const lift = -low + p.bob
  for (let i = 0; i < n; i++) y[i] = y[i]! + lift
  curLift = lift
  curHead = nodes.head
  customDims = [7.5, 4.5, 2, 3, 4]
  const hp = at(nodes.head!, [0, 0, 0])
  return { prims: [], head: [hp[0], hp[1] + lift, hp[2]], mesh: { x, y, z, tri: md.tri, g: md.gd, color: parseInt(m.mesh!.color.slice(1), 16) } }
}

function buildCustom(m0: Model3D, p0: Pose, T: number): Built {
  if (m0.mesh) return buildMesh(m0, p0, T)
  const m = withKnees(m0)
  // Postura propia del personaje (encorvado, brazos al frente, rodillas flexionadas) sumada a lo que haga la animacion.
  const stn = m.stance
  const p: Pose = stn ? { ...p0, pitch: p0.pitch + stn.lean, headPitch: p0.headPitch + 0.12, legs: [p0.legs[0] + stn.arms, p0.legs[1] + stn.arms, p0.legs[2], p0.legs[3]], lift: [p0.lift[0] + stn.elbow, p0.lift[1] + stn.elbow, p0.lift[2] + stn.knee, p0.lift[3] + stn.knee] } : p0
  const { prims, add } = collect()
  const piv = (g: string): V3 => m.pivots[g] ?? [0, 18, 0]
  const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
  const root: Node = { R: Ry(Math.PI + p.yaw), t: [p.shake, 30, 0] }
  const pb = piv('body')
  const body = child(root, pb, mul(mul(Ry(p.twist), Rx(-p.pitch)), Rz(p.roll)))
  const has = (g: string) => m.parts.some(q => q.g === g)
  const nodes: Record<string, Node> = { body }
  const mk = (g: string, parent: string, rot: M3) => { if (has(g)) nodes[g] = child(nodes[parent] ?? body, sub(piv(g), piv(parent === 'body' ? 'body' : parent)), rot) }
  mk('head', 'body', mul(mul(Ry(p.headYaw), Rx(p.headPitch + p.pitch * 0.8)), Rz(p.headRoll)))
  mk('earL', has('head') ? 'head' : 'body', Rz(p.earL * 0.6))
  mk('earR', has('head') ? 'head' : 'body', Rz(-p.earR * 0.6))
  mk('tail', 'body', mul(Ry(p.tailYaw + p.tailAmp * 0.5 * Math.sin((TWO * T) / p.tailSpeed)), Rx(-(p.tailPitch - 0.9) * 0.3)))
  const flap = 0.55 + 0.45 * Math.sin((TWO * T) / (p.ground > 2 ? 9 : p.bob > 3 ? 8 : 40)) * (p.ground > 2 || p.bob > 3 ? 1 : 0.35)
  mk('wingL', 'body', Rz(0.2 + flap * 0.6))
  mk('wingR', 'body', Rz(-(0.2 + flap * 0.6)))
  for (const g of ['legFL', 'legFR', 'legBL', 'legBR', 'armL', 'armR', 'legL', 'legR']) {
    const i = LEG_IDX[g]!
    // Brazo levantado: ademas de ir al frente se abre hacia el costado, para que se vea de frente (si no, el escorzo lo acorta).
    const abd = g.startsWith('arm') ? Math.max(0, Math.min(0.9, (p.legs[i]! - 1.1) * 0.55)) : 0
    mk(g, 'body', abd ? mul(Rz(g.endsWith('L') ? -abd : abd), Rx(-p.legs[i]!)) : Rx(-p.legs[i]!))
    if (has(g + 'low')) nodes[g + 'low'] = child(nodes[g] ?? body, sub(piv(g + 'low'), piv(g)), Rx(Math.min(1.4, p.lift[i]! * 0.9 + Math.max(0, p.legs[i]!) * 0.15)))
  }
  const rest = (c: number[]): V3 => [c[0]!, c[1]!, c[2]!]
  for (const q of m.parts) {
    const n = nodes[q.g] ?? body
    const np = q.g in nodes ? piv(q.g) : pb
    const br = q.g === 'body' ? 1 + p.breathe : 1
    const base = parseInt(q.color.slice(1), 16)
    const r: V3 = [q.r[0] * br, q.r[1] * br, q.r[2] * br]
    const color = q.tex === 'stripes' ? (v: V3) => (Math.sin(v[2] * 0.55 + v[1] * 0.12) > 0.55 && v[1] > -r[1] * 0.3 ? shade(base, 0.62) : base)
      : q.tex === 'spots' ? (v: V3) => (Math.sin(v[0] * 0.9) * Math.sin(v[1] * 0.9) * Math.sin(v[2] * 0.9) > 0.4 ? shade(base, 0.6) : base)
      : q.tex === 'belly' ? (v: V3) => (v[1] < -r[1] * 0.45 ? shade(base, 1.35) : base) : base
    add(n, sub(rest(q.c), np), r, color)
  }
  const hn = nodes.head ?? body
  const hp = nodes.head ? piv('head') : pb
  if (m.eyes) {
    const e = m.eyes, iris = parseInt(e.color.slice(1), 16), lid = Math.max(0.1, 1 - p.blink * 0.92)
    for (const s of [-1, 1]) {
      const o = sub([s * e.x, e.y, e.z], hp)
      if (p.blink > 0.85) add(hn, [o[0], o[1] - 0.2, o[2] + 0.5], [e.r * 1.15, 0.35, 0.7], 0x2a1608, { solid: true })
      else {
        add(hn, o, [e.r * p.wide, e.r * 1.15 * lid * p.wide, Math.max(0.8, e.r * 0.6)], iris, { glyph: 'O' })
        add(hn, [o[0] + p.lookX * 0.9, o[1] + p.lookY * 0.8, o[2] + 0.8], [e.r * 0.36, e.r * 0.9 * lid * p.wide, 0.5], 0x10140a, { solid: true })
      }
    }
  }
  if (m.mouth && p.mouth > 0.05) { const o = sub(m.mouth, hp); add(hn, o, [2.4, 0.3 + p.mouth * 1.8, 1.2], 0x4a1020, { solid: true }) }
  // medidas de la cabeza para los accesorios: coronilla y radio relativos a su pivote, y posicion del ojo
  const hparts = m.parts.filter(q => q.g === 'head')
  const top = hparts.length ? Math.max(...hparts.map(q => q.c[1] + q.r[1])) - hp[1] : 7
  const w = hparts.length ? Math.max(...hparts.map(q => Math.abs(q.c[0]) + q.r[0])) : 7
  customDims = [top, w, m.eyes?.x ?? 3, (m.eyes?.y ?? hp[1] + 1) - hp[1], (m.eyes?.z ?? hp[2] + 6) - hp[2]]
  curHead = hn
  return { prims, head: groundPrims(prims, p.bob, at(hn, [0, 0, 0])) }
}

// Recolor: el color elegido de la mascota reemplaza el del material principal de la especie conservando luces, rayas y manchas.
const BASE: Record<string, number> = { cat: ORANGE, dog: 0xc88a4a, fox: 0xe2661c, bunny: 0xe3dfee, dragon: 0x4caf50, owl: 0x8a6a46, robot: 0xaab4c4, monster: 0x8d52d8, ghost: 0xe6e8ff }
const lum = (c: number) => 0.3 * ((c >> 16) & 255) + 0.59 * ((c >> 8) & 255) + 0.11 * (c & 255)
function recolor(prims: Prim[], base: number, tint: number) {
  const bl = Math.max(30, lum(base))
  for (const q of prims) {
    if (q.solid || q.glyph) continue
    const f = q.color
    q.color = typeof f === 'function' ? (v: V3) => shade(tint, lum(f(v)) / bl) : shade(tint, lum(f) / bl)
  }
}

const BIPED = new Set(['robot', 'monster', 'owl']), FLOAT = new Set(['ghost'])
// Tipo de cuerpo de una especie o de un modelo de la IA: con brazos y piernas (humanoide), con 4 patas, o sin patas (flota).
function kindOf(pet: string, st?: ModelStyle): Kind {
  if (st?.model) {
    if (st.model.mesh) return 'biped'
    const gs = new Set(st.model.parts.map(q => q.g))
    if (['legFL', 'legFR', 'legBL', 'legBR'].some(g => gs.has(g))) return 'quad'
    if (['legL', 'legR', 'armL', 'armR'].some(g => gs.has(g))) return 'biped'
    return 'float'
  }
  const rp = resolvePet(pet)
  return BIPED.has(rp) ? 'biped' : FLOAT.has(rp) ? 'float' : 'quad'
}

export type ModelStyle = { color?: string; accessory?: string; model?: Model3D }
function buildStyled(pet: string, p: Pose, T: number, st?: ModelStyle): Built {
  if (st?.model) {
    const b = buildCustom(st.model, p, T)
    if (st.accessory) b.prims.push(...accessoryPrims(st.accessory, '#custom'))
    return b
  }
  const rp = resolvePet(pet)
  const b = buildFor(rp, p, T)
  const tint = st?.color && /^#[0-9a-f]{6}$/i.test(st.color) ? parseInt(st.color.slice(1), 16) : undefined
  if (tint !== undefined) recolor(b.prims, BASE[rp] ?? ORANGE, tint)
  if (st?.accessory) b.prims.push(...accessoryPrims(st.accessory, rp))
  return b
}

function resolvePet(pet: string): string {
  if (QUADS[pet] || pet === 'owl' || pet === 'robot' || pet === 'monster' || pet === 'ghost') return pet
  let h = 0
  for (const ch of pet) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  const all = [...Object.keys(QUADS), 'owl', 'robot', 'monster', 'ghost']
  return all[h % all.length]!
}

function buildFor(pet: string, p: Pose, T: number): Built {
  if (QUADS[pet]) return buildQuad(QUADS[pet]!, p, T)
  if (pet === 'owl') return buildOwl(p, T)
  if (pet === 'robot') return buildRobot(p, T)
  if (pet === 'monster') return buildMonster(p, T)
  if (pet === 'ghost') return buildGhost(p, T)
  return buildFor(resolvePet(pet), p, T)
}
// Tamano del lienzo para `rows` filas disponibles (la escala la fija el alto).
export function modelSize(rows: number): { columns: number; rows: number } {
  const r = Math.max(10, Math.min(40, rows))
  return { columns: Math.round(r * 2.7), rows: r }
}

// Cuadros ya calculados por zona: varios repintados en el mismo tick (por otros cambios de estado) no recalculan, y si el equipo anda justo de
// tiempo (promedio > 28 ms por cuadro) se calcula un cuadro de cada dos y se repite el anterior: la animacion nunca se arrastra.
const memo = new Map<string, { tick: number; key: string; out: Cells }>()
let avgMs = 4
// px: 0 = letras de color, 1 = pixel art grueso (1 pixel por celda), 2 = pixel art fino (medios bloques: 2 pixeles por celda en vertical).
export function modelCells(pet: string, mood: Mood, tick: number, maxRows: number, slot = 'main', px: 0 | 1 | 2 = 0, face = false, st?: ModelStyle): Cells {
  const key = `${pet}|${mood}|${maxRows}|${px}|${face}|${st?.color ?? ''}|${st?.accessory ?? ''}|${st?.model ? modelId(st.model) : 0}`
  const prev = memo.get(slot)
  if (prev && prev.key === key && (prev.tick === tick || (avgMs > 28 && tick % 2 === 1 && tick - prev.tick === 1))) return prev.out
  const t0 = Date.now()
  const out = renderModel(pet, mood, tick, maxRows, slot, px, face, st)
  avgMs = avgMs * 0.9 + (Date.now() - t0) * 0.1
  memo.set(slot, { tick, key, out })
  return out
}

// readable() es lo mas caro por celda; los colores sombreados se repiten mucho, asi que se guardan (se vacia al llenarse).
const rdCache = new Map<number, number>()
const readableC = (c: number): number => {
  let v = rdCache.get(c)
  if (v === undefined) { if (rdCache.size > 6000) rdCache.clear(); v = readable(c); rdCache.set(c, v) }
  return v
}

// Altura (en filas de 2 unidades) de la pose mas alta de cada especie, medida una vez sobre todos los animos y un tramo del reposo.
const heights = new Map<string, number>()
function petHeight(pet: string, st?: ModelStyle): number {
  const hk = st?.model ? `m${modelId(st.model)}` : pet
  let h = heights.get(hk)
  if (h !== undefined) return h
  let top = 0
  for (const m of ['think', 'read', 'write', 'run', 'wait', 'error', 'sleep', 'happy'] as Mood[]) for (let t = 0; t < 420; t += 9) {
    const { prims, mesh } = st?.model ? buildCustom(st.model, catPose(m, t, kindOf(pet, st)).pose, t) : buildFor(pet, catPose(m, t, kindOf(pet, st)).pose, t)
    if (mesh) for (let i = 0; i < mesh.y.length; i++) top = Math.max(top, mesh.y[i]!)
    for (const q of prims) top = Math.max(top, q.c[1] + Math.max(q.r[0], q.r[1], q.r[2]) * (q.noGround ? 0.6 : 1))
  }
  h = Math.max(20, Math.ceil(top / 2) + 2)
  heights.set(hk, h)
  return h
}

// Paleta corta: cada canal a 16 niveles, como un sprite de consola.
const q5 = (c: number) => { const f = (v: number) => Math.round(Math.min(255, v) / 17) * 17; return (f((c >> 16) & 255) << 16) | (f((c >> 8) & 255) << 8) | f(c & 255) }

function renderModel(pet: string, mood: Mood, tick: number, maxRows: number, slot: string, px: 0 | 1 | 2, face: boolean, st?: ModelStyle): Cells {
  // face: solo la cara (tarjetas de subagentes), encuadrada sobre la cabeza
  const { columns: W, rows: H } = face ? { columns: Math.round(maxRows * 3.2), rows: maxRows } : modelSize(maxRows)
  const fino = px === 2
  const GH = fino ? H * 2 : H                         // filas de la rejilla de muestreo
  let k = face ? (H * 2) / 19 : H / (petHeight(pet, st) + (st?.accessory && st.accessory !== 'ninguno' ? 2 : 0))                        // escala fija por especie: la pose mas alta cabe entera y el modelo no "respira" de tamano
  const pose = smoothPose(slot, mood, tick, kindOf(pet, st))
  const { prims, head, mesh } = buildStyled(pet, pose, tick, st)
  const Y0 = H - 1.5
  if (face && st?.model && customDims) k = (H * 2) / Math.max(10, customDims[1] * 2.7)   // la cabeza de un modelo propio puede ser de cualquier tamano
  if (face) { for (const q of prims) q.c[0] -= head[0]; if (mesh) for (let i = 0; i < mesh.x.length; i++) mesh.x[i] = mesh.x[i]! - head[0] }
  const vk = fino ? k : k / 2, Y0g = face ? GH / 2 + (head[1] + (st?.model && customDims ? customDims[0] * 0.45 : 3)) * vk : fino ? 2 * Y0 : Y0   // pixeles por unidad en vertical y fila del suelo en la rejilla de muestreo
  const chars = new Array<string>(W * H).fill(' ')
  const fg = new Array<number>(W * H).fill(0)
  const bg = new Array<number>(W * H).fill(0x01000000)
  // sombra en el suelo
  if (!face) for (let Y = 0; Y < H; Y++) for (let X = 0; X < W; X++) {
    const dx = (X + 0.5 - W / 2) / (17 * k), dy = (Y + 0.5 - (Y0 + 0.5)) / 0.9
    if (dx * dx + dy * dy <= 1) bg[Y * W + X] = 0x1c1c33
  }
  // suelo que corre al caminar o correr (sensacion de avance con el gato en su sitio)
  if (!face && pose.ground > 0) for (let X = 0; X < W; X++) if ((X + Math.floor(tick * pose.ground * k)) % 6 === 0) { chars[(H - 1) * W + X] = '.'; fg[(H - 1) * W + X] = readableC(0x6a6a96) }
  // luz desde arriba a la izquierda y al frente (el espectador esta en -z)
  const Lv: V3 = [-0.45, 0.6, -0.65], Ln = Math.hypot(...Lv)
  const inv = prims.map(p => {
    // A = diag(1/r) * R^T
    const A: M3 = [p.R[0]! / p.r[0], p.R[3]! / p.r[0], p.R[6]! / p.r[0], p.R[1]! / p.r[1], p.R[4]! / p.r[1], p.R[7]! / p.r[1], p.R[2]! / p.r[2], p.R[5]! / p.r[2], p.R[8]! / p.r[2]]
    return { p, A, rad: Math.max(...p.r) * 1.05 }
  })
  // Por pieza (no por celda): cada elipsoide solo recorre las celdas de su caja en pantalla y deja el impacto mas cercano en un z-buffer.
  const bestT = new Float64Array(W * GH).fill(1e9)
  const hits = new Array<{ p: Prim; ox: number; oy: number; oz: number; t: number; mI?: number; mCol?: number } | undefined>(W * GH)
  if (mesh) {
    // Malla: triangulos proyectados (ortografico) con z-buffer compartido; sombreado plano por triangulo, a dos caras.
    const meshP = MESH_G.map(() => ({ c: [0, 0, 0] as V3, R: I3, r: [1, 1, 1] as V3, color: 0 }))
    const nv = mesh.x.length, sx = new Float32Array(nv), sy = new Float32Array(nv)
    for (let i = 0; i < nv; i++) { sx[i] = W / 2 + mesh.x[i]! * k; sy[i] = Y0g - mesh.y[i]! * vk }
    for (let f = 0; f < mesh.tri.length; f += 3) {
      const a = mesh.tri[f]!, b = mesh.tri[f + 1]!, c = mesh.tri[f + 2]!
      const ax = sx[a]!, ay = sy[a]!, bx = sx[b]!, by = sy[b]!, cx = sx[c]!, cy = sy[c]!
      const area = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay)
      if (Math.abs(area) < 1e-4) continue
      const ux = mesh.x[b]! - mesh.x[a]!, uy = mesh.y[b]! - mesh.y[a]!, uz = mesh.z[b]! - mesh.z[a]!
      const vx = mesh.x[c]! - mesh.x[a]!, vy = mesh.y[c]! - mesh.y[a]!, vz = mesh.z[c]! - mesh.z[a]!
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx
      if (nz > 0) { nx = -nx; ny = -ny; nz = -nz }
      const nn = Math.hypot(nx, ny, nz) || 1
      const I = 0.3 + 0.7 * Math.max(0, (nx * Lv[0] + ny * Lv[1] + nz * Lv[2]) / (nn * Ln))
      const g = mesh.g[a]!
      const x0 = Math.max(0, Math.floor(Math.min(ax, bx, cx) - 0.5)), x1 = Math.min(W - 1, Math.ceil(Math.max(ax, bx, cx) - 0.5))
      const y0 = Math.max(0, Math.floor(Math.min(ay, by, cy) - 0.5)), y1 = Math.min(GH - 1, Math.ceil(Math.max(ay, by, cy) - 0.5))
      const za = mesh.z[a]!, zb = mesh.z[b]!, zc = mesh.z[c]!
      for (let Y = y0; Y <= y1; Y++) for (let X = x0; X <= x1; X++) {
        const pxc = X + 0.5, pyc = Y + 0.5
        const w1 = ((pxc - ax) * (cy - ay) - (cx - ax) * (pyc - ay)) / area, w2 = ((bx - ax) * (pyc - ay) - (pxc - ax) * (by - ay)) / area, w0 = 1 - w1 - w2
        if (w0 < -0.02 || w1 < -0.02 || w2 < -0.02) continue
        const t = w0 * za + w1 * zb + w2 * zc, i = Y * W + X
        if (t < bestT[i]!) { bestT[i] = t; hits[i] = { p: meshP[g]!, ox: 0, oy: 0, oz: 0, t, mI: I, mCol: mesh.color } }
      }
    }
  }
  for (const { p, A, rad } of inv) {
    const x0 = Math.max(0, Math.floor(W / 2 + (p.c[0] - rad) * k - 0.5) ), x1 = Math.min(W - 1, Math.ceil(W / 2 + (p.c[0] + rad) * k - 0.5))
    const y0 = Math.max(0, Math.floor(Y0g - 0.5 - (p.c[1] + rad) * vk)), y1 = Math.min(GH - 1, Math.ceil(Y0g - 0.5 - (p.c[1] - rad) * vk))
    const oz = -p.c[2], d0 = A[2]!, d1 = A[5]!, d2 = A[8]!, a = d0 * d0 + d1 * d1 + d2 * d2
    for (let Y = y0; Y <= y1; Y++) for (let X = x0; X <= x1; X++) {
      const dx = (X + 0.5 - W / 2) / k - p.c[0], dy = (Y0g - (Y + 0.5)) / vk - p.c[1]
      if (dx * dx + dy * dy > rad * rad) continue
      const o0 = A[0]! * dx + A[1]! * dy + A[2]! * oz, o1 = A[3]! * dx + A[4]! * dy + A[5]! * oz, o2 = A[6]! * dx + A[7]! * dy + A[8]! * oz
      const b = o0 * d0 + o1 * d1 + o2 * d2, c = o0 * o0 + o1 * o1 + o2 * o2 - 1
      const disc = b * b - a * c
      if (disc < 0) continue
      const t = (-b - Math.sqrt(disc)) / a
      const i = Y * W + X
      if (t < bestT[i]!) { bestT[i] = t; hits[i] = { p, ox: dx, oy: dy, oz, t } }
    }
  }
  const px_ = px ? new Array<number | undefined>(W * GH) : undefined   // pixel art: color de cada pixel antes del contorno
  for (let Y = 0; Y < GH; Y++) for (let X = 0; X < W; X++) {
    const hit = hits[Y * W + X]
    if (!hit) continue
    const { p, ox, oy, oz, t } = hit
    let I: number, col: number
    if (hit.mI !== undefined) { I = hit.mI; col = hit.mCol! }
    else {
      // punto de impacto y normal en el espacio local del elipsoide
      const wx = ox, wy = oy, wz = oz + t                                  // punto relativo al centro, en vista
      const loc: V3 = [p.R[0]! * wx + p.R[3]! * wy + p.R[6]! * wz, p.R[1]! * wx + p.R[4]! * wy + p.R[7]! * wz, p.R[2]! * wx + p.R[5]! * wy + p.R[8]! * wz]
      const nl: V3 = [loc[0] / (p.r[0] * p.r[0]), loc[1] / (p.r[1] * p.r[1]), loc[2] / (p.r[2] * p.r[2])]
      const nw = apply(p.R, nl), nn = Math.hypot(...nw) || 1
      const lit = Math.max(0, (nw[0] * Lv[0] + nw[1] * Lv[1] + nw[2] * Lv[2]) / (nn * Ln))
      I = 0.3 + 0.7 * lit
      col = typeof p.color === 'function' ? p.color(loc) : p.color
    }
    const i = Y * W + X
    if (px) {
      // Pixel art con tres tonos por material (luz, base, sombra), como un sprite pintado a mano.
      const f = I > 0.97 ? 1.34 : I > 0.84 ? 1.16 : I > 0.58 ? 1 : I > 0.42 ? 0.8 : 0.64   // brillo, luz, base, sombra y sombra profunda
      px_![i] = p.solid ? shade(col, 0.95) : q5(shade(col, f))
      continue
    }
    if (p.solid) { chars[i] = ' '; bg[i] = shade(col, 0.6 + 0.4 * I); fg[i] = 0; continue }
    // Letras de color sobre el fondo de la terminal (como arte ASCII): el caracter da la luz y el color, el material.
    const v = Math.min(1, Math.max(0.08, I * 0.95 + 0.07 * Math.sin(X * 1.7 + Y * 2.3)))
    chars[i] = p.glyph ?? RAMP[Math.max(1, Math.round(v * (RAMP.length - 1)))]!
    fg[i] = readableC(shade(col, 0.55 + 0.45 * (Math.round(I * 12) / 12)))
    bg[i] = 0x01000000
  }
  if (px_) {
    // Contorno oscuro por dentro de la silueta (y entre piezas separadas en profundidad), del tono de cada material.
    const at_ = (X: number, Y: number) => (X < 0 || Y < 0 || X >= W || Y >= GH ? undefined : hits[Y * W + X])
    const fin = fino ? new Array<number | undefined>(W * GH) : undefined
    for (let Y = 0; Y < GH; Y++) for (let X = 0; X < W; X++) {
      const i = Y * W + X, c = px_[i]
      if (c === undefined) continue
      const h = hits[i]!
      let edge = false
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) {
        const n = at_(X + dx, Y + dy)
        if (!n || (n.p !== h.p && !h.p.solid && !n.p.solid && n.t - h.t > 3.5)) { edge = true; break }
      }
      const col = edge && !h.p.solid ? shade(c, 0.38) : c
      if (fin) fin[i] = col
      else { chars[i] = ' '; bg[i] = col }
    }
    if (fin) {
      // Medios bloques: arriba = color de letra, abajo = color de fondo; donde no hay figura queda el fondo de la zona (sombra o terminal).
      for (let Y = 0; Y < H; Y++) for (let X = 0; X < W; X++) {
        const top = fin[2 * Y * W + X], bot = fin[(2 * Y + 1) * W + X], i = Y * W + X
        if (top === undefined && bot === undefined) continue
        if (top !== undefined && bot !== undefined) { if (top === bot) { chars[i] = ' '; bg[i] = top } else { chars[i] = '▀'; fg[i] = top; bg[i] = bot } }
        else if (top !== undefined) { chars[i] = '▀'; fg[i] = top }
        else { chars[i] = '▄'; fg[i] = bot! }
      }
    }
  }
  // gestos de la accion sobre la cabeza (zzz, ?, !, corazones)
  const hx = Math.round(W / 2 + head[0] * k), hy = Math.round(Y0 - 0.5 - (head[1] * k) / 2)
  const put = (x: number, y: number, ch: string, color: number) => { if (x >= 0 && x < W && y >= 0 && y < H) { chars[y * W + x] = ch; fg[y * W + x] = readableC(color); bg[y * W + x] = 0x01000000 } }
  const gesto: Partial<Record<Mood, [string[], number]>> = {
    sleep: [['z', 'Z', 'Z'], 0x93c5fd], think: [['.', 'o', '?'], 0xc4b5fd], error: [['!', '!', '!'], 0xf87171], happy: [['♥', '♥', '♥'], 0xff7aa8], wait: [['?', '?', '?'], 0xfacc15], write: [['_', '/', '_'], 0xfbbf24], read: [['=', '≡', '='], 0x93c5fd],
  }
  const g = face ? undefined : gesto[mood]
  if (g) {
    const n = mood === 'sleep' || mood === 'think' || mood === 'happy' ? 3 : 1
    for (let j = 0; j < n; j++) {
      const rise = ((tick / 5 + j * 2.2) % 7)
      put(hx + 6 + j * 2 + Math.round(Math.sin(tick / 4 + j) * 1), hy - 4 - Math.round(rise), g[0][(j + (mood === 'sleep' ? 0 : Math.floor(tick / 6))) % g[0].length]!, g[1])
    }
  }
  const words: number[] = []
  for (let i = 0; i < W * H; i++) words.push(chars[i]!.codePointAt(0)!, fg[i]!, bg[i]!)
  return { columns: W, rows: H, cells: (new Uint8Array(Uint32Array.from(words).buffer) as unknown as { toBase64: () => string }).toBase64() }
}

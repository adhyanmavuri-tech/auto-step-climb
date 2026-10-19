import type { AircraftProfile, ActionValue, ProfileAction } from './profile.ts'
import type { SimCommand } from './types.ts'

/** One thing to send to the sim, `delayMs` after the command was issued. */
export type Primitive =
  | { kind: 'input'; name: string; value: number; delayMs: number }
  | { kind: 'key'; name: string; data: number; delayMs: number }

const PULSE_MS = 200
/** Spacing between the actions of one list, so a multi-step engage doesn't land in one frame. */
const ACTION_GAP_MS = 250

const resolve = (v: ActionValue | undefined, altitudeFt: number): number => (v === 'altitudeFt' ? altitudeFt : (v ?? 0))

function expand(action: ProfileAction, altitudeFt: number, offsetMs: number): Primitive[] {
  if ('inputEvent' in action) {
    const out: Primitive[] = [{ kind: 'input', name: action.inputEvent, value: resolve(action.value, altitudeFt), delayMs: offsetMs }]
    if (action.releaseValue !== undefined) {
      out.push({ kind: 'input', name: action.inputEvent, value: action.releaseValue, delayMs: offsetMs + (action.pulseMs ?? PULSE_MS) })
    }
    return out
  }
  return [{ kind: 'key', name: action.keyEvent, data: resolve(action.data, altitudeFt), delayMs: offsetMs }]
}

/**
 * Turns an engine command into the exact sends for this aircraft. Pure, so what a profile does can
 * be checked without a simulator. A command the profile can't do (a knob click on a direct-style
 * aircraft, say) yields nothing.
 */
export function planCommand(profile: AircraftProfile, cmd: SimCommand): Primitive[] {
  switch (cmd.type) {
    case 'fcu-click':
      if (!profile.knob) return []
      return [
        {
          kind: 'input',
          name: profile.knob.inputEvent,
          value: cmd.dir > 0 ? profile.knob.upValue : profile.knob.downValue,
          delayMs: 0
        }
      ]
    case 'set-altitude':
      return profile.setAltitude ? expand(profile.setAltitude, cmd.ft, 0) : []
    case 'engage':
      return profile.engage[cmd.mode].flatMap((action, i) => expand(action, 0, i * ACTION_GAP_MS))
  }
}

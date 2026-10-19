/**
 * Best-effort draft of a knob-style profile from the input events an aircraft offers. It finds the
 * ALT push/pull pair and the rotary that goes with them. Everything it writes is a guess: the values
 * and the SimVars must be confirmed with `npm run listen` and the dashboard's Control test.
 */
export interface DraftResult {
  profile: Record<string, unknown> | null
  notes: string[]
}

/** "A330-300 (RR)" -> "A330"; falls back to the first word. */
export function guessTitlePattern(title: string): string {
  const model = /[A-Z]{1,3}\d{2,4}[A-Z]{0,2}/i.exec(title)
  const word = /[A-Za-z0-9]{3,}/.exec(title)
  return model?.[0] ?? word?.[0] ?? title
}

export function draftKnobProfile(title: string, eventNames: string[]): DraftResult {
  const notes: string[] = []
  const names = new Set(eventNames)
  const pushes = eventNames.filter((n) => /ALT.*PUSH$/i.test(n))

  const trios: { knob: string; push: string; pull: string }[] = []
  for (const push of pushes) {
    const base = push.replace(/_?PUSH$/i, '')
    const sep = push.slice(base.length).startsWith('_') ? '_' : ''
    const pullCandidates = [`${base}${sep}PULL`, `${base}${sep}Pull`, `${base}${sep}pull`]
    const pull = pullCandidates.find((c) => names.has(c))
    const knob = [base, `${base}_KNOB`, `${base}_SET`].find((c) => names.has(c))
    if (pull && knob) trios.push({ knob, push, pull })
  }

  if (trios.length === 0) {
    notes.push('No knob-style ALT events (rotary + push + pull) were found. This aircraft probably uses key events, LVars or H-events. See "Adding an aircraft" in the README for a direct-style profile.')
    return { profile: null, notes }
  }
  const pick = trios.find((t) => /MCU|FCU/i.test(t.knob)) ?? trios[0]!
  if (trios.length > 1) notes.push(`Several candidates were found (${trios.map((t) => t.knob).join(', ')}); using ${pick.knob}. Check it.`)
  notes.push('The knob values, the SimVars and the press values are guesses. Run `npm run listen` and operate the FCU to confirm them, then press Control test.')

  return {
    profile: {
      name: `${title} (draft)`,
      titlePattern: guessTitlePattern(title),
      verified: false,
      control: 'knob',
      simVars: { fcuSelectedFt: 'AUTOPILOT ALTITUDE LOCK VAR', apTargetFt: 'AUTOPILOT ALTITUDE LOCK VAR' },
      knob: { inputEvent: pick.knob, upValue: 1, downValue: -1 },
      engage: {
        managed: [{ inputEvent: pick.push, value: 1, releaseValue: 0, pulseMs: 200 }],
        open: [{ inputEvent: pick.pull, value: 1, releaseValue: 0, pulseMs: 200 }]
      }
    },
    notes
  }
}

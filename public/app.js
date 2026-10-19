const $ = (id) => document.getElementById(id)

// [label, tone]. The tone drives the colour of the status card: idle grey, info cyan, caution and
// action amber (action pulses), active green.
const PHASES = {
  idle: ['Idle', 'idle'],
  waiting: ['Waiting', 'info'],
  armed: ['Step ahead', 'caution'],
  confirming: ['Confirm', 'action'],
  'asking-atc': ['Asking ATC', 'info'],
  'setting-fcu': ['Setting FCU', 'active'],
  engaging: ['Engaging', 'active'],
  climbing: ['Climbing', 'active'],
  descending: ['Descending', 'active'],
  restoring: ['Restoring FCU', 'caution']
}

const MODE_LABEL = { 'dry-run': 'Watching only', live: 'Live', demo: 'Demo', preview: 'Preview' }

const STATUS = {
  pending: 'Pending',
  active: 'In progress',
  done: 'Done',
  failed: 'Failed',
  skipped: 'Skipped',
  'dry-run': 'Would have climbed'
}

const fmt = (n, digits = 0) =>
  typeof n === 'number' && Number.isFinite(n) ? n.toLocaleString('en-US', { maximumFractionDigits: digits }) : '-'
const fl = (ft) => (typeof ft === 'number' && ft > 0 ? `FL${Math.round(ft / 100)}` : '-')
const stepName = (label) => label.replace(/\s+(?:to\s+)?FL\d+$/i, '')
const fmtDuration = (min) => {
  if (!Number.isFinite(min) || min < 0) return ''
  if (min < 1) return 'a minute'
  if (min < 90) return `${Math.round(min)} min`
  const h = Math.floor(min / 60)
  const m = Math.round(min - h * 60)
  return m === 0 ? `${h} h` : `${h} h ${m} min`
}
const setText = (el, text) => {
  if (el.textContent !== text) el.textContent = text
}

// In the Windows app a preload script gives the page `window.autostep`, and the page talks to the app through it.
// Opened in a browser (the command-line version), there is none, and the page talks to the local server instead.
const bridge = window.autostep ?? null

async function post(action, body = {}) {
  if (bridge) return bridge.act(action, body)
  const res = await fetch(`/api/${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Autostep': '1' },
    body: JSON.stringify(body)
  })
  const data = await res.json()
  if (!data.ok) throw new Error(data.error)
  return data.result
}

function say(text, bad = false) {
  const out = $('result')
  out.className = bad ? 'result bad' : 'result'
  out.textContent = text
}

/** Presses a button: shows what came back (or what went wrong), and says whether it worked. */
async function act(action, body) {
  try {
    const result = await post(action, body)
    say(typeof result === 'string' ? result : '')
    return true
  } catch (err) {
    say(`Error: ${err.message}`, true)
    return false
  }
}

// A themed replacement for window.confirm. Resolves true only for the OK button; Escape and Cancel
// both resolve false, and Cancel has the initial focus.
function ask(title, text, okLabel) {
  return new Promise((resolve) => {
    const dlg = $('ask')
    const ok = $('askOk')
    const cancel = $('askCancel')
    $('askTitle').textContent = title
    $('askText').textContent = text
    ok.textContent = okLabel
    dlg.returnValue = ''
    // It answers on the click itself: a dialog's close event only arrives on the browser's next
    // animation frame, so a page that is not drawing would leave the question hanging.
    const finish = (value) => {
      ok.removeEventListener('click', onOk)
      cancel.removeEventListener('click', onNo)
      dlg.removeEventListener('cancel', onNo)
      dlg.removeEventListener('close', onClose)
      resolve(value)
    }
    const onOk = () => finish(true)
    const onNo = () => finish(false)
    const onClose = () => finish(dlg.returnValue === 'ok')
    ok.addEventListener('click', onOk)
    cancel.addEventListener('click', onNo)
    dlg.addEventListener('cancel', onNo)
    dlg.addEventListener('close', onClose)
    dlg.showModal()
  })
}

$('enabled').addEventListener('change', (e) => act('enable', { enabled: e.target.checked }))
$('stepDowns').addEventListener('change', (e) => act('step-downs', { enabled: e.target.checked }))
$('atcFirst').addEventListener('change', (e) => act('atc-first', { enabled: e.target.checked }))
$('atcOther').addEventListener('change', (e) => act('atc-other-aircraft', { enabled: e.target.checked }))
$('atcClimbAnyway').addEventListener('change', async (e) => {
  const box = e.target
  if (!box.checked) {
    act('atc-climb-anyway', { enabled: false })
    return
  }
  box.checked = false // it turns on when the app says so, not before
  const ok = await ask(
    'Climb without a clearance?',
    "When BeyondATC is not running, does not answer, or refuses a step twice, the app will fly that step anyway instead of skipping it. That suits a flight on your own, overnight. On VATSIM or IVAO a climb you were not cleared for can upset the controller, so leave it off there. You can turn it off at any time.",
    'Climb anyway'
  )
  if (ok) act('atc-climb-anyway', { enabled: true })
})

// ---- settings (the Windows app) ----------------------------------------------------------------

let simbriefDirty = false
$('simbriefName').addEventListener('input', () => {
  simbriefDirty = true
})
async function saveSimbrief() {
  const ok = await act('set-simbrief', { username: $('simbriefName').value })
  if (ok) simbriefDirty = false
}
$('saveSimbrief').addEventListener('click', saveSimbrief)
$('simbriefName').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') saveSimbrief()
})
$('liveSwitch').addEventListener('change', async (e) => {
  const box = e.target
  if (!box.checked) {
    act('set-live', { enabled: false })
    return
  }
  box.checked = false // it turns on when the app says so, not before
  const ok = await ask(
    'Turn on live control?',
    "The app will operate the A330's FCU by itself: it turns the altitude knob and pushes or pulls it at each step point, with nobody pressing anything. You can turn it off again at any time. On VATSIM or IVAO, get your step clearance first.",
    'Turn on live control'
  )
  if (ok) act('set-live', { enabled: true })
})
$('confirmEach').addEventListener('change', (e) => act('set-confirm-each', { enabled: e.target.checked }))
$('windowAtAirport').addEventListener('change', (e) => act('set-window-at-airport', { enabled: e.target.checked }))
$('startWithWindows').addEventListener('change', (e) => act('set-login-item', { enabled: e.target.checked }))
$('openLogs').addEventListener('click', () => act('open-logs'))
$('openConfig').addEventListener('click', () => act('open-config'))
$('copyReport').addEventListener('click', () => act('copy-report'))
$('reportProblem').addEventListener('click', () => act('open-issues'))
$('openSettings').addEventListener('click', () => {
  const card = $('settingsCard')
  card.open = true
  card.scrollIntoView({ block: 'start' })
  $('simbriefName').focus()
})
$('confirm').addEventListener('click', () => act('confirm'))
$('stepNow').addEventListener('click', async () => {
  if (await ask('Step now?', 'Start the next step climb now, ahead of its step point?', 'Step now')) act('step-now')
})
$('quit').addEventListener('click', async () => {
  const ok = await ask(
    'Quit Auto Step Climb?',
    'It stops watching for step points until you start it again. It does not touch the aircraft.',
    'Quit'
  )
  if (ok) act('quit')
})
$('skip').addEventListener('click', () => act('skip'))
$('abort').addEventListener('click', () => act('abort'))
$('reload').addEventListener('click', () => act('reload-plan'))
$('controlTest').addEventListener('click', async () => {
  const ok = await ask(
    'Run the control test?',
    'This changes the FCU altitude by one small step and back in the sim. It does not change the autopilot mode.',
    'Run test'
  )
  if (ok) act('control-test')
})

// The look: "classic" (plain, the default) or "cockpit" (black glass). skin.js sets it before the page draws.
const skinButton = $('skinToggle')
const currentSkin = () => (document.documentElement.getAttribute('data-skin') === 'cockpit' ? 'cockpit' : 'classic')
const showSkin = () => {
  skinButton.textContent = currentSkin() === 'cockpit' ? 'Classic look' : 'Cockpit look'
}
skinButton.addEventListener('click', () => {
  const next = currentSkin() === 'cockpit' ? 'classic' : 'cockpit'
  document.documentElement.setAttribute('data-skin', next)
  try {
    localStorage.setItem('autostep-skin', next)
  } catch {
    // not saved; it still applies until the page is reloaded
  }
  showSkin()
})
showSkin()

// The step box is only overwritten from the server while you are not editing it.
const stepsInput = $('stepsInput')
let stepsDirty = false
stepsInput.addEventListener('input', () => {
  stepsDirty = true
})
async function stepsAction(action, body) {
  const box = $('stepErrors')
  try {
    say(await post(action, body))
    stepsDirty = false
    box.hidden = true
  } catch (err) {
    box.hidden = false
    box.textContent = err.message
  }
}
$('applySteps').addEventListener('click', () => stepsAction('set-steps', { text: stepsInput.value }))
$('resetSteps').addEventListener('click', () => stepsAction('reset-steps'))

// ---- aircraft tiles (built once, updated in place) ---------------------------------------------

const TILES = [
  { label: 'Altitude', unit: 'ft', get: (a) => fmt(a.altFt) },
  { label: 'Vertical speed', unit: 'fpm', get: (a) => fmt(a.vsFpm) },
  { label: 'Mach', unit: '', get: (a) => fmt(a.mach, 3) },
  { label: 'Ground speed', unit: 'kt', get: (a) => fmt(a.gsKt) },
  { label: 'Weight', unit: 't', get: (a) => fmt(a.weightKg / 1000, 1) },
  { label: 'FCU selected', unit: '', tone: 'cyan', get: (a) => fl(a.fcuSelectedFt) },
  { label: 'AP target', unit: '', get: (a) => fl(a.apTargetFt) },
  { label: 'Status', unit: '', get: (a) => (a.onGround ? 'On ground' : 'Airborne') }
]

const tileCells = TILES.map((t) => {
  const div = document.createElement('div')
  div.className = `tile dim${t.tone ? ` ${t.tone}` : ''}`
  const dt = document.createElement('dt')
  dt.textContent = t.label
  const dd = document.createElement('dd')
  const value = document.createElement('span')
  value.textContent = '-'
  dd.append(value)
  if (t.unit) {
    const unit = document.createElement('small')
    unit.textContent = t.unit
    dd.append(unit)
  }
  div.append(dt, dd)
  $('aircraft').append(div)
  return { div, value }
})

// ---- the step profile (a staircase of the planned cruise levels) -------------------------------

const SVG_NS = 'http://www.w3.org/2000/svg'
function svg(name, attrs = {}, text) {
  const el = document.createElementNS(SVG_NS, name)
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v))
  if (text !== undefined) el.textContent = text
  return el
}

// structSig and planeSig say what the drawing was last built from, so only what changed is drawn
// again: the whole chart when the plan or a status changes, just the aircraft while it climbs.
// marks holds what the tooltips show; hover is the mark whose tooltip is open.
const profile = { structSig: '', planeSig: '', width: 0, hover: null, marks: [] }

/** What the chart needs to be true to distance: the route's span, and how far along it the aircraft is. */
const geoOf = (e) => ({ route: e.route ?? null, along: Number.isFinite(e.alongNm) ? e.alongNm : null })

/**
 * Where everything goes for this many steps in this much width. When the plan has a route, every step has its
 * place on it (geo), so the steps sit where they really are, in NM from the top of climb to the top of descent,
 * and the aircraft can sit where it really is. Steps that are too close to tell apart are spread a little.
 * Without a route (steps counted in distance flown) the steps are spaced evenly.
 */
function layoutProfile(steps, width, geo) {
  const n = steps.length
  const levels = [steps[0].step.fromAltFt, ...steps.map((x) => x.step.toAltFt)]
  const left = 56
  const right = 20
  const evenW = (width - left - right) / (n + 1)
  // Half the width of a riser. To scale a step takes only a few miles, so its riser is steep and narrow.
  const steepR = 7
  const evenR = Math.min(18, evenW * 0.18)

  const route = geo ? geo.route : null
  const known =
    route !== null &&
    route.toNm > route.fromNm &&
    steps.every((x, i) => Number.isFinite(x.atNm) && (i === 0 || x.atNm > steps[i - 1].atNm))
  let xs = null
  let toX = null
  let nudged = false
  if (known) {
    const x0 = left
    const x1 = width - right
    const scale = (x1 - x0) / (route.toNm - route.fromNm)
    const clampNm = (nm) => Math.min(route.toNm, Math.max(route.fromNm, nm))
    const gap = Math.max(2 * steepR + 12, 40)
    const lo = x0 + steepR + 8
    const hi = x1 - steepR - 8
    xs = steps.map((x) => Math.min(hi, Math.max(lo, x0 + (clampNm(x.atNm) - route.fromNm) * scale)))
    for (let i = 1; i < n; i++) {
      if (xs[i] < xs[i - 1] + gap) {
        xs[i] = xs[i - 1] + gap
        nudged = true
      }
    }
    xs[n - 1] = Math.min(xs[n - 1], hi)
    for (let i = n - 2; i >= 0; i--) {
      if (xs[i] > xs[i + 1] - gap) {
        xs[i] = xs[i + 1] - gap
        nudged = true
      }
    }
    if (xs[0] < lo - 0.5) {
      xs = null // no room to keep them apart: even spacing
    } else {
      // NM along the route to a place on the chart, straight between the steps either side of it
      const pts = [{ nm: route.fromNm, x: x0 }, ...steps.map((x, i) => ({ nm: clampNm(x.atNm), x: xs[i] })), { nm: route.toNm, x: x1 }]
      toX = (nm) => {
        if (nm <= pts[0].nm) return pts[0].x
        for (let j = 0; j + 1 < pts.length; j++) {
          const p = pts[j]
          const q = pts[j + 1]
          if (nm <= q.nm) return q.nm > p.nm ? p.x + ((nm - p.nm) / (q.nm - p.nm)) * (q.x - p.x) : q.x
        }
        return pts[pts.length - 1].x
      }
    }
  }
  const toScale = xs !== null
  const r = toScale ? steepR : evenR
  const gaps = toScale ? xs.slice(1).map((x, i) => x - xs[i]) : []
  const segW = toScale && gaps.length ? Math.min(...gaps) : evenW
  const stagger = segW < 64
  const ruler = toScale ? 16 : 0 // room for the NM scale under the step names
  const m = { l: left, r: right, t: 20, b: (stagger ? 58 : 40) + ruler }
  const height = (width < 520 ? 168 : 196) + (stagger ? 18 : 0) + ruler
  const base = height - m.b
  const lo = Math.min(...levels)
  const hi = Math.max(...levels)
  const pad = Math.max(1200, (hi - lo) * 0.35)
  const y = (ft) => m.t + ((hi + pad - ft) / (hi - lo + 2 * pad)) * (base - m.t)
  const xi = toScale ? (i) => xs[i - 1] : (i) => m.l + evenW * i // centre of riser i (1..n)
  const plateau = (k) => [k === 0 ? m.l : xi(k) + r, k === n ? width - m.r : xi(k + 1) - r]
  return { n, levels, stagger, m, width, height, base, y, r, xi, plateau, toScale, nudged, toX, route }
}

/** The tooltip: the value leads, the label follows. Everything goes in with textContent. */
function showTip(key) {
  const mark = profile.marks.find((x) => x.key === key)
  const box = $('profileTip')
  if (!mark) {
    hideTip()
    return
  }
  box.replaceChildren()
  const head = document.createElement('strong')
  head.textContent = mark.title
  box.append(head)
  for (const line of mark.lines) {
    const row = document.createElement('span')
    row.textContent = line
    box.append(row)
  }
  box.hidden = false
  profile.hover = key
  const wrapBox = $('profileWrap').getBoundingClientRect()
  const chartBox = $('profile-chart').getBoundingClientRect()
  const scale = profile.width > 0 ? chartBox.width / profile.width : 1
  const cx = chartBox.left - wrapBox.left + mark.x * scale
  const cy = chartBox.top - wrapBox.top + mark.y * scale
  const w = box.offsetWidth
  const h = box.offsetHeight
  box.style.left = `${Math.max(4, Math.min(cx - w / 2, wrapBox.width - w - 4))}px`
  box.style.top = `${cy - h - 14 < 4 ? cy + 16 : cy - h - 14}px`
}

function hideTip() {
  $('profileTip').hidden = true
  profile.hover = null
}

$('profileWrap').addEventListener('pointermove', (e) => {
  if (!(e.target instanceof Element) || !e.target.closest('.pmark')) hideTip()
})
$('profileWrap').addEventListener('pointerleave', hideTip)

/** A mark you can hover or tab to. Its hit area is bigger than the dot, and focus shows what hover shows. */
function addMark(root, key, x, y, label, shape) {
  const g = svg('g', { class: 'pmark', tabindex: 0, role: 'img', 'aria-label': label })
  g.append(svg('circle', { class: 'hit', cx: x, cy: y, r: 14 }), svg('circle', { class: 'ring', cx: x, cy: y, r: 9 }), ...shape)
  g.addEventListener('pointerenter', () => showTip(key))
  g.addEventListener('focus', () => showTip(key))
  g.addEventListener('blur', hideTip)
  root.append(g)
}

const KEY_ORDER = ['done', 'active', 'pending', 'skipped', 'failed', 'dry-run']

/** The key under the chart: one line sample for each state that is on it, and the aircraft. */
function drawKey(states, airborne, noteText) {
  const key = $('profileKey')
  key.replaceChildren()
  const item = (icon, text) => {
    const span = document.createElement('span')
    span.className = 'key-item'
    const label = document.createElement('span')
    label.textContent = text
    span.append(icon, label)
    key.append(span)
  }
  for (const state of KEY_ORDER) {
    if (!states.has(state)) continue
    const icon = svg('svg', { class: 'key-icon', viewBox: '0 0 22 8', width: 22, height: 8, 'aria-hidden': 'true' })
    icon.append(svg('path', { class: `seg ${state}`, d: 'M1 4H21' }))
    item(icon, STATUS[state] ?? state)
  }
  if (airborne) {
    const icon = svg('svg', { class: 'key-icon', viewBox: '0 0 12 12', width: 12, height: 12, 'aria-hidden': 'true' })
    icon.append(svg('circle', { class: 'plane', cx: 6, cy: 6, r: 4.5 }))
    item(icon, 'Aircraft')
  }
  const note = document.createElement('span')
  note.className = 'key-note'
  note.textContent = noteText
  key.append(note)
}

/** Everything but the aircraft: level rules, the line, a mark for each step, and the key. */
function drawStructure(root, L, steps, nextIdx, airborne, a, geo) {
  const { n, levels, m, width, base, y, r, xi, plateau } = L
  for (const lvl of new Set(levels)) {
    root.append(svg('line', { class: 'rule', x1: m.l, x2: width - m.r, y1: y(lvl), y2: y(lvl) }))
    root.append(svg('text', { class: 'ylab', x: m.l - 10, y: y(lvl) + 4, 'text-anchor': 'end' }, fl(lvl)))
  }

  // To scale: a ruler of NM along the route from the departure airport, under the step names.
  if (L.toScale) {
    const span = L.route.toNm - L.route.fromNm
    const every = [50, 100, 200, 250, 500, 1000, 2000].find((s) => span / s <= 6) ?? 2000
    for (let nm = Math.ceil(L.route.fromNm / every) * every; nm <= L.route.toNm; nm += every) {
      const x = L.toX(nm)
      root.append(svg('line', { class: 'guide', x1: x, x2: x, y1: base, y2: base + 4 }))
      root.append(svg('text', { class: 'tlab', x, y: base + (L.stagger ? 50 : 34), 'text-anchor': 'middle' }, fmt(nm)))
    }
  }

  const reachedStart = steps.some((x) => x.status !== 'pending') || (airborne && a.altFt >= levels[0] - 500)
  const shown = new Set()
  for (let k = 0; k <= n; k++) {
    const [x1, x2] = plateau(k)
    const state = k === 0 ? (reachedStart ? 'done' : 'pending') : steps[k - 1].status === 'done' ? 'done' : 'pending'
    shown.add(state)
    root.append(svg('path', { class: `seg ${state}`, d: `M${x1} ${y(levels[k])} H${x2}` }))
    if (k < n) {
      const xr = xi(k + 1)
      shown.add(steps[k].status)
      root.append(
        svg('path', { class: `seg ${steps[k].status}`, d: `M${xr - r} ${y(levels[k])} L${xr + r} ${y(levels[k + 1])}` })
      )
    }
  }

  steps.forEach((x, i) => {
    const xr = xi(i + 1)
    const ym = (y(levels[i]) + y(levels[i + 1])) / 2
    const row = L.stagger && i % 2 === 1 ? 34 : 18
    const name = stepName(x.step.label)
    const from = fl(x.step.fromAltFt)
    const to = fl(x.step.toAltFt)
    const state = STATUS[x.status] ?? x.status
    const lines = [`${name} - ${state}`]
    if (x.note) lines.push(x.note)
    else if (x.status === 'pending' && x.step.toAltFt > x.step.fromAltFt && x.step.plannedWeightKg) {
      lines.push(`OFP weight here: ${fmt(x.step.plannedWeightKg / 1000, 1)} t`)
    }
    if (L.toScale) {
      lines.push(
        geo.along !== null && x.status === 'pending'
          ? `${fmt(Math.max(0, x.atNm - geo.along))} NM ahead, ${fmt(x.atNm)} NM along the route`
          : `${fmt(x.atNm)} NM along the route`
      )
    }
    profile.marks.push({ key: i, x: xr, y: ym, title: `${from} → ${to}`, lines })

    root.append(svg('line', { class: 'guide', x1: xr, x2: xr, y1: ym, y2: base + 4 }))
    // A failed step is a cross, not a dot, so it never relies on red against green.
    const shape =
      x.status === 'failed'
        ? [svg('path', { class: 'x', d: `M${xr - 4} ${ym - 4}L${xr + 4} ${ym + 4}M${xr + 4} ${ym - 4}L${xr - 4} ${ym + 4}` })]
        : [svg('circle', { class: `node ${x.status}`, cx: xr, cy: ym, r: 4.5 })]
    addMark(root, i, xr, ym, `${name}: ${from} to ${to}, ${state}`, shape)
    root.append(svg('text', { class: `xlab${i === nextIdx ? ' next' : ''}`, x: xr, y: base + row, 'text-anchor': 'middle' }, name))
  })

  drawKey(
    shown,
    airborne,
    L.toScale ? `To scale, in NM along the route${L.nudged ? ' (close steps are spread apart)' : ''}` : 'Steps are evenly spaced, not to scale'
  )
  const route = steps.map((x, i) => `${fl(levels[i + 1])} at ${stepName(x.step.label)}`).join(', then ')
  root.setAttribute('aria-label', `Planned cruise levels: ${fl(levels[0])}, then ${route}.`)
}

/**
 * The aircraft: its height on the chart is its altitude (on the line of the level it is at), with its level written
 * beside it. When the chart is to scale, how far along it is comes from its distance along the route, whatever its
 * level: it carries on along its own level's line, below the plan, past a step it has not made. Without distances it
 * sits in the middle of its level's line, or on the riser while it climbs.
 */
function drawAircraft(root, L, a, phase, nextIdx, airborne, geo) {
  if (!airborne) return
  const { n, levels, m, width, base, y, r, xi, plateau } = L
  const alt = a.altFt
  const along = L.toScale && geo.along !== null ? Math.min(width - m.r, Math.max(m.l, L.toX(geo.along))) : null
  let px
  let py
  const rise = levels.findIndex(
    (from, i) => i < n && alt > Math.min(from, levels[i + 1]) + 150 && alt < Math.max(from, levels[i + 1]) - 150
  )
  if (rise >= 0) {
    if (along !== null) {
      px = along
    } else {
      const f = (alt - levels[rise]) / (levels[rise + 1] - levels[rise])
      px = xi(rise + 1) - r + 2 * r * f
    }
    py = y(alt)
  } else if (alt < levels[0] - 500) {
    px = along ?? m.l
    py = Math.min(y(alt), base - 2)
  } else if (alt > levels[n] + 500) {
    px = along ?? width - m.r
    py = Math.max(y(alt), m.t)
  } else {
    let best = 0
    levels.forEach((l, i) => {
      if (Math.abs(alt - l) < Math.abs(alt - levels[best])) best = i
    })
    if (along !== null) {
      px = along
    } else {
      const [x1, x2] = plateau(best)
      const near = best === nextIdx && (phase === 'armed' || phase === 'confirming')
      px = x1 + (x2 - x1) * (near ? 0.88 : 0.5)
    }
    py = y(levels[best])
  }
  const g = svg('g', { class: 'pmark plane-mark', tabindex: 0, role: 'img', 'aria-label': `Aircraft at ${fmt(alt)} feet` })
  g.append(
    svg('circle', { class: 'hit', cx: px, cy: py, r: 14 }),
    svg('circle', { class: 'ring', cx: px, cy: py, r: 9 }),
    svg('circle', { class: 'halo', cx: px, cy: py, r: 10 }),
    svg('circle', { class: 'plane', cx: px, cy: py, r: 4.5 }),
    svg('text', { class: 'plabel', x: Math.max(m.l + 18, Math.min(px, width - m.r - 8)), y: py - 12, 'text-anchor': 'middle' }, fl(alt))
  )
  g.addEventListener('pointerenter', () => showTip('plane'))
  g.addEventListener('focus', () => showTip('plane'))
  g.addEventListener('blur', hideTip)
  root.append(g)
  const trend = Math.abs(a.vsFpm) < 100 ? 'Level' : `${a.vsFpm > 0 ? 'Climbing' : 'Descending'} ${fmt(Math.abs(a.vsFpm))} fpm`
  const lines = ['Aircraft', trend]
  if (L.toScale && geo.along !== null) lines.push(`${fmt(geo.along)} NM along the route, ${fmt(Math.max(0, geo.route.totalNm - geo.along))} NM to go`)
  profile.marks.push({ key: 'plane', x: px, y: py, title: `${fmt(alt)} ft`, lines })
}

function drawProfile(steps, a, phase, geo) {
  const wrap = $('profileWrap')
  wrap.hidden = steps.length === 0
  if (steps.length === 0) {
    profile.structSig = ''
    profile.planeSig = ''
    return
  }
  const width = Math.floor(wrap.getBoundingClientRect().width) - 8
  if (width < 200) return // not laid out yet: the ResizeObserver draws it when it is

  const root = $('profile-chart')
  const L = layoutProfile(steps, width, geo)
  const nextIdx = steps.findIndex((x) => x.status === 'pending' || x.status === 'active')
  const airborne = Boolean(a && !a.onGround && Number.isFinite(a.altFt))

  const structSig = JSON.stringify([
    width,
    airborne,
    steps.map((x) => [x.step.label, x.step.fromAltFt, x.step.toAltFt, x.status, x.note, x.step.plannedWeightKg, x.atNm ?? null]),
    geo.route ? [geo.route.fromNm, geo.route.toNm, geo.route.totalNm] : null,
    geo.along === null || !L.toScale ? null : Math.floor(geo.along / 25) // the distance labels in the tooltips follow the aircraft
  ])
  const planeSig = JSON.stringify([
    airborne ? Math.round(a.altFt / 25) : null,
    airborne ? Math.round(a.vsFpm / 50) : null,
    phase,
    geo.along === null || !L.toScale ? null : Math.round(geo.along)
  ])

  if (structSig !== profile.structSig) {
    profile.structSig = structSig
    profile.planeSig = planeSig
    profile.width = width
    profile.marks = []
    root.replaceChildren()
    root.setAttribute('viewBox', `0 0 ${width} ${L.height}`)
    root.setAttribute('width', width)
    root.setAttribute('height', L.height)
    drawStructure(root, L, steps, nextIdx, airborne, a, geo)
    drawAircraft(root, L, a, phase, nextIdx, airborne, geo)
  } else if (planeSig !== profile.planeSig) {
    profile.planeSig = planeSig
    root.querySelector('.plane-mark')?.remove()
    profile.marks = profile.marks.filter((x) => x.key !== 'plane')
    drawAircraft(root, L, a, phase, nextIdx, airborne, geo)
  }
  if (profile.hover !== null) showTip(profile.hover)
}

// ---- render ------------------------------------------------------------------------------------

let lastState = null
let logSig = ''
let planSig = ''
let settingsOpened = false

function render(s) {
  lastState = s

  const inApp = s.app.host === 'app'

  // header chips
  const mode = $('mode')
  // An aircraft the app does not control (it only asks BeyondATC for its steps): the app sends nothing to it, so it is neither live nor watching.
  const askOnly = s.engine.askOnly === true
  const simulatedRun = s.app.mode === 'demo' || s.app.mode === 'preview'
  setText(mode, askOnly && !simulatedRun ? 'Asking BeyondATC' : (MODE_LABEL[s.app.mode] ?? s.app.mode))
  // Green only while Live control is on and the app really operates the aircraft; watching only, demo and preview are amber.
  mode.className = `chip ${askOnly && !simulatedRun ? '' : s.app.mode === 'live' ? 'ok' : 'warn'}`.trim()
  const conn = $('conn')
  const stale = s.sim.dataAgeMs !== null && s.sim.dataAgeMs > 5000
  setText(conn, s.sim.kind === 'demo' ? 'Simulated aircraft' : s.sim.connected ? (stale ? 'No data from sim' : 'Sim connected') : 'Sim not found')
  conn.className = `chip ${s.sim.kind === 'demo' ? 'warn' : s.sim.connected && !stale ? 'ok' : 'bad'}`
  // Where the aircraft is parked, once the app knows (the Windows app opens its window when the A330 gets there).
  const place = $('place')
  const at = s.launch?.place
  place.hidden = !at
  if (at) {
    setText(place, at.icao ? `At ${at.icao}` : 'At an airport')
    place.title = at.name ?? ''
    place.className = 'chip ok'
  }
  // The flight's name, once there is a plan that has one (SimBrief's callsign, for example ALK607).
  const flightChip = $('flightChip')
  const flight = s.plan?.flight ?? ''
  flightChip.hidden = flight === ''
  if (flight !== '') {
    setText(flightChip, flight)
    flightChip.title = s.plan.origin ? `${s.plan.origin} to ${s.plan.destination}` : ''
  }

  // banner
  const banner = $('banner')
  banner.hidden = false
  const [kind, head, text] =
    askOnly && !simulatedRun
      ? ['ask', 'Asking BeyondATC', 'The app does not control this aircraft. It asks BeyondATC for each step before the step point and tells you the answer; it sends nothing to the aircraft.']
      : s.app.mode === 'dry-run'
      ? [
          'dry',
          'Watching only',
          inApp
            ? 'It reads the sim and shows what it would do, but it will NOT climb your aircraft: nothing is sent to it. Turn on Live control in Settings to let it operate the FCU.'
            : 'It reads the sim and shows what it would do, but it will NOT climb your aircraft: nothing is sent to it. Start with --live to let it operate the FCU.'
        ]
      : s.app.mode === 'live'
        ? ['live', 'Live', 'This will operate the A330 FCU at each step point. On VATSIM/IVAO, turn on "confirm each step" and get your step clearance first.']
        : s.app.mode === 'preview'
          ? ['demo', 'Preview', 'A simulated aircraft is flying your flight plan, sped up, to show what the real flight would do. Everything below is simulated, including every Done: it is not your aircraft, and nothing here touches Microsoft Flight Simulator.']
          : ['demo', 'Demo', 'A simulated aircraft is flying a made-up route, sped up. Everything below is simulated, and nothing here touches Microsoft Flight Simulator.']
  if (banner.dataset.kind !== kind) {
    banner.dataset.kind = kind
    banner.className = `banner ${kind}`
    const strong = document.createElement('strong')
    strong.textContent = head
    const span = document.createElement('span')
    span.textContent = text
    banner.replaceChildren(strong, span)
  }

  // A simulated run says so everywhere: the banner stays on screen, every card is marked, and so is the tab.
  const simulated = simulatedRun
  $('bannerWrap').classList.toggle('sticky', simulated)
  document.documentElement.toggleAttribute('data-sim', simulated)

  // status card
  const e = s.engine
  const [label, tone] = PHASES[e.phase] ?? [e.phase, 'idle']
  $('hero').dataset.tone = tone
  setText($('phase'), label)
  setText($('message'), e.message)
  $('enabled').checked = e.enabled
  $('stepDowns').checked = e.stepDowns === true
  $('atcFirst').checked = e.atcFirst === true
  $('atcAnywayWrap').hidden = e.atcFirst !== true // it does nothing unless BeyondATC is asked first
  $('atcClimbAnyway').checked = e.atcClimbAnyway === true
  $('atcOther').checked = e.atcOtherAircraft === true

  // BeyondATC: the chip and the line under the switch say whether it can be reached
  const atc = s.atc
  const atcOn = atc?.enabled === true
  const atcChip = $('atcChip')
  atcChip.hidden = !atcOn
  if (atcOn) {
    setText(atcChip, atc.connected ? 'BeyondATC connected' : 'BeyondATC not found')
    atcChip.className = `chip ${atc.connected ? 'ok' : 'warn'}`
  }
  setText(
    $('atcStatus'),
    !atcOn
      ? ''
      : !atc.connected
        ? 'Not connected: is BeyondATC running? Steps wait for it.'
        : atc.autoRespond === false
          ? 'Connected. Auto Respond is off in BeyondATC, so you would have to read ATC back yourself.'
          : atc.autoRespond === true
            ? 'Connected. Auto Respond is on.'
            : 'Connected.'
  )
  // The tab and the taskbar name the app and the flight, and say when it is simulated or waiting for you.
  const appName = flight ? `${flight} - Auto Step Climb` : 'Auto Step Climb'
  const prefix = simulated ? (s.app.mode === 'preview' ? 'Preview' : 'Demo') : e.phase === 'armed' || e.phase === 'confirming' ? label : ''
  const title = prefix ? `${prefix} - ${appName}` : appName
  if (document.title !== title) document.title = title

  const next = e.steps.find((x) => x.status === 'pending' || x.status === 'active')
  setText($('nextLabel'), next ? stepName(next.step.label) : '-')
  setText($('nextLevel'), next ? `${fl(next.step.fromAltFt)} → ${fl(next.step.toAltFt)}` : '')
  $('nextTile').classList.toggle('empty', !next)
  const dist = e.distToNextNm === null ? '-' : fmt(e.distToNextNm, 1)
  setText($('nextDist'), dist)
  $('distTile').classList.toggle('empty', dist === '-')
  // How long that is at the current ground speed, so "232 NM" also says whether it is soon.
  const gs = s.aircraft ? s.aircraft.gsKt : null
  setText(
    $('nextEta'),
    e.distToNextNm !== null && e.distToNextNm > 0.5 && gs !== null && gs > 100
      ? `about ${fmtDuration((e.distToNextNm / gs) * 60)} at ${fmt(gs)} kt`
      : ''
  )
  const xtk = e.crossTrackNm === null ? '-' : fmt(e.crossTrackNm, 1)
  setText($('xtk'), xtk)
  $('xtkTile').classList.toggle('empty', xtk === '-')
  $('confirm').hidden = e.phase !== 'confirming'
  $('controlTest').hidden = s.app.mode === 'dry-run' || askOnly
  $('stepNow').hidden = askOnly // there is nothing to start in an aircraft the app does not control

  // Whether the app climbs on its own or waits for a click. A wait with nobody there skips the step,
  // so it is always stated.
  const autoMode = $('autoMode')
  // Watching only comes first: whatever else is set, nothing is climbed until Live control is on.
  const watching = s.app.mode === 'dry-run'
  const modeKey = askOnly ? 'ask-only' : watching ? 'watch' : s.app.confirmEachStep ? 'confirm' : e.atcFirst ? (e.atcClimbAnyway ? 'atc-anyway' : 'atc') : 'auto'
  if (autoMode.dataset.mode !== modeKey) {
    autoMode.dataset.mode = modeKey
    const head = document.createElement('strong')
    const body = document.createElement('span')
    if (modeKey === 'ask-only') {
      head.textContent = 'Asks BeyondATC only'
      body.textContent =
        'It asks BeyondATC for each step before the step point and tells you the answer. It does not touch this aircraft: the aircraft climbs by itself, or you climb it. Nobody needs to click anything.'
    } else if (modeKey === 'watch') {
      head.textContent = 'Watching only'
      body.textContent = `It will NOT climb your aircraft: it only logs what it would do at each step point. ${
        inApp ? 'Turn on Live control in Settings to let it climb.' : 'Start with --live to let it climb.'
      }`
    } else if (modeKey === 'atc' || modeKey === 'atc-anyway') {
      head.textContent = 'Asks ATC'
      body.textContent = `It asks BeyondATC for each step and climbs once ATC clears it. Nobody needs to click anything. ${
        modeKey === 'atc-anyway' ? 'If BeyondATC does not clear a step, it climbs anyway.' : 'If BeyondATC does not clear a step, the step is skipped.'
      }`
    } else if (modeKey === 'auto') {
      head.textContent = 'Automatic'
      body.textContent = 'It climbs by itself at each step point. Nobody needs to click anything; these buttons are manual overrides.'
    } else {
      head.textContent = 'Confirm mode'
      body.textContent = `It waits for you to press Confirm step at each step point, and skips the step if you are not there. ${
        inApp ? 'For hands-off flying turn off "Confirm each step" in Settings.' : 'For hands-off flying set confirmEachStep to false in config.json.'
      }`
    }
    autoMode.replaceChildren(head, body)
  }

  // aircraft
  const p = s.sim.profile
  setText($('title'), s.sim.title || 'No aircraft data yet')
  const badge = $('profile')
  if (!s.sim.title) {
    badge.hidden = true
  } else {
    let tone2 = 'ok'
    let text2
    if (!s.sim.aircraftOk) {
      tone2 = 'bad'
      text2 = p ? 'Controls missing' : 'No profile for this aircraft'
    } else if (askOnly) {
      text2 = 'BeyondATC requests only: the app sends nothing to this aircraft'
    } else if (p) {
      tone2 = p.verified || p.tested ? 'ok' : 'warn'
      text2 = `${p.name}: ${p.verified ? 'controls verified' : p.tested ? 'controls tested this session' : 'controls not verified yet, press Control test'}`
    }
    badge.hidden = text2 === undefined
    if (text2 !== undefined && badge.dataset.sig !== `${tone2}|${text2}`) {
      badge.dataset.sig = `${tone2}|${text2}`
      const b = document.createElement('span')
      b.className = `badge ${tone2}`
      b.textContent = text2
      badge.replaceChildren(b)
    }
  }
  const a = s.aircraft
  TILES.forEach((t, i) => {
    const cell = tileCells[i]
    setText(cell.value, a ? t.get(a) : '-')
    cell.div.classList.toggle('dim', !a)
  })

  // step box
  if (!stepsDirty && document.activeElement !== stepsInput && stepsInput.value !== s.stepsText) stepsInput.value = s.stepsText

  // plan: the flight and its route first, then where the plan came from
  const planRoute = s.plan?.origin ? `${s.plan.origin} to ${s.plan.destination}` : ''
  setText(
    $('planInfo'),
    s.plan
      ? [
          [flight, planRoute].filter(Boolean).join(', '),
          `${s.plan.source}${s.plan.edited ? ' (steps edited by you)' : ''}`,
          s.plan.generatedAt ? `OFP ${new Date(s.plan.generatedAt).toLocaleString()}` : ''
        ]
          .filter(Boolean)
          .join(' - ')
      : ''
  )
  const pe = $('planError')
  pe.hidden = !s.planError
  setText(pe, s.planError ?? '')
  const pw = $('planWarning')
  pw.hidden = !s.planWarning
  setText(pw, s.planWarning ?? '')
  $('openSettings').hidden = !s.settings?.needsPlanSource

  // settings (the Windows app only)
  const st = s.settings
  const settingsCard = $('settingsCard')
  settingsCard.hidden = !st
  if (st) {
    // The first time, with nothing to fetch a flight plan from, the card opens by itself.
    if (st.needsPlanSource && !settingsOpened) {
      settingsCard.open = true
      settingsOpened = true
    }
    const name = $('simbriefName')
    if (!simbriefDirty && document.activeElement !== name && name.value !== st.simbriefUsername) name.value = st.simbriefUsername
    $('simbriefNote').hidden = !st.simbriefUserId
    $('liveSwitch').checked = st.live === true
    $('confirmEach').checked = st.confirmEachStep === true
    $('windowAtAirport').checked = st.openWindowAtAirport === true
    $('startWithWindowsRow').hidden = s.app.startWithWindows === undefined
    $('startWithWindows').checked = s.app.startWithWindows === true
    setText($('appVersion'), `Auto Step Climb ${s.app.version}`)
    // With a bug report page set up, the button opens it; without one, the report is just copied.
    const haveIssuePage = typeof s.app.issuesUrl === 'string' && s.app.issuesUrl !== ''
    $('reportProblem').hidden = !haveIssuePage
    setText($('reportHow'), haveIssuePage ? 'Report a problem and paste it in' : 'paste it into your bug report')
  }

  const rowsSig = JSON.stringify(e.steps.map((x) => [x.step.label, x.step.fromAltFt, x.step.toAltFt, x.status, x.note]))
  if (rowsSig !== planSig) {
    planSig = rowsSig
    const body = $('steps')
    body.replaceChildren()
    for (const st of e.steps) {
      const tr = document.createElement('tr')
      const name = document.createElement('td')
      name.textContent = stepName(st.step.label)
      const level = document.createElement('td')
      level.append(document.createTextNode(fl(st.step.fromAltFt)))
      const arrow = document.createElement('span')
      arrow.className = st.step.toAltFt < st.step.fromAltFt ? 'arrow down' : 'arrow'
      arrow.textContent = '→'
      level.append(arrow, document.createTextNode(fl(st.step.toAltFt)))
      const status = document.createElement('td')
      const chip = document.createElement('span')
      chip.className = `st st-${st.status}`
      chip.textContent = STATUS[st.status] ?? st.status
      status.append(chip)
      const note = document.createElement('td')
      // A climb that hasn't started shows the weight the OFP plans there, to compare with the aircraft's.
      const planned =
        st.status === 'pending' && st.step.toAltFt > st.step.fromAltFt && st.step.plannedWeightKg
          ? `OFP weight here: ${fmt(st.step.plannedWeightKg / 1000, 1)} t`
          : ''
      note.textContent = st.note || planned
      tr.append(name, level, status, note)
      body.append(tr)
    }
    if (e.steps.length === 0) {
      const tr = document.createElement('tr')
      const td = document.createElement('td')
      td.colSpan = 4
      td.className = 'none'
      td.textContent = 'No steps in the plan yet. Reload the OFP, or type steps in the Steps box.'
      tr.append(td)
      body.append(tr)
    }
  }
  drawProfile(e.steps, a, e.phase, geoOf(e))

  // log (rebuilt only when it changed, so text can be selected and copied)
  const first = s.logs[0]
  const last = s.logs[s.logs.length - 1]
  const nextLogSig = `${s.logs.length}|${first?.at}|${last?.at}|${last?.text}`
  if (nextLogSig !== logSig) {
    logSig = nextLogSig
    const list = $('log')
    const atBottom = list.scrollTop + list.clientHeight >= list.scrollHeight - 24
    list.replaceChildren()
    for (const entry of s.logs) {
      const li = document.createElement('li')
      li.className = entry.level
      const time = document.createElement('time')
      time.textContent = new Date(entry.at).toLocaleTimeString()
      li.append(time, document.createTextNode(entry.text))
      list.append(li)
    }
    if (s.logs.length === 0) {
      const li = document.createElement('li')
      li.className = 'none'
      li.textContent = 'Nothing yet'
      list.append(li)
    }
    if (atBottom) list.scrollTop = list.scrollHeight
  }
}

// Redraw the profile when its box changes width (window resize, rotating a tablet). The drawing is done a frame
// later, not inside the observer: drawing can change the size being watched, and the browser reports that as an
// error ("ResizeObserver loop completed with undelivered notifications").
let resizeQueued = false
new ResizeObserver(() => {
  if (resizeQueued) return
  resizeQueued = true
  requestAnimationFrame(() => {
    resizeQueued = false
    if (!lastState) return
    const width = Math.floor($('profileWrap').getBoundingClientRect().width) - 8
    if (width === profile.width) return
    profile.structSig = ''
    drawProfile(lastState.engine.steps, lastState.aircraft, lastState.engine.phase, geoOf(lastState.engine))
  })
}).observe($('profileWrap'))

if (bridge) {
  // The app pushes its state about once a second while this window is open, and straight away after a button.
  bridge.onState(render)
  bridge.getState().then(render)
} else {
  const source = new EventSource('/api/stream')
  source.onmessage = (ev) => render(JSON.parse(ev.data))
  source.onerror = () => {
    setText($('conn'), 'Dashboard disconnected')
    $('conn').className = 'chip bad'
  }
}

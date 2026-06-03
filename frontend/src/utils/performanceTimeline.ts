const DEV_TIMELINE_CHECK_INTERVAL_MS = 15_000
const DEV_TIMELINE_ENTRY_LIMIT = 5_000

type PerformanceWithReactMeasureGuard = Performance & {
  __reactMeasureGuardOriginalMeasure?: Performance['measure']
}

function clearUserTimingEntries() {
  performance.clearMeasures()
  performance.clearMarks()
}

function restorePerformanceMeasureIfGuarded() {
  const guardedPerformance = performance as PerformanceWithReactMeasureGuard
  const originalMeasure = guardedPerformance.__reactMeasureGuardOriginalMeasure
  if (typeof originalMeasure !== 'function') return
  guardedPerformance.measure = originalMeasure
  delete guardedPerformance.__reactMeasureGuardOriginalMeasure
}

export function installDevPerformanceTimelineGuard() {
  if (!import.meta.env.DEV || typeof performance === 'undefined') return
  restorePerformanceMeasureIfGuarded()
  if (typeof performance.clearMeasures !== 'function' || typeof performance.clearMarks !== 'function') return

  const trimIfNeeded = () => {
    if (typeof performance.getEntriesByType !== 'function') return
    const measureCount = performance.getEntriesByType('measure').length
    const markCount = performance.getEntriesByType('mark').length
    if (measureCount + markCount < DEV_TIMELINE_ENTRY_LIMIT) return
    clearUserTimingEntries()
  }

  trimIfNeeded()
  window.setInterval(trimIfNeeded, DEV_TIMELINE_CHECK_INTERVAL_MS)
}

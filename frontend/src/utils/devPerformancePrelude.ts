type PerformanceWithReactMeasureGuard = Performance & {
  __reactMeasureGuardOriginalMeasure?: Performance['measure']
}

const devPerformance = performance as PerformanceWithReactMeasureGuard | undefined

if (import.meta.env.DEV && devPerformance && typeof devPerformance.measure === 'function') {
  devPerformance.__reactMeasureGuardOriginalMeasure = devPerformance.measure.bind(devPerformance)
  devPerformance.measure = undefined as unknown as Performance['measure']
}

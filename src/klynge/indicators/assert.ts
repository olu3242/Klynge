export function assertPeriod(period: number, name = "period"): void {
  if (!Number.isSafeInteger(period) || period < 1) throw new RangeError(`${name} must be a positive integer`);
}

export function assertFiniteSeries(values: readonly number[], name = "values"): void {
  for (let i = 0; i < values.length; i++) {
    if (!Number.isFinite(values[i])) throw new RangeError(`${name}[${i}] is not finite`);
  }
}

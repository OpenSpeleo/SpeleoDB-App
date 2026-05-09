type ConsoleLevel = 'warn' | 'error'

type ConsoleMatcher =
  | RegExp
  | { asymmetricMatch(value: unknown): boolean }
  | ((value: unknown) => boolean)
  | unknown

interface ExpectedConsoleCall {
  level: ConsoleLevel
  matchers: ConsoleMatcher[]
  consumed: boolean
  stack?: string
}

interface RecordedConsoleCall {
  level: ConsoleLevel
  args: unknown[]
}

const expectedConsoleCalls: ExpectedConsoleCall[] = []
const unexpectedConsoleCalls: RecordedConsoleCall[] = []

let isInstalled = false

function isAsymmetricMatcher(value: unknown): value is { asymmetricMatch(candidate: unknown): boolean } {
  return Boolean(
    value &&
      typeof value === 'object' &&
      'asymmetricMatch' in value &&
      typeof (value as { asymmetricMatch?: unknown }).asymmetricMatch === 'function',
  )
}

function matchConsoleArg(actual: unknown, matcher: ConsoleMatcher): boolean {
  if (isAsymmetricMatcher(matcher)) {
    return matcher.asymmetricMatch(actual)
  }

  if (matcher instanceof RegExp) {
    return typeof actual === 'string' && matcher.test(actual)
  }

  if (typeof matcher === 'function') {
    return matcher(actual)
  }

  return Object.is(actual, matcher)
}

function consumeExpectedConsoleCall(level: ConsoleLevel, args: unknown[]): boolean {
  const nextExpected = expectedConsoleCalls.find(
    (entry) =>
      !entry.consumed &&
      entry.level === level &&
      entry.matchers.length === args.length &&
      entry.matchers.every((matcher, index) => matchConsoleArg(args[index], matcher)),
  )

  if (!nextExpected) {
    return false
  }

  nextExpected.consumed = true
  return true
}

function formatConsoleArg(value: unknown): string {
  if (value instanceof Error) {
    return `${value.name}: ${value.message}`
  }

  if (typeof value === 'string') {
    return JSON.stringify(value)
  }

  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function formatRecordedCall(call: RecordedConsoleCall): string {
  return `console.${call.level}(${call.args.map(formatConsoleArg).join(', ')})`
}

function formatExpectedCall(call: ExpectedConsoleCall): string {
  const matchers = call.matchers
    .map((matcher) => {
      if (isAsymmetricMatcher(matcher)) return '[asymmetric matcher]'
      if (matcher instanceof RegExp) return matcher.toString()
      if (typeof matcher === 'function') return '[predicate matcher]'
      return formatConsoleArg(matcher)
    })
    .join(', ')
  const stack = call.stack ? `\n  Registered at:\n${call.stack}` : ''
  return `console.${call.level}(${matchers})${stack}`
}

function captureExpectationStack(): string | undefined {
  const stack = new Error().stack
  if (!stack) return undefined
  return stack
    .split('\n')
    .slice(3, 7)
    .map((line) => `    ${line.trim()}`)
    .join('\n')
}

function interceptConsole(level: ConsoleLevel): (...args: unknown[]) => void {
  return (...args: unknown[]) => {
    if (consumeExpectedConsoleCall(level, args)) {
      return
    }

    unexpectedConsoleCalls.push({ level, args })
  }
}

export function installConsoleGuards(): void {
  if (isInstalled) return
  isInstalled = true

  console.warn = interceptConsole('warn')
  console.error = interceptConsole('error')
}

export function resetConsoleGuardState(): void {
  expectedConsoleCalls.length = 0
  unexpectedConsoleCalls.length = 0
}

export function assertConsoleGuardState(): void {
  const unconsumedExpectedCalls = expectedConsoleCalls.filter((entry) => !entry.consumed)

  if (unexpectedConsoleCalls.length === 0 && unconsumedExpectedCalls.length === 0) {
    resetConsoleGuardState()
    return
  }

  const sections: string[] = []

  if (unexpectedConsoleCalls.length > 0) {
    sections.push(
      `Unexpected console output:\n${unexpectedConsoleCalls
        .map((call) => `- ${formatRecordedCall(call)}`)
        .join('\n')}`,
    )
  }

  if (unconsumedExpectedCalls.length > 0) {
    sections.push(
      `Expected console output was not emitted:\n${unconsumedExpectedCalls
        .map((call) => `- ${formatExpectedCall(call)}`)
        .join('\n')}`,
    )
  }

  resetConsoleGuardState()
  throw new Error(sections.join('\n\n'))
}

export function allowConsoleWarn(...matchers: ConsoleMatcher[]): void {
  expectedConsoleCalls.push({
    level: 'warn',
    matchers,
    consumed: false,
    stack: captureExpectationStack(),
  })
}

export function allowConsoleError(...matchers: ConsoleMatcher[]): void {
  expectedConsoleCalls.push({
    level: 'error',
    matchers,
    consumed: false,
    stack: captureExpectationStack(),
  })
}

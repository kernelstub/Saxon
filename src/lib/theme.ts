export type ThemeMap = Record<string, string>

const toCssVarName = (key: string) => {
  const trimmed = key.trim()
  if (!trimmed) return null
  if (trimmed.startsWith("--")) return trimmed
  return `--${trimmed}`
}

export const applyThemeMap = (theme: ThemeMap, previouslyApplied: Set<string>) => {
  const root = document.documentElement
  const nextApplied = new Set<string>()

  for (const [rawKey, rawValue] of Object.entries(theme)) {
    const key = toCssVarName(rawKey)
    const value = (rawValue ?? "").trim()
    if (!key || !value) continue
    root.style.setProperty(key, value)
    nextApplied.add(key)
  }

  for (const key of previouslyApplied) {
    if (!nextApplied.has(key)) {
      root.style.removeProperty(key)
    }
  }

  previouslyApplied.clear()
  for (const key of nextApplied) previouslyApplied.add(key)
}


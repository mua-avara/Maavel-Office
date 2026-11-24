/** Light / dark / follow-the-device, remembered on this device. */
export type ThemeChoice = 'auto' | 'light' | 'dark'
const KEY = 'maavel-theme'

export function savedTheme(): ThemeChoice {
  try { const v = localStorage.getItem(KEY); return v === 'light' || v === 'dark' ? v : 'auto' } catch { return 'auto' }
}

export function applyTheme(t: ThemeChoice) {
  const root = document.documentElement
  if (t === 'auto') root.removeAttribute('data-theme')
  else root.setAttribute('data-theme', t)
  try { localStorage.setItem(KEY, t) } catch { /* private mode */ }
  const dark = t === 'dark' || (t === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches)
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#0b1220' : '#12264a')
}

/** Small per-device preferences (collapsed sidebar, notifications already seen). */
export function pref<T>(key: string, fallback: T): T {
  try { const v = localStorage.getItem(`maavel-${key}`); return v == null ? fallback : (JSON.parse(v) as T) } catch { return fallback }
}
export function setPref(key: string, value: unknown) {
  try { localStorage.setItem(`maavel-${key}`, JSON.stringify(value)) } catch { /* private mode */ }
}

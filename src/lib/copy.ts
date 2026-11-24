/** Copy text to the clipboard, falling back to the older method where the Clipboard API is refused. */
export async function copyText(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true } catch { /* try the fallback */ }
  try {
    const t = document.createElement('textarea')
    t.value = text
    t.setAttribute('readonly', '')
    t.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none'
    document.body.appendChild(t)
    t.select(); t.setSelectionRange(0, text.length)
    const ok = document.execCommand('copy')
    t.remove()
    return ok
  } catch { return false }
}

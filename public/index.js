/* The grid's two mutations — pin a diagram to the front, delete it — and the menu they live in.
 *
 * The page is server-rendered and works with this file absent: a card is a link either way. The menu is
 * placed in viewport space so a card can never clip it, and every mutation re-renders from the server
 * instead of patching the DOM: one truth (the store), not two that can disagree after a failed request.
 */
(() => {
  'use strict'

  let open = null

  /** Put the sheet at its button's corner, flipped up when there is no room below. */
  function place(button, sheet) {
    const at = button.getBoundingClientRect()
    sheet.hidden = false
    const size = sheet.getBoundingClientRect()
    const below = at.bottom + 4
    const top = below + size.height > innerHeight - 8 ? at.top - size.height - 4 : below
    sheet.style.top = `${Math.max(8, top)}px`
    sheet.style.left = `${Math.max(8, Math.min(at.right - size.width, innerWidth - size.width - 8))}px`
  }

  function close() {
    if (!open) return
    open.sheet.hidden = true
    open.button.setAttribute('aria-expanded', 'false')
    open = null
  }

  function toggle(button) {
    const sheet = button.parentElement.querySelector('.card-menu-sheet')
    if (!sheet) return
    const same = open && open.sheet === sheet
    close()
    if (same) return
    place(button, sheet)
    button.setAttribute('aria-expanded', 'true')
    open = { button, sheet }
    sheet.querySelector('.card-action')?.focus()
  }

  /** POST/DELETE, then reload on success; say what went wrong when it did not. */
  async function ask(url, method, body) {
    const answer = await fetch(url, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
      credentials: 'same-origin',
    })
    if (!answer.ok) {
      const said = await answer.text().catch(() => '')
      window.alert(`${method} ${url} failed: ${answer.status}${said ? ` — ${said.slice(0, 200)}` : ''}`)
      return
    }
    location.reload()
  }

  document.addEventListener('click', (event) => {
    if (!(event.target instanceof Element)) return
    const kebab = event.target.closest('.card-kebab')
    if (kebab) {
      event.preventDefault()
      toggle(kebab)
      return
    }
    const action = event.target.closest('[data-pin], [data-del]')
    if (action) {
      const pin = action.getAttribute('data-pin')
      if (pin) {
        close()
        void ask(`/api/diagrams/${encodeURIComponent(pin)}/pin`, 'POST', {
          pinned: action.getAttribute('aria-pressed') !== 'true',
        })
        return
      }
      const del = action.getAttribute('data-del')
      if (del && window.confirm(`Delete “${del}” and everything stored with it?`)) {
        close()
        void ask(`/api/diagrams/${encodeURIComponent(del)}`, 'DELETE')
      }
      return
    }
    if (open && !open.sheet.contains(event.target)) close()
  })

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && open) {
      const button = open.button
      close()
      button.focus()
    }
  })

  // a menu pinned to the viewport does not travel with its card
  addEventListener('scroll', close, { passive: true })
  addEventListener('resize', close)
})()

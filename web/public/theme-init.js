// Pre-paint theme resolution: no flash, ever. Mirrors src/theme.ts.
// Loaded as a blocking classic script in <head>, ahead of the module bundle.
// It lives in its own same-origin file because the server's CSP
// (script-src 'self') refuses inline scripts.
;(function () {
  try {
    var KEY = 'pmh.theme'
    var mql = window.matchMedia('(prefers-color-scheme: dark)')
    function mode() {
      var saved = localStorage.getItem(KEY)
      return saved === 'dark' || saved === 'light' ? saved : 'auto'
    }
    function apply() {
      var m = mode()
      var theme = m === 'auto' ? (mql.matches ? 'dark' : 'light') : m
      var root = document.documentElement
      root.setAttribute('data-theme', theme)
      root.style.colorScheme = theme
    }
    apply()
    // Live-follow the OS while preference is 'auto'.
    var listen = mql.addEventListener
      ? function (fn) { mql.addEventListener('change', fn) }
      : function (fn) { mql.addListener(fn) }
    listen(function () {
      if (mode() === 'auto') apply()
    })
  } catch (e) {
    document.documentElement.setAttribute('data-theme', 'dark')
  }
})()

// Picks the look before the page draws, so it doesn't flash. "classic" is the plain light or dark look
// (the default); "cockpit" is the black-glass look. The choice is remembered in this browser.
;(function () {
  var skin = 'classic'
  try {
    var saved = localStorage.getItem('autostep-skin')
    if (saved === 'cockpit' || saved === 'classic') skin = saved
  } catch (e) {
    // storage can be blocked; the default is fine
  }
  document.documentElement.setAttribute('data-skin', skin)
})()

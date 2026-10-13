// Research stays self-contained; the parent owns navigation and appearance.
(function () {
  'use strict';
  if (!window.CLEAN) return;
  var C = window.CLEAN, frame;
  C.register('methods', {
    mount: function (el) {
      el.innerHTML = '<div class="cl-methods-wrap"><iframe class="cl-methods-frame" title="Methods: how the surf forecast and model work"></iframe></div>';
      frame = el.querySelector('iframe');
      C.bindFrameTheme(frame);
      window.addEventListener('message', function (event) {
        if (event.origin !== location.origin || event.source !== frame.contentWindow || !event.data) return;
        if (event.data.type === 'lcc-open-map') C.emit('x-open-map', event.data);
      });
    },
    render: function () {},
    onShow: function () {
      if (!frame.getAttribute('src')) frame.src = 'research/index.html?view=methods&theme=' + (C.theme() === 'night' ? 'dark' : 'light');
    }
  });
})();

# Local patch to maplibre-gl.js 5.24.0

One expression in the image request queue (`processQueue` in `src/util/image_request.ts`):

    - e.abortController.signal.aborted ? t-- : s(e)
    + !e.abortController || e.abortController.signal.aborted ? t-- : s(e)

A raster tile cancelled while its URL is still being prepared (a fast fly-to,
or the map page reloading its sea-floor tiles) reaches the queue without an
abort controller, and the unpatched check throws and stalls the queue. Such a
request belongs to a cancelled tile, so it is skipped like one. Re-apply when
upgrading MapLibre unless upstream has fixed it.

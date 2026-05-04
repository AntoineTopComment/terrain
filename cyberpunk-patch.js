(() => {
  const LIVE_STORAGE_KEY = "terrain:map-live-mode";
  const FREE_LABEL = "FREE";
  const LIVE_LABEL = "LIVE";
  const MIN_JITTER_METERS = 14;
  const SMOOTH_DURATION_SECONDS = 1.75;

  const control = {
    live: localStorage.getItem(LIVE_STORAGE_KEY) !== "free",
    setLive(nextLive) {
      this.live = Boolean(nextLive);
      localStorage.setItem(LIVE_STORAGE_KEY, this.live ? "live" : "free");
      document.body.classList.toggle("terrain-gps-free", !this.live);
      updateLiveButton();
    }
  };

  window.__terrainLiveControl = control;

  function patchLeafletMotion() {
    if (!window.L?.Map || window.L.Map.prototype.__terrainSmoothPatched) return;

    const originalSetView = window.L.Map.prototype.setView;

    window.L.Map.prototype.setView = function terrainSmoothSetView(center, zoom, options = {}) {
      const containerId = this.getContainer?.().id;
      const isHomeMinimap = containerId === "home-minimap";

      if (isHomeMinimap) {
        if (!control.live) return this;

        if (this._loaded && center) {
          const target = window.L.latLng(center);
          const current = this.getCenter();
          const wantedZoom = Number.isFinite(zoom) ? zoom : this.getZoom();
          const distance = current.distanceTo(target);

          if (distance < MIN_JITTER_METERS && wantedZoom === this.getZoom()) return this;

          return originalSetView.call(this, center, wantedZoom, {
            ...options,
            animate: true,
            duration: SMOOTH_DURATION_SECONDS,
            easeLinearity: 0.12,
            noMoveStart: false
          });
        }
      }

      return originalSetView.call(this, center, zoom, options);
    };

    Object.defineProperty(window.L.Map.prototype, "__terrainSmoothPatched", { value: true });
  }

  function updateLiveButton() {
    const pill = document.getElementById("network-pill");
    if (!pill) return;

    pill.classList.toggle("free", !control.live);
    pill.setAttribute("aria-pressed", control.live ? "true" : "false");
    pill.setAttribute(
      "title",
      control.live
        ? "Mode LIVE : suivi automatique de la minimap actif"
        : "Mode FREE : suivi automatique en pause, navigation libre"
    );

    if (!control.live) {
      if (pill.textContent.trim() !== FREE_LABEL) pill.textContent = FREE_LABEL;
      return;
    }

    if (pill.textContent.trim() === FREE_LABEL) pill.textContent = LIVE_LABEL;
  }

  function bindLiveButton() {
    const pill = document.getElementById("network-pill");
    if (!pill) return;

    document.body.classList.toggle("terrain-gps-free", !control.live);
    updateLiveButton();

    pill.addEventListener("click", () => control.setLive(!control.live));

    const observer = new MutationObserver(() => {
      if (!control.live && pill.textContent.trim() !== FREE_LABEL) {
        pill.textContent = FREE_LABEL;
      }
    });
    observer.observe(pill, { childList: true, characterData: true, subtree: true });
  }

  patchLeafletMotion();
  document.addEventListener("DOMContentLoaded", bindLiveButton);
})();

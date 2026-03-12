/**
 * Obsidian's native mobile image viewer (deobfuscated from app.js)
 * Extracted for reference — DO NOT import or bundle.
 *
 * Gate: Platform.isMobile (no phone/tablet distinction — same code for both)
 * Trigger: click/tap on img or video element
 */
function openNativeImageViewer(imgEl) {
  const clone = imgEl.cloneNode();
  const overlay = document.body.createDiv('mobile-image-viewer');
  overlay.appendChild(clone);

  let imgWidth = clone.width;
  let imgHeight = clone.height;
  let naturalWidth = clone.naturalWidth;
  let naturalHeight = clone.naturalHeight;
  let maxScale = 5;
  let panX = 0;
  let panY = 0;
  let scale = 1;

  /** Apply clamped transform */
  const applyTransform = () => {
    // Pan limits based on IMAGE dimensions (not viewport)
    // At scale 1: maxPan = 0 (pan locked)
    // At scale 2: maxPan = imgDim * 0.25
    // At scale N: maxPan = imgDim * (N-1)/N/2
    const panFactor = (scale - 1) / scale / 2;
    const maxPanX = Math.max(0, imgWidth * panFactor);
    const maxPanY = Math.max(0, imgHeight * panFactor);
    panX = Math.clamp(panX, -maxPanX, maxPanX);
    panY = Math.clamp(panY, -maxPanY, maxPanY);
    scale = Math.clamp(scale, 1, maxScale);
    clone.style.transform = `scale(${scale}) translate(${panX}px, ${panY}px)`;
  };

  // Momentum state
  let velocity = 0;
  let direction = 0; // angle in radians
  let lastTime = 0;
  let animFrame = 0;

  /** Momentum animation after touch release */
  const momentumTick = () => {
    cancelAnimationFrame(animFrame);
    const now = Date.now();
    const dt = now - lastTime;
    panX += Math.cos(direction) * velocity * dt;
    panY += Math.sin(direction) * velocity * dt;
    applyTransform();
    velocity -= Math.min(0.003 * dt, velocity);
    if (velocity > 0.01) {
      lastTime = now;
      animFrame = requestAnimationFrame(momentumTick);
    }
  };

  // Recalculate maxScale on image load (based on natural vs displayed size)
  clone.addEventListener('load', () => {
    imgWidth = clone.width;
    imgHeight = clone.height;
    naturalWidth = clone.naturalWidth;
    naturalHeight = clone.naturalHeight;
    maxScale = 2 * Math.max(naturalWidth / imgWidth, naturalHeight / imgHeight);
    if (maxScale < 1) maxScale = 1;
    applyTransform();
  });

  // Touch tracking
  let prevTouch1 = null;
  let prevTouch2 = null;

  const handleTouch = (e) => {
    cancelAnimationFrame(animFrame);
    const now = Date.now();
    const dt = now - lastTime;
    const touches = Array.prototype.slice.call(e.touches);

    // Match existing touches by identifier
    let currTouch1 = null;
    let currTouch2 = null;
    for (const touch of touches) {
      if (prevTouch1 && touch.identifier === prevTouch1.identifier)
        currTouch1 = touch;
      if (prevTouch2 && touch.identifier === prevTouch2.identifier)
        currTouch2 = touch;
    }

    // If touch2 lifted but touch1 didn't, promote touch2 → touch1
    if (currTouch2 && !currTouch1) {
      prevTouch1 = prevTouch2;
      currTouch1 = currTouch2;
      prevTouch2 = null;
      currTouch2 = null;
    }

    // Assign remaining unmatched touches
    if (currTouch1) touches.remove(currTouch1);
    else if (touches.length > 0) {
      currTouch1 = touches.first();
      touches.splice(0, 1);
    }
    if (currTouch2) touches.remove(currTouch2);
    else if (touches.length > 0) {
      currTouch2 = touches.first();
      touches.splice(0, 1);
    }

    if (
      prevTouch1 &&
      currTouch1 &&
      prevTouch1.identifier === currTouch1.identifier
    ) {
      const cx = window.innerWidth / 2;
      const cy = window.innerHeight / 2;

      if (
        prevTouch2 &&
        currTouch2 &&
        prevTouch2.identifier === currTouch2.identifier
      ) {
        // --- TWO-FINGER: pinch zoom with focal point ---
        // Focal point offset from image center (in pre-scale coords)
        const focalOffsetX =
          -panX + ((prevTouch1.clientX + prevTouch2.clientX) / 2 - cx) / scale;
        const focalOffsetY =
          -panY + ((prevTouch1.clientY + prevTouch2.clientY) / 2 - cy) / scale;

        // New midpoint (screen coords)
        const newMidX = (currTouch1.clientX + currTouch2.clientX) / 2;
        const newMidY = (currTouch1.clientY + currTouch2.clientY) / 2;

        // Distance between fingers (squared)
        const prevDx = prevTouch1.clientX - prevTouch2.clientX;
        const prevDy = prevTouch1.clientY - prevTouch2.clientY;
        const currDx = currTouch1.clientX - currTouch2.clientX;
        const currDy = currTouch1.clientY - currTouch2.clientY;
        const prevDistSq = prevDx * prevDx + prevDy * prevDy;
        const currDistSq = currDx * currDx + currDy * currDy;

        if (prevDistSq !== 0 && currDistSq !== 0) {
          const ratio = Math.sqrt(currDistSq / prevDistSq);
          const newScale = scale * ratio;
          // Adjust pan to keep focal point under fingers
          panX = (newMidX - cx) / newScale - focalOffsetX;
          panY = (newMidY - cy) / newScale - focalOffsetY;
          scale = newScale;
          applyTransform();
        }
      } else {
        // --- ONE-FINGER: pan with momentum tracking ---
        const deltaX = (currTouch1.clientX - prevTouch1.clientX) / scale;
        const deltaY = (currTouch1.clientY - prevTouch1.clientY) / scale;
        panX += deltaX;
        panY += deltaY;
        // Track velocity for momentum
        velocity = Math.sqrt(deltaX * deltaX + deltaY * deltaY) / dt;
        direction = Math.atan2(deltaY, deltaX);
        applyTransform();
      }
    }

    prevTouch2 = currTouch2;
    prevTouch1 = currTouch1;

    // Start momentum when all fingers lifted
    if (!prevTouch1 && !prevTouch2) {
      animFrame = requestAnimationFrame(momentumTick);
    }
    lastTime = now;
  };

  overlay.addEventListener('touchstart', handleTouch);
  overlay.addEventListener('touchend', handleTouch);
  overlay.addEventListener('touchmove', handleTouch);
  overlay.addEventListener('touchcancel', handleTouch);
  overlay.addEventListener('click', (e) => {
    overlay.remove();
    e.preventDefault();
    cancelAnimationFrame(animFrame);
  });
}

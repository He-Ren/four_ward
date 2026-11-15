// @ts-check
/** Pointer capture gives mouse, pen and touch the same drag/release semantics.
 * @param {HTMLCanvasElement} canvas
 * @param {{width:number, step:number, getAim:()=>number, aim:(x:number)=>void, drop:()=>void, pause:()=>void, enabled:()=>boolean}} actions */
export function bindInput(canvas, actions) {
  const controller = new AbortController(),
    options = { signal: controller.signal };
  /** @type {number|null} */ let active = null;
  /** @param {PointerEvent} event */
  const aim = (event) => {
    const rect = canvas.getBoundingClientRect();
    actions.aim(((event.clientX - rect.left) / rect.width) * actions.width);
  };
  canvas.addEventListener(
    "pointerdown",
    (event) => {
      if (!actions.enabled() || active !== null || event.button !== 0) return;
      event.preventDefault();
      canvas.focus({ preventScroll: true });
      active = event.pointerId;
      canvas.setPointerCapture(active);
      aim(event);
    },
    options,
  );
  canvas.addEventListener(
    "pointermove",
    (event) => {
      if (
        actions.enabled() &&
        (active === event.pointerId ||
          (active === null && event.pointerType === "mouse"))
      )
        aim(event);
    },
    options,
  );
  canvas.addEventListener(
    "pointerup",
    (event) => {
      if (active !== event.pointerId) return;
      aim(event);
      active = null;
      if (canvas.hasPointerCapture(event.pointerId))
        canvas.releasePointerCapture(event.pointerId);
      if (actions.enabled()) actions.drop();
    },
    options,
  );
  canvas.addEventListener(
    "pointercancel",
    () => {
      active = null;
    },
    options,
  );
  canvas.addEventListener(
    "lostpointercapture",
    () => {
      active = null;
    },
    options,
  );
  window.addEventListener(
    "blur",
    () => {
      active = null;
    },
    options,
  );
  window.addEventListener(
    "keydown",
    (event) => {
      if (
        event.target instanceof HTMLElement &&
        event.target.closest("button,a,input,textarea,select")
      )
        return;
      if (event.code === "KeyP") {
        event.preventDefault();
        if (!event.repeat) actions.pause();
        return;
      }
      if (!actions.enabled()) return;
      if (["ArrowLeft", "ArrowRight", "Space", "Enter"].includes(event.code))
        event.preventDefault();
      if (event.code === "ArrowLeft")
        actions.aim(actions.getAim() - actions.step);
      if (event.code === "ArrowRight")
        actions.aim(actions.getAim() + actions.step);
      if ((event.code === "Space" || event.code === "Enter") && !event.repeat)
        actions.drop();
    },
    options,
  );
  return () => controller.abort();
}

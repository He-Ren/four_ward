// @ts-check
/** Bind help only after game images are ready. No new image downloads.
 * @param {string[]} images
 * @param {() => void} pause
 * @returns {() => void} */
export function bindHelp(images, pause) {
  const button = /** @type {HTMLButtonElement} */ (
    document.getElementById("help")
  );
  const dialog = /** @type {HTMLDialogElement} */ (
    document.getElementById("help-dialog")
  );
  const viewer = /** @type {HTMLDialogElement} */ (
    document.getElementById("image-dialog")
  );
  const large = /** @type {HTMLImageElement} */ (
    document.getElementById("help-large-image")
  );
  const close = /** @type {HTMLButtonElement} */ (
    document.getElementById("help-close")
  );
  const list = /** @type {HTMLOListElement} */ (
    document.getElementById("help-progression")
  );
  const controller = new AbortController();
  const options = { signal: controller.signal };
  const numbers = ["一", "二", "三", "四", "五", "六", "七", "八", "九"];
  list.replaceChildren();
  images.forEach((src, index) => {
    const row = document.createElement("li");
    const label = `${numbers[index] || index + 1}阶`;
    const text = document.createElement("span");
    text.textContent = `${label}：`;
    const preview = document.createElement("button");
    preview.type = "button";
    preview.setAttribute("aria-label", `查看${label}大图`);
    const image = document.createElement("img");
    image.src = src;
    image.alt = label;
    preview.append(image);
    preview.addEventListener(
      "click",
      () => {
        large.src = src;
        large.alt = label;
        viewer.showModal();
        viewer.focus();
      },
      options,
    );
    row.append(text, preview);
    list.append(row);
  });
  button.addEventListener(
    "click",
    () => {
      pause();
      dialog.showModal();
    },
    options,
  );
  close.addEventListener("click", () => dialog.close(), options);
  /** @param {MouseEvent} event */
  const outside = (event) => {
    const box = dialog.getBoundingClientRect();
    return (
      event.clientX < box.left ||
      event.clientX > box.right ||
      event.clientY < box.top ||
      event.clientY > box.bottom
    );
  };
  let beganOutside = false;
  dialog.addEventListener(
    "pointerdown",
    (event) => {
      beganOutside = outside(event);
    },
    options,
  );
  dialog.addEventListener(
    "click",
    (event) => {
      if (event.target === dialog && beganOutside && outside(event))
        dialog.close();
      beganOutside = false;
    },
    options,
  );
  viewer.addEventListener(
    "click",
    (event) => {
      event.preventDefault();
      event.stopPropagation();
      viewer.close();
    },
    options,
  );
  button.hidden = false;
  return () => {
    viewer.close();
    dialog.close();
    button.hidden = true;
    controller.abort();
    list.replaceChildren();
  };
}

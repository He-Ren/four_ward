// @ts-check
export const RESOURCE_POLICY = Object.freeze({
  attempts: 3,
  retryDelayMs: 350,
  timeoutMs: 15000,
});

/** Bounded retries; failures are never cached as successful results.
 * @template T
 * @param {(attempt:number)=>Promise<T>} operation
 * @returns {Promise<T>}
 */
export async function retryResource(operation) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await operation(attempt);
    } catch (error) {
      if (attempt + 1 >= RESOURCE_POLICY.attempts) throw error;
      await new Promise((resolve) =>
        setTimeout(resolve, RESOURCE_POLICY.retryDelayMs * (attempt + 1)),
      );
    }
  }
}

/** Timeout covers both headers and the response body.
 * @template T
 * @param {string|URL} url
 * @param {(response:Response)=>Promise<T>} read
 * @returns {Promise<T>}
 */
export function fetchResource(url, read) {
  return retryResource(async (attempt) => {
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      RESOURCE_POLICY.timeoutMs,
    );
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        cache: attempt ? "reload" : "default",
      });
      if (!response.ok) throw new Error(`资源加载失败 (${response.status})`);
      return await read(response);
    } finally {
      clearTimeout(timer);
    }
  });
}

/** @param {string} url @returns {Promise<HTMLImageElement>} */
export function loadImage(url) {
  return retryResource(async (attempt) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    const source = new URL(url, location.href);
    if (attempt && /^https?:$/.test(source.protocol))
      source.searchParams.set("retry", String(attempt));
    let timer = 0;
    try {
      await new Promise((resolve, reject) => {
        image.onload = () => resolve(undefined);
        image.onerror = () => reject(new Error("图片下载失败"));
        timer = window.setTimeout(
          () => reject(new Error("图片下载超时")),
          RESOURCE_POLICY.timeoutMs,
        );
        image.src = source.href;
      });
      // onload is sufficient for drawImage; decode() may reject on Safari even
      // when a completely downloaded image can already be drawn.
      if (!image.naturalWidth || !image.naturalHeight)
        throw new Error("图片内容无效");
      return image;
    } catch (error) {
      image.src = "";
      throw error;
    } finally {
      clearTimeout(timer);
      image.onload = image.onerror = null;
    }
  });
}

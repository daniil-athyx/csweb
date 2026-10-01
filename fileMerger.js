(function () {
  "use strict";

  const defaultConfig = {
    files: [],
    basePath: "",
    debug: true,
  };

  const config = Object.assign(
    {},
    defaultConfig,
    window.fileMergerConfig || {},
  );
  window.mergedFiles = window.mergedFiles || {};

  const mergeStatus = {};
  const mergeProgress = {};

  let loadingDiv;
  let loadingContent;

  function initializeUI() {
    loadingDiv = document.createElement("div");
    loadingDiv.id = "file-merger-loading";
    loadingDiv.style.cssText = `
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      background: rgba(0, 0, 0, 0.9);
      color: white;
      padding: 30px 40px;
      border-radius: 10px;
      font-family: monospace;
      font-size: 16px;
      z-index: 10000;
      min-width: 300px;
      text-align: center;
    `;

    loadingContent = document.createElement("div");
    loadingContent.id = "file-merger-content";
    loadingDiv.appendChild(loadingContent);
    document.body.appendChild(loadingDiv);
  }

  function updateLoadingDisplay() {
    if (!loadingContent) return;

    const lines = [
      '<div style="font-size: 18px; margin-bottom: 15px;">loading...</div>',
      '',
      '',
    ];

    config.files.forEach((file) => {
      const status = mergeStatus[file.name] || "waiting";
      const progress = mergeProgress[file.name] || {
        current: 0,
        total: file.parts,
      };

      let statusText = "";
      let color = "#888";

      if (status === "merging") {
        statusText = ` merging... ${progress.current}/${progress.total}`;
        color = "#ffa500";
      } else if (status === "ready") {
        statusText = "done";
        color = "#00ff00";
      } else if (status === "failed") {
        statusText = "failed";
        color = "#ff0000";
      } else {
        statusText = "Waiting...";
      }

      lines.push(
        `<div style="margin: 8px 0; color: ${color};">${file.name}: ${statusText}</div>`,
      );
    });
    loadingContent.innerHTML = lines.join("");

    const allDone = config.files.every(
      (file) =>
        mergeStatus[file.name] === "ready" ||
        mergeStatus[file.name] === "failed",
    );

    if (allDone) {
      setTimeout(() => {
        loadingDiv.style.opacity = "0";
        loadingDiv.style.transition = "opacity 0.5s";
        setTimeout(() => loadingDiv.remove(), 500);
      }, 1000);
    }
  }

  function log(...args) {
    if (config.debug) console.log("[FileMerger]", ...args);
  }

  function error(...args) {
    console.error("[FileMerger]", ...args);
  }

  function normalizeUrl(url) {
    try {
      return decodeURIComponent(url.toString().split("?")[0]);
    } catch (e) {
      return url;
    }
  }

  function urlsMatch(url1, url2) {
    const norm1 = normalizeUrl(url1);
    const norm2 = normalizeUrl(url2);

    if (norm1 === norm2) return true;
    if (norm1.endsWith(norm2) || norm2.endsWith(norm1)) return true;

    return norm1.split("/").pop() === norm2.split("/").pop();
  }

  async function mergeSplitFiles(filePath, numParts) {
    const fileName = filePath.split("/").pop();
    mergeProgress[fileName] = { current: 0, total: numParts };
    updateLoadingDisplay();

    try {
      const parts = [];
      for (let i = 1; i <= numParts; i++) {
        parts.push(`${filePath}.part${i}`);
      }

      log(`Merging ${filePath} from ${numParts} parts...`);

      const buffers = [];
      for (let i = 0; i < parts.length; i++) {
        const response = await window.originalFetch(parts[i]);

        if (!response.ok) {
          if (response.status === 403 || response.status === 404) {
            throw new Error(`Part missing: ${parts[i]}`);
          }
          throw new Error(
            `failed to load sowwy (make a report in bug-reports in the discord) ${parts[i]}: ${response.status}`,
          );
        }

        const buffer = await response.arrayBuffer();
        buffers.push(buffer);

        mergeProgress[fileName].current = i + 1;
        updateLoadingDisplay();
      }

      const totalSize = buffers.reduce((sum, buf) => sum + buf.byteLength, 0);
      const mergedArray = new Uint8Array(totalSize);
      let offset = 0;

      for (const buffer of buffers) {
        mergedArray.set(new Uint8Array(buffer), offset);
        offset += buffer.byteLength;
      }

      log(` ${filePath} done: ${(totalSize / 1024 / 1024).toFixed(2)} MB`);
      return mergedArray.buffer;
    } catch (err) {
      error(`Failed to merge ${filePath}:`, err);
      throw err;
    }
  }

  function shouldInterceptFile(url) {
    const urlStr = normalizeUrl(url);
    if (urlStr.includes(".part")) return null;

    for (const file of config.files) {
      const fileName = file.name;
      const fullPath = config.basePath
        ? `${config.basePath}${fileName}`
        : fileName;

      if (
        urlsMatch(urlStr, fileName) ||
        urlsMatch(urlStr, fullPath) ||
        urlsMatch(urlStr, fileName + ".br") ||
        urlsMatch(urlStr, fullPath + ".br")
      ) {
        return fileName;
      }
    }

    return null;
  }

  function getMergedFile(filename) {
    if (window.mergedFiles[filename]) return window.mergedFiles[filename];

    for (const [key, value] of Object.entries(window.mergedFiles)) {
      if (urlsMatch(key, filename)) return value;
    }

    return null;
  }

  if (!window.originalFetch) window.originalFetch = window.fetch;

  window.fetch = function (url, ...args) {
    const filename = shouldInterceptFile(url);

    if (filename) {
      log("Intercepting fetch for:", filename);

      return new Promise((resolve, reject) => {
        const maxWait = 60000;
        const startTime = Date.now();

        const check = setInterval(() => {
          const buffer = getMergedFile(filename);

          if (buffer) {
            clearInterval(check);
            const contentType = filename.endsWith(".wasm")
              ? "application/wasm"
              : "application/octet-stream";
            resolve(
              new Response(buffer, {
                status: 200,
                statusText: "OK",
                headers: {
                  "Content-Type": contentType,
                  "Content-Length": buffer.byteLength.toString(),
                },
              }),
            );
          } else if (mergeStatus[filename] === "failed") {
            clearInterval(check);
            reject(new Error(`Merge failed for ${filename}`));
          } else if (Date.now() - startTime > maxWait) {
            clearInterval(check);
            reject(new Error(`Timeout waiting for ${filename}`));
          }
        }, 100);
      });
    }

    return window.originalFetch.call(this, url, ...args);
  };

  if (!window.OriginalXMLHttpRequest)
    window.OriginalXMLHttpRequest = window.XMLHttpRequest;

  window.XMLHttpRequest = function (options) {
    const xhr = new window.OriginalXMLHttpRequest(options);
    const originalOpen = xhr.open;
    const originalSend = xhr.send;
    let requestUrl = "";

    xhr.open = function (method, url, ...args) {
      requestUrl = url;
      return originalOpen.call(this, method, url, ...args);
    };

    xhr.send = function (...args) {
      const filename = shouldInterceptFile(requestUrl);

      if (filename) {
        log("Intercepting XHR for:", filename);

        const waitForMerge = () => {
          const buffer = getMergedFile(filename);

          if (buffer) {
            Object.defineProperties(xhr, {
              status: { value: 200 },
              statusText: { value: "OK" },
              response: { value: buffer },
              responseType: { value: "arraybuffer" },
              readyState: { value: 4 },
            });

            setTimeout(() => {
              try {
                xhr.dispatchEvent(new ProgressEvent('progress', {
                  lengthComputable: true,
                  loaded: buffer.byteLength,
                  total: buffer.byteLength
                }));
                xhr.dispatchEvent(new Event('load'));
              } catch (e) {
                console.error("Event dispatch error:", e);
              }
              if (xhr.onreadystatechange) xhr.onreadystatechange();
              if (xhr.onload) xhr.onload({ type: "load", target: xhr });
            }, 1);
          } else if (mergeStatus[filename] === "failed") {
            if (xhr.onerror) xhr.onerror(new Error("Merge Failed"));
          } else {
            setTimeout(waitForMerge, 100);
          }
        };

        waitForMerge();
        return;
      }

      return originalSend.call(this, ...args);
    };

    return xhr;
  };

  async function autoMergeFiles() {
    if (!config.files.length) return;

    updateLoadingDisplay();

    try {
      const promises = config.files.map((file) => {
        const fullPath = config.basePath
          ? `${config.basePath}${file.name}`
          : file.name;

        mergeStatus[file.name] = "merging";
        updateLoadingDisplay();

        return mergeSplitFiles(fullPath, file.parts)
          .then((buffer) => {
            window.mergedFiles[file.name] = buffer;
            window.mergedFiles[fullPath] = buffer;
            mergeStatus[file.name] = "ready";
            updateLoadingDisplay();
          })
          .catch((err) => {
            mergeStatus[file.name] = "failed";
            updateLoadingDisplay();
            error(err);
          });
      });

      await Promise.all(promises);
    } catch (e) {
      error(e);
    }
  }
  function init() {
    if (document.body) {
      initializeUI();
      autoMergeFiles();
    } else {
      if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", () => {
          initializeUI();
          autoMergeFiles();
        });
      } else {
        setTimeout(init, 10);
      }
    }
  }

  init();
})();

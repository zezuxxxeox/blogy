const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

const STORAGE_KEY = "easy-posting-settings";
const MAX_API_IMAGES = 12;
const MIN_AUTO_SECTIONS = 3;
const MAX_AUTO_SECTIONS = 9;

// 플랫폼별 PC 본문 가로폭(px). 네이버 블로그 본문은 693px 기준이다.
const PLATFORM_PREVIEW_WIDTH = {
  naver: 693,
  tistory: 740,
  wordpress: 820,
  generic: 820
};
const MOBILE_PREVIEW_WIDTH = 390;

const state = {
  photos: [],
  result: null,
  activeView: "preview",
  previewWidthMode: "pc",
  settings: {
    provider: "gemini",
    geminiModel: "gemini-2.5-flash",
    geminiKey: "",
    noReference: false
  }
};

const stopwords = new Set([
  "그리고", "그래서", "하지만", "있는", "없는", "합니다", "해서", "으로", "에서", "에게", "까지",
  "부터", "보다", "이번", "정말", "너무", "조금", "가장", "같은", "하면", "하는", "했다", "했다",
  "this", "that", "with", "from", "about", "into", "your", "blog", "post", "photo", "image"
]);

init();

function init() {
  bindRuntimeErrorFeedback();
  loadSettings();
  hydrateSettings();
  bindEvents();
  renderPhotos();
  updateProviderStatus();
  applyPreviewWidth();
}

function bindRuntimeErrorFeedback() {
  let shown = false;
  const notify = (error) => {
    console.error(error);
    if (shown) return;
    shown = true;
    showToast("오류가 발생했습니다. 새로고침 후 다시 시도해주세요.");
  };

  window.addEventListener("error", (event) => notify(event.error || event.message));
  window.addEventListener("unhandledrejection", (event) => notify(event.reason));
}

function bindEvents() {
  $("#providerSelect").addEventListener("change", () => {
    state.settings.provider = $("#providerSelect").value;
    updateProviderStatus();
  });

  $("#saveSettingsButton").addEventListener("click", () => {
    state.settings.provider = $("#providerSelect").value;
    state.settings.geminiKey = $("#geminiKey").value.trim();
    state.settings.geminiModel = $("#geminiModel").value.trim() || "gemini-2.5-flash";
    saveSettings();
    updateProviderStatus();
    showToast("✓ 설정이 저장되었습니다.");
  });

  $("#dropzone").addEventListener("dragover", (event) => {
    event.preventDefault();
    $("#dropzone").classList.add("dragging");
  });

  $("#dropzone").addEventListener("dragleave", () => {
    $("#dropzone").classList.remove("dragging");
  });

  $("#dropzone").addEventListener("drop", async (event) => {
    event.preventDefault();
    $("#dropzone").classList.remove("dragging");
    await addPhotos(Array.from(event.dataTransfer.files || []));
  });

  $("#photoInput").addEventListener("change", async (event) => {
    await addPhotos(Array.from(event.target.files || []));
    event.target.value = "";
  });

  $("#noReferenceToggle").addEventListener("change", () => {
    state.settings.noReference = $("#noReferenceToggle").checked;
    saveSettings();
    updateReferenceControls();
  });

  $("#generateButton").addEventListener("click", generatePost);
  $("#copyRichButton").addEventListener("click", copyRichHtml);
  $("#copyHtmlButton").addEventListener("click", copyHtml);
  $("#copyTextButton").addEventListener("click", copyPlainText);
  $("#downloadButton").addEventListener("click", downloadHtml);

  $$(".tab").forEach((tab) => {
    tab.addEventListener("click", () => setView(tab.dataset.view));
  });

  $$(".width-tab").forEach((tab) => {
    tab.addEventListener("click", () => setPreviewWidthMode(tab.dataset.width));
  });

  $("#platformSelect").addEventListener("change", applyPreviewWidth);
}

function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    state.settings = { ...state.settings, ...saved };
  } catch {
    state.settings = { ...state.settings };
  }
  if (state.settings.provider !== "gemini") {
    state.settings.provider = "gemini";
  }
}

function saveSettings() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.settings));
}

function hydrateSettings() {
  $("#providerSelect").value = "gemini";
  $("#geminiKey").value = state.settings.geminiKey;
  $("#geminiModel").value = state.settings.geminiModel;
  $("#noReferenceToggle").checked = Boolean(state.settings.noReference);
  updateReferenceControls();
}

function updateReferenceControls() {
  const noReference = $("#noReferenceToggle").checked;
  $("#referenceText").disabled = noReference;
  $("#referenceWeight").disabled = noReference;
}

function updateProviderStatus() {
  const provider = $("#providerSelect").value;
  const hasKey = $("#geminiKey").value.trim().length > 0;
  const label = $("#apiModeLabel");
  if (provider === "gemini") {
    if (label) label.textContent = hasKey ? "고품질 AI 활성" : "키 필요";
  } else {
    if (label) label.textContent = "키 필요";
  }
}

async function addPhotos(files) {
  const images = files.filter(isLikelyImageFile);
  if (!images.length) {
    updateUploadStatus(files.length ? `${files.length}개 파일 선택됨 - 이미지로 인식하지 못했습니다.` : "선택된 사진 없음");
    showToast("이미지 파일을 선택해주세요. JPG, PNG, WebP, HEIC 등을 지원합니다.");
    return;
  }
  clearResultData();
  updateUploadStatus(`${images.length}장 선택됨 - 목록을 준비하는 중`);
  setProgress(true, "사진을 읽고 압축하는 중", 8);

  let addedCount = 0;
  const failedNames = [];

  for (let index = 0; index < images.length; index += 1) {
    const file = images[index];
    const id = `p_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const objectUrl = URL.createObjectURL(file);
    const photo = {
      id,
      file,
      objectUrl,
      name: file.name,
      size: file.size,
      mime: inferImageMime(file),
      width: 0,
      height: 0,
      dataUrl: "",
      apiBase64: "",
      exportDataUrl: "",
      colors: [],
      brightness: 0,
      visualTags: [],
      note: "",
      caption: "",
      keywords: [],
      matchedSectionId: "",
      confidence: 0,
      status: "loading",
      statusMessage: "처리 중"
    };

    state.photos.push(photo);
    updateUploadStatus(`${state.photos.length}장 목록에 추가됨`);
    renderPhotos();

    try {
      const prepared = await prepareImage(file);
      Object.assign(photo, prepared, {
        status: "ready",
        statusMessage: "준비 완료"
      });
      addedCount += 1;
    } catch (error) {
      failedNames.push(file.name);
      photo.status = "failed";
      photo.statusMessage = "읽기 실패";
      console.warn("Image decode failed", file.name, error);
    }

    setProgress(true, `${index + 1}/${images.length}장 확인됨`, 8 + Math.round(((index + 1) / images.length) * 20));
    renderPhotos();
  }

  setProgress(false);
  renderPhotos();

  if (addedCount && failedNames.length) {
    updateUploadStatus(`${state.photos.length}장 표시됨 - ${failedNames.length}장 읽기 실패`);
    showToast(`${addedCount}장은 추가했고, ${failedNames.length}장은 읽지 못했습니다.`);
  } else if (addedCount) {
    updateUploadStatus(`${state.photos.length}장 표시됨`);
    showToast(`${addedCount}장의 사진을 추가했습니다.`);
  } else {
    updateUploadStatus(`${state.photos.length}장 표시됨 - 모두 읽기 실패`);
    showToast("사진을 읽지 못했습니다. JPG, PNG, WebP로 다시 시도해주세요.");
  }
}

function isLikelyImageFile(file) {
  if (file.type?.startsWith("image/")) return true;
  return /\.(?:jpe?g|jfif|png|webp|gif|bmp|heic|heif|avif|tiff?)$/i.test(file.name || "");
}

function inferImageMime(file) {
  if (file.type?.startsWith("image/")) return file.type;
  const name = file.name || "";
  if (/\.png$/i.test(name)) return "image/png";
  if (/\.webp$/i.test(name)) return "image/webp";
  if (/\.gif$/i.test(name)) return "image/gif";
  if (/\.avif$/i.test(name)) return "image/avif";
  if (/\.heic$/i.test(name)) return "image/heic";
  if (/\.heif$/i.test(name)) return "image/heif";
  return "image/jpeg";
}

async function prepareImage(file) {
  const source = await loadImageSource(file);
  try {
    const exportDataUrl = resizeBitmap(source.image, 1600, 0.88);
    const apiDataUrl = resizeBitmap(source.image, 1024, 0.82);
    const colorInfo = sampleColors(source.image);
    return {
      width: colorInfo.width,
      height: colorInfo.height,
      mime: "image/jpeg",
      dataUrl: exportDataUrl,
      exportDataUrl,
      apiBase64: apiDataUrl.split(",")[1],
      colors: colorInfo.colors,
      brightness: colorInfo.brightness,
      visualTags: colorInfo.visualTags
    };
  } finally {
    source.cleanup();
  }
}

async function loadImageSource(file) {
  if (typeof createImageBitmap === "function") {
    try {
      const image = await createImageBitmap(file);
      return {
        image,
        cleanup: () => image.close()
      };
    } catch (error) {
      console.warn("createImageBitmap failed, trying image element fallback", error);
    }
  }

  const objectUrl = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.decoding = "async";
    const loaded = new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () => reject(new Error("이미지를 브라우저에서 열 수 없습니다."));
    });
    image.src = objectUrl;
    if (image.decode) {
      await image.decode().catch(() => loaded);
    } else {
      await loaded;
    }
    return {
      image,
      cleanup: () => URL.revokeObjectURL(objectUrl)
    };
  } catch (error) {
    URL.revokeObjectURL(objectUrl);
    throw error;
  }
}

function resizeBitmap(image, maxSide, quality) {
  const sourceWidth = image.naturalWidth || image.width;
  const sourceHeight = image.naturalHeight || image.height;
  const ratio = Math.min(1, maxSide / Math.max(sourceWidth, sourceHeight));
  const width = Math.max(1, Math.round(sourceWidth * ratio));
  const height = Math.max(1, Math.round(sourceHeight * ratio));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { alpha: false });
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(image, 0, 0, width, height);
  return canvas.toDataURL("image/jpeg", quality);
}

function sampleColors(image) {
  const sourceWidth = image.naturalWidth || image.width;
  const sourceHeight = image.naturalHeight || image.height;
  const width = 48;
  const height = Math.max(1, Math.round((sourceHeight / sourceWidth) * width));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(image, 0, 0, width, height);
  const { data } = ctx.getImageData(0, 0, width, height);
  const buckets = new Map();
  let brightnessTotal = 0;
  let warm = 0;
  let green = 0;
  let blue = 0;
  let neutral = 0;

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const brightness = (r * 299 + g * 587 + b * 114) / 1000;
    brightnessTotal += brightness;
    if (r > g + 18 && r > b + 18) warm += 1;
    if (g > r + 12 && g > b + 8) green += 1;
    if (b > r + 12 && b > g + 8) blue += 1;
    if (Math.abs(r - g) < 18 && Math.abs(g - b) < 18) neutral += 1;
    const key = `${Math.round(r / 32) * 32},${Math.round(g / 32) * 32},${Math.round(b / 32) * 32}`;
    buckets.set(key, (buckets.get(key) || 0) + 1);
  }

  const colors = Array.from(buckets.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([rgb]) => {
      const [r, g, b] = rgb.split(",").map(Number);
      return rgbToHex(r, g, b);
    });
  const total = data.length / 4;
  const brightness = Math.round(brightnessTotal / total);
  const visualTags = [];
  if (brightness > 178) visualTags.push("밝은 분위기", "도입부");
  if (brightness < 96) visualTags.push("차분한 분위기", "야간");
  if (sourceWidth > sourceHeight * 1.25) visualTags.push("가로 사진", "대표 이미지");
  if (sourceHeight > sourceWidth * 1.25) visualTags.push("세로 사진", "상세 컷");
  if (warm / total > 0.26) visualTags.push("따뜻한 색감", "음식", "실내");
  if (green / total > 0.2) visualTags.push("자연", "야외");
  if (blue / total > 0.2) visualTags.push("하늘", "물", "청량함");
  if (neutral / total > 0.44) visualTags.push("깔끔함", "제품", "공간");
  return { width: sourceWidth, height: sourceHeight, colors, brightness, visualTags };
}

function rgbToHex(r, g, b) {
  return `#${[r, g, b].map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}

function isPhotoReady(photo) {
  return photo.status === "ready" && Boolean(photo.exportDataUrl && photo.apiBase64);
}

function isPhotoLoading(photo) {
  return photo.status === "loading";
}

function getReadyPhotos() {
  return state.photos.filter(isPhotoReady);
}

function parseHashtagCount() {
  const input = $("#hashtagCount");
  const raw = Number.parseInt(input?.value || "8", 10);
  return clamp(Number.isFinite(raw) ? raw : 8, 0, 30);
}

function renderPhotos() {
  $("#photoCount").textContent = `${state.photos.length}장`;
  if (state.photos.length) updateUploadStatus(`${state.photos.length}장 표시됨`);
  const grid = $("#photoGrid");
  if (!state.photos.length) {
    grid.innerHTML = "";
    return;
  }

  grid.innerHTML = state.photos.map((photo) => `
    <div class="photo-card ${photo.status === "failed" ? "failed" : ""}" data-photo-id="${escapeAttr(photo.id)}">
      <div class="photo-thumb-wrap">
        ${photo.status === "failed"
          ? `<div class="photo-thumb placeholder">!</div>`
          : `<img class="photo-thumb" src="${escapeAttr(photo.objectUrl)}" alt="${escapeAttr(photo.name)}">`
        }
        ${photo.status && photo.status !== "ready" ? `<span class="photo-status">${escapeHtml(photo.statusMessage || "")}</span>` : ""}
      </div>
      <div class="photo-meta">
        <div class="photo-name" title="${escapeAttr(photo.name)}">${escapeHtml(photo.name)}</div>
        <input class="photo-note" value="${escapeAttr(photo.note)}">
        <button class="remove-photo" type="button">삭제</button>
      </div>
    </div>
  `).join("");

  $$(".photo-card", grid).forEach((card) => {
    const photo = state.photos.find((item) => item.id === card.dataset.photoId);
    $(".photo-note", card).addEventListener("input", (event) => {
      photo.note = event.target.value;
    });
    $(".remove-photo", card).addEventListener("click", () => {
      URL.revokeObjectURL(photo.objectUrl);
      state.photos = state.photos.filter((item) => item.id !== photo.id);
      clearResultData();
      renderPhotos();
    });
  });
}

function updateUploadStatus(message) {
  const status = $("#uploadStatus");
  if (status) status.textContent = message;
}

async function generatePost() {
  const prompt = $("#userPrompt").value.trim();
  const references = $("#noReferenceToggle").checked ? "" : $("#referenceText").value.trim();
  const readyPhotos = getReadyPhotos();
  if (state.photos.some(isPhotoLoading)) {
    showToast("사진을 처리하는 중입니다. 잠시 후 다시 눌러주세요.");
    return;
  }
  if (!readyPhotos.length) {
    showToast("먼저 사진을 추가하세요.");
    return;
  }
  if (!prompt && !references) {
    showToast("프롬프트나 레퍼런스 중 하나는 필요합니다.");
    return;
  }

  state.settings.provider = $("#providerSelect").value;
  state.settings.geminiKey = $("#geminiKey").value.trim();
  state.settings.geminiModel = $("#geminiModel").value.trim() || "gemini-2.5-flash";
  saveSettings();
  updateProviderStatus();
  clearResultData();
  setView("preview");

  lockUi(true);
  setProgress(true, "글 구조를 분석하는 중", 12);

  try {
    const brief = collectBrief();
    if (state.settings.provider === "gemini" && state.settings.geminiKey) {
      state.result = await generateWithGemini(brief);
    } else {
      state.result = generateLocally(brief);
    }
    normalizeResult();
    renderResult();
    setView("preview");
    showToast("블로그용 결과물을 만들었습니다.");
  } catch (error) {
    console.error(error);
    const brief = collectBrief();
    state.result = generateLocally(brief, error.message);
    normalizeResult();
    renderResult();
    setView("preview");
    showToast("AI 호출이 실패해 로컬 작성으로 결과를 만들었습니다.");
  } finally {
    lockUi(false);
    setProgress(false);
  }
}

function clearResultData() {
  if (!state.result) {
    renderResult();
    return;
  }
  state.result = null;
  renderResult();
}

function collectBrief() {
  const rawPrompt = $("#userPrompt").value.trim();
  const rawReferences = $("#noReferenceToggle").checked ? "" : $("#referenceText").value.trim();
  const rawKeywords = $("#keywordInput").value.split(",").map((item) => item.trim()).filter(Boolean);
  const readyPhotos = getReadyPhotos();
  const hashtagCount = parseHashtagCount();
  const firstPassTerms = buildDictationContextTerms(rawPrompt, rawReferences, rawKeywords);
  const prompt = rawPrompt;
  const references = rawReferences;
  let referenceAnalysis = analyzeReference(references);
  const contextTerms = unique([
    ...firstPassTerms,
    ...referenceAnalysis.topicKeywords,
    ...referenceAnalysis.headings.flatMap((heading) => extractKeywords(heading))
  ]).slice(0, 80);
  const finalPrompt = rawPrompt;
  const finalReferences = rawReferences;
  referenceAnalysis = analyzeReference(finalReferences);
  const dictationProfile = buildDictationProfile(rawPrompt, rawReferences, rawKeywords, finalPrompt, finalReferences, contextTerms);
  const referenceWeight = $("#noReferenceToggle").checked ? "balanced" : $("#referenceWeight").value;
  const inferredSectionCount = inferSectionCount(referenceAnalysis, finalReferences, finalPrompt, readyPhotos.length);
  const sectionCount = referenceWeight === "strict" && referenceAnalysis.outline.length
    ? clamp(referenceAnalysis.outline.length, MIN_AUTO_SECTIONS, MAX_AUTO_SECTIONS)
    : inferredSectionCount;
  return {
    prompt: finalPrompt,
    rawPrompt,
    references: finalReferences,
    rawReferences,
    referenceWeight,
    referenceAnalysis,
    tone: $("#toneSelect").value,
    platform: $("#platformSelect").value,
    hashtagCount,
    keywords: rawKeywords.map((keyword) => normalizeDictationText(keyword, contextTerms)).filter(Boolean),
    dictationProfile,
    sectionCount,
    cta: "",
    photos: readyPhotos.map((photo, index) => ({
      id: photo.id,
      index: index + 1,
      name: photo.name,
      rawNote: photo.note,
      note: normalizeDictationText(photo.note, contextTerms),
      width: photo.width,
      height: photo.height,
      colors: photo.colors,
      brightness: photo.brightness,
      visualTags: photo.visualTags
    }))
  };
}

async function generateWithGemini(brief) {
  setProgress(true, "Gemini가 사진 맥락을 읽는 중", 28);
  const model = encodeURIComponent(state.settings.geminiModel);
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(state.settings.geminiKey)}`;
  const photosForApi = getReadyPhotos().slice(0, MAX_API_IMAGES);
  const textPrompt = buildGeminiPrompt(brief, photosForApi.length);
  const parts = [{ text: textPrompt }];

  photosForApi.forEach((photo) => {
    parts.push({
      inlineData: {
        mimeType: photo.mime,
        data: photo.apiBase64
      }
    });
  });

  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts }],
      generationConfig: {
        temperature: 0.72,
        topP: 0.9,
        responseMimeType: "application/json"
      }
    })
  });

  setProgress(true, "AI 결과를 정리하는 중", 72);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Gemini API ${response.status}: ${text.slice(0, 220)}`);
  }

  const payload = await response.json();
  const text = payload?.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("\n").trim();
  if (!text) throw new Error("Gemini 응답에 본문이 없습니다.");
  const parsed = parseJsonResponse(text);
  parsed.provider = "gemini";
  parsed.sourceNote = `Gemini ${state.settings.geminiModel} 무료 티어 기반`;
  return parsed;
}

function buildGeminiPrompt(brief, photoCount) {
  const ref = brief.references.slice(0, 18000);
  const prompt = brief.prompt.slice(0, 4000);
  const rawPrompt = brief.rawPrompt.slice(0, 4000);
  const rawRef = brief.rawReferences.slice(0, 8000);
  const referenceBlueprint = JSON.stringify(brief.referenceAnalysis, null, 2).slice(0, 8000);
  const referenceStyleGuide = JSON.stringify(buildReferenceGenerationGuide(brief), null, 2).slice(0, 6000);
  const referenceDirective = buildReferenceDirective(brief, referenceStyleGuide);
  const dictationBlueprint = JSON.stringify(brief.dictationProfile, null, 2).slice(0, 5000);
  const photoMeta = brief.photos.slice(0, photoCount).map((photo) => ({
    id: photo.id,
    order: photo.index,
    filename: photo.name,
    rawUserNote: photo.rawNote,
    normalizedUserNote: photo.note,
    dimensions: `${photo.width}x${photo.height}`,
    visualHints: photo.visualTags,
    dominantColors: photo.colors
  }));

  return `
${referenceDirective}
너는 한국어 블로그 에디터이자 사진 편집자다. 사용자가 올린 사진, 원하는 글 프롬프트, 참고 블로그 글을 바탕으로 블로그에 바로 붙여넣을 수 있는 고품질 초안을 만들어라.

중요 원칙:
- 사진과 글 섹션의 맥락이 같을 때만 매칭한다. 애매하면 targetPhotoIds를 비워두고 이유를 쓴다.
- 사진을 억지로 끼워 넣지 않는다. 한 사진은 가능하면 한 섹션에만 배치한다.
- 사용자의 프롬프트, 레퍼런스, 사진 메모는 음성 인식으로 입력되어 단어가 틀렸을 수 있다. 원문을 그대로 믿지 말고 문맥, 사진, 파일명, 레퍼런스 흐름을 함께 보고 의도한 단어로 보정한다.
- 사진에서 보이는 대상과 rawUserNote가 충돌하면 사진과 normalizedUserNote를 우선 비교하고, 확실하지 않은 보정은 단정하지 않는다.
- 레퍼런스 반영 강도가 높거나 엄격하면 레퍼런스를 먼저 분석하고, 그 글의 소제목 순서, 문단 호흡, 정보 배치, 결론 방식, 말투를 새 주제에 이식한다.
- 레퍼런스 반영 강도가 엄격이면 referenceBlueprint.titleStyle과 sentenceStyle을 최우선으로 따른다. 제목의 괄호, 파이프, 슬래시, 번호형 소제목, 질문형/후기형 어미, 문장 종결 방식을 새 주제에 맞게 재현한다.
- 레퍼런스의 문장을 그대로 베끼지 않는다. 7어절 이상 연속 복사하지 말고, 사실과 표현은 사용자 프롬프트와 사진에 맞게 새로 쓴다.
- 사용자가 준 사실, 사진에서 보이는 정보, 레퍼런스에서 확인되는 정보 외에는 단정하지 않는다.
- 한국어는 자연스럽고 검색 노출에 어울리게 쓴다. 과장과 AI 같은 문투는 피한다.
- 이모지는 반드시 글 맥락에 맞게 사용한다. referenceBlueprint.emojiProfile에 이모지가 있으면 그 계열과 위치를 우선 모방하고, 없으면 사진/주제/키워드에 맞는 이모지만 고른다. 고정 아이콘처럼 모든 글에 같은 이모지를 쓰지 않는다.
- HTML은 h2, p, blockquote 정도의 안전한 태그만 사용한다. figure/img 태그는 내가 나중에 붙일 것이므로 draftHtml 안에는 넣지 않는다.
- qualityChecklist는 내부 검수 메타데이터다. 이 문장들을 draftHtml 본문, 제목, 캡션에 절대 포함하지 않는다.

레퍼런스 반영 절차:
1. referenceBlueprint의 outline을 글의 기본 골격으로 삼는다.
2. 레퍼런스에 소제목이 있으면 sections의 title과 순서를 그 역할에 맞춰 최대한 대응시킨다.
3. seo.title은 referenceBlueprint.titleStyle.sample을 복사하지 말고, 같은 제목 형식으로 새 제목을 만든다.
4. section.title은 레퍼런스 소제목의 길이, 구분자, 번호/괄호/이모지 위치를 따라 하되 단어는 새 주제에 맞게 바꾼다.
5. 레퍼런스가 도입-경험-디테일-팁-마무리 흐름이면 새 글도 같은 흐름을 따른다.
6. 각 섹션의 문단 수와 길이는 referenceBlueprint의 paragraphRhythm에 가깝게 맞춘다.
7. 레퍼런스에 체크리스트, 장단점, 가격/위치/팁 같은 정보 블록이 있으면 새 글에도 같은 성격의 블록을 둔다.
8. 절대 "레퍼런스처럼", "참고글처럼" 같은 메타 표현을 본문에 쓰지 않는다.

음성 메모 보정 절차:
1. dictationBlueprint의 corrections는 후보일 뿐이다. 사진과 전체 문맥으로 맞는지 다시 판단한다.
2. rawUserNote가 이상하면 사진 속 대상, filename, visualHints, referenceBlueprint.topicKeywords를 함께 봐서 자연스러운 한국어 명사/표현으로 바꾼다.
3. 사용자가 말한 고유명사일 가능성이 있으면 임의로 흔한 단어로 바꾸지 않는다.
4. 본문에는 어색한 음성 인식 표현을 남기지 않는다.

출력은 반드시 JSON만 반환한다. 마크다운 코드블록을 쓰지 마라.
스키마:
{
  "seo": {
    "title": "검색과 클릭을 고려한 제목",
    "description": "140자 이내 설명",
    "tags": ["요청한 개수만큼의 해시태그"],
    "slug": "english-or-korean-slug"
  },
  "photoInsights": [
    {
      "photoId": "입력 photo id",
      "captionKo": "사진을 구체적으로 설명하는 한 문장",
      "visualKeywords": ["키워드"],
      "mood": "분위기",
      "bestUse": "대표/도입/상세/증거/마무리 중 하나",
      "avoidReason": ""
    }
  ],
  "sections": [
    {
      "id": "s_1",
      "title": "문맥에 맞는 이모지가 포함된 섹션 제목",
      "intent": "이 섹션의 역할",
      "draftHtml": "<p>문단...</p><p>문단...</p>",
      "keywordAnchors": ["사진 매칭용 키워드"],
      "targetPhotoIds": ["photo id"],
      "photoRationale": "왜 이 사진이 어울리는지",
      "altText": "이미지 대체 텍스트"
    }
  ],
  "referenceStyle": {
    "followedOutline": ["반영한 레퍼런스 구조"],
    "toneNotes": ["반영한 문체 특징"],
    "faithfulness": 0
  },
  "inputCorrections": [
    {
      "field": "prompt | reference | photoNote",
      "photoId": "photo note일 때만",
      "original": "음성 인식 원문",
      "corrected": "문맥과 사진을 보고 보정한 표현",
      "reason": "보정 근거"
    }
  ],
  "qualityChecklist": ["맥락 일치 확인", "복붙 전 확인할 점"]
}

사용자 프롬프트 원문:
${rawPrompt || "(없음)"}

문맥 보정된 사용자 프롬프트:
${prompt || "(없음)"}

톤: ${brief.tone}
플랫폼: ${brief.platform}
섹션 수: ${brief.sectionCount}
레퍼런스 반영 강도: ${brief.referenceWeight}
해시태그 개수: ${brief.hashtagCount}
필수 키워드: ${brief.keywords.join(", ") || "(없음)"}
마무리 방식: 별도 CTA 없이 레퍼런스의 결말 흐름을 자연스럽게 반영

레퍼런스 분석 blueprint:
${referenceBlueprint || "(없음)"}

레퍼런스 스타일 전사 가이드:
${referenceStyleGuide || "(없음)"}

음성 메모/오타 보정 blueprint:
${dictationBlueprint || "(없음)"}

사진 메타데이터:
${JSON.stringify(photoMeta, null, 2)}

참고 블로그/메모 원문:
${rawRef || "(없음)"}

문맥 보정된 참고 블로그/메모:
  ${ref || "(없음)"}
`.trim();
}

function buildReferenceGenerationGuide(brief) {
  const analysis = brief.referenceAnalysis || {};
  const style = analysis.titleStyle || {};
  const outline = (analysis.outline || []).slice(0, brief.sectionCount);
  return {
    mode: brief.referenceWeight,
    titleSample: style.sample || "",
    titleRules: {
      bracketPrefix: style.usesBracketPrefix ? style.bracketPrefix || "same bracket prefix" : "",
      usePipe: Boolean(style.usesPipe),
      useSlash: Boolean(style.usesSlash),
      useColon: Boolean(style.usesColon),
      questionLike: Boolean(style.questionLike),
      exclamationLike: Boolean(style.exclamationLike),
      numberedHeadings: Boolean(style.numberHeading),
      emojiAtStart: Boolean(style.emojiAtStart),
      emojiAtEnd: Boolean(style.emojiAtEnd),
      shortHeading: Boolean(style.shortHeading),
      headingSamples: style.headingSamples || []
    },
    structure: {
      sectionCount: brief.sectionCount,
      outline: outline.map((item, index) => ({
        order: index + 1,
        referenceHeading: item.rawTitle || item.title,
        role: item.intent,
        paragraphCount: item.paragraphCount || 1,
        sampleTone: (item.sample || "").slice(0, 260),
        keywords: item.keywords || []
      }))
    },
    rhythm: analysis.paragraphRhythm || {},
    emojiProfile: analysis.emojiProfile || {},
    sentenceStyle: analysis.sentenceStyle || {},
    toneSignals: analysis.toneSignals || [],
    hashtagCount: brief.hashtagCount
  };
}

function buildReferenceDirective(brief, styleGuide) {
  if (!brief.references.trim()) {
    return `레퍼런스가 없으면 사용자 프롬프트와 사진 기준으로 작성한다. 해시태그는 정확히 ${brief.hashtagCount}개만 만든다.`;
  }
  if (brief.referenceWeight === "strict") {
    return `
[레퍼런스 엄격 전사 모드]
- 먼저 레퍼런스의 제목 형식, 소제목 형식, 섹션 순서, 문단 길이, 이모지 위치, 말투를 분석한 뒤 새 주제에 이식한다.
- seo.title은 레퍼런스 제목을 복사하지 말고 같은 포맷만 복제한다. 예: 괄호/파이프/슬래시/질문형/느낌표/이모지 위치를 그대로 유지한다.
- sections는 레퍼런스 outline 순서와 역할을 따른다. 레퍼런스의 1번째 소제목 역할은 결과의 1번째 소제목 역할이 되어야 한다.
- section.title은 각 referenceHeading의 장식과 형태를 유지하되 단어만 새 주제에 맞게 바꾼다.
- 문단 수와 호흡은 각 outline의 paragraphCount와 paragraphRhythm을 따른다. 짧은 후기형이면 짧게, 정보 정리형이면 정보 배치까지 비슷하게 쓴다.
- emojiProfile.unique에 이모지가 있으면 같은 이모지 계열과 위치를 우선 사용한다.
- seo.tags는 정확히 ${brief.hashtagCount}개만 반환한다. 0이면 빈 배열을 반환한다.
- 아래 styleGuide를 최우선 제약으로 따른다.
${styleGuide}
`.trim();
  }
  if (brief.referenceWeight === "high") {
    return `
[레퍼런스 구조 우선 모드]
- 레퍼런스의 소제목 순서, 제목 장식, 문단 리듬, 이모지 위치를 가능한 한 따른다.
- 내용은 새 주제와 사진에 맞게 쓰되 구조와 무드는 레퍼런스에 가깝게 유지한다.
- seo.tags는 정확히 ${brief.hashtagCount}개만 반환한다.
${styleGuide}
`.trim();
  }
  return `
[레퍼런스 참고 모드]
- 레퍼런스는 주제 흐름과 톤 참고용으로만 사용한다.
- seo.tags는 정확히 ${brief.hashtagCount}개만 반환한다.
`.trim();
}

function parseJsonResponse(text) {
  const cleaned = text
    .replace(/^```json/i, "")
    .replace(/^```/i, "")
    .replace(/```$/i, "")
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(cleaned.slice(start, end + 1));
    }
    throw new Error("AI 응답 JSON 파싱에 실패했습니다.");
  }
}

function buildDictationContextTerms(rawPrompt, rawReferences, rawKeywords) {
  const photoTerms = getReadyPhotos().flatMap((photo) => [
    ...extractKeywords(photo.name.replace(/\.[^.]+$/, "")),
    ...extractKeywords(photo.note),
    ...photo.visualTags
  ]);
  return unique([
    ...rawKeywords,
    ...photoTerms,
    ...extractKeywords(rawPrompt),
    ...extractKeywords(rawReferences).slice(0, 24)
  ])
    .filter((term) => term.length >= 2 && term.length <= 18)
    .slice(0, 80);
}

function buildDictationProfile(rawPrompt, rawReferences, rawKeywords, prompt, references, contextTerms) {
  const photoCorrections = getReadyPhotos()
    .map((photo) => {
      const corrected = normalizeDictationText(photo.note, contextTerms);
      return corrected && corrected !== photo.note.trim()
        ? {
          field: "photoNote",
          photoId: photo.id,
          original: photo.note,
          corrected,
          reason: "사진 파일명, 사진 힌트, 전체 키워드를 기준으로 음성 메모 표현을 보정"
        }
        : null;
    })
    .filter(Boolean);
  return {
    contextTerms: contextTerms.slice(0, 36),
    rawKeywords,
    corrections: [
      ...detectTextCorrection("prompt", rawPrompt, prompt),
      ...detectTextCorrection("reference", rawReferences, references),
      ...photoCorrections
    ].slice(0, 24),
    instruction: "음성 인식 오류처럼 보이는 표현은 사진과 문맥을 함께 보고 자연스러운 단어로 보정하되, 불확실한 고유명사는 임의로 바꾸지 않는다."
  };
}

function detectTextCorrection(field, original, corrected) {
  const source = (original || "").trim();
  const fixed = (corrected || "").trim();
  if (!source || source === fixed) return [];
  if (source.replace(/\s+/g, " ") === fixed.replace(/\s+/g, " ")) return [];
  return [{
    field,
    original: source.slice(0, 220),
    corrected: fixed.slice(0, 220),
    reason: "문맥 키워드와 사진 단서를 기준으로 음성 인식/오타 가능성이 있는 표현을 보정"
  }];
}

function normalizeDictationText(text, contextTerms = []) {
  if (!text) return "";
  let normalized = String(text)
    .replace(/\r\n/g, "\n")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  const replacements = [
    [/래퍼런스|레퍼\s*렌스|래퍼\s*런스/g, "레퍼런스"],
    [/블러그|브로그/g, "블로그"],
    [/섹숀|쎅션|섹쎤/g, "섹션"],
    [/프롬프트트|프롬\s*프트/g, "프롬프트"],
    [/복\s*붙/g, "복붙"],
    [/붙여\s*넣기/g, "붙여넣기"],
    [/업\s*로드/g, "업로드"],
    [/네이\s*버/g, "네이버"],
    [/티\s*스토리/g, "티스토리"],
    [/워드\s*프레스/g, "워드프레스"],
    [/카페\s*라떼/g, "카페라떼"],
    [/아메리카\s*노/g, "아메리카노"]
  ];
  replacements.forEach(([pattern, replacement]) => {
    normalized = normalized.replace(pattern, replacement);
  });

  normalized = normalized
    .replace(/(^|\s)(음|어|아|그|저기|뭐지|그러니까)(?=\s|$)/g, " ")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .trim();

  return repairTextWithContext(normalized, contextTerms);
}

function repairTextWithContext(text, contextTerms) {
  const terms = unique(contextTerms)
    .filter((term) => /^[가-힣A-Za-z0-9][가-힣A-Za-z0-9\s-]{1,17}$/.test(term))
    .sort((a, b) => b.length - a.length)
    .slice(0, 80);
  if (!terms.length) return text;

  return text.replace(/[가-힣A-Za-z0-9]{2,18}/g, (token) => {
    const repaired = findClosestContextTerm(token, terms);
    return repaired || token;
  });
}

function findClosestContextTerm(token, terms) {
  if (stopwords.has(token.toLowerCase())) return "";
  let best = null;
  for (const term of terms) {
    const compactTerm = term.replace(/\s+/g, "");
    if (compactTerm === token || compactTerm.length < 2) continue;
    if (Math.abs(compactTerm.length - token.length) > 2) continue;
    const similarity = koreanSimilarity(token, compactTerm);
    if (similarity >= 0.88 && (!best || similarity > best.similarity)) {
      best = { term: compactTerm, similarity };
    }
  }
  return best?.term || "";
}

function koreanSimilarity(a, b) {
  const left = hangulSignature(a);
  const right = hangulSignature(b);
  const distance = levenshtein(left, right);
  return 1 - distance / Math.max(left.length, right.length, 1);
}

function hangulSignature(text) {
  const choseong = ["ㄱ", "ㄲ", "ㄴ", "ㄷ", "ㄸ", "ㄹ", "ㅁ", "ㅂ", "ㅃ", "ㅅ", "ㅆ", "ㅇ", "ㅈ", "ㅉ", "ㅊ", "ㅋ", "ㅌ", "ㅍ", "ㅎ"];
  const jungseong = ["ㅏ", "ㅐ", "ㅑ", "ㅒ", "ㅓ", "ㅔ", "ㅕ", "ㅖ", "ㅗ", "ㅘ", "ㅙ", "ㅚ", "ㅛ", "ㅜ", "ㅝ", "ㅞ", "ㅟ", "ㅠ", "ㅡ", "ㅢ", "ㅣ"];
  const jongseong = ["", "ㄱ", "ㄲ", "ㄳ", "ㄴ", "ㄵ", "ㄶ", "ㄷ", "ㄹ", "ㄺ", "ㄻ", "ㄼ", "ㄽ", "ㄾ", "ㄿ", "ㅀ", "ㅁ", "ㅂ", "ㅄ", "ㅅ", "ㅆ", "ㅇ", "ㅈ", "ㅊ", "ㅋ", "ㅌ", "ㅍ", "ㅎ"];
  return [...String(text).toLowerCase()].map((char) => {
    const code = char.charCodeAt(0);
    if (code < 0xac00 || code > 0xd7a3) return char;
    const offset = code - 0xac00;
    const cho = Math.floor(offset / 588);
    const jung = Math.floor((offset % 588) / 28);
    const jong = offset % 28;
    return `${choseong[cho]}${jungseong[jung]}${jongseong[jong]}`;
  }).join("");
}

function levenshtein(a, b) {
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    let last = i - 1;
    previous[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const old = previous[j];
      previous[j] = Math.min(
        previous[j] + 1,
        previous[j - 1] + 1,
        last + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
      last = old;
    }
  }
  return previous[b.length];
}

function analyzeReference(text) {
  const empty = {
    rawLength: 0,
    headings: [],
    outline: [],
    paragraphRhythm: {
      paragraphCount: 0,
      avgChars: 0,
      paragraphsPerSection: 1,
      listDensity: 0
    },
    toneSignals: [],
    titleStyle: {
      sample: "",
      headingSamples: [],
      patternSummary: ""
    },
    emojiProfile: {
      unique: [],
      count: 0,
      density: 0,
      placement: "none"
    },
    sentenceStyle: {
      dominantEnding: "politeYo",
      avgSentenceChars: 0,
      firstPerson: false,
      colloquial: false,
      endings: {}
    },
    topicKeywords: []
  };
  const normalized = (text || "").replace(/\r\n/g, "\n").trim();
  if (!normalized) return empty;

  const lines = normalized.split("\n").map((line) => line.trim()).filter(Boolean);
  const paragraphs = splitParagraphs(normalized);
  let headingCandidates = lines
    .map((line, index) => ({ text: cleanHeading(line), index, raw: line }))
    .filter((item) => isLikelyHeading(item.raw, item.text))
    .slice(0, 12);
  if (headingCandidates.length < 2) {
    headingCandidates = inferStructuralHeadings(lines);
  }
  const listLines = lines.filter((line) => /^(\s*[-*•]|\s*\d+[\).])\s+/.test(line));
  const avgChars = paragraphs.length
    ? Math.round(paragraphs.reduce((sum, paragraph) => sum + paragraph.length, 0) / paragraphs.length)
    : Math.round(normalized.length / Math.max(1, lines.length));
  const topicKeywords = extractKeywords(normalized).slice(0, 16);
  const paragraphRhythm = {
    paragraphCount: paragraphs.length,
    avgChars,
    paragraphsPerSection: Math.max(1, Math.round(paragraphs.length / Math.max(1, headingCandidates.length || 3))),
    listDensity: Number((listLines.length / Math.max(1, lines.length)).toFixed(2))
  };
  const titleStyle = analyzeTitleStyle(lines, headingCandidates);
  const emojiProfile = analyzeEmojiProfile(normalized);

  const outline = headingCandidates.length >= 2
    ? headingCandidates.map((heading, index) => {
      const next = headingCandidates[index + 1]?.index ?? lines.length;
      const sectionText = lines.slice(heading.index + 1, next).join("\n");
      const sample = splitParagraphs(sectionText)[0] || sectionText.replace(/\s+/g, " ").slice(0, 220);
      return {
        title: heading.text,
        rawTitle: heading.raw,
        titleSignature: getTitleSignature(heading.raw),
        intent: inferReferenceIntent(heading.text, sample, index),
        sample,
        keywords: extractKeywords(`${heading.text} ${sample}`).slice(0, 8),
        paragraphCount: Math.max(1, splitParagraphs(sectionText).length || 1)
      };
    })
    : chunkReferenceParagraphs(paragraphs.length ? paragraphs : [normalized], topicKeywords);

  const analysis = {
    rawLength: normalized.length,
    headings: headingCandidates.map((item) => item.text),
    outline: outline.slice(0, 12),
    paragraphRhythm,
    toneSignals: detectReferenceTone(normalized),
    titleStyle,
    emojiProfile,
    sentenceStyle: analyzeSentenceStyle(normalized),
    topicKeywords
  };
  analysis.structureGuide = buildReferenceStructureGuide(analysis);
  return analysis;
}

function inferSectionCount(analysis, references, prompt, photoCount) {
  const headingCount = analysis?.headings?.length || 0;
  if (headingCount >= MIN_AUTO_SECTIONS) {
    return clamp(headingCount, MIN_AUTO_SECTIONS, MAX_AUTO_SECTIONS);
  }

  const paragraphCount = analysis?.paragraphRhythm?.paragraphCount || splitParagraphs(references).length;
  const textLength = (references || "").length + (prompt || "").length;
  const outlineCount = analysis?.outline?.length || 0;
  let count = outlineCount >= MIN_AUTO_SECTIONS ? outlineCount : 4;

  if (textLength > 3500) count += 1;
  if (textLength > 7500) count += 1;
  if (paragraphCount > 8) count += 1;
  if (paragraphCount > 14) count += 1;
  if (photoCount >= 5) count += 1;
  if (photoCount >= 9) count += 1;

  return clamp(count, MIN_AUTO_SECTIONS, MAX_AUTO_SECTIONS);
}

function inferStructuralHeadings(lines) {
  const candidates = [];
  lines.forEach((raw, index) => {
    const cleaned = cleanHeading(raw);
    if (!cleaned || cleaned.length < 3 || cleaned.length > 58) return;
    if (/https?:\/\/|www\./i.test(cleaned)) return;
    const previous = lines[index - 1] || "";
    const next = lines[index + 1] || "";
    const tokenCount = cleaned.split(/\s+/).filter(Boolean).length;
    const shaped = /^#+\s+|^\d+[\).]\s+|^[①-⑳]\s*|^\[[^\]]+\]|^\p{Extended_Pictographic}/u.test(raw);
    const looksLikeTitle = tokenCount <= 8 && cleaned.length <= 38;
    const nextLooksBody = next.length >= Math.max(28, cleaned.length + 8);
    const previousLooksBody = previous.length >= 44;
    const sentenceEnding = /(습니다|해요|어요|예요|이에요|했다|했어요|입니다|\.|!|\?)$/.test(cleaned);
    const headingCue = /후기|리뷰|추천|정리|요약|장점|단점|아쉬|좋았|포인트|체크|총평|마무리|첫인상|분위기|위치|가격|메뉴|사용|디테일|이유|방법|과정|방문/.test(cleaned);
    if ((shaped || headingCue || (looksLikeTitle && nextLooksBody && !previousLooksBody)) && !sentenceEnding) {
      candidates.push({ text: cleaned, index, raw });
    }
  });
  return candidates.slice(0, 12);
}

function buildReferenceStructureGuide(analysis) {
  const outline = analysis.outline || [];
  const style = analysis.titleStyle || {};
  const rhythm = analysis.paragraphRhythm || {};
  const emoji = analysis.emojiProfile || {};
  const sentence = analysis.sentenceStyle || {};
  const headingShape = [
    style.numberHeading ? "numbered headings" : "",
    style.usesBracketPrefix ? "bracket prefix" : "",
    style.usesPipe ? "pipe divider" : "",
    style.usesSlash ? "slash divider" : "",
    style.emojiAtStart ? "emoji at start" : "",
    style.emojiAtEnd ? "emoji at end" : "",
    style.questionLike ? "question style" : "",
    style.exclamationLike ? "exclamation style" : ""
  ].filter(Boolean);

  return {
    sectionCount: outline.length,
    headingShape,
    headingSamples: (style.headingSamples || []).slice(0, 8),
    outlineRoles: outline.map((item, index) => ({
      order: index + 1,
      referenceHeading: item.rawTitle || item.title,
      role: item.intent,
      paragraphCount: item.paragraphCount,
      keywords: item.keywords
    })),
    paragraphRhythm: {
      avgChars: rhythm.avgChars || 0,
      paragraphsPerSection: rhythm.paragraphsPerSection || 1,
      listDensity: rhythm.listDensity || 0
    },
    emoji: {
      unique: emoji.unique || [],
      density: emoji.density || 0,
      placement: emoji.placement || "none"
    },
    tone: {
      signals: analysis.toneSignals || [],
      dominantEnding: sentence.dominantEnding || "politeYo",
      colloquial: Boolean(sentence.colloquial),
      firstPerson: Boolean(sentence.firstPerson)
    }
  };
}

function analyzeTitleStyle(lines, headingCandidates) {
  const candidates = [
    ...lines.slice(0, 4),
    ...headingCandidates.map((item) => item.raw)
  ].map((line) => line.trim()).filter(Boolean);
  const sample = candidates.find((line) => cleanHeading(line).length >= 4) || "";
  const cleaned = cleanHeading(sample);
  const headingSamples = headingCandidates.map((item) => item.raw).slice(0, 8);
  const headingText = headingSamples.join("\n");
  return {
    sample: cleaned,
    usesBracketPrefix: /^\[[^\]]+\]/.test(sample),
    bracketPrefix: sample.match(/^\[([^\]]+)\]/)?.[1] || "",
    usesColon: /[:：]/.test(cleaned),
    usesPipe: /\s[|｜]\s/.test(cleaned),
    usesSlash: /\s\/\s|·/.test(cleaned),
    questionLike: /\?$|？$|까$|나요$/.test(cleaned),
    exclamationLike: /!$|！$/.test(cleaned),
    numberHeading: headingSamples.some((line) => /^\d+[\).]\s+/.test(line)),
    shortHeading: headingSamples.length ? average(headingSamples.map((line) => cleanHeading(line).length)) <= 16 : cleaned.length <= 22,
    emojiAtStart: headingSamples.some((line) => /^\p{Extended_Pictographic}/u.test(line.trim())),
    emojiAtEnd: headingSamples.some((line) => /\p{Extended_Pictographic}\uFE0F?$/u.test(line.trim())),
    headingSamples: headingSamples.map(cleanHeading).slice(0, 6),
    patternSummary: summarizeTitlePattern(sample, headingText)
  };
}

function analyzeEmojiProfile(text) {
  const emojis = [...(text || "").matchAll(/\p{Extended_Pictographic}\uFE0F?(?:\u200D\p{Extended_Pictographic}\uFE0F?)*/gu)].map((match) => match[0]);
  const counts = new Map();
  emojis.forEach((emoji) => counts.set(emoji, (counts.get(emoji) || 0) + 1));
  const unique = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([emoji]) => emoji);
  return {
    unique: unique.slice(0, 16),
    count: emojis.length,
    density: Number((emojis.length / Math.max(1, (text || "").length / 1000)).toFixed(2)),
    placement: detectEmojiPlacement(text)
  };
}

function analyzeSentenceStyle(text) {
  const sentences = splitSentences(text).slice(0, 80);
  const endings = {
    politeYo: sentences.filter((item) => /(요|어요|아요|네요|더라고요|했어요)$/.test(item)).length,
    formalDa: sentences.filter((item) => /(다|니다|됩니다|합니다)$/.test(item)).length,
    casual: sentences.filter((item) => /(함|음|듯|ㅎㅎ|ㅋㅋ|대박|진짜)$/.test(item)).length,
    question: sentences.filter((item) => /\?$|까요$|나요$/.test(item)).length
  };
  const dominantEnding = Object.entries(endings).sort((a, b) => b[1] - a[1])[0]?.[0] || "politeYo";
  return {
    dominantEnding,
    avgSentenceChars: sentences.length ? Math.round(average(sentences.map((item) => item.length))) : 0,
    firstPerson: /저는|제가|저희|우리/.test(text),
    colloquial: /ㅎㅎ|ㅋㅋ|진짜|완전|너무|딱|살짝|뭔가/.test(text),
    endings
  };
}

function summarizeTitlePattern(sample, headingText) {
  const notes = [];
  if (/^\[[^\]]+\]/.test(sample)) notes.push("대괄호 말머리");
  if (/\s[|｜]\s/.test(sample)) notes.push("파이프 구분");
  if (/\s\/\s|·/.test(sample)) notes.push("슬래시/가운뎃점 구분");
  if (/후기|리뷰|정리|추천|비교|총정리/.test(sample)) notes.push("검색 키워드형 제목");
  if (/솔직|내돈내산|찐|실제/.test(sample + headingText)) notes.push("솔직 후기 톤");
  if (/^\d+[\).]\s+/m.test(headingText)) notes.push("번호형 소제목");
  if (/\p{Extended_Pictographic}/u.test(sample + headingText)) notes.push("이모지 포함");
  return notes.length ? notes.join(", ") : "간결한 블로그 제목형";
}

function getTitleSignature(rawTitle) {
  const raw = rawTitle || "";
  return {
    numbered: /^\d+[\).]\s+/.test(raw),
    bracket: raw.match(/^(\[[^\]]+\])/)?.[1] || "",
    emojiStart: raw.match(/^(\p{Extended_Pictographic}\uFE0F?)/u)?.[1] || "",
    emojiEnd: raw.match(/(\p{Extended_Pictographic}\uFE0F?)$/u)?.[1] || "",
    divider: /\s[|｜]\s/.test(raw) ? "|" : /\s\/\s/.test(raw) ? "/" : /·/.test(raw) ? "·" : "",
    question: /\?$|？$|나요$|까요$/.test(raw),
    exclamation: /!$|！$/.test(raw)
  };
}

function detectEmojiPlacement(text) {
  const lines = (text || "").split("\n").map((line) => line.trim()).filter(Boolean);
  if (!lines.length) return "none";
  const start = lines.filter((line) => /^\p{Extended_Pictographic}/u.test(line)).length;
  const end = lines.filter((line) => /\p{Extended_Pictographic}\uFE0F?$/u.test(line)).length;
  if (start > end && start > 0) return "start";
  if (end > 0) return "end";
  return /\p{Extended_Pictographic}/u.test(text) ? "inline" : "none";
}

function cleanHeading(line) {
  return line
    .replace(/^#+\s*/, "")
    .replace(/^(\d+[\).]|\-|\*|•)\s*/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isLikelyHeading(rawLine, cleaned) {
  if (!cleaned || cleaned.length < 3 || cleaned.length > 46) return false;
  if (/https?:\/\/|www\./i.test(cleaned)) return false;
  if (/[.!。]$/.test(cleaned)) return false;
  if (/^[-*•]\s+/.test(rawLine) && cleaned.length > 22) return false;
  if (/^#+\s+/.test(rawLine)) return true;
  if (/^\d+[\).]\s+/.test(rawLine)) return true;
  const tokenCount = cleaned.split(/\s+/).filter(Boolean).length;
  const hasHeadingCue = /후기|추천|정리|요약|장점|단점|가격|위치|주차|메뉴|맛|공간|분위기|팁|체크|마무리|총평|방문|예약|이유|포인트/.test(cleaned);
  return tokenCount <= 7 && (hasHeadingCue || cleaned.length <= 24);
}

function inferReferenceIntent(title, sample, index) {
  const text = `${title} ${sample}`;
  if (/첫|도입|시작|한눈|요약|총정리/.test(text)) return "도입에서 핵심 인상과 읽을 이유를 잡는다.";
  if (/위치|주차|예약|가격|운영|시간|가는|정보/.test(text)) return "방문 전 필요한 정보를 정리한다.";
  if (/메뉴|맛|제품|사용|성능|디자인|구성/.test(text)) return "핵심 대상의 구체적인 특징을 설명한다.";
  if (/공간|분위기|인테리어|자리|좌석|뷰/.test(text)) return "현장의 분위기와 체감 포인트를 보여준다.";
  if (/장점|좋았|추천|포인트|만족/.test(text)) return "좋았던 점과 추천 이유를 설득력 있게 정리한다.";
  if (/단점|아쉬|주의|체크|팁/.test(text)) return "아쉬운 점과 체크할 부분을 균형 있게 다룬다.";
  if (/마무리|총평|결론|재방문/.test(text)) return "전체 판단과 다음 행동을 자연스럽게 제안한다.";
  return index === 0 ? "레퍼런스의 도입 역할을 새 글에 맞게 옮긴다." : "레퍼런스의 전개 방식을 새 주제에 맞게 적용한다.";
}

function chunkReferenceParagraphs(paragraphs, topicKeywords) {
  const count = Math.min(7, Math.max(3, paragraphs.length || 3));
  const chunkSize = Math.max(1, Math.ceil(paragraphs.length / count));
  return Array.from({ length: count }, (_, index) => {
    const sample = paragraphs.slice(index * chunkSize, (index + 1) * chunkSize).join(" ") || paragraphs[index % Math.max(1, paragraphs.length)] || "";
    return {
      title: referenceFallbackTitle(index),
      rawTitle: referenceFallbackTitle(index),
      titleSignature: getTitleSignature(referenceFallbackTitle(index)),
      intent: inferReferenceIntent(referenceFallbackTitle(index), sample, index),
      sample,
      keywords: unique([...extractKeywords(sample), ...topicKeywords.slice(0, 4)]).slice(0, 8),
      paragraphCount: Math.max(1, Math.min(3, splitSentences(sample).length))
    };
  });
}

function referenceFallbackTitle(index) {
  return ["첫인상", "핵심 포인트", "디테일", "좋았던 점", "체크 포인트", "추천 대상", "마무리"][index] || `섹션 ${index + 1}`;
}

function detectReferenceTone(text) {
  const signals = [];
  if (/저는|제가|다녀왔|먹어봤|써봤|방문했/.test(text)) signals.push("1인칭 경험담");
  if (/추천|좋았|만족|재방문/.test(text)) signals.push("추천형 후기");
  if (/가격|위치|주차|시간|예약|정보/.test(text)) signals.push("정보 정리형");
  if (/아쉬|단점|주의|체크/.test(text)) signals.push("균형 잡힌 평가");
  if (/!|ㅎㅎ|ㅋㅋ|완전|진짜|너무/.test(text)) signals.push("캐주얼한 표현");
  if (/습니다|합니다|됩니다/.test(text)) signals.push("정돈된 설명체");
  return signals.length ? signals : ["일반 후기체"];
}

function buildReferenceOutline(analysis, count) {
  if (!analysis?.outline?.length) return [];
  const outline = analysis.outline.slice(0, count);
  while (outline.length < count) {
    const index = outline.length;
    outline.push({
      title: referenceFallbackTitle(index),
      intent: inferReferenceIntent(referenceFallbackTitle(index), "", index),
      sample: analysis.outline[index % analysis.outline.length]?.sample || "",
      keywords: analysis.topicKeywords.slice(0, 8),
      paragraphCount: analysis.paragraphRhythm.paragraphsPerSection
    });
  }
  return outline;
}

function adaptReferenceTitle(outlineItem, fallbackTitle, brief, keywords, index) {
  const referenceTitle = outlineItem?.title || fallbackTitle || "";
  const core = buildSectionTitleCore(referenceTitle, fallbackTitle, brief, keywords, outlineItem?.intent || "", index);
  const signature = outlineItem?.titleSignature || getTitleSignature(outlineItem?.rawTitle || referenceTitle);
  const styled = applyReferenceHeadingFormat(core, signature, brief.referenceAnalysis.titleStyle, index);
  return decorateSectionTitle(styled, index, `${outlineItem?.intent || ""} ${(outlineItem?.keywords || []).join(" ")}`, brief);
}

function makeReferenceRhythmParagraphs(brief, outlineItem, keywords, index) {
  if (brief.referenceWeight === "balanced") return "";
  const wanted = brief.referenceWeight === "strict"
    ? Math.min(3, Math.max(1, outlineItem.paragraphCount || brief.referenceAnalysis.paragraphRhythm.paragraphsPerSection))
    : Math.min(2, Math.max(1, outlineItem.paragraphCount || 1));
  if (wanted <= 1) return "";

  const keyLine = unique([...(outlineItem.keywords || []), ...keywords]).slice(0, 5).join(", ");
  const paragraphs = [];
  for (let i = 1; i < wanted; i += 1) {
    const base = i === wanted - 1 && index >= brief.sectionCount - 2
      ? `${keyLine || "핵심 포인트"}를 기준으로 다시 보면 선택 기준이 더 분명해집니다`
      : `${keyLine || "핵심 포인트"}를 먼저 짚어두면 사진 속 장면과 글의 흐름이 자연스럽게 이어집니다`;
    const sentence = applySentenceStyle(base, brief.referenceAnalysis.sentenceStyle);
    paragraphs.push(`<p>${escapeHtml(sentence)}</p>`);
  }
  return paragraphs.join("");
}

function decorateSectionTitle(title, index, intent = "", brief = null) {
  const cleaned = String(title || "").trim();
  if (hasEmoji(cleaned)) return cleaned;
  const emoji = pickContextEmoji(`${cleaned} ${intent} ${brief?.prompt || ""} ${(brief?.keywords || []).join(" ")}`, index, brief);
  if (!emoji) return cleaned;
  const placement = brief?.referenceAnalysis?.emojiProfile?.placement === "end" || brief?.referenceAnalysis?.titleStyle?.emojiAtEnd ? "end" : "start";
  return placement === "end" ? `${cleaned} ${emoji}`.trim() : `${emoji} ${cleaned}`.trim();
}

function enforceSectionTitleFormat(title, index, intent, brief) {
  const cleaned = stripTitleOrnaments(title);
  if (brief.referenceWeight === "balanced") return decorateSectionTitle(cleaned || title, index, intent, brief);
  const outlineItem = brief.referenceAnalysis?.outline?.[index];
  const signature = outlineItem?.titleSignature || getTitleSignature(outlineItem?.rawTitle || "");
  const hasReferenceShape = Boolean(signature.numbered || signature.bracket || signature.divider || signature.question || signature.exclamation);
  const core = cleaned || buildSectionTitleCore(outlineItem?.title || title, title, brief, brief.keywords, intent, index);
  const formatted = hasReferenceShape
    ? applyReferenceHeadingFormat(core, signature, brief.referenceAnalysis.titleStyle, index)
    : core;
  return decorateSectionTitle(formatted, index, `${intent} ${(outlineItem?.keywords || []).join(" ")}`, brief);
}

function enforceSeoTitleFormat(title, brief, keywords) {
  const style = brief.referenceAnalysis?.titleStyle || {};
  let result = stripTitleOrnaments(title) || title;
  if (brief.referenceWeight !== "balanced") {
    if (style.usesBracketPrefix && !/^\[[^\]]+\]/.test(result)) {
      result = `[${style.bracketPrefix || "후기"}] ${result}`;
    }
    if (style.usesPipe && !/\s[|｜]\s/.test(result)) {
      result = `${result} | ${pickHeadingTail(style, 0)}`;
    }
    if (style.usesSlash && !/\s\/\s|·/.test(result)) {
      result = `${result} / ${pickHeadingTail(style, 0)}`;
    }
    if (style.questionLike && !/[?？]$/.test(result)) {
      result = result.replace(/[.!。！？?]+$/, "") + "?";
    }
    if (style.exclamationLike && !/[!！]$/.test(result)) {
      result = result.replace(/[.!。！？?]+$/, "") + "!";
    }
  }
  if (brief.referenceWeight !== "balanced") {
    result = applyReferenceSeoTitleShape(result, style.sample || "", style, brief, keywords);
  }
  return decorateSectionTitle(result.slice(0, 70), 0, keywords.join(" "), brief);
}

function applyReferenceSeoTitleShape(title, sample, style, brief, keywords) {
  if (!sample) return title;
  const subject = inferSubject(brief, keywords);
  const cleanSample = cleanHeading(sample);
  const core = stripTitleOrnaments(title)
    .replace(/\s[|｜]\s.*$/, "")
    .replace(/\s\/\s.*$/, "")
    .replace(/[:：].*$/, "")
    .trim() || subject;
  let shaped = core;
  const pipeTail = cleanSample.split(/\s[|｜]\s/).slice(1).join(" | ").trim();
  const slashTail = cleanSample.split(/\s\/\s/).slice(1).join(" / ").trim();
  const colonTail = cleanSample.split(/[:：]/).slice(1).join(":").trim();
  if (pipeTail) shaped = `${core} | ${adaptTitleTail(pipeTail, subject)}`;
  else if (slashTail) shaped = `${core} / ${adaptTitleTail(slashTail, subject)}`;
  else if (colonTail) shaped = `${core}: ${adaptTitleTail(colonTail, subject)}`;
  if (style.usesBracketPrefix && !/^\[[^\]]+\]/.test(shaped)) {
    shaped = `[${style.bracketPrefix || sample.match(/^\[([^\]]+)\]/)?.[1] || "후기"}] ${shaped}`;
  }
  if (style.questionLike) shaped = shaped.replace(/[.!?。！？]+$/, "") + "?";
  if (style.exclamationLike) shaped = shaped.replace(/[.!?。！？]+$/, "") + "!";
  return shaped;
}

function adaptTitleTail(tail, subject) {
  const cleaned = stripTitleOrnaments(tail).trim();
  if (!cleaned) return "후기";
  return cleaned
    .replace(/이곳|여기|장소|제품|메뉴/g, subject)
    .replace(/^.+?\s+(후기|리뷰|추천|정리|체크|총평)/, "$1")
    .slice(0, 24);
}

function stripTitleOrnaments(title) {
  return String(title || "")
    .replace(/^\p{Extended_Pictographic}\uFE0F?\s*/u, "")
    .replace(/\s*\p{Extended_Pictographic}\uFE0F?$/u, "")
    .replace(/^\d+[\).]\s+/, "")
    .replace(/^\[[^\]]+\]\s*/, "")
    .trim();
}

function hasEmoji(text) {
  return /\p{Extended_Pictographic}/u.test(text);
}

function buildSectionTitleCore(referenceTitle, fallbackTitle, brief, keywords, intent, index) {
  const subject = inferSubject(brief, keywords);
  const text = `${referenceTitle} ${fallbackTitle} ${intent}`;
  if (/위치|주차|예약|시간|가는|정보/.test(text)) return `${subject} 기본 정보`;
  if (/메뉴|맛|음식|카페|식당|디저트|브런치/.test(text)) return `${subject}에서 좋았던 메뉴`;
  if (/공간|분위기|인테리어|자리|좌석|뷰/.test(text)) return `${subject} 분위기`;
  if (/제품|사용|성능|디자인|구성|상세|디테일/.test(text)) return `${subject} 디테일`;
  if (/장점|좋았|추천|포인트|만족/.test(text)) return `좋았던 포인트`;
  if (/단점|아쉬|주의|체크|팁/.test(text)) return `체크하면 좋은 점`;
  if (/마무리|총평|결론|재방문|요약/.test(text)) return `총평`;
  if (index === 0) return `${subject} 첫인상`;
  return fallbackTitle || referenceTitle || `섹션 ${index + 1}`;
}

function applyReferenceHeadingFormat(core, signature, titleStyle, index) {
  let title = core;
  const divider = signature.divider || "";
  if (divider === "|") title = `${core} | ${pickHeadingTail(titleStyle, index)}`;
  if (divider === "/") title = `${core} / ${pickHeadingTail(titleStyle, index)}`;
  if (divider === "·") title = `${core} · ${pickHeadingTail(titleStyle, index)}`;
  if (signature.bracket) title = `${signature.bracket} ${title}`;
  if (signature.numbered || titleStyle?.numberHeading) title = `${index + 1}. ${title.replace(/^\d+[\).]\s+/, "")}`;
  if (signature.question) title = title.replace(/[.!。！？?]+$/, "") + "?";
  if (signature.exclamation) title = title.replace(/[.!。！？?]+$/, "") + "!";
  return title.slice(0, titleStyle?.shortHeading ? 28 : 42);
}

function pickHeadingTail(titleStyle, index) {
  const samples = titleStyle?.headingSamples || [];
  const sampleTail = samples
    .map((sample) => sample.split(/\s[|｜/]\s|·/).at(-1)?.trim())
    .find((tail) => tail && tail.length <= 14 && tail.length >= 2);
  if (sampleTail && !/^[\p{Extended_Pictographic}\s]+$/u.test(sampleTail)) return sampleTail;
  return ["후기", "포인트", "체크", "총평"][index % 4];
}

function pickContextEmoji(text, index, brief = null) {
  const refEmojis = brief?.referenceAnalysis?.emojiProfile?.unique || [];
  const haystack = `${text || ""} ${(brief?.referenceAnalysis?.topicKeywords || []).join(" ")}`;
  const rules = [
    [/커피|카페|라떼|아메리카노|디저트|베이커리|브런치|빵/, ["☕", "🥐", "🍰"]],
    [/맛집|식당|메뉴|음식|고기|회|파스타|피자|라멘|국수|떡볶이|밥|술집/, ["🍜", "🥩", "🍽️"]],
    [/여행|숙소|호텔|공항|비행|바다|제주|부산|해변|휴양|투어/, ["✈️", "🧳", "🏝️"]],
    [/공간|인테리어|집|홈|가구|소품|방|거실|스튜디오/, ["🛋️", "🪴", "🏠"]],
    [/뷰티|화장품|피부|크림|세럼|향수|메이크업|헤어/, ["🧴", "💄", "🫧"]],
    [/패션|옷|가방|신발|코디|쇼핑|브랜드/, ["🛍️", "👟", "🧥"]],
    [/노트북|앱|프로그램|기기|휴대폰|아이폰|갤럭시|카메라|전자|개발/, ["💻", "📱", "📷"]],
    [/운동|헬스|요가|필라테스|러닝|수영|등산/, ["🏃", "🧘", "⛰️"]],
    [/책|공부|강의|수업|자격증|시험|문구|노트/, ["📚", "✍️", "🗂️"]],
    [/전시|공연|영화|음악|콘서트|미술|문화/, ["🎬", "🎧", "🎨"]],
    [/병원|건강|치료|검진|약|관리/, ["🏥", "🩺", "💊"]],
    [/자연|숲|공원|꽃|정원|산책|하늘/, ["🌿", "🌷", "🌤️"]]
  ];
  const matched = rules.find(([pattern]) => pattern.test(haystack));
  const pool = matched?.[1] || refEmojis;
  if (!pool.length) return "";
  const preferred = refEmojis.find((emoji) => pool.includes(emoji));
  return preferred || pool[index % pool.length];
}

function generateLocally(brief, fallbackReason = "") {
  setProgress(true, "레퍼런스 구조를 반영해 로컬 초안 생성 중", 45);
  const keywords = unique([...extractKeywords(`${brief.prompt}\n${brief.references}`), ...brief.keywords]).slice(0, 18);
  const title = makeLocalTitle(brief, keywords);
  const referenceParagraphs = splitParagraphs(brief.references);
  const sections = buildLocalSections(brief, referenceParagraphs, keywords);
  const normalizedPhotos = getReadyPhotos().map((photo) => ({
    ...photo,
    rawNote: photo.note,
    note: normalizeDictationText(photo.note, brief.dictationProfile.contextTerms)
  }));
  const photoInsights = normalizedPhotos.map((photo) => makeLocalPhotoInsight(photo, brief));
  const matched = matchPhotosToSections(normalizedPhotos, sections, photoInsights);

  return {
    provider: "local",
    sourceNote: fallbackReason ? `로컬 매칭 사용: ${fallbackReason}` : "무료 로컬 매칭 사용",
    seo: {
      title,
      description: makeDescription(brief, keywords),
      tags: normalizeSeoTags(keywords, brief, keywords),
      slug: slugify(title)
    },
    referenceStyle: {
      followedOutline: brief.referenceAnalysis.outline.map((item) => item.title).slice(0, brief.sectionCount),
      toneNotes: brief.referenceAnalysis.toneSignals,
      faithfulness: brief.referenceWeight === "strict" ? 86 : brief.referenceWeight === "high" ? 76 : 58
    },
    inputCorrections: brief.dictationProfile.corrections,
    photoInsights,
    sections: sections.map((section) => {
      const photos = matched.filter((item) => item.sectionId === section.id);
      return {
        ...section,
        targetPhotoIds: photos.map((item) => item.photoId),
        photoRationale: photos.length ? "파일명, 사진 메모, 색감 힌트와 섹션 키워드를 비교해 배치했습니다." : "명확히 맞는 사진이 없어 비워두었습니다.",
        altText: photos[0]?.altText || `${section.title} 관련 이미지`
      };
    }),
    qualityChecklist: [
      `레퍼런스 반영: ${brief.referenceAnalysis.outline.length ? "소제목/문단 흐름을 우선 적용했습니다." : "명확한 소제목이 없어 문단 흐름과 키워드를 적용했습니다."}`,
      "무료 API 키가 없으면 사진의 의미를 완전히 읽지는 못합니다.",
      "정확도를 높이려면 각 사진 메모에 장소, 메뉴, 제품명 같은 단서를 한두 단어 넣으세요.",
      "작성 후 사진 배치 탭에서 섹션을 직접 바꿀 수 있습니다."
    ]
  };
}

function buildLocalSections(brief, paragraphs, keywords) {
  const count = brief.sectionCount;
  const referenceOutline = buildReferenceOutline(brief.referenceAnalysis, count);
  const templates = [
    ["첫인상", "독자가 글의 분위기와 핵심 장면을 바로 이해하게 한다."],
    ["방문 전 기대한 점", "프롬프트와 레퍼런스에서 나온 니즈를 정리한다."],
    ["현장에서 좋았던 포인트", "사진과 잘 맞는 구체적인 경험을 풀어낸다."],
    ["디테일하게 볼 부분", "메뉴, 제품, 공간, 과정 등 판단에 도움이 되는 요소를 설명한다."],
    ["추천 대상과 활용 팁", "누구에게 맞는지, 어떻게 이용하면 좋은지 제안한다."],
    ["아쉬운 점과 체크 포인트", "신뢰도를 높이기 위해 균형 있게 정리한다."],
    ["마무리", "핵심 요약과 자연스러운 결론으로 글을 닫는다."]
  ];

  const intro = brief.prompt || paragraphs[0] || "사진과 레퍼런스를 바탕으로 정리한 블로그 초안입니다.";
  const selected = referenceOutline.length && brief.referenceWeight !== "balanced"
    ? referenceOutline
    : templates.slice(0, count).map(([title, intent], index) => ({
      title,
      intent,
      sample: paragraphs[index] || "",
      keywords: []
    }));

  return selected.slice(0, count).map((item, index) => {
    const title = adaptReferenceTitle(item, templates[index]?.[0] || item.title, brief, keywords, index);
    const intent = item.intent || templates[index]?.[1] || "레퍼런스 흐름에 맞춰 내용을 전개한다.";
    const paragraph = item.sample || paragraphs[index] || paragraphs[index % Math.max(1, paragraphs.length)] || intro;
    const body = rewriteParagraph(paragraph, brief, keywords, index, item);
    const extra = makeReferenceRhythmParagraphs(brief, item, keywords, index);
    return {
      id: `s_${index + 1}`,
      title,
      intent,
      draftHtml: `<p>${escapeHtml(body)}</p>${extra}`,
      keywordAnchors: unique([...extractKeywords(`${title} ${intent} ${paragraph}`), ...(item.keywords || []), ...keywords.slice(0, 4)]).slice(0, 10),
      targetPhotoIds: [],
      photoRationale: "",
      altText: `${title} 관련 사진`
    };
  });
}

function rewriteParagraph(paragraph, brief, keywords, index, outlineItem = {}) {
  const cleaned = paragraph.replace(/\s+/g, " ").trim();
  const subject = inferSubject(brief, keywords);
  const anchors = unique([...(outlineItem.keywords || []), ...extractKeywords(cleaned), ...keywords]).slice(0, 4);
  const anchorText = anchors.length ? anchors.join(", ") : "핵심 포인트";
  const intent = `${outlineItem.title || ""} ${outlineItem.intent || ""}`;
  let base;
  if (/위치|주차|예약|시간|정보/.test(intent)) {
    base = `${subject}을 보기 전에 ${anchorText}를 먼저 확인하면 전체 흐름이 훨씬 선명해집니다`;
  } else if (/메뉴|맛|제품|디테일|상세|사용/.test(intent)) {
    base = `${subject}에서 가장 먼저 볼 부분은 ${anchorText}이고, 사진과 함께 보면 특징이 더 잘 드러납니다`;
  } else if (/좋았|장점|추천|만족|포인트/.test(intent)) {
    base = `${subject}에서 좋았던 점은 ${anchorText}가 자연스럽게 이어진다는 점입니다`;
  } else if (/단점|아쉬|주의|체크|팁/.test(intent)) {
    base = `${subject}을 고를 때는 ${anchorText}를 미리 체크해두는 편이 좋습니다`;
  } else if (/마무리|총평|결론|재방문|요약/.test(intent)) {
    base = `${subject}은 ${anchorText}를 기준으로 다시 떠올려보면 선택 이유가 분명해지는 편입니다`;
  } else {
    base = `${subject}의 분위기는 ${anchorText}를 따라가며 보면 자연스럽게 이해됩니다`;
  }
  return applySentenceStyle(base, brief.referenceAnalysis.sentenceStyle);
}

function makeLocalPhotoInsight(photo, brief = null) {
  const filenameTokens = extractKeywords(photo.name.replace(/\.[^.]+$/, ""));
  const normalizedNote = normalizeDictationText(photo.note, brief?.dictationProfile?.contextTerms || []);
  const visualKeywords = unique([...filenameTokens, ...photo.visualTags, ...extractKeywords(normalizedNote)]).slice(0, 10);
  const mood = photo.brightness > 170 ? "밝고 선명함" : photo.brightness < 95 ? "차분하고 밀도 있음" : "균형 잡힌 분위기";
  const bestUse = photo.width > photo.height ? "대표" : "상세";
  return {
    photoId: photo.id,
    captionKo: `${normalizedNote || photo.name.replace(/\.[^.]+$/, "")} 사진`,
    visualKeywords,
    mood,
    bestUse,
    avoidReason: ""
  };
}

function matchPhotosToSections(photos, sections, insights) {
  const used = new Set();
  const matches = [];
  const sectionTexts = sections.map((section) => ({
    id: section.id,
    tokens: new Set(extractKeywords(`${section.title} ${section.intent} ${stripHtml(section.draftHtml)} ${section.keywordAnchors.join(" ")}`))
  }));

  photos.forEach((photo, index) => {
    const insight = insights.find((item) => item.photoId === photo.id);
    const photoTokens = new Set(extractKeywords(`${photo.name} ${photo.note} ${photo.visualTags.join(" ")} ${(insight?.visualKeywords || []).join(" ")} ${insight?.captionKo || ""}`));
    let best = null;
    sectionTexts.forEach((section, sectionIndex) => {
      const overlap = [...photoTokens].filter((token) => section.tokens.has(token)).length;
      const orderScore = Math.max(0, 1 - Math.abs(index - sectionIndex) / Math.max(photos.length, sections.length));
      const visualScore = scoreVisualFit(photo, sections[sectionIndex], insight);
      const score = overlap * 10 + orderScore * 3 + visualScore;
      if (!best || score > best.score) best = { sectionId: section.id, score, sectionIndex };
    });

    if (!best || used.has(best.sectionId)) {
      const fallback = sections.find((section) => !used.has(section.id)) || sections[index % sections.length];
      best = { sectionId: fallback.id, score: 4, sectionIndex: sections.indexOf(fallback) };
    }
    used.add(best.sectionId);
    matches.push({
      photoId: photo.id,
      sectionId: best.sectionId,
      confidence: clamp(Math.round(best.score * 7), 30, 92),
      altText: insight?.captionKo || `${sections[best.sectionIndex]?.title || "본문"} 관련 사진`
    });
  });
  return matches;
}

function scoreVisualFit(photo, section, insight) {
  const text = `${section.title} ${section.intent} ${section.keywordAnchors.join(" ")}`;
  let score = 0;
  if (/첫인상|대표|도입|시작|메인/.test(text) && photo.width >= photo.height) score += 4;
  if (/디테일|상세|메뉴|제품|포인트|과정/.test(text) && photo.height >= photo.width) score += 3;
  if (/마무리|요약|추천/.test(text) && insight?.bestUse === "마무리") score += 2;
  if (/야외|자연|산책/.test(text) && photo.visualTags.includes("자연")) score += 4;
  if (/음식|메뉴|맛|카페|식당/.test(text) && photo.visualTags.includes("음식")) score += 4;
  return score;
}

function normalizeResult() {
  if (!state.result) return;
  const brief = collectBrief();
  const readyPhotos = getReadyPhotos();
  const photoIds = new Set(readyPhotos.map((photo) => photo.id));
  const insightsById = new Map((state.result.photoInsights || []).filter((item) => photoIds.has(item.photoId)).map((item) => [item.photoId, item]));

  readyPhotos.forEach((photo) => {
    if (!insightsById.has(photo.id)) {
      insightsById.set(photo.id, makeLocalPhotoInsight(photo, brief));
    }
  });

  state.result.photoInsights = readyPhotos.map((photo) => insightsById.get(photo.id));

  const localReferenceSections = buildLocalSections(brief, splitParagraphs(brief.references), extractKeywords(`${brief.prompt} ${brief.references}`));
  const desiredSectionCount = brief.referenceWeight === "strict" && brief.referenceAnalysis?.outline?.length
    ? brief.sectionCount
    : Math.min(MAX_AUTO_SECTIONS, Math.max(1, state.result.sections?.length || brief.sectionCount));
  const sourceSections = [...(state.result.sections || [])];
  while (sourceSections.length < desiredSectionCount) {
    sourceSections.push(localReferenceSections[sourceSections.length] || localReferenceSections[sourceSections.length % Math.max(1, localReferenceSections.length)] || {});
  }

  state.result.sections = sourceSections.slice(0, desiredSectionCount).map((section, index) => ({
    id: section.id || `s_${index + 1}`,
    title: enforceSectionTitleFormat(section.title || `섹션 ${index + 1}`, index, section.intent || "", brief),
    intent: section.intent || "",
    draftHtml: sanitizeDraftHtml(section.draftHtml || `<p>${escapeHtml(section.body || "")}</p>`),
    keywordAnchors: Array.isArray(section.keywordAnchors) ? section.keywordAnchors : [],
    targetPhotoIds: Array.isArray(section.targetPhotoIds) ? section.targetPhotoIds.filter((id) => photoIds.has(id)) : [],
    photoRationale: section.photoRationale || "",
    altText: section.altText || `${section.title || "본문"} 관련 사진`
  }));

  if (!state.result.sections.length) {
    state.result.sections = buildLocalSections(collectBrief(), [], extractKeywords(collectBrief().prompt));
  }

  const sectionIds = new Set(state.result.sections.map((section) => section.id));
  readyPhotos.forEach((photo) => {
    const containing = state.result.sections.find((section) => section.targetPhotoIds.includes(photo.id));
    photo.matchedSectionId = containing?.id || "";
    photo.caption = insightsById.get(photo.id)?.captionKo || photo.caption || photo.name;
    photo.keywords = insightsById.get(photo.id)?.visualKeywords || [];
  });

  const missingPhotos = readyPhotos.filter((photo) => !photo.matchedSectionId);
  if (missingPhotos.length) {
    const matches = matchPhotosToSections(missingPhotos, state.result.sections, state.result.photoInsights);
    matches.forEach((match) => {
      if (!sectionIds.has(match.sectionId)) return;
      const section = state.result.sections.find((item) => item.id === match.sectionId);
      if (!section.targetPhotoIds.includes(match.photoId)) section.targetPhotoIds.push(match.photoId);
      const photo = readyPhotos.find((item) => item.id === match.photoId);
      photo.matchedSectionId = match.sectionId;
      photo.confidence = match.confidence;
    });
  }

  state.result.sections.forEach((section) => {
    section.targetPhotoIds = unique(section.targetPhotoIds).filter((id) => photoIds.has(id));
  });

  state.result.seo = {
    title: enforceSeoTitleFormat(state.result.seo?.title || makeLocalTitle(brief, extractKeywords(brief.prompt)), brief, extractKeywords(brief.prompt)),
    description: state.result.seo?.description || makeDescription(collectBrief(), extractKeywords(collectBrief().prompt)),
    tags: normalizeSeoTags(state.result.seo?.tags, brief, extractKeywords(`${brief.prompt} ${brief.references}`)),
    slug: state.result.seo?.slug || slugify(state.result.seo?.title || "blogy")
  };
}

function normalizeSeoTags(tags, brief, fallbackKeywords = []) {
  const count = clamp(Number(brief?.hashtagCount ?? 8), 0, 30);
  if (count === 0) return [];
  const sourceTags = Array.isArray(tags) ? tags : [];
  const raw = [
    ...sourceTags,
    ...(brief?.keywords || []),
    ...fallbackKeywords,
    ...(brief?.referenceAnalysis?.topicKeywords || []),
    ...getReadyPhotos().flatMap((photo) => [photo.name.replace(/\.[^.]+$/, ""), ...(photo.visualTags || [])])
  ];
  const cleaned = unique(raw
    .flatMap((item) => String(item || "").split(/[,\s#]+/))
    .map((item) => item.replace(/^#+/, "").replace(/[^\p{L}\p{N}_-]/gu, "").trim())
    .filter((item) => item.length >= 2 && item.length <= 24));
  const generic = ["블로그", "후기", "리뷰", "사진", "정보", "추천", "정리", "방문", "체크", "일상", "기록", "팁"];
  let index = 0;
  while (cleaned.length < count) {
    const subject = inferSubject(brief, fallbackKeywords).replace(/[^\p{L}\p{N}_-]/gu, "");
    const next = index === 0 && subject.length >= 2 ? subject : generic[index % generic.length];
    if (!cleaned.includes(next)) cleaned.push(next);
    index += 1;
  }
  return cleaned.slice(0, count);
}

function sanitizeDraftHtml(html) {
  const template = document.createElement("template");
  template.innerHTML = html;
  const allowed = new Set(["P", "STRONG", "B", "EM", "BR", "UL", "OL", "LI", "BLOCKQUOTE"]);
  const walker = document.createTreeWalker(template.content, NodeFilter.SHOW_ELEMENT);
  const remove = [];
  while (walker.nextNode()) {
    const node = walker.currentNode;
    if (!allowed.has(node.nodeName)) {
      const span = document.createElement("span");
      span.textContent = node.textContent;
      node.replaceWith(span);
    } else {
      [...node.attributes].forEach((attr) => node.removeAttribute(attr.name));
    }
  }
  remove.forEach((node) => node.remove());
  return template.innerHTML.trim() || "<p></p>";
}

function renderResult() {
  const hasResult = Boolean(state.result);
  $("#copyRichButton").disabled = !hasResult;
  $("#copyHtmlButton").disabled = !hasResult;
  $("#copyTextButton").disabled = !hasResult;
  $("#downloadButton").disabled = !hasResult;

  if (!hasResult) {
    $("#blogPreview").innerHTML = "";
    $("#htmlOutput").value = "";
    $("#seoStrip").classList.add("hidden");
    $("#qualityGrid").innerHTML = "";
    $("#matchList").innerHTML = "";
    return;
  }

  const html = buildBlogHtml();
  $("#blogPreview").innerHTML = html;
  $("#htmlOutput").value = html;
  renderSeo();
  renderMatching();
}

function renderSeo() {
  const seo = state.result.seo;
  const strip = $("#seoStrip");
  strip.classList.remove("hidden");
  strip.innerHTML = `
    <div><strong>${escapeHtml(seo.title)}</strong></div>
    <div>${escapeHtml(seo.description || "")}</div>
    <div class="seo-tags">${(seo.tags || []).map((tag) => `<span>#${escapeHtml(tag)}</span>`).join("")}</div>
  `;
}

function renderMatching() {
  const readyPhotos = getReadyPhotos();
  const totalPhotos = readyPhotos.length;
  const matchedPhotos = readyPhotos.filter((photo) => getSectionForPhoto(photo.id)).length;
  const sectionsWithPhotos = state.result.sections.filter((section) => section.targetPhotoIds.length).length;
  const lowConfidence = calculateLowConfidence();
  const referenceFaithfulness = state.result.referenceStyle?.faithfulness || (state.result.provider === "gemini" ? 80 : 65);
  $("#qualityGrid").innerHTML = `
    <div class="quality-card"><span>사진 사용</span><strong>${matchedPhotos}/${totalPhotos}</strong></div>
    <div class="quality-card"><span>사진 있는 섹션</span><strong>${sectionsWithPhotos}</strong></div>
    <div class="quality-card"><span>점검 필요</span><strong>${lowConfidence}</strong></div>
    <div class="quality-card"><span>레퍼런스</span><strong>${referenceFaithfulness}%</strong></div>
  `;

  const sectionOptions = state.result.sections.map((section) => `<option value="${escapeAttr(section.id)}">${escapeHtml(section.title)}</option>`).join("");
  $("#matchList").innerHTML = readyPhotos.map((photo) => {
    const section = getSectionForPhoto(photo.id);
    const insight = state.result.photoInsights.find((item) => item.photoId === photo.id);
    const confidence = estimateConfidence(photo, section, insight);
    return `
      <div class="match-row" data-photo-id="${escapeAttr(photo.id)}">
        <img src="${escapeAttr(photo.objectUrl)}" alt="${escapeAttr(photo.name)}">
        <div class="match-copy">
          <h3>${escapeHtml(photo.name)}</h3>
          <p>${escapeHtml(insight?.captionKo || photo.caption || "사진 설명 없음")}</p>
          <div class="seo-tags">${(insight?.visualKeywords || photo.visualTags).slice(0, 8).map((tag) => `<span>${escapeHtml(tag)}</span>`).join("")}</div>
          <p><strong>배치:</strong> ${section ? escapeHtml(section.title) : "미배치"}</p>
          <p>${escapeHtml(section?.photoRationale || "사진이 어색하면 섹션을 직접 바꿔주세요.")}</p>
          <div class="match-actions">
            <select class="section-picker">
              <option value="">사용하지 않음</option>
              ${sectionOptions}
            </select>
            <span class="confidence ${confidence < 50 ? "low" : confidence < 72 ? "medium" : ""}">${confidence}%</span>
          </div>
        </div>
      </div>
    `;
  }).join("");

  $$(".match-row", $("#matchList")).forEach((row) => {
    const photoId = row.dataset.photoId;
    const picker = $(".section-picker", row);
    picker.value = getSectionForPhoto(photoId)?.id || "";
    picker.addEventListener("change", () => {
      state.result.sections.forEach((section) => {
        section.targetPhotoIds = section.targetPhotoIds.filter((id) => id !== photoId);
      });
      if (picker.value) {
        const section = state.result.sections.find((item) => item.id === picker.value);
        section.targetPhotoIds.push(photoId);
      }
      renderResult();
    });
  });
}

function buildBlogHtml() {
  const seo = state.result.seo;
  const sections = state.result.sections;
  const toc = sections.length > 3
    ? `<div class="toc"><strong>목차</strong><ol>${sections.map((section) => `<li>${escapeHtml(section.title)}</li>`).join("")}</ol></div>`
    : "";
  const body = sections.map((section) => {
    const figures = section.targetPhotoIds.map((photoId) => {
      const photo = getReadyPhotos().find((item) => item.id === photoId);
      const insight = state.result.photoInsights.find((item) => item.photoId === photoId);
      if (!photo || !photo.exportDataUrl) return "";
      const caption = insight?.captionKo || section.altText || photo.name;
      return `
        <figure>
          <img src="${photo.exportDataUrl}" alt="${escapeAttr(section.altText || caption)}">
          <figcaption>${escapeHtml(caption)}</figcaption>
        </figure>
      `;
    }).join("");
    return `
      <section>
        <h2>${escapeHtml(section.title)}</h2>
        ${figures}
        ${stripInternalChecklistHtml(section.draftHtml)}
      </section>
    `;
  }).join("");

  return `
    <h1>${escapeHtml(seo.title)}</h1>
    ${seo.description ? `<p>${escapeHtml(seo.description)}</p>` : ""}
    ${toc}
    ${body}
  `.trim();
}

function stripInternalChecklistHtml(html) {
  const template = document.createElement("template");
  template.innerHTML = html || "";
  const internalPatterns = [
    /사진과\s*글\s*섹션의\s*맥락/i,
    /억지로\s*끼워\s*넣어진/i,
    /7어절\s*이상\s*연속\s*복사/i,
    /단정적인\s*내용/i,
    /과장\s*\/?\s*이모지\s*\/?\s*AI\s*문투/i,
    /HTML\s*태그.*h2.*p.*blockquote/i,
    /음성\s*메모\s*보정/i,
    /inputCorrections/i
  ];
  template.content.querySelectorAll("p, blockquote, li").forEach((node) => {
    const text = node.textContent.replace(/\s+/g, " ").trim();
    if (internalPatterns.some((pattern) => pattern.test(text))) node.remove();
  });
  return template.innerHTML;
}

function getSectionForPhoto(photoId) {
  return state.result?.sections.find((section) => section.targetPhotoIds.includes(photoId)) || null;
}

function estimateConfidence(photo, section, insight) {
  if (!section) return 0;
  const photoTokens = new Set(extractKeywords(`${photo.name} ${photo.note} ${(insight?.captionKo || "")} ${(insight?.visualKeywords || []).join(" ")} ${photo.visualTags.join(" ")}`));
  const sectionTokens = new Set(extractKeywords(`${section.title} ${section.intent} ${stripHtml(section.draftHtml)} ${section.keywordAnchors.join(" ")}`));
  const overlap = [...photoTokens].filter((token) => sectionTokens.has(token)).length;
  const base = state.result.provider === "gemini" ? 62 : 42;
  return clamp(base + overlap * 9 + scoreVisualFit(photo, section, insight) * 4, section.photoRationale ? 38 : 24, 97);
}

function calculateLowConfidence() {
  return getReadyPhotos().filter((photo) => {
    const section = getSectionForPhoto(photo.id);
    const insight = state.result.photoInsights.find((item) => item.photoId === photo.id);
    return estimateConfidence(photo, section, insight) < 58;
  }).length;
}

function setView(view) {
  state.activeView = view;
  $$(".tab").forEach((tab) => tab.classList.toggle("active", tab.dataset.view === view));
  $$(".result-view").forEach((section) => section.classList.remove("active"));
  $(`#${view}View`).classList.add("active");
}

function setPreviewWidthMode(mode) {
  state.previewWidthMode = mode === "mobile" ? "mobile" : "pc";
  $$(".width-tab").forEach((tab) => {
    tab.classList.toggle("active", tab.dataset.width === state.previewWidthMode);
  });
  applyPreviewWidth();
}

function applyPreviewWidth() {
  const page = $("#previewPage");
  if (!page) return;
  const platform = $("#platformSelect")?.value || "naver";
  const pcWidth = PLATFORM_PREVIEW_WIDTH[platform] || PLATFORM_PREVIEW_WIDTH.generic;
  const width = state.previewWidthMode === "mobile" ? MOBILE_PREVIEW_WIDTH : pcWidth;
  page.style.setProperty("--preview-width", `${width}px`);
  page.dataset.width = state.previewWidthMode;
}

async function copyRichHtml() {
  ensurePreviewHtml();
  try {
    const copied = copyRenderedPreview();
    if (copied) {
      showToast("글과 이미지를 함께 복사했습니다.");
      return;
    }
  } catch (error) {
    console.warn("Rendered copy failed", error);
  }

  const html = $("#blogPreview").innerHTML || buildBlogHtml();
  const plain = htmlToPlainText(html);
  try {
    if (navigator.clipboard?.write && window.ClipboardItem) {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/html": new Blob([html], { type: "text/html" }),
          "text/plain": new Blob([plain], { type: "text/plain" })
        })
      ]);
      showToast("글과 이미지가 포함된 HTML을 복사했습니다.");
      return;
    }
  } catch (error) {
    console.warn("ClipboardItem copy failed", error);
  }

  await copyTextFallback(html);
  showToast("브라우저 제한으로 HTML 코드만 복사했습니다.");
}

function ensurePreviewHtml() {
  const preview = $("#blogPreview");
  if (!preview.innerHTML.trim() && state.result) {
    preview.innerHTML = buildBlogHtml();
  }
}

function copyRenderedPreview() {
  const preview = $("#blogPreview");
  if (!preview.innerHTML.trim()) return false;
  const selection = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(preview);
  selection.removeAllRanges();
  selection.addRange(range);
  const copied = document.execCommand("copy");
  selection.removeAllRanges();
  return copied;
}

async function copyHtml() {
  const html = $("#blogPreview").innerHTML || buildBlogHtml();
  await copyTextFallback(html);
  showToast("HTML 코드를 복사했습니다.");
}

async function copyPlainText() {
  const text = htmlToPlainText($("#blogPreview").innerHTML || buildBlogHtml());
  await copyTextFallback(text);
  showToast("텍스트만 복사했습니다.");
}

function downloadHtml() {
  const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>${escapeHtml(state.result.seo.title)}</title></head><body>${$("#blogPreview").innerHTML || buildBlogHtml()}</body></html>`;
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${state.result.seo.slug || "blogy"}.html`;
  link.click();
  URL.revokeObjectURL(url);
}

async function copyTextFallback(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
}

function htmlToPlainText(html) {
  const temp = document.createElement("div");
  temp.innerHTML = html;
  temp.querySelectorAll("figcaption").forEach((caption) => {
    caption.insertAdjacentText("beforebegin", "\n");
  });
  return temp.innerText.replace(/\n{3,}/g, "\n\n").trim();
}

function splitParagraphs(text) {
  return text
    .split(/\n{2,}|---+/)
    .map((item) => item.replace(/\s+/g, " ").trim())
    .filter((item) => item.length > 28)
    .slice(0, 20);
}

function splitSentences(text) {
  return (text || "")
    .split(/[.!?。！？]\s+|\n+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function extractKeywords(text) {
  return unique((text || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .split(/\s+/)
    .map((token) => token.trim().replace(/^-+|-+$/g, ""))
    .filter((token) => token.length >= 2 && !stopwords.has(token))
    .sort((a, b) => b.length - a.length));
}

function inferSubject(brief, keywords = []) {
  const explicit = brief?.keywords?.[0];
  if (explicit) return explicit.slice(0, 24);
  const promptSubject = (brief?.prompt || "")
    .split(/[.!?\n。！？]/)[0]
    ?.replace(/블로그|후기|리뷰|작성|써줘|정리|추천|글/gi, "")
    .trim();
  if (promptSubject && promptSubject.length >= 2) return promptSubject.slice(0, 28);
  return (keywords[0] || "이번 주제").slice(0, 24);
}

function applySentenceStyle(sentence, sentenceStyle = {}) {
  const clean = sentence.replace(/[.!?。！？]+$/, "").trim();
  if (!clean) return "";
  if (/(요|죠|습니다|니다|입니다|됩니다|합니다|다)$/.test(clean)) return `${clean}.`;
  if (sentenceStyle.colloquial || sentenceStyle.dominantEnding === "casual") return `${clean}요.`;
  if (sentenceStyle.dominantEnding === "formalDa") return `${clean}습니다.`;
  if (sentenceStyle.dominantEnding === "question") return `${clean}죠.`;
  return `${clean}요.`;
}

function makeLocalTitle(brief, keywords) {
  const subject = inferSubject(brief, keywords);
  const sample = brief.referenceAnalysis?.titleStyle?.sample || "";
  const summary = brief.referenceAnalysis?.titleStyle?.patternSummary || "";
  let title;
  if (/^\[[^\]]+\]/.test(sample)) {
    const label = sample.match(/^\[([^\]]+)\]/)?.[1] || "후기";
    title = `[${label}] ${subject} 후기`;
  } else if (/\s[|｜]\s/.test(sample)) {
    title = `${subject} 후기 | ${pickHeadingTail(brief.referenceAnalysis.titleStyle, 0)}`;
  } else if (/\s\/\s/.test(sample)) {
    title = `${subject} / ${pickHeadingTail(brief.referenceAnalysis.titleStyle, 0)} / 후기`;
  } else if (/:|：/.test(sample)) {
    title = `${subject}: ${summary.includes("솔직") ? "솔직 후기" : "정리"}`;
  } else if (/나요|까요|\?$/.test(sample)) {
    title = `${subject}, 직접 보면 어떨까?`;
  } else if (/추천/.test(sample)) {
    title = `${subject} 추천 포인트 정리`;
  } else if (/후기|리뷰|솔직|내돈내산/.test(sample + summary)) {
    title = `${subject} 솔직 후기`;
  } else {
    title = `${subject} 후기와 사진 정리`;
  }
  return decorateSectionTitle(title, 0, `${subject} ${keywords.join(" ")}`, brief);
}

function makeDescription(brief, keywords) {
  const text = `${brief.prompt} ${keywords.slice(0, 5).join(", ")}`.trim();
  if (!text) return "사진과 레퍼런스를 기반으로 정리한 블로그 초안입니다.";
  return text.length > 138 ? `${text.slice(0, 137)}…` : text;
}

function slugify(text) {
  return (text || "blogy")
    .toString()
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64) || "blogy";
}

function stripHtml(html) {
  const temp = document.createElement("div");
  temp.innerHTML = html || "";
  return temp.textContent || "";
}

function unique(items) {
  return [...new Set(items.filter(Boolean))];
}

function average(values) {
  const numbers = values.filter((value) => Number.isFinite(value));
  if (!numbers.length) return 0;
  return numbers.reduce((sum, value) => sum + value, 0) / numbers.length;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttr(value) {
  return escapeHtml(value).replaceAll("\n", " ");
}

function lockUi(isLocked) {
  $("#generateButton").disabled = isLocked;
  $("#copyRichButton").disabled = isLocked || !state.result;
  $("#copyHtmlButton").disabled = isLocked || !state.result;
}

function setProgress(visible, text = "", percent = 0) {
  const panel = $("#progressPanel");
  panel.classList.toggle("hidden", !visible);
  if (!visible) return;
  $("#progressText").textContent = text;
  $("#progressPercent").textContent = `${percent}%`;
  $("#progressBar").style.width = `${percent}%`;
}

let toastTimer = 0;
function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("visible"), 2600);
}

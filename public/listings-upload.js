const backToCase = document.getElementById("back-to-case");
const caseMeta = document.getElementById("case-meta");
const uploadForm = document.getElementById("upload-form");
const uploadError = document.getElementById("upload-error");
const uploadResult = document.getElementById("upload-result");
const patchDefendantsButton = document.getElementById("patch-defendants-button");
const mappingPanel = document.getElementById("mapping-panel");
const fileInput = uploadForm.querySelector('input[type="file"]');
const mappingSelects = {
  seller: document.getElementById("map-seller"),
  platform: document.getElementById("map-platform"),
  productId: document.getElementById("map-product-id"),
  title: document.getElementById("map-title"),
  infType: document.getElementById("map-inf-type"),
  url: document.getElementById("map-url"),
  merchantId: document.getElementById("map-merchant-id"),
  location: document.getElementById("map-location"),
  screenshotEvidence: document.getElementById("map-screenshot-evidence"),
  remark: document.getElementById("map-remark"),
};

const parseCsvHeaders = (csvText) => {
  const headers = [];
  let token = "";
  let inQuotes = false;
  for (let i = 0; i < csvText.length; i += 1) {
    const ch = csvText[i];
    const next = csvText[i + 1];
    if (ch === '"') {
      if (inQuotes && next === '"') {
        token += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (!inQuotes && (ch === "\n" || ch === "\r")) {
      if (token.length || headers.length) {
        headers.push(token.trim());
      }
      break;
    }
    if (!inQuotes && ch === ",") {
      headers.push(token.trim());
      token = "";
      continue;
    }
    token += ch;
  }
  if (token.trim() && headers.length === 0) {
    headers.push(token.trim());
  }
  return headers.filter(Boolean);
};

const normalize = (value) =>
  String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

const pickDefaultHeader = (headers, candidates) => {
  const byNormalized = new Map(headers.map((header) => [normalize(header), header]));
  for (const candidate of candidates) {
    const hit = byNormalized.get(normalize(candidate));
    if (hit) return hit;
  }
  return "";
};

const buildOptions = (select, headers, defaultValue, required = false) => {
  const options = [];
  if (!required) {
    options.push(`<option value="">(Not mapped)</option>`);
  }
  headers.forEach((header) => {
    options.push(
      `<option value="${header.replace(/"/g, "&quot;")}" ${
        header === defaultValue ? "selected" : ""
      }>${header}</option>`
    );
  });
  select.innerHTML = options.join("");
};

const populateMappingPanel = (headers) => {
  const defaults = {
    seller: pickDefaultHeader(headers, ["SELLER", "Sellers", "Name"]),
    platform: pickDefaultHeader(headers, ["PLATFORM", "Marketplace", "Market Place"]),
    productId: pickDefaultHeader(headers, ["No.", "No", "Product ID", "PRODUCT ID"]),
    title: pickDefaultHeader(headers, ["TITLE", "Title"]),
    infType: pickDefaultHeader(headers, ["INF_TYPE", "Inf Type", "INF Type"]),
    url: pickDefaultHeader(headers, ["URL", "Url"]),
    merchantId: pickDefaultHeader(headers, ["MERCHANT ID", "Merchant ID"]),
    location: pickDefaultHeader(headers, [
      "MERCHANT COUNTRY",
      "Merchant Country",
      "Location",
      "Located In",
    ]),
    screenshotEvidence: pickDefaultHeader(headers, [
      "SCREENSHOT EVIDENCE",
      "Screenshot Evidence",
      "Screenshots",
    ]),
    remark: pickDefaultHeader(headers, ["REMARK", "Remark", "Notes"]),
  };
  buildOptions(mappingSelects.seller, headers, defaults.seller, true);
  buildOptions(mappingSelects.platform, headers, defaults.platform, true);
  buildOptions(mappingSelects.productId, headers, defaults.productId);
  buildOptions(mappingSelects.title, headers, defaults.title);
  buildOptions(mappingSelects.infType, headers, defaults.infType);
  buildOptions(mappingSelects.url, headers, defaults.url);
  buildOptions(mappingSelects.merchantId, headers, defaults.merchantId);
  buildOptions(mappingSelects.location, headers, defaults.location);
  buildOptions(
    mappingSelects.screenshotEvidence,
    headers,
    defaults.screenshotEvidence
  );
  buildOptions(mappingSelects.remark, headers, defaults.remark);
  mappingPanel.classList.remove("hidden");
};

const init = async () => {
  const caseId = getParam("caseId");
  const cases = await loadCases();
  const currentCase = cases.find((item) => item.id === caseId);

  if (!currentCase) {
    caseMeta.textContent = "Case not found.";
    return;
  }

  caseMeta.textContent = `${currentCase.caseName || currentCase.title} • ${
    currentCase.caseNumber || currentCase.id
  }`;
  backToCase.href = `case.html?caseId=${encodeURIComponent(currentCase.id)}`;

  fileInput.addEventListener("change", async () => {
    uploadError.textContent = "";
    uploadResult.classList.add("hidden");
    mappingPanel.classList.add("hidden");
    if (!fileInput.files.length) return;
    try {
      const text = await fileInput.files[0].text();
      const headers = parseCsvHeaders(text);
      if (!headers.length) {
        uploadError.textContent = "Could not read CSV headers.";
        return;
      }
      populateMappingPanel(headers);
    } catch (error) {
      uploadError.textContent = "Unable to read CSV file.";
    }
  });

  const buildMappedFormData = () => {
    uploadError.textContent = "";
    uploadResult.classList.add("hidden");

    if (!fileInput.files.length) {
      throw new Error("Please choose a CSV file.");
    }
    const sellerHeader = mappingSelects.seller.value;
    const platformHeader = mappingSelects.platform.value;
    if (!sellerHeader || !platformHeader) {
      throw new Error("Seller and Platform mappings are required.");
    }

    const formData = new FormData();
    formData.append("file", fileInput.files[0]);
    formData.append(
      "mapping",
      JSON.stringify({
        seller: sellerHeader,
        platform: platformHeader,
        productId: mappingSelects.productId.value || null,
        title: mappingSelects.title.value || null,
        infType: mappingSelects.infType.value || null,
        url: mappingSelects.url.value || null,
        merchantId: mappingSelects.merchantId.value || null,
        location: mappingSelects.location.value || null,
        screenshotEvidence: mappingSelects.screenshotEvidence.value || null,
        remark: mappingSelects.remark.value || null,
      })
    );
    return formData;
  };

  uploadForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    let formData;
    try {
      formData = buildMappedFormData();
    } catch (error) {
      uploadError.textContent = error.message || "Invalid upload data.";
      return;
    }

    const response = await authFetch(
      `/api/cases/${currentCase.id}/listings/import`,
      {
        method: "POST",
        body: formData,
      }
    );

    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      uploadError.textContent = payload.error || "Upload failed.";
      return;
    }

    const payload = await response.json();
    uploadResult.textContent = `Imported ${payload.imported} listings. Skipped ${payload.skipped}.`;
    uploadResult.classList.remove("hidden");
    fileInput.value = "";
    mappingPanel.classList.add("hidden");
  });

  patchDefendantsButton.addEventListener("click", async () => {
    let formData;
    try {
      formData = buildMappedFormData();
    } catch (error) {
      uploadError.textContent = error.message || "Invalid upload data.";
      return;
    }
    const response = await authFetch(
      `/api/cases/${currentCase.id}/defendants/patch-from-listings`,
      {
        method: "POST",
        body: formData,
      }
    );
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      uploadError.textContent = payload.error || "Patch failed.";
      return;
    }
    const payload = await response.json();
    uploadResult.textContent = `Patched ${payload.patched} defendants. Matched ${payload.matched}, skipped ${payload.skipped}.`;
    uploadResult.classList.remove("hidden");
  });
};

init();

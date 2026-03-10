const backToCase = document.getElementById("back-to-case");
const caseMeta = document.getElementById("case-meta");
const uploadForm = document.getElementById("upload-form");
const uploadError = document.getElementById("upload-error");
const uploadResult = document.getElementById("upload-result");
const mappingPanel = document.getElementById("mapping-panel");
const fileInput = uploadForm.querySelector('input[type="file"]');
const mappingSelects = {
  seller: document.getElementById("map-seller"),
  platform: document.getElementById("map-platform"),
  businessName: document.getElementById("map-business-name"),
  locatedIn: document.getElementById("map-located-in"),
  sellerLocation: document.getElementById("map-seller-location"),
  sellerUrl: document.getElementById("map-seller-url"),
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
    businessName: pickDefaultHeader(headers, ["BUSINESS NAME", "BusinessName"]),
    locatedIn: pickDefaultHeader(headers, ["LOCATED IN", "LocatedIn"]),
    sellerLocation: pickDefaultHeader(headers, ["SELLER LOCATION", "SellerLocation"]),
    sellerUrl: pickDefaultHeader(headers, ["SELLER_URL", "SellerURL", "Seller URL"]),
  };
  buildOptions(mappingSelects.seller, headers, defaults.seller, true);
  buildOptions(mappingSelects.platform, headers, defaults.platform, true);
  buildOptions(mappingSelects.businessName, headers, defaults.businessName);
  buildOptions(mappingSelects.locatedIn, headers, defaults.locatedIn);
  buildOptions(mappingSelects.sellerLocation, headers, defaults.sellerLocation);
  buildOptions(mappingSelects.sellerUrl, headers, defaults.sellerUrl);
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

  uploadForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    uploadError.textContent = "";
    uploadResult.classList.add("hidden");

    if (!fileInput.files.length) {
      uploadError.textContent = "Please choose a CSV file.";
      return;
    }
    const sellerHeader = mappingSelects.seller.value;
    const platformHeader = mappingSelects.platform.value;
    if (!sellerHeader || !platformHeader) {
      uploadError.textContent = "Seller and Platform mappings are required.";
      return;
    }

    const formData = new FormData();
    formData.append("file", fileInput.files[0]);
    formData.append(
      "mapping",
      JSON.stringify({
        seller: sellerHeader,
        platform: platformHeader,
        businessName: mappingSelects.businessName.value || null,
        locatedIn: mappingSelects.locatedIn.value || null,
        sellerLocation: mappingSelects.sellerLocation.value || null,
        sellerUrl: mappingSelects.sellerUrl.value || null,
      })
    );

    const response = await authFetch(`/api/cases/${currentCase.id}/defendants/import`, {
      method: "POST",
      body: formData,
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      uploadError.textContent = payload.error || "Upload failed.";
      return;
    }

    const payload = await response.json();
    uploadResult.textContent = `Imported ${payload.imported} defendants (starting Doe ${payload.startingDoe}).`;
    uploadResult.classList.remove("hidden");
    fileInput.value = "";
    mappingPanel.classList.add("hidden");
  });
};

init();

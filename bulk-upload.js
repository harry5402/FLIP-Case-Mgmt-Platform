const backToCase = document.getElementById("back-to-case");
const caseMeta = document.getElementById("case-meta");
const uploadForm = document.getElementById("upload-form");
const uploadError = document.getElementById("upload-error");
const uploadResult = document.getElementById("upload-result");

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

  uploadForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    uploadError.textContent = "";
    uploadResult.classList.add("hidden");

    const fileInput = uploadForm.querySelector('input[type="file"]');
    if (!fileInput.files.length) {
      uploadError.textContent = "Please choose a CSV file.";
      return;
    }

    const formData = new FormData();
    formData.append("file", fileInput.files[0]);

    const response = await fetch(`/api/cases/${currentCase.id}/defendants/import`, {
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
  });
};

init();

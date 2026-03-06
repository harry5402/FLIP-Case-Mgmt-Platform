const CASES_STORAGE_KEY = "cases:local";
const USE_API = true;
const API_BASE = "";

const loadCases = async () => {
  if (USE_API) {
    const response = await authFetch(`${API_BASE}/api/cases`);
    return response.json();
  }
  const response = await fetch("data/cases.json");
  const data = await response.json();
  const baseCases = data.cases || [];
  const localRaw = localStorage.getItem(CASES_STORAGE_KEY);
  const localCases = localRaw ? JSON.parse(localRaw) : [];
  const merged = [...baseCases];
  localCases.forEach((localCase) => {
    if (!merged.some((item) => item.id === localCase.id)) {
      merged.push(localCase);
    }
  });
  return merged;
};

const saveCase = async (newCase) => {
  if (USE_API) {
    const response = await authFetch(`${API_BASE}/api/cases`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(newCase),
    });
    return response.json();
  }
  const localRaw = localStorage.getItem(CASES_STORAGE_KEY);
  const localCases = localRaw ? JSON.parse(localRaw) : [];
  localCases.push(newCase);
  localStorage.setItem(CASES_STORAGE_KEY, JSON.stringify(localCases));
  return newCase;
};

const updateCase = async (caseId, updates) => {
  if (USE_API) {
    const response = await authFetch(`${API_BASE}/api/cases/${caseId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updates),
    });
    return response.json();
  }
  const localRaw = localStorage.getItem(CASES_STORAGE_KEY);
  const localCases = localRaw ? JSON.parse(localRaw) : [];
  const index = localCases.findIndex((item) => item.id === caseId);
  if (index >= 0) {
    localCases[index] = { ...localCases[index], ...updates };
    localStorage.setItem(CASES_STORAGE_KEY, JSON.stringify(localCases));
    return localCases[index];
  }
  return null;
};

const loadDefendants = async (caseId) => {
  if (USE_API) {
    const response = await authFetch(`${API_BASE}/api/cases/${caseId}/defendants`);
    return response.json();
  }
  const cases = await loadCases();
  const currentCase = cases.find((item) => item.id === caseId);
  return currentCase?.defendants || [];
};

const updateDefendant = async (defendantId, updates) => {
  if (USE_API) {
    const response = await authFetch(`${API_BASE}/api/defendants/${defendantId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updates),
    });
    return response.json();
  }
  return null;
};

const loadListings = async (defendantId) => {
  if (USE_API) {
    const response = await authFetch(`${API_BASE}/api/defendants/${defendantId}/listings`);
    return response.json();
  }
  return [];
};

const loadGroups = async (caseId) => {
  if (USE_API) {
    const response = await authFetch(`${API_BASE}/api/cases/${caseId}/groups`);
    return response.json();
  }
  return [];
};

const createGroup = async (caseId, payload) => {
  if (USE_API) {
    const response = await authFetch(`${API_BASE}/api/cases/${caseId}/groups`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return response.json();
  }
  return null;
};

const loadCase = async (caseId) => {
  if (USE_API) {
    const response = await authFetch(`${API_BASE}/api/cases/${caseId}`);
    if (!response.ok) return null;
    return response.json();
  }
  const cases = await loadCases();
  return cases.find((item) => item.id === caseId) || null;
};

const loadNegotiation = async (defendantId) => {
  if (USE_API) {
    const response = await authFetch(`${API_BASE}/api/defendants/${defendantId}/negotiation`);
    return response.json();
  }
  return null;
};

const saveNegotiation = async (defendantId, payload) => {
  if (USE_API) {
    const response = await authFetch(`${API_BASE}/api/defendants/${defendantId}/negotiation`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return response.json();
  }
  return null;
};

const loadCollection = async (defendantId) => {
  if (USE_API) {
    const response = await authFetch(`${API_BASE}/api/defendants/${defendantId}/collection`);
    return response.json();
  }
  return null;
};

const saveCollection = async (defendantId, payload) => {
  if (USE_API) {
    const response = await authFetch(`${API_BASE}/api/defendants/${defendantId}/collection`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return response.json();
  }
  return null;
};

const loadBookkeeping = async (defendantId) => {
  if (USE_API) {
    const response = await authFetch(`${API_BASE}/api/defendants/${defendantId}/bookkeeping`);
    return response.json();
  }
  return null;
};

const saveBookkeeping = async (defendantId, payload) => {
  if (USE_API) {
    const response = await authFetch(`${API_BASE}/api/defendants/${defendantId}/bookkeeping`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return response.json();
  }
  return null;
};

const loadUserOptions = async () => {
  if (USE_API) {
    const response = await authFetch(`${API_BASE}/api/users/options`);
    return response.json();
  }
  return [];
};

const createTask = async (payload) => {
  if (USE_API) {
    const response = await authFetch(`${API_BASE}/api/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return response.json();
  }
  return null;
};

const loadMyTasks = async () => {
  if (USE_API) {
    const response = await authFetch(`${API_BASE}/api/tasks/my`);
    return response.json();
  }
  return [];
};

const completeTask = async (taskId) => {
  if (USE_API) {
    const response = await authFetch(`${API_BASE}/api/tasks/${taskId}/complete`, {
      method: "PUT",
    });
    return response.json();
  }
  return null;
};

const loadCaseTemplates = async (caseId) => {
  if (USE_API) {
    const response = await authFetch(`${API_BASE}/api/cases/${caseId}/templates`);
    return response.json();
  }
  return [];
};

const uploadCaseTemplate = async (
  caseId,
  templateFile,
  dataFile,
  displayName
) => {
  if (USE_API) {
    const formData = new FormData();
    formData.append("templateFile", templateFile);
    formData.append("dataFile", dataFile);
    formData.append("displayName", displayName || "");
    const response = await authFetch(`${API_BASE}/api/cases/${caseId}/templates`, {
      method: "POST",
      body: formData,
    });
    return response.json();
  }
  return null;
};

const loadGroup = async (groupId) => {
  if (USE_API) {
    const response = await authFetch(`${API_BASE}/api/groups/${groupId}`);
    if (!response.ok) return null;
    return response.json();
  }
  return null;
};

const loadGroupDefendants = async (groupId) => {
  if (USE_API) {
    const response = await authFetch(`${API_BASE}/api/groups/${groupId}/defendants`);
    return response.json();
  }
  return [];
};

const loadGroupListings = async (groupId) => {
  if (USE_API) {
    const response = await authFetch(`${API_BASE}/api/groups/${groupId}/listings`);
    return response.json();
  }
  return [];
};

const loadGroupNegotiation = async (groupId) => {
  if (USE_API) {
    const response = await authFetch(`${API_BASE}/api/groups/${groupId}/negotiation`);
    return response.json();
  }
  return {};
};

const saveGroupNegotiation = async (groupId, payload) => {
  if (USE_API) {
    const response = await authFetch(`${API_BASE}/api/groups/${groupId}/negotiation`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return response.json();
  }
  return null;
};

const getParam = (name) => {
  const params = new URLSearchParams(window.location.search);
  return params.get(name);
};

const formatDate = (value) => {
  if (!value) return "—";
  const date = new Date(value);
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
};

const formatMoney = (value) => {
  if (value === null || value === undefined) return "—";
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
};

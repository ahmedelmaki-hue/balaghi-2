const API_BASE = (import.meta.env.VITE_API_BASE_URL || '/api').replace(/\/$/, '');
const REFRESH_KEY = 'balaghi_staff_refresh_token';

let accessToken = null;
let refreshInFlight = null;

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const DASHBOARD_ROLES = ['staff', 'field_worker', 'admin'];

async function readResponse(response) {
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new ApiError(response.status, data?.error || 'تعذّر إكمال الطلب.');
    // The server enforces both on every request; tell the app so it can react.
    if (error.status === 403 && error.message === 'account disabled') {
      logout();
      window.dispatchEvent(new CustomEvent('balaghi:session-ended', { detail: 'disabled' }));
    } else if (error.status === 403 && error.message === 'password change required') {
      window.dispatchEvent(new Event('balaghi:password-change-required'));
    }
    throw error;
  }
  return data;
}

function saveSession(session) {
  accessToken = session.access_token;
  sessionStorage.setItem(REFRESH_KEY, session.refresh_token);
}

export function logout() {
  accessToken = null;
  sessionStorage.removeItem(REFRESH_KEY);
}

export function hasSavedSession() {
  return Boolean(sessionStorage.getItem(REFRESH_KEY));
}

export async function login(username, password) {
  const response = await fetch(`${API_BASE}/auth/staff/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const data = await readResponse(response);
  if (!DASHBOARD_ROLES.includes(data.user?.role) || !data.session?.refresh_token) {
    throw new ApiError(403, 'هذا الحساب لا يملك صلاحية الموظف.');
  }
  saveSession(data.session);
  return data.user;
}

async function refreshSession() {
  if (refreshInFlight) return refreshInFlight;
  const refreshToken = sessionStorage.getItem(REFRESH_KEY);
  if (!refreshToken) throw new ApiError(401, 'يرجى تسجيل الدخول.');
  refreshInFlight = (async () => {
    try {
      const response = await fetch(`${API_BASE}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: refreshToken }),
      });
      const data = await readResponse(response);
      if (!DASHBOARD_ROLES.includes(data.user?.role) || !data.session?.refresh_token) {
        throw new ApiError(403, 'هذا الحساب لا يملك صلاحية الموظف.');
      }
      saveSession(data.session);
      return data.user;
    } catch (error) {
      logout();
      window.dispatchEvent(new Event('balaghi:session-ended'));
      throw error;
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

export async function restoreSession() {
  if (!hasSavedSession()) return null;
  try {
    return await refreshSession();
  } catch {
    return null;
  }
}

export async function api(path, { method = 'GET', body, query } = {}) {
  if (!accessToken) await refreshSession();
  const url = new URL(`${API_BASE}${path}`, window.location.origin);
  for (const [key, value] of Object.entries(query || {})) {
    if (value !== '' && value !== null && value !== undefined) {
      url.searchParams.set(key, String(value));
    }
  }
  const send = () => fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(body === undefined || body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: body instanceof FormData ? body : JSON.stringify(body) }),
  });
  let response = await send();
  if (response.status === 401) {
    await refreshSession();
    response = await send();
  }
  return readResponse(response);
}

export function imageUrl(value) {
  if (!value) return null;
  return new URL(value, new URL(API_BASE, window.location.origin)).href;
}

export const staffApi = {
  overview: () => api('/stats/overview'),
  reports: (query) => api('/reports/staff', { query: { limit: 25, ...query } }),
  report: (id) => api(`/reports/${encodeURIComponent(id)}/staff`),
  approve: (id) => api(`/reports/${encodeURIComponent(id)}/approve`, { method: 'PATCH' }),
  correctCategory: (id, category) => api(`/reports/${encodeURIComponent(id)}/category`, {
    method: 'PATCH', body: { category },
  }),
  requestVerification: (id, note) => api(`/reports/${encodeURIComponent(id)}/verification/request`, {
    method: 'PATCH', body: { note },
  }),
  cancelVerification: (id, note) => api(`/reports/${encodeURIComponent(id)}/verification/cancel`, {
    method: 'PATCH', body: { note },
  }),
  correctVerificationLocation: (id, latitude, longitude) =>
    api(`/reports/${encodeURIComponent(id)}/verification/location`, {
      method: 'PATCH', body: { latitude, longitude },
    }),
  reviewFieldIssue: (id, body) => api(`/reports/${encodeURIComponent(id)}/field-issue/review`, {
    method: 'PATCH', body,
  }),
  reviewCompletion: (id, decision, note) => api(`/reports/${encodeURIComponent(id)}/completion/review`, {
    method: 'PATCH', body: { decision, ...(note ? { note } : {}) },
  }),
  releaseReport: (id, reason) => api(`/reports/${encodeURIComponent(id)}/release`, {
    method: 'PATCH', body: { reason },
  }),
  changeStatus: (id, status, reason) => api(`/reports/${encodeURIComponent(id)}/status`, {
    method: 'PATCH',
    body: { status, ...(reason ? { reason } : {}) },
  }),
  publicMarkers: (bbox, query) => api('/reports/public', {
    query: { bbox, limit: 500, ...query },
  }),
  staffMarkers: (bbox, query) => api('/reports/staff/map', {
    query: { bbox, limit: 500, ...query },
  }),
};

export const fieldApi = {
  assigned: (query) => api('/reports/field/assigned', { query: { limit: 25, ...query } }),
  verifications: (query) => api('/reports/field/verifications', { query: { limit: 25, ...query } }),
  claimVerification: (id) => api(`/reports/${encodeURIComponent(id)}/verification/claim`, {
    method: 'PATCH',
  }),
  respondVerification: (id, result, note) => api(`/reports/${encodeURIComponent(id)}/verification/respond`, {
    method: 'PATCH', body: { result, note },
  }),
  accept: (id) => api(`/reports/${encodeURIComponent(id)}/accept`, { method: 'PATCH' }),
  start: (id) => api(`/reports/${encodeURIComponent(id)}/start`, { method: 'PATCH' }),
  reportIssue: (id, reason, note) => api(`/reports/${encodeURIComponent(id)}/field-issue`, {
    method: 'POST', body: { reason, note },
  }),
  submitCompletion: (id, note, image, location) => {
    const body = new FormData();
    body.append('image', image, 'after-repair.jpg');
    body.append('note', note);
    if (location) {
      body.append('photo_latitude', String(location.latitude));
      body.append('photo_longitude', String(location.longitude));
      body.append('photo_accuracy_m', String(location.accuracy));
    }
    return api(`/reports/${encodeURIComponent(id)}/completion`, { method: 'POST', body });
  },
};

export async function changePassword(currentPassword, newPassword) {
  const data = await api('/auth/password', {
    method: 'POST',
    body: { current_password: currentPassword, new_password: newPassword },
  });
  // The server ends every other session and returns a fresh one for this browser.
  saveSession(data.session);
  return data.user;
}

const account = (id) => `/admin/users/${encodeURIComponent(id)}`;
const citizen = (id) => `/admin/citizens/${encodeURIComponent(id)}`;

export const adminApi = {
  users: (query) => api('/admin/users', { query: { limit: 25, ...query } }),
  createUser: (body) => api('/admin/users', { method: 'POST', body }),
  updateUser: (id, body) => api(account(id), { method: 'PATCH', body }),
  setUserActive: (id, active, reason) => api(`${account(id)}/status`, {
    method: 'PATCH', body: { active, ...(reason ? { reason } : {}) },
  }),
  resetPassword: (id) => api(`${account(id)}/reset-password`, { method: 'POST' }),
  citizens: (query) => api('/admin/citizens', { query: { limit: 25, ...query } }),
  setCitizenActive: (id, active, reason) => api(`${citizen(id)}/status`, {
    method: 'PATCH', body: { active, ...(reason ? { reason } : {}) },
  }),
  audit: (query) => api('/admin/audit', { query: { limit: 25, ...query } }),
};

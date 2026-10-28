const apiBaseUrl = String.fromEnvironment(
  'BALAGHI_API_BASE_URL',
  defaultValue: 'http://10.0.2.2:5000/api',
);

// Every build uses the real authentication service unless a design preview is
// requested explicitly with --dart-define=BALAGHI_AUTH_PREVIEW=true, which walks
// through the login screens without sending an SMS.
const authPreviewMode = bool.fromEnvironment(
  'BALAGHI_AUTH_PREVIEW',
  defaultValue: false,
);

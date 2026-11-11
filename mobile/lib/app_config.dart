/// How long the app waits for the server. The free Render instance sleeps
/// after about 15 minutes without use, and its first answer can take up to a
/// minute while it wakes; a shorter wait would show an error for a working server.
const serverTimeout = Duration(seconds: 60);

/// After this long, a wait is explained so the app does not look stuck.
const slowServerHint = Duration(seconds: 6);
const slowServerMessage = 'جارٍ الاتصال بالخادم، قد يستغرق ذلك دقيقة.';

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

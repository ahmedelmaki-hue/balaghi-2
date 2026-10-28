import 'package:flutter/foundation.dart';

const apiBaseUrl = String.fromEnvironment(
  'BALAGHI_API_BASE_URL',
  defaultValue: 'http://10.0.2.2:5000/api',
);

// Debug builds can walk through the login design without sending an SMS.
// Release builds always use the real authentication service by default.
const authPreviewMode = bool.fromEnvironment(
  'BALAGHI_AUTH_PREVIEW',
  defaultValue: kDebugMode,
);

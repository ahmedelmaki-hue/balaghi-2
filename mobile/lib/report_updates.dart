import 'dart:convert';

import 'package:shared_preferences/shared_preferences.dart';

import 'citizen_auth.dart';
import 'my_reports_repository.dart';

/// The stage a citizen sees for a report: pending, new, in_progress,
/// resolved or rejected. Staff-only steps never change it.
String reportStage(MyReport report) => report.isRejected
    ? 'rejected'
    : report.isPendingReview
    ? 'pending'
    : report.status!.apiValue;

/// What each citizen last saw in «بلاغاتي» on this device, kept per phone so
/// another account on the same phone never sees someone else's marks.
class SeenReportStore {
  const SeenReportStore();

  static String _key(String phone) => 'seen_report_stages_$phone';

  /// Null until «بلاغاتي» has been checked once on this device.
  Future<Map<String, String>?> load(String phone) async {
    final preferences = await SharedPreferences.getInstance();
    final raw = preferences.getString(_key(phone));
    if (raw == null) return null;
    try {
      return Map<String, String>.from(jsonDecode(raw) as Map);
    } catch (_) {
      return null;
    }
  }

  Future<void> save(String phone, Map<String, String> stages) async {
    final preferences = await SharedPreferences.getInstance();
    await preferences.setString(_key(phone), jsonEncode(stages));
  }
}

/// Reports whose stage differs from the last visit. Every report starts
/// awaiting review, so one never seen counts only once it has left review.
/// Before the first visit there is nothing to compare, so nothing counts.
Set<String> changedReports(
  Map<String, String>? seen,
  Iterable<MyReport> reports,
) {
  if (seen == null) return const {};
  return {
    for (final report in reports)
      if (seen[report.id] != reportStage(report) &&
          (seen.containsKey(report.id) || reportStage(report) != 'pending'))
        report.id,
  };
}

/// Records the stages on screen now, keeping the reports not shown, and
/// returns the ones that changed since the last visit.
Future<Set<String>> markReportsSeen(
  SeenReportStore store,
  String phone,
  List<MyReport> reports,
) async {
  final seen = await store.load(phone);
  final changed = changedReports(seen, reports);
  await store.save(phone, {
    ...?seen,
    for (final report in reports) report.id: reportStage(report),
  });
  return changed;
}

/// How many of the citizen's latest reports changed since «بلاغاتي» was last
/// opened, for the mark on its button. The first check only sets the baseline.
Future<int> countReportUpdates({
  required CitizenSession session,
  required MyReportsRepository repository,
  SeenReportStore store = const SeenReportStore(),
}) async {
  final latest = (await repository.fetch(session: session)).items;
  final seen = await store.load(session.phone);
  if (seen == null) {
    await store.save(session.phone, {
      for (final report in latest) report.id: reportStage(report),
    });
    return 0;
  }
  return changedReports(seen, latest).length;
}

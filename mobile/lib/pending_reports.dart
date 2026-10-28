import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:latlong2/latlong.dart';
import 'package:path_provider/path_provider.dart';

import 'citizen_auth.dart';
import 'create_report_repository.dart';
import 'public_reports.dart';

/// A report that could not reach the server and waits on this device.
/// It keeps its client_request_id so a later send never creates a duplicate.
class PendingReport {
  const PendingReport({
    required this.clientRequestId,
    required this.ownerPhone,
    required this.category,
    required this.location,
    required this.imageMimeType,
    required this.savedAt,
    this.description,
    this.imagePath = '',
  });

  final String clientRequestId;
  final String ownerPhone;
  final ReportCategory category;
  final LatLng location;
  final String imageMimeType;
  final DateTime savedAt;
  final String? description;

  /// Absolute path of the saved photo, filled in when the store loads it.
  final String imagePath;

  String get imageFileName =>
      '$clientRequestId.${imageMimeType == 'image/png' ? 'png' : 'jpg'}';

  Map<String, dynamic> toJson() => {
    'client_request_id': clientRequestId,
    'owner_phone': ownerPhone,
    'category': category.apiValue,
    'latitude': location.latitude,
    'longitude': location.longitude,
    'image_mime_type': imageMimeType,
    'saved_at': savedAt.toIso8601String(),
    'description': description,
  };

  factory PendingReport.fromJson(
    Map<String, dynamic> json, {
    String imagePath = '',
  }) => PendingReport(
    clientRequestId: json['client_request_id'] as String,
    ownerPhone: json['owner_phone'] as String,
    category: ReportCategory.fromApi(json['category'] as String),
    location: LatLng(
      (json['latitude'] as num).toDouble(),
      (json['longitude'] as num).toDouble(),
    ),
    imageMimeType: json['image_mime_type'] as String,
    savedAt: DateTime.parse(json['saved_at'] as String),
    description: json['description'] as String?,
    imagePath: imagePath,
  );
}

class PendingReportStore {
  PendingReportStore({Future<Directory> Function()? directory})
    : _directory = directory ?? _defaultDirectory;

  final Future<Directory> Function() _directory;

  // Screens may read and write at the same time; queue index changes.
  static Future<void> _queue = Future.value();

  static Future<Directory> _defaultDirectory() async => Directory(
    '${(await getApplicationSupportDirectory()).path}/pending_reports',
  );

  Future<T> _locked<T>(Future<T> Function() action) {
    final result = _queue.then((_) => action());
    _queue = result.then<void>((_) {}, onError: (_) {});
    return result;
  }

  Future<File> _indexFile() async {
    final directory = await _directory();
    await directory.create(recursive: true);
    return File('${directory.path}/index.json');
  }

  Future<List<PendingReport>> _readAll() async {
    final index = await _indexFile();
    if (!await index.exists()) return [];
    try {
      final directory = index.parent.path;
      return (jsonDecode(await index.readAsString()) as List<dynamic>).map((
        item,
      ) {
        final json = Map<String, dynamic>.from(item as Map);
        final report = PendingReport.fromJson(json);
        return PendingReport.fromJson(
          json,
          imagePath: '$directory/${report.imageFileName}',
        );
      }).toList();
    } catch (_) {
      return [];
    }
  }

  Future<void> _writeAll(List<PendingReport> reports) async {
    final index = await _indexFile();
    final temporary = File('${index.path}.tmp');
    await temporary.writeAsString(
      jsonEncode(reports.map((report) => report.toJson()).toList()),
      flush: true,
    );
    await temporary.rename(index.path);
  }

  /// Saved reports of one citizen, oldest first.
  Future<List<PendingReport>> load(String ownerPhone) => _locked(() async {
    final reports = await _readAll();
    return reports
        .where((report) => report.ownerPhone == ownerPhone)
        .where((report) => File(report.imagePath).existsSync())
        .toList()
      ..sort((a, b) => a.savedAt.compareTo(b.savedAt));
  });

  Future<void> save(PendingReport report, List<int> image) => _locked(() async {
    final index = await _indexFile();
    await File(
      '${index.parent.path}/${report.imageFileName}',
    ).writeAsBytes(image, flush: true);
    final reports = await _readAll();
    await _writeAll([
      ...reports.where(
        (item) => item.clientRequestId != report.clientRequestId,
      ),
      report,
    ]);
  });

  Future<void> remove(PendingReport report) => _locked(() async {
    final reports = await _readAll();
    await _writeAll(
      reports
          .where((item) => item.clientRequestId != report.clientRequestId)
          .toList(),
    );
    final image = File(report.imagePath);
    if (await image.exists()) await image.delete();
  });
}

class PendingSendResult {
  const PendingSendResult({
    required this.sent,
    required this.remaining,
    this.error,
  });

  final int sent;
  final List<PendingReport> remaining;

  /// Why sending stopped, when the server refused a report or the session ended.
  final String? error;
}

/// Sends the citizen's saved reports in order and removes each one the server
/// accepts. Stops at the first failure so an offline device does not retry
/// every report in turn.
Future<PendingSendResult> sendPendingReports({
  required CitizenSession session,
  required PendingReportStore store,
  required CreateReportRepository repository,
}) => _inFlight[session.phone] ??= _send(session, store, repository)
    .whenComplete(() {
      _inFlight.remove(session.phone);
    });

final _inFlight = <String, Future<PendingSendResult>>{};

Future<PendingSendResult> _send(
  CitizenSession session,
  PendingReportStore store,
  CreateReportRepository repository,
) async {
  final waiting = await store.load(session.phone);
  var sent = 0;
  String? error;
  for (final report in waiting) {
    try {
      await repository.submit(
        session: session,
        category: report.category,
        location: report.location,
        imageBytes: await File(report.imagePath).readAsBytes(),
        imageMimeType: report.imageMimeType,
        clientRequestId: report.clientRequestId,
        description: report.description,
      );
    } on CreateReportFailure catch (failure) {
      if (!failure.canRetryLater) error = failure.message;
      break;
    } catch (_) {
      break;
    }
    await store.remove(report);
    sent++;
  }
  return PendingSendResult(
    sent: sent,
    remaining: await store.load(session.phone),
    error: error,
  );
}

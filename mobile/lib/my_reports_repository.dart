import 'dart:convert';

import 'package:http/http.dart' as http;
import 'package:latlong2/latlong.dart';

import 'app_config.dart';
import 'citizen_auth.dart';
import 'public_reports.dart';
import 'report_image_url.dart';

class MyReportsFailure implements Exception {
  const MyReportsFailure(this.message);
  final String message;
}

class MyReport {
  const MyReport({
    required this.id,
    required this.category,
    required this.status,
    required this.location,
    required this.createdAt,
    this.approvedAt,
    this.description,
    this.addressText,
    this.imageUrl,
    this.rejectionReason,
  });

  final String id;
  final ReportCategory category;
  final ReportStatus? status;
  final LatLng location;
  final DateTime createdAt;
  final DateTime? approvedAt;
  final String? description;
  final String? addressText;
  final String? imageUrl;
  final String? rejectionReason;

  bool get isRejected => status == null;
  bool get isPendingReview => !isRejected && approvedAt == null;

  PublicReport toPublicReport() {
    if (status == null) throw StateError('Rejected report is not public');
    return PublicReport(
      id: id,
      category: category,
      status: status!,
      location: location,
      createdAt: createdAt,
      description: description,
      addressText: addressText,
      imageUrl: imageUrl,
    );
  }

  factory MyReport.fromPublic(PublicReport report) => MyReport(
    id: report.id,
    category: report.category,
    status: report.status,
    location: report.location,
    createdAt: report.createdAt,
    approvedAt: report.createdAt,
    description: report.description,
    addressText: report.addressText,
    imageUrl: report.imageUrl,
  );

  factory MyReport.fromJson(Map<String, dynamic> json) {
    final id = json['id']?.toString();
    final latitude = _number(json['latitude']);
    final longitude = _number(json['longitude']);
    final createdAt = DateTime.tryParse(json['created_at']?.toString() ?? '');
    if (id == null ||
        id.isEmpty ||
        latitude == null ||
        longitude == null ||
        latitude < -90 ||
        latitude > 90 ||
        longitude < -180 ||
        longitude > 180 ||
        createdAt == null) {
      throw const FormatException('Invalid own report');
    }
    final rawStatus = json['status']?.toString() ?? '';
    return MyReport(
      id: id,
      category: ReportCategory.fromApi(json['category']?.toString() ?? ''),
      status: rawStatus == 'rejected' ? null : ReportStatus.fromApi(rawStatus),
      location: LatLng(latitude, longitude),
      createdAt: createdAt,
      approvedAt: DateTime.tryParse(json['approved_at']?.toString() ?? ''),
      description: _optionalText(json['description']),
      addressText: _optionalText(json['address_text']),
      imageUrl: _optionalText(json['image_url']),
      rejectionReason: _optionalText(json['rejection_reason']),
    );
  }

  static double? _number(Object? value) => value is num
      ? value.toDouble()
      : double.tryParse(value?.toString() ?? '');

  static String? _optionalText(Object? value) {
    final text = value?.toString().trim();
    return text == null || text.isEmpty ? null : text;
  }
}

class MyReportsPage {
  const MyReportsPage({
    required this.items,
    required this.page,
    required this.totalPages,
  });

  final List<MyReport> items;
  final int page;
  final int totalPages;
}

class MyReportsRepository {
  MyReportsRepository({required String baseUrl, http.Client? client})
    : _baseUrl = baseUrl.replaceFirst(RegExp(r'/$'), ''),
      _client = client ?? http.Client(),
      _ownsClient = client == null;

  final String _baseUrl;
  final http.Client _client;
  final bool _ownsClient;

  Future<MyReportsPage> fetch({
    required CitizenSession session,
    ReportStatus? status,
    int page = 1,
  }) async {
    final uri = Uri.parse('$_baseUrl/reports/mine').replace(
      queryParameters: {
        'page': '$page',
        'limit': '25',
        if (status != null) 'status': status.apiValue,
      },
    );
    http.Response response;
    try {
      response = await _client
          .get(uri, headers: {'authorization': 'Bearer ${session.accessToken}'})
          .timeout(serverTimeout);
    } catch (_) {
      throw const MyReportsFailure(
        'تعذّر تحميل بلاغاتك. تحقق من اتصالك وحاول مجددًا.',
      );
    }
    if (response.statusCode == 403) {
      throw const MyReportsFailure(suspendedAccountMessage);
    }
    if (response.statusCode == 401) {
      throw const MyReportsFailure(
        'انتهت جلسة الدخول. ارجع وسجّل الدخول مجددًا.',
      );
    }
    if (response.statusCode != 200) {
      throw const MyReportsFailure('تعذّر تحميل بلاغاتك. حاول مجددًا.');
    }
    try {
      final body = jsonDecode(response.body) as Map<String, dynamic>;
      final items = body['items'] as List<dynamic>;
      return MyReportsPage(
        items: items.map((item) {
          final json = Map<String, dynamic>.from(item as Map);
          json['image_url'] = resolveReportImageUrl(
            json['image_url'],
            _baseUrl,
          );
          return MyReport.fromJson(json);
        }).toList(),
        page: (body['page'] as num).toInt(),
        totalPages: (body['total_pages'] as num).toInt(),
      );
    } catch (_) {
      throw const MyReportsFailure('استجابة البلاغات غير صالحة.');
    }
  }

  void dispose() {
    if (_ownsClient) _client.close();
  }
}

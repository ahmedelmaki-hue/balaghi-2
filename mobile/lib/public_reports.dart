import 'dart:convert';

import 'package:flutter_map/flutter_map.dart';
import 'package:http/http.dart' as http;
import 'package:latlong2/latlong.dart';

import 'report_image_url.dart';

enum ReportCategory {
  pothole('pothole', 'الحفر', 'حفرة'),
  waterLeak('water_leak', 'تسرب مياه', 'تسرب مياه'),
  garbage('garbage', 'القمامة', 'قمامة');

  const ReportCategory(this.apiValue, this.label, this.singularLabel);

  final String apiValue;
  final String label;
  final String singularLabel;

  static ReportCategory fromApi(String value) => values.firstWhere(
    (category) => category.apiValue == value,
    orElse: () => throw FormatException('Unknown report category: $value'),
  );
}

enum ReportStatus {
  newReport('new', 'جديد'),
  inProgress('in_progress', 'قيد المعالجة'),
  resolved('resolved', 'تم الحل');

  const ReportStatus(this.apiValue, this.label);

  final String apiValue;
  final String label;

  static ReportStatus fromApi(String value) => values.firstWhere(
    (status) => status.apiValue == value,
    orElse: () => throw FormatException('Unknown report status: $value'),
  );
}

class PublicReport {
  const PublicReport({
    required this.id,
    required this.category,
    required this.status,
    required this.location,
    required this.createdAt,
    this.description,
    this.addressText,
    this.imageUrl,
  });

  final String id;
  final ReportCategory category;
  final ReportStatus status;
  final LatLng location;
  final DateTime createdAt;
  final String? description;
  final String? addressText;
  final String? imageUrl;

  String get title {
    final address = addressText?.trim();
    return address == null || address.isEmpty
        ? category.singularLabel
        : '${category.singularLabel} – $address';
  }

  factory PublicReport.fromJson(Map<String, dynamic> json) {
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
      throw const FormatException('Invalid public report');
    }
    return PublicReport(
      id: id,
      category: ReportCategory.fromApi(json['category']?.toString() ?? ''),
      status: ReportStatus.fromApi(json['status']?.toString() ?? ''),
      location: LatLng(latitude, longitude),
      createdAt: createdAt,
      description: _optionalText(json['description']),
      addressText: _optionalText(json['address_text']),
      imageUrl: _optionalText(json['image_url']),
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

class PublicReportsRepository {
  PublicReportsRepository({required String baseUrl, http.Client? client})
    : _baseUrl = baseUrl.replaceFirst(RegExp(r'/$'), ''),
      _client = client ?? http.Client(),
      _ownsClient = client == null;

  final String _baseUrl;
  final http.Client _client;
  final bool _ownsClient;

  /// Markers in [bounds], newest first. The API sends at most 500 per batch, so
  /// this follows `next_cursor` for up to [maxBatches] batches; a view with
  /// even more reports shows the newest and the rest appear as the citizen
  /// zooms in.
  Future<List<PublicReport>> fetchMarkers(
    LatLngBounds bounds, {
    ReportCategory? category,
    int maxBatches = 4,
  }) async {
    final reports = <PublicReport>[];
    String? cursor;
    for (var batch = 0; batch < maxBatches; batch++) {
      final query = <String, String>{
        'bbox': '${bounds.west},${bounds.south},${bounds.east},${bounds.north}',
        'limit': '500',
        if (category != null) 'category': category.apiValue,
        'cursor': ?cursor,
      };
      final uri = Uri.parse(
        '$_baseUrl/reports/public',
      ).replace(queryParameters: query);
      final response = await _client
          .get(uri)
          .timeout(const Duration(seconds: 12));
      if (response.statusCode != 200) {
        throw Exception('تعذر تحميل البلاغات (${response.statusCode})');
      }
      final body = jsonDecode(response.body) as Map<String, dynamic>;
      final items = body['items'] as List<dynamic>? ?? const [];
      reports.addAll(
        items.map((item) {
          final json = Map<String, dynamic>.from(item as Map);
          json['image_url'] = resolveReportImageUrl(
            json['image_url'],
            _baseUrl,
          );
          return PublicReport.fromJson(json);
        }),
      );
      cursor = body['next_cursor'] as String?;
      if (cursor == null) break;
    }
    return reports;
  }

  Future<PublicReport> fetchDetail(String id) async {
    final uri = Uri.parse('$_baseUrl/reports/$id/public');
    final response = await _client
        .get(uri)
        .timeout(const Duration(seconds: 12));
    if (response.statusCode != 200) {
      throw Exception('تعذر تحميل تفاصيل البلاغ (${response.statusCode})');
    }
    final json = jsonDecode(response.body) as Map<String, dynamic>;
    json['image_url'] = resolveReportImageUrl(json['image_url'], _baseUrl);
    return PublicReport.fromJson(json);
  }

  void dispose() {
    if (_ownsClient) _client.close();
  }
}

List<PublicReport> demoPublicReports() {
  final now = DateTime.now();
  return [
    PublicReport(
      id: '14',
      category: ReportCategory.pothole,
      status: ReportStatus.newReport,
      location: const LatLng(32.8949, 13.1858),
      createdAt: now.subtract(const Duration(hours: 3)),
      addressText: 'شارع عمر المختار',
      description: 'هبوط في الطريق يعيق حركة السير بالقرب من التقاطع.',
    ),
    PublicReport(
      id: '15',
      category: ReportCategory.waterLeak,
      status: ReportStatus.inProgress,
      location: const LatLng(32.8891, 13.1962),
      createdAt: now.subtract(const Duration(minutes: 45)),
      addressText: 'وسط طرابلس',
      description: 'تسرب مياه ظاهر على جانب الطريق.',
    ),
    PublicReport(
      id: '16',
      category: ReportCategory.garbage,
      status: ReportStatus.resolved,
      location: const LatLng(32.8988, 13.2002),
      createdAt: now.subtract(const Duration(days: 2)),
      addressText: 'بالقرب من ميدان الشهداء',
      description: 'تراكم قمامة تمت معالجته.',
    ),
    PublicReport(
      id: '17',
      category: ReportCategory.pothole,
      status: ReportStatus.newReport,
      location: const LatLng(32.8838, 13.1814),
      createdAt: now.subtract(const Duration(hours: 6)),
      addressText: 'حي الأندلس',
      description: 'حفرة في مسار السيارات.',
    ),
  ];
}

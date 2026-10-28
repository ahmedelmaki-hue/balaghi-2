import 'dart:convert';
import 'dart:typed_data';

import 'package:http/http.dart' as http;
import 'package:http_parser/http_parser.dart';
import 'package:latlong2/latlong.dart';

import 'citizen_auth.dart';
import 'public_reports.dart';
import 'report_image_url.dart';

class CreateReportFailure implements Exception {
  const CreateReportFailure(this.message, {this.canRetryLater = false});
  final String message;

  /// True when the report never reached the server or the server failed, so
  /// the same request can be saved on the device and sent again later.
  final bool canRetryLater;
}

class CreateReportRepository {
  CreateReportRepository({required String baseUrl, http.Client? client})
    : _baseUrl = baseUrl.replaceFirst(RegExp(r'/$'), ''),
      _client = client ?? http.Client(),
      _ownsClient = client == null;

  final String _baseUrl;
  final http.Client _client;
  final bool _ownsClient;

  Future<PublicReport> submit({
    required CitizenSession session,
    required ReportCategory category,
    required LatLng location,
    required Uint8List imageBytes,
    required String imageMimeType,
    required String clientRequestId,
    String? description,
  }) async {
    final request =
        http.MultipartRequest('POST', Uri.parse('$_baseUrl/reports'))
          ..headers['authorization'] = 'Bearer ${session.accessToken}'
          ..fields['category'] = category.apiValue
          ..fields['latitude'] = location.latitude.toString()
          ..fields['longitude'] = location.longitude.toString()
          ..fields['client_request_id'] = clientRequestId;
    if (description?.trim().isNotEmpty == true) {
      request.fields['description'] = description!.trim();
    }
    request.files.add(
      http.MultipartFile.fromBytes(
        'image',
        imageBytes,
        filename: imageMimeType == 'image/png' ? 'report.png' : 'report.jpg',
        contentType: MediaType.parse(imageMimeType),
      ),
    );

    http.Response response;
    try {
      response = await http.Response.fromStream(
        await _client.send(request).timeout(const Duration(seconds: 30)),
      );
    } catch (_) {
      throw const CreateReportFailure(
        'تعذّر الاتصال بالخادم. بيانات البلاغ ما زالت هنا؛ حاول مجددًا.',
        canRetryLater: true,
      );
    }

    if (response.statusCode == 401) {
      throw const CreateReportFailure('انتهت جلسة الدخول. سجّل الدخول مجددًا.');
    }
    if (response.statusCode == 403) {
      throw const CreateReportFailure(suspendedAccountMessage);
    }
    if (response.statusCode == 413) {
      throw const CreateReportFailure(
        'حجم الصورة أكبر من المسموح. حاول التقاطها مجددًا.',
      );
    }
    if (response.statusCode == 422) {
      throw const CreateReportFailure(
        'موقع البلاغ خارج النطاق المحدد. اختر موقعًا داخل حدود طرابلس المركز.',
      );
    }
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw CreateReportFailure(
        'تعذّر إرسال البلاغ. بياناتك ما زالت هنا؛ حاول مجددًا.',
        canRetryLater: response.statusCode >= 500,
      );
    }
    try {
      final json = jsonDecode(response.body) as Map<String, dynamic>;
      json['image_url'] = resolveReportImageUrl(json['image_url'], _baseUrl);
      return PublicReport.fromJson(json);
    } catch (_) {
      throw const CreateReportFailure('تعذّر قراءة تأكيد البلاغ من الخادم.');
    }
  }

  void dispose() {
    if (_ownsClient) _client.close();
  }
}

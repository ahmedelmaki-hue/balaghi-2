import 'dart:math';
import 'dart:typed_data';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:flutter_map_maplibre/flutter_map_maplibre.dart';
import 'package:geolocator/geolocator.dart';
import 'package:image_picker/image_picker.dart';
import 'package:latlong2/latlong.dart';

import 'app_config.dart';
import 'citizen_auth.dart';
import 'create_report_repository.dart';
import 'pending_reports.dart';
import 'photo_brightness.dart';
import 'public_reports.dart';
import 'report_ui.dart';

const _tripoli = LatLng(32.8912, 13.1905);
const _muted = Color(0xFF75858A);
const _line = Color(0xFFE2EAED);
const _orangeWash = Color(0xFFFFF5E8);
const _photoTeal = Color(0xFF12323F);
const _photoTealLight = Color(0xFF1E4A5C);
const _photoGold = Color(0xFFE5A93C);
const _photoSlate = Color(0xFF5F7382);
const _reportBackground = Color(0xFFFCF9F2);
const _reportTopGlow = Color(0xFFFEF3C7);
// Same boundary as the KML shared for the reporting area, as [latitude, longitude].
const _tripoliCenterBoundary = <LatLng>[
  LatLng(32.8859759, 13.1604141),
  LatLng(32.9016584, 13.1721901),
  LatLng(32.9021196, 13.1759666),
  LatLng(32.89474, 13.1896995),
  LatLng(32.900563, 13.206385),
  LatLng(32.9022349, 13.2192253),
  LatLng(32.893241, 13.2224525),
  LatLng(32.8837271, 13.2205986),
  LatLng(32.8752215, 13.2238945),
  LatLng(32.8720785, 13.2251047),
  LatLng(32.8707809, 13.2225641),
  LatLng(32.8702618, 13.2171396),
  LatLng(32.8662824, 13.2167276),
  LatLng(32.8657057, 13.2102045),
  LatLng(32.8637314, 13.1957276),
  LatLng(32.8678108, 13.1928238),
  LatLng(32.867061, 13.1797775),
  LatLng(32.876, 13.1646713),
  LatLng(32.8859759, 13.1604141),
];

bool _isInsideTripoliCenter(LatLng point) {
  var inside = false;
  for (
    var i = 0, j = _tripoliCenterBoundary.length - 1;
    i < _tripoliCenterBoundary.length;
    j = i++
  ) {
    final a = _tripoliCenterBoundary[i];
    final b = _tripoliCenterBoundary[j];
    final cross =
        (point.latitude - a.latitude) * (b.longitude - a.longitude) -
        (point.longitude - a.longitude) * (b.latitude - a.latitude);
    final onSegment =
        cross.abs() < 1e-9 &&
        point.longitude >= min(a.longitude, b.longitude) - 1e-9 &&
        point.longitude <= max(a.longitude, b.longitude) + 1e-9 &&
        point.latitude >= min(a.latitude, b.latitude) - 1e-9 &&
        point.latitude <= max(a.latitude, b.latitude) + 1e-9;
    if (onSegment) return true;
    final crosses =
        (a.latitude > point.latitude) != (b.latitude > point.latitude) &&
        point.longitude <
            (b.longitude - a.longitude) *
                    (point.latitude - a.latitude) /
                    (b.latitude - a.latitude) +
                a.longitude;
    if (crosses) inside = !inside;
  }
  return inside;
}

class CreateReportScreen extends StatefulWidget {
  const CreateReportScreen({super.key, required this.previewMode});

  final bool previewMode;

  @override
  State<CreateReportScreen> createState() => _CreateReportScreenState();
}

class _CreateReportScreenState extends State<CreateReportScreen> {
  final _picker = ImagePicker();
  final _mapController = MapController();
  final _description = TextEditingController();
  final _authApi = CitizenAuthApi(baseUrl: apiBaseUrl);
  final _repository = CreateReportRepository(baseUrl: apiBaseUrl);
  final _store = const CitizenAuthStore();
  final _pendingStore = PendingReportStore();
  final _clientRequestId = _newRequestId();

  int _step = 0;
  Uint8List? _photo;
  String? _photoMimeType;
  // A photo taken in near darkness: the citizen is told, and may keep it.
  bool _photoTooDark = false;
  int _photoCheckSerial = 0;
  ReportCategory? _category;
  LatLng? _location;
  LatLng _mapCenter = _tripoli;
  bool _mapReady = false;
  bool _locating = false;
  bool? _isAtProblemLocation;
  bool _mapMovedByUser = false;
  int _locationRequestId = 0;
  bool _locationConfirmed = false;
  bool _sending = false;
  bool _savedForLater = false;
  PublicReport? _createdReport;

  @override
  void initState() {
    super.initState();
    _restoreLostPhoto();
  }

  @override
  void dispose() {
    _description.dispose();
    _mapController.dispose();
    _authApi.dispose();
    _repository.dispose();
    super.dispose();
  }

  static String _newRequestId() {
    final bytes = List<int>.generate(16, (_) => Random.secure().nextInt(256));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    final hex = bytes.map((b) => b.toRadixString(16).padLeft(2, '0')).join();
    return '${hex.substring(0, 8)}-${hex.substring(8, 12)}-'
        '${hex.substring(12, 16)}-${hex.substring(16, 20)}-${hex.substring(20)}';
  }

  Future<void> _restoreLostPhoto() async {
    try {
      final lost = await _picker.retrieveLostData();
      if (lost.files?.isNotEmpty == true) await _acceptPhoto(lost.files!.first);
    } catch (_) {
      // The user can take the photo again if Android could not restore it.
    }
  }

  Future<void> _capturePhoto() async {
    try {
      final picked = await _picker.pickImage(
        source: ImageSource.camera,
        maxWidth: 1920,
        maxHeight: 1920,
        imageQuality: 82,
        requestFullMetadata: false,
      );
      if (picked != null) await _acceptPhoto(picked);
    } catch (_) {
      _message('تعذّر فتح الكاميرا. تحقق من إذن الكاميرا وحاول مجددًا.');
    }
  }

  Future<void> _acceptPhoto(XFile file) async {
    try {
      final bytes = await file.readAsBytes();
      if (bytes.length > 5 * 1024 * 1024) {
        _message('الصورة أكبر من ٥ ميغابايت. أعد تصويرها بدقة أقل.');
        return;
      }
      final isJpeg =
          bytes.length >= 3 &&
          bytes[0] == 0xff &&
          bytes[1] == 0xd8 &&
          bytes[2] == 0xff;
      final isPng =
          bytes.length >= 8 &&
          bytes[0] == 0x89 &&
          bytes[1] == 0x50 &&
          bytes[2] == 0x4e &&
          bytes[3] == 0x47;
      if (!isJpeg && !isPng) {
        _message('تعذّر استخدام الصورة الملتقطة. أعد التصوير.');
        return;
      }
      if (mounted) {
        setState(() {
          _photo = bytes;
          _photoMimeType = isPng ? 'image/png' : 'image/jpeg';
          _photoTooDark = false;
        });
      }
      final serial = ++_photoCheckSerial;
      final tooDark = await isPhotoTooDark(bytes);
      if (mounted && serial == _photoCheckSerial && tooDark) {
        setState(() => _photoTooDark = true);
      }
    } catch (_) {
      _message('تعذّر قراءة الصورة. أعد التصوير.');
    }
  }

  Future<void> _useCurrentLocation() async {
    if (_locating) return;
    final requestId = ++_locationRequestId;
    setState(() {
      _isAtProblemLocation = true;
      _locating = true;
      _location = null;
      _locationConfirmed = false;
      _mapMovedByUser = false;
    });
    try {
      final serviceEnabled = await Geolocator.isLocationServiceEnabled();
      if (!mounted || requestId != _locationRequestId) return;
      if (!serviceEnabled) {
        _message('فعّل خدمة الموقع أو حدد الموضع يدويًا على الخريطة.');
        return;
      }
      var permission = await Geolocator.checkPermission();
      if (!mounted || requestId != _locationRequestId) return;
      if (permission == LocationPermission.denied) {
        permission = await Geolocator.requestPermission();
      }
      if (!mounted || requestId != _locationRequestId) return;
      if (permission == LocationPermission.denied ||
          permission == LocationPermission.deniedForever) {
        if (requestId == _locationRequestId) {
          _message('لم يُسمح بالموقع. حدد الموضع يدويًا على الخريطة.');
        }
        return;
      }
      final position = await Geolocator.getCurrentPosition(
        locationSettings: const LocationSettings(
          accuracy: LocationAccuracy.high,
          timeLimit: Duration(seconds: 15),
        ),
      );
      if (!mounted || requestId != _locationRequestId) return;
      final point = LatLng(position.latitude, position.longitude);
      setState(() {
        _location = point;
        _mapCenter = point;
        _locationConfirmed = false;
      });
      if (_mapReady) _mapController.move(point, 16);
      if (!_isInsideTripoliCenter(point)) {
        _message(
          'الموقع خارج نطاق بلاغي. حرّك الخريطة إلى داخل حدود طرابلس المركز.',
        );
      }
    } catch (_) {
      if (requestId == _locationRequestId) {
        _message('تعذّر تحديد موقعك. يمكنك تحديده يدويًا.');
      }
    } finally {
      if (mounted && requestId == _locationRequestId) {
        setState(() => _locating = false);
      }
    }
  }

  void _chooseManualLocation() {
    if (_isAtProblemLocation == false) return;
    _locationRequestId++;
    setState(() {
      _isAtProblemLocation = false;
      _locating = false;
      _location = null;
      _locationConfirmed = false;
      _mapMovedByUser = false;
    });
  }

  Future<void> _askLocationMethod() async {
    if (!mounted || _step != 2) return;
    final atProblemLocation = await showDialog<bool>(
      context: context,
      barrierDismissible: false,
      builder: (dialogContext) => PopScope(
        canPop: false,
        child: AlertDialog(
          backgroundColor: Colors.white,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(20),
          ),
          icon: const Icon(
            Icons.location_on_rounded,
            color: _photoGold,
            size: 36,
          ),
          title: const Text(
            'هل أنت الآن في موقع المشكلة؟',
            textAlign: TextAlign.center,
            style: TextStyle(fontWeight: FontWeight.w800, color: _photoTeal),
          ),
          content: const Text(
            'إذا كنت هناك، سنضع المؤشر قرب موقع هاتفك. وإلا يمكنك تحديد مكان المشكلة بنفسك على الخريطة. راجع المؤشر قبل التأكيد.',
            textAlign: TextAlign.center,
            style: TextStyle(color: _photoSlate, height: 1.6),
          ),
          actionsAlignment: MainAxisAlignment.spaceEvenly,
          actions: [
            OutlinedButton(
              onPressed: () => Navigator.of(dialogContext).pop(false),
              child: const BalaghiButtonLabel('لا، أحدده بنفسي'),
            ),
            FilledButton(
              onPressed: () => Navigator.of(dialogContext).pop(true),
              style: FilledButton.styleFrom(
                backgroundColor: civicGold,
                foregroundColor: civicText,
              ),
              child: const BalaghiButtonLabel('نعم، أنا في الموقع'),
            ),
          ],
        ),
      ),
    );
    if (!mounted || _step != 2) return;
    if (atProblemLocation == true) {
      await _useCurrentLocation();
    } else if (atProblemLocation == false) {
      _chooseManualLocation();
    }
  }

  Future<void> _confirmMapCenter() async {
    if (_location == null && !_mapMovedByUser) {
      _message(
        'استخدم موقعك الحالي أو حرّك الخريطة حتى يصبح المؤشر فوق المشكلة.',
      );
      return;
    }
    final selected = _mapReady ? _mapController.camera.center : _mapCenter;
    if (!_isInsideTripoliCenter(selected)) {
      _message('الموقع خارج نطاق بلاغي. اختر موقعًا داخل حدود طرابلس المركز.');
      return;
    }
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        backgroundColor: Colors.white,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
        icon: const Icon(Icons.location_on_rounded, color: civicTeal, size: 36),
        title: const Text(
          'هل أنت متأكد من الموقع؟',
          textAlign: TextAlign.center,
          style: TextStyle(fontWeight: FontWeight.w800, color: civicText),
        ),
        content: const Text(
          'تأكد من أن المؤشر فوق مكان المشكلة بدقة. ستراجع الجهة المختصة البلاغ والصورة والموقع للتحقق منها قبل اعتماد البلاغ.',
          textAlign: TextAlign.center,
          style: TextStyle(color: _muted, height: 1.6),
        ),
        actionsAlignment: MainAxisAlignment.spaceEvenly,
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(false),
            child: const BalaghiButtonLabel('تعديل الموقع'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(dialogContext).pop(true),
            style: FilledButton.styleFrom(
              backgroundColor: civicGold,
              foregroundColor: civicText,
            ),
            child: const BalaghiButtonLabel('تأكيد الموقع'),
          ),
        ],
      ),
    );
    if (!mounted || confirmed != true) return;
    setState(() {
      _location = selected;
      _mapCenter = selected;
      _locationConfirmed = true;
    });
  }

  void _zoomMap(double change) {
    if (!_mapReady) return;
    final camera = _mapController.camera;
    final zoom = (camera.zoom + change).clamp(5.0, 18.0).toDouble();
    _mapController.move(camera.center, zoom);
  }

  String _formattedMapCenter() {
    final lat = _mapCenter.latitude;
    final lon = _mapCenter.longitude;
    return '${lat.abs().toStringAsFixed(5)}° ${lat >= 0 ? 'N' : 'S'}, '
        '${lon.abs().toStringAsFixed(5)}° ${lon >= 0 ? 'E' : 'W'}';
  }

  void _message(String message) {
    if (!mounted) return;
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(
        SnackBar(content: Text(message), behavior: SnackBarBehavior.floating),
      );
  }

  void _promptForLocationOnEntry() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted && _step == 2) _askLocationMethod();
    });
  }

  /// The arrow in the top bar and the phone's back button do the same thing:
  /// one step back, and leaving only from the first step or the result screen.
  Future<void> _back() async {
    if (_sending) return;
    if (_step == 4) {
      Navigator.of(
        context,
      ).pop((_createdReport != null || _savedForLater) && !widget.previewMode);
    } else if (_step == 0) {
      // Leaving drops the photo and everything entered after it.
      if (_photo != null && !await _confirmDiscard()) return;
      if (mounted) Navigator.of(context).pop(false);
    } else {
      setState(() {
        if (_step == 2) _mapReady = false;
        _step--;
      });
      if (_step == 2) _promptForLocationOnEntry();
    }
  }

  Future<bool> _confirmDiscard() async {
    final discard = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        backgroundColor: Colors.white,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
        title: const Text(
          'تجاهل هذا البلاغ؟',
          textAlign: TextAlign.center,
          style: TextStyle(fontWeight: FontWeight.w800, color: _photoTeal),
        ),
        content: const Text(
          'ستُحذف الصورة والبيانات التي أدخلتها، ولن يُرسل البلاغ.',
          textAlign: TextAlign.center,
          style: TextStyle(color: _photoSlate, height: 1.6),
        ),
        actionsAlignment: MainAxisAlignment.spaceEvenly,
        actions: [
          OutlinedButton(
            onPressed: () => Navigator.of(dialogContext).pop(true),
            style: OutlinedButton.styleFrom(
              foregroundColor: const Color(0xFFC93636),
            ),
            child: const BalaghiButtonLabel('تجاهل البلاغ'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(dialogContext).pop(false),
            style: FilledButton.styleFrom(
              backgroundColor: civicGold,
              foregroundColor: civicText,
            ),
            child: const BalaghiButtonLabel('متابعة البلاغ'),
          ),
        ],
      ),
    );
    return discard == true;
  }

  void _next() {
    if (_step == 0 && _photo == null) {
      _message('التقط صورة للمشكلة للمتابعة.');
      return;
    }
    if (_step == 1 && _category == null) {
      _message('اختر نوع المشكلة للمتابعة.');
      return;
    }
    if (_step == 2 && !_isInsideTripoliCenter(_mapCenter)) {
      _message(
        'موقع البلاغ خارج النطاق. حرّك الخريطة إلى داخل حدود طرابلس المركز.',
      );
      return;
    }
    if (_step == 2 && !_locationConfirmed) {
      _message(
        _isAtProblemLocation == null
            ? 'اختر طريقة تحديد الموقع أولًا.'
            : 'حدد الموقع على الخريطة ثم اضغط «تأكيد الموقع».',
      );
      return;
    }
    if (_step == 3) {
      _submit();
      return;
    }
    setState(() {
      if (_step == 2) _mapReady = false;
      _step++;
    });
    if (_step == 2) _promptForLocationOnEntry();
  }

  Future<void> _submit() async {
    if (_photo == null ||
        _photoMimeType == null ||
        _category == null ||
        _location == null ||
        !_locationConfirmed ||
        !_isInsideTripoliCenter(_location!) ||
        _sending) {
      return;
    }
    if (widget.previewMode) {
      setState(() => _step = 4);
      return;
    }
    setState(() => _sending = true);
    CitizenSession? session;
    try {
      session = await _authApi.restore(_store);
      if (session == null || session.needsProfile) {
        throw const CreateReportFailure(
          'انتهت جلسة الدخول. ارجع وسجّل الدخول مجددًا.',
        );
      }
      final created = await _repository.submit(
        session: session,
        category: _category!,
        location: _location!,
        imageBytes: _photo!,
        imageMimeType: _photoMimeType!,
        clientRequestId: _clientRequestId,
        description: _description.text,
      );
      if (mounted) {
        setState(() {
          _createdReport = created;
          _step = 4;
        });
      }
    } on CreateReportFailure catch (error) {
      if (error.canRetryLater &&
          session != null &&
          await _saveForLater(session)) {
        return;
      }
      _message(error.message);
    } catch (_) {
      _message('تعذّر إرسال البلاغ. بياناتك ما زالت هنا؛ حاول مجددًا.');
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  /// Keeps the report on the device with the same request id, so «بلاغاتي»
  /// can send it once the connection returns without creating a duplicate.
  Future<bool> _saveForLater(CitizenSession session) async {
    try {
      await _pendingStore.save(
        PendingReport(
          clientRequestId: _clientRequestId,
          ownerPhone: session.phone,
          category: _category!,
          location: _location!,
          imageMimeType: _photoMimeType!,
          savedAt: DateTime.now(),
          description: _description.text.trim().isEmpty
              ? null
              : _description.text.trim(),
        ),
        _photo!,
      );
    } catch (_) {
      return false;
    }
    if (mounted) {
      setState(() {
        _savedForLater = true;
        _step = 4;
      });
    }
    return true;
  }

  @override
  Widget build(BuildContext context) {
    final completed = _step == 4;
    return PopScope<bool>(
      canPop: false,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) _back();
      },
      child: Scaffold(
        backgroundColor: civicBackground,
        body: Stack(
          children: [
            const Positioned.fill(child: _ReportFlowBackdrop()),
            SafeArea(
              child: Column(
                children: [
                  _topBar(),
                  Expanded(
                    child: SingleChildScrollView(
                      padding: const EdgeInsets.fromLTRB(22, 16, 22, 20),
                      child: completed
                          ? _success()
                          : Column(
                              crossAxisAlignment: CrossAxisAlignment.stretch,
                              children: [
                                _heading(),
                                SizedBox(height: _step >= 2 ? 15 : 28),
                                if (_step == 0) _photoStep(),
                                if (_step == 1) _detailsStep(),
                                if (_step == 2) _locationStep(),
                                if (_step == 3) _reviewStep(),
                              ],
                            ),
                    ),
                  ),
                  _footer(completed),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _topBar() => _reportStepTopBar();

  Widget _reportStepTopBar() => Padding(
    padding: const EdgeInsets.fromLTRB(24, 12, 24, 0),
    child: SizedBox(
      height: 52,
      child: Stack(
        alignment: Alignment.center,
        children: [
          Stack(
            clipBehavior: Clip.none,
            children: [
              const Text(
                'بلاغي',
                style: TextStyle(
                  color: _photoTeal,
                  fontSize: 23,
                  fontWeight: FontWeight.w800,
                ),
              ),
              const PositionedDirectional(
                end: -14,
                top: 11,
                child: _PhotoBrandPulse(),
              ),
            ],
          ),
          Align(
            alignment: AlignmentDirectional.centerStart,
            child: Material(
              color: Colors.white.withValues(alpha: 0.92),
              borderRadius: BorderRadius.circular(16),
              child: InkWell(
                onTap: _back,
                borderRadius: BorderRadius.circular(16),
                child: Container(
                  width: 44,
                  height: 44,
                  decoration: BoxDecoration(
                    borderRadius: BorderRadius.circular(16),
                    border: Border.all(color: const Color(0xFFDCE4E8)),
                  ),
                  child: const Icon(
                    Icons.chevron_right_rounded,
                    textDirection: TextDirection.ltr,
                    size: 25,
                    color: _photoTeal,
                  ),
                ),
              ),
            ),
          ),
        ],
      ),
    ),
  );

  Widget _heading() {
    if (_step == 0) return _photoHeading();
    if (_step == 1) return _detailsHeading();
    if (_step == 2) return _locationHeading();
    if (_step == 3) return _reviewHeading();
    const titles = [
      'صوّر المشكلة',
      'تفاصيل البلاغ',
      'حدد موقع المشكلة',
      'راجع بلاغك',
    ];
    const hints = [
      'التقط صورة واضحة للمشكلة التي تريد الإبلاغ عنها.',
      'اختر نوع المشكلة وأضف تفاصيل تساعد في فهمها.',
      'حدد مكان المشكلة بدقة على الخريطة.',
      'تأكد من المعلومات قبل إرسالها إلى البلدية.',
    ];
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(
          'الخطوة ${_step + 1} من 4',
          style: const TextStyle(
            color: civicTeal,
            fontWeight: FontWeight.w700,
            fontSize: 13,
          ),
        ),
        const SizedBox(height: 8),
        Text(
          titles[_step],
          style: const TextStyle(
            color: civicText,
            fontSize: 27,
            fontWeight: FontWeight.w800,
          ),
        ),
        const SizedBox(height: 5),
        Text(hints[_step], style: const TextStyle(color: _muted, fontSize: 14)),
        const SizedBox(height: 22),
        Row(
          children: List.generate(
            4,
            (index) => Expanded(
              child: Padding(
                padding: const EdgeInsetsDirectional.only(end: 5),
                child: Container(
                  height: 4,
                  decoration: BoxDecoration(
                    color: index <= _step ? civicTeal : _line,
                    borderRadius: BorderRadius.circular(4),
                  ),
                ),
              ),
            ),
          ),
        ),
      ],
    );
  }

  Widget _photoHeading() => Column(
    crossAxisAlignment: CrossAxisAlignment.stretch,
    children: [
      Row(
        children: [
          const Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              CircleAvatar(radius: 3, backgroundColor: _photoGold),
              SizedBox(width: 7),
              Text(
                'الخطوة الأولى',
                style: TextStyle(
                  color: _photoTeal,
                  fontWeight: FontWeight.w800,
                  fontSize: 12,
                ),
              ),
            ],
          ),
          const Spacer(),
          const Text(
            '١ من ٤',
            style: TextStyle(
              color: _photoSlate,
              fontWeight: FontWeight.w600,
              fontSize: 12,
            ),
          ),
        ],
      ),
      const SizedBox(height: 8),
      Row(
        children: List.generate(
          4,
          (index) => Expanded(
            child: Padding(
              padding: const EdgeInsetsDirectional.only(end: 6),
              child: SizedBox(
                height: 12,
                child: Stack(
                  alignment: Alignment.center,
                  children: [
                    Container(
                      height: 5,
                      decoration: BoxDecoration(
                        gradient: index == 0
                            ? const LinearGradient(
                                colors: [_photoTealLight, _photoTeal],
                              )
                            : null,
                        color: index == 0 ? null : const Color(0xFFE2E8F0),
                        borderRadius: BorderRadius.circular(8),
                      ),
                    ),
                    if (index == 0)
                      Align(
                        alignment: AlignmentDirectional.centerEnd,
                        child: Container(
                          width: 9,
                          height: 9,
                          decoration: const BoxDecoration(
                            color: _photoGold,
                            shape: BoxShape.circle,
                            boxShadow: [
                              BoxShadow(
                                color: Color(0x66E5A93C),
                                blurRadius: 8,
                              ),
                            ],
                          ),
                        ),
                      ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
      const SizedBox(height: 28),
      Align(
        alignment: Alignment.centerRight,
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
          decoration: BoxDecoration(
            color: _photoTeal.withValues(alpha: 0.05),
            borderRadius: BorderRadius.circular(30),
            border: Border.all(color: _photoTeal.withValues(alpha: 0.10)),
          ),
          child: const Text(
            'توثيق البلاغ',
            style: TextStyle(
              color: _photoTeal,
              fontSize: 11,
              fontWeight: FontWeight.w700,
            ),
          ),
        ),
      ),
      const SizedBox(height: 7),
      const Text(
        'صوّر المشكلة',
        style: TextStyle(
          color: _photoTeal,
          fontSize: 26,
          fontWeight: FontWeight.w800,
        ),
      ),
      const SizedBox(height: 5),
      const Text(
        'التقط صورة واضحة تساعد فريق المعالجة على التحقق وحل المشكلة بسرعة',
        style: TextStyle(color: _photoSlate, fontSize: 12, height: 1.6),
      ),
    ],
  );

  Widget _photoStep() => Column(
    crossAxisAlignment: CrossAxisAlignment.stretch,
    children: [
      _photoViewfinder(),
      const SizedBox(height: 20),
      _photoActionCard(
        icon: Icons.photo_camera_outlined,
        label: _photo == null ? 'التقاط صورة' : 'إعادة التصوير',
        onTap: _capturePhoto,
      ),
      const SizedBox(height: 18),
      if (_photoTooDark)
        _darkPhotoWarning()
      else
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
          decoration: BoxDecoration(
            color: Colors.white.withValues(alpha: 0.68),
            borderRadius: BorderRadius.circular(13),
            border: Border.all(color: Colors.white),
          ),
          child: const Row(
            children: [
              Icon(
                Icons.tips_and_updates_outlined,
                size: 18,
                color: _photoTeal,
              ),
              SizedBox(width: 9),
              Expanded(
                child: Text(
                  'التقط صورة مباشرة بالكاميرا وتأكد من ظهور المشكلة كاملة.',
                  style: TextStyle(color: _muted, fontSize: 12),
                ),
              ),
            ],
          ),
        ),
    ],
  );

  /// Shown under a photo taken in near darkness. It only advises: the citizen
  /// can retake it with the button above or keep it and carry on.
  Widget _darkPhotoWarning() => Semantics(
    liveRegion: true,
    child: Container(
      padding: const EdgeInsetsDirectional.fromSTEB(13, 8, 6, 12),
      decoration: BoxDecoration(
        color: const Color(0xFFFFF8E8),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: const Color(0xFFF0D59C)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            width: 34,
            height: 34,
            margin: const EdgeInsets.only(top: 4),
            decoration: BoxDecoration(
              color: const Color(0xFFFDEFCF),
              borderRadius: BorderRadius.circular(10),
            ),
            child: const Icon(
              Icons.nights_stay_outlined,
              size: 19,
              color: Color(0xFF9A6700),
            ),
          ),
          const SizedBox(width: 11),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    const Expanded(
                      child: Text(
                        'الصورة مظلمة',
                        style: TextStyle(
                          color: Color(0xFF7A5408),
                          fontSize: 14,
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                    ),
                    TextButton(
                      onPressed: () => setState(() => _photoTooDark = false),
                      style: TextButton.styleFrom(
                        foregroundColor: _photoTeal,
                        minimumSize: const Size(48, 40),
                        padding: const EdgeInsets.symmetric(horizontal: 10),
                      ),
                      child: const BalaghiButtonLabel(
                        'استخدامها كما هي',
                        style: TextStyle(
                          fontSize: 12.5,
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                    ),
                  ],
                ),
                const Padding(
                  padding: EdgeInsetsDirectional.only(end: 8),
                  child: Text(
                    'قد لا تظهر المشكلة فيها بوضوح. أعد التصوير في إضاءة أفضل أو شغّل الفلاش.',
                    style: TextStyle(
                      color: Color(0xFF5E4B23),
                      fontSize: 12,
                      height: 1.55,
                    ),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    ),
  );

  Widget _photoViewfinder() => Container(
    height: 274,
    decoration: BoxDecoration(
      borderRadius: BorderRadius.circular(28),
      boxShadow: const [
        BoxShadow(
          color: Color(0x1612323F),
          blurRadius: 40,
          offset: Offset(0, 15),
        ),
      ],
    ),
    child: ClipRRect(
      borderRadius: BorderRadius.circular(28),
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          onTap: _capturePhoto,
          child: Stack(
            fit: StackFit.expand,
            children: [
              if (_photo == null)
                Container(
                  decoration: const BoxDecoration(
                    gradient: LinearGradient(
                      begin: Alignment.topRight,
                      end: Alignment.bottomLeft,
                      colors: [Color(0xF5FFFFFF), Color(0xF7FFFCF6)],
                    ),
                  ),
                )
              else
                Image.memory(_photo!, fit: BoxFit.cover),
              if (_photo != null)
                const DecoratedBox(
                  decoration: BoxDecoration(
                    gradient: LinearGradient(
                      begin: Alignment.topCenter,
                      end: Alignment.bottomCenter,
                      colors: [Colors.transparent, Color(0x990B3640)],
                    ),
                  ),
                ),
              const IgnorePointer(
                child: DecoratedBox(
                  decoration: BoxDecoration(
                    border: Border.fromBorderSide(
                      BorderSide(color: Color(0xFFE8E4DA)),
                    ),
                    borderRadius: BorderRadius.all(Radius.circular(28)),
                  ),
                ),
              ),
              IgnorePointer(
                child: CustomPaint(
                  painter: _ViewfinderPainter(onImage: _photo != null),
                ),
              ),
              if (_photo == null)
                Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    const _PhotoCameraBadge(),
                    const SizedBox(height: 16),
                    const BalaghiButtonLabel(
                      'التقط صورة للمشكلة',
                      style: TextStyle(
                        color: _photoTeal,
                        fontSize: 16,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                    const SizedBox(height: 4),
                    const SizedBox(
                      width: 230,
                      child: Text(
                        'صورة واضحة من زاوية مناسبة تساعد في التحقق المباشر',
                        textAlign: TextAlign.center,
                        style: TextStyle(
                          color: _photoSlate,
                          fontSize: 12,
                          height: 1.5,
                        ),
                      ),
                    ),
                    const SizedBox(height: 10),
                    Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 17,
                        vertical: 10,
                      ),
                      decoration: BoxDecoration(
                        color: Colors.white.withValues(alpha: 0.9),
                        borderRadius: BorderRadius.circular(30),
                        border: Border.all(color: const Color(0xFFE5EAEC)),
                      ),
                      child: const Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Icon(
                            Icons.touch_app_outlined,
                            size: 17,
                            color: _photoTeal,
                          ),
                          SizedBox(width: 6),
                          BalaghiButtonLabel(
                            'اضغط لالتقاط صورة',
                            style: TextStyle(
                              color: _photoTeal,
                              fontWeight: FontWeight.w700,
                              fontSize: 12,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                )
              else
                PositionedDirectional(
                  bottom: 17,
                  start: 17,
                  child: Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 13,
                      vertical: 8,
                    ),
                    decoration: BoxDecoration(
                      color: Colors.white.withValues(alpha: 0.93),
                      borderRadius: BorderRadius.circular(20),
                    ),
                    child: const Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Icon(
                          Icons.check_circle_rounded,
                          color: _photoTeal,
                          size: 18,
                        ),
                        SizedBox(width: 6),
                        Text(
                          'تم اختيار الصورة',
                          style: TextStyle(
                            color: _photoTeal,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
            ],
          ),
        ),
      ),
    ),
  );

  Widget _photoActionCard({
    required IconData icon,
    required String label,
    required VoidCallback onTap,
  }) => Material(
    color: Colors.transparent,
    child: InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(17),
      child: Ink(
        height: 68,
        decoration: BoxDecoration(
          color: Colors.white.withValues(alpha: 0.9),
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: const Color(0xFFE2E8F0)),
          boxShadow: const [
            BoxShadow(
              color: Color(0x0F12323F),
              blurRadius: 12,
              offset: Offset(0, 4),
            ),
          ],
        ),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Container(
              width: 36,
              height: 36,
              decoration: BoxDecoration(
                color: _photoTeal.withValues(alpha: 0.05),
                borderRadius: BorderRadius.circular(11),
              ),
              child: Icon(icon, color: _photoTeal, size: 21),
            ),
            const SizedBox(width: 9),
            BalaghiButtonLabel(
              label,
              style: const TextStyle(
                color: _photoTeal,
                fontWeight: FontWeight.w700,
                fontSize: 12,
              ),
            ),
          ],
        ),
      ),
    ),
  );

  Widget _detailsHeading() => Column(
    crossAxisAlignment: CrossAxisAlignment.stretch,
    children: [
      const Row(
        children: [
          CircleAvatar(radius: 3, backgroundColor: _photoGold),
          SizedBox(width: 7),
          Text(
            'الخطوة الثانية',
            style: TextStyle(
              color: _photoTeal,
              fontWeight: FontWeight.w800,
              fontSize: 12,
            ),
          ),
        ],
      ),
      const SizedBox(height: 10),
      Row(
        children: List.generate(
          4,
          (index) => Expanded(
            child: Padding(
              padding: const EdgeInsetsDirectional.only(end: 7),
              child: SizedBox(
                height: 11,
                child: Stack(
                  alignment: Alignment.center,
                  children: [
                    Container(
                      height: 6,
                      decoration: BoxDecoration(
                        color: index < 2 ? _photoTeal : const Color(0xFFE2E8F0),
                        borderRadius: BorderRadius.circular(8),
                      ),
                    ),
                    if (index == 1)
                      Align(
                        alignment: AlignmentDirectional.centerEnd,
                        child: Container(
                          width: 10,
                          height: 10,
                          decoration: const BoxDecoration(
                            color: _photoGold,
                            shape: BoxShape.circle,
                            boxShadow: [
                              BoxShadow(
                                color: Color(0x66E5A93C),
                                blurRadius: 8,
                              ),
                            ],
                          ),
                        ),
                      ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
      const SizedBox(height: 29),
      Align(
        alignment: AlignmentDirectional.centerStart,
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 13, vertical: 5),
          decoration: BoxDecoration(
            color: const Color(0xFFE9EDF0),
            borderRadius: BorderRadius.circular(30),
          ),
          child: const Text(
            'بيانات البلاغ',
            style: TextStyle(
              color: _photoSlate,
              fontSize: 11,
              fontWeight: FontWeight.w700,
            ),
          ),
        ),
      ),
      const SizedBox(height: 8),
      const Text(
        'تفاصيل البلاغ',
        style: TextStyle(
          color: _photoTeal,
          fontSize: 27,
          fontWeight: FontWeight.w800,
        ),
      ),
    ],
  );

  Widget _detailsStep() => Column(
    crossAxisAlignment: CrossAxisAlignment.stretch,
    children: [
      Row(
        children: [
          const Text(
            'ما نوع المشكلة؟',
            style: TextStyle(
              fontWeight: FontWeight.w800,
              color: _photoTeal,
              fontSize: 16,
            ),
          ),
          const Spacer(),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
            decoration: BoxDecoration(
              color: const Color(0xFFFFF8E9),
              borderRadius: BorderRadius.circular(8),
              border: Border.all(color: const Color(0x55E5A93C)),
            ),
            child: const Text(
              'إجباري',
              style: TextStyle(
                color: _photoGold,
                fontSize: 11,
                fontWeight: FontWeight.w700,
              ),
            ),
          ),
        ],
      ),
      const SizedBox(height: 13),
      for (final category in ReportCategory.values) ...[
        _categoryCard(category),
        const SizedBox(height: 11),
      ],
      const SizedBox(height: 14),
      Row(
        children: [
          const Text(
            'وصف المشكلة',
            style: TextStyle(
              fontWeight: FontWeight.w800,
              color: _photoTeal,
              fontSize: 16,
            ),
          ),
          const SizedBox(width: 5),
          const Text(
            '(اختياري)',
            style: TextStyle(color: _photoSlate, fontSize: 12),
          ),
          const Spacer(),
          ValueListenableBuilder<TextEditingValue>(
            valueListenable: _description,
            builder: (context, value, child) => Text(
              '${value.text.length}/2000',
              style: const TextStyle(color: _photoSlate, fontSize: 11),
            ),
          ),
        ],
      ),
      const SizedBox(height: 10),
      Focus(
        child: Builder(
          builder: (context) {
            final focused = Focus.of(context).hasFocus;
            return Container(
              padding: const EdgeInsets.fromLTRB(16, 14, 16, 13),
              decoration: BoxDecoration(
                color: Colors.white,
                borderRadius: BorderRadius.circular(24),
                border: Border.all(
                  color: focused ? _photoGold : const Color(0xFFDEE5E9),
                  width: focused ? 1.5 : 1,
                ),
                boxShadow: const [
                  BoxShadow(
                    color: Color(0x0D12232E),
                    blurRadius: 20,
                    offset: Offset(0, 6),
                  ),
                ],
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  TextField(
                    controller: _description,
                    minLines: 4,
                    maxLines: 6,
                    maxLength: 2000,
                    style: const TextStyle(color: _photoTeal, fontSize: 14),
                    decoration: const InputDecoration(
                      hintText: '',
                      hintStyle: TextStyle(
                        color: Color(0xFFAFBAC2),
                        fontSize: 13,
                      ),
                      border: InputBorder.none,
                      isCollapsed: true,
                      counterText: '',
                    ),
                  ),
                  const SizedBox(height: 9),
                  const Divider(color: Color(0xFFF0F2F4), height: 1),
                  const SizedBox(height: 9),
                  const Row(
                    children: [
                      Icon(
                        Icons.info_outline_rounded,
                        color: _photoGold,
                        size: 15,
                      ),
                      SizedBox(width: 5),
                      Expanded(
                        child: Text(
                          'كلما كان الوصف دقيقًا، ساعد ذلك في سرعة المعالجة',
                          style: TextStyle(color: _photoSlate, fontSize: 11),
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            );
          },
        ),
      ),
    ],
  );

  Widget _categoryCard(ReportCategory category) {
    final selected = _category == category;
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: () => setState(() => _category = category),
        borderRadius: BorderRadius.circular(22),
        child: Ink(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 13),
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(22),
            border: Border.all(
              color: selected ? _photoGold : const Color(0xFFE8EDF0),
              width: selected ? 2 : 1,
            ),
            boxShadow: [
              BoxShadow(
                color: selected
                    ? const Color(0x33E5A93C)
                    : const Color(0x0D12232E),
                blurRadius: selected ? 24 : 17,
                offset: const Offset(0, 6),
              ),
            ],
          ),
          child: Row(
            children: [
              Container(
                width: 49,
                height: 49,
                decoration: BoxDecoration(
                  color: const Color(0xFFFFF8E9),
                  borderRadius: BorderRadius.circular(16),
                  border: Border.all(color: const Color(0x55E5A93C)),
                ),
                child: Icon(
                  categoryIcon(category),
                  color: _photoGold,
                  size: 25,
                ),
              ),
              const SizedBox(width: 13),
              Expanded(
                child: Align(
                  alignment: AlignmentDirectional.centerStart,
                  child: BalaghiButtonLabel(
                    category.label,
                    textAlign: TextAlign.start,
                    style: const TextStyle(
                      color: _photoTeal,
                      fontWeight: FontWeight.w800,
                      fontSize: 15,
                    ),
                  ),
                ),
              ),
              const SizedBox(width: 8),
              Container(
                width: 23,
                height: 23,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color: Colors.white,
                  border: Border.all(
                    color: selected ? _photoGold : const Color(0xFFCED7DD),
                    width: 2,
                  ),
                ),
                child: selected
                    ? Center(
                        child: Container(
                          width: 11,
                          height: 11,
                          decoration: const BoxDecoration(
                            color: _photoGold,
                            shape: BoxShape.circle,
                          ),
                        ),
                      )
                    : null,
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _locationHeading() => Column(
    crossAxisAlignment: CrossAxisAlignment.stretch,
    children: [
      const Text(
        'الخطوة الثالثة',
        style: TextStyle(
          color: _photoTeal,
          fontWeight: FontWeight.w800,
          fontSize: 12,
        ),
      ),
      const SizedBox(height: 9),
      Row(
        children: List.generate(
          4,
          (index) => Expanded(
            child: Padding(
              padding: const EdgeInsetsDirectional.only(end: 6),
              child: SizedBox(
                height: 11,
                child: Stack(
                  alignment: Alignment.center,
                  children: [
                    Container(
                      height: 6,
                      decoration: BoxDecoration(
                        color: index < 3 ? _photoTeal : const Color(0xFFE2E8F0),
                        borderRadius: BorderRadius.circular(8),
                      ),
                    ),
                    if (index == 2)
                      Align(
                        alignment: AlignmentDirectional.centerEnd,
                        child: Container(
                          width: 10,
                          height: 10,
                          decoration: const BoxDecoration(
                            color: _photoGold,
                            shape: BoxShape.circle,
                            boxShadow: [
                              BoxShadow(
                                color: Color(0x66E5A93C),
                                blurRadius: 8,
                              ),
                            ],
                          ),
                        ),
                      ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
      const SizedBox(height: 25),
      const Text(
        'حدد موقع المشكلة',
        style: TextStyle(
          color: _photoTeal,
          fontSize: 25,
          fontWeight: FontWeight.w800,
        ),
      ),
      const SizedBox(height: 3),
      const Text(
        'اختر طريقة تحديد الموقع، ثم راجع موضع المؤشر على الخريطة.',
        style: TextStyle(color: _photoSlate, fontSize: 12, height: 1.5),
      ),
    ],
  );

  Widget _locationStep() => Column(
    crossAxisAlignment: CrossAxisAlignment.stretch,
    children: [
      Container(
        height: 270,
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(28),
          border: Border.all(color: const Color(0x22142834)),
          boxShadow: const [
            BoxShadow(
              color: Color(0x15142834),
              blurRadius: 20,
              offset: Offset(0, 6),
            ),
          ],
        ),
        child: ClipRRect(
          borderRadius: BorderRadius.circular(27),
          child: Stack(
            fit: StackFit.expand,
            children: [
              FlutterMap(
                mapController: _mapController,
                options: MapOptions(
                  initialCenter: _location ?? _tripoli,
                  initialZoom: _location == null ? 13 : 16,
                  minZoom: 5,
                  maxZoom: 18,
                  onMapReady: () => _mapReady = true,
                  onPositionChanged: (camera, hasGesture) {
                    if (!hasGesture) return;
                    _locationRequestId++;
                    setState(() {
                      _mapCenter = camera.center;
                      _location = null;
                      _locationConfirmed = false;
                      _locating = false;
                      _mapMovedByUser = true;
                      _isAtProblemLocation ??= false;
                    });
                  },
                ),
                children: [
                  const MapLibreLayer(
                    initStyle: 'https://tiles.openfreemap.org/styles/bright',
                  ),
                  PolygonLayer(
                    polygons: [
                      Polygon(
                        points: _tripoliCenterBoundary,
                        color: const Color(0x16E5A93C),
                        borderColor: civicGold,
                        borderStrokeWidth: 3,
                      ),
                    ],
                  ),
                ],
              ),
              const IgnorePointer(
                child: CustomPaint(painter: _MapCornersPainter()),
              ),
              Positioned(
                top: 12,
                left: 27,
                right: 27,
                child: IgnorePointer(
                  child: Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 11,
                      vertical: 7,
                    ),
                    decoration: BoxDecoration(
                      color: Colors.white.withValues(alpha: 0.93),
                      borderRadius: BorderRadius.circular(24),
                      border: Border.all(color: const Color(0x14000000)),
                      boxShadow: const [
                        BoxShadow(color: Color(0x24142834), blurRadius: 10),
                      ],
                    ),
                    child: Row(
                      children: [
                        Container(
                          width: 8,
                          height: 8,
                          decoration: BoxDecoration(
                            color: !_isInsideTripoliCenter(_mapCenter)
                                ? const Color(0xFFD84A3A)
                                : _locationConfirmed
                                ? const Color(0xFF47A46F)
                                : _photoGold,
                            shape: BoxShape.circle,
                          ),
                        ),
                        const SizedBox(width: 7),
                        Expanded(
                          child: Text(
                            !_isInsideTripoliCenter(_mapCenter)
                                ? 'الموقع خارج نطاق بلاغي'
                                : _locationConfirmed
                                ? 'تم تأكيد موقع البلاغ'
                                : _locating
                                ? 'جارٍ تحديد موقعك...'
                                : _isAtProblemLocation == null
                                ? 'اختر طريقة تحديد الموقع'
                                : 'اسحب الخريطة لتعديل موقع المشكلة',
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(
                              color: _photoTeal,
                              fontSize: 11,
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
              const Center(child: IgnorePointer(child: _MapCenterPin())),
              PositionedDirectional(
                bottom: 12,
                start: 12,
                child: Column(
                  children: [
                    _mapControl(
                      icon: Icons.add_rounded,
                      tooltip: 'تكبير الخريطة',
                      onTap: () => _zoomMap(1),
                    ),
                    const SizedBox(height: 6),
                    _mapControl(
                      icon: Icons.remove_rounded,
                      tooltip: 'تصغير الخريطة',
                      onTap: () => _zoomMap(-1),
                    ),
                  ],
                ),
              ),
              PositionedDirectional(
                bottom: 12,
                end: 12,
                child: Material(
                  color: Colors.white.withValues(alpha: 0.96),
                  borderRadius: BorderRadius.circular(12),
                  elevation: 3,
                  child: InkWell(
                    onTap: _locating ? null : _useCurrentLocation,
                    borderRadius: BorderRadius.circular(12),
                    child: Padding(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 10,
                        vertical: 9,
                      ),
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          _locating
                              ? const SizedBox(
                                  width: 18,
                                  height: 18,
                                  child: CircularProgressIndicator(
                                    strokeWidth: 2,
                                    color: _photoGold,
                                  ),
                                )
                              : const Icon(
                                  Icons.my_location_rounded,
                                  color: _photoGold,
                                  size: 18,
                                ),
                          const SizedBox(width: 6),
                          const BalaghiButtonLabel(
                            'موقعي',
                            style: TextStyle(
                              color: _photoTeal,
                              fontSize: 11,
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
      const SizedBox(height: 14),
      Container(
        padding: const EdgeInsets.all(15),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(24),
          border: Border.all(color: const Color(0x22142834)),
          boxShadow: const [
            BoxShadow(
              color: Color(0x0D142834),
              blurRadius: 18,
              offset: Offset(0, 5),
            ),
          ],
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                Icon(
                  _locationConfirmed
                      ? Icons.check_circle_outline_rounded
                      : Icons.info_outline_rounded,
                  color: _locationConfirmed ? _photoGold : _photoTeal,
                  size: 20,
                ),
                const SizedBox(width: 7),
                Expanded(
                  child: Text(
                    !_isInsideTripoliCenter(_mapCenter)
                        ? 'حرّك المؤشر إلى داخل نطاق طرابلس المركز لإكمال البلاغ.'
                        : _locationConfirmed
                        ? 'تم تأكيد موضع المشكلة على الخريطة.'
                        : _isAtProblemLocation == null
                        ? 'اختر طريقة تحديد الموقع للمتابعة.'
                        : 'تأكد أن المؤشر فوق المشكلة مباشرة، وعدّله عند الحاجة.',
                    style: const TextStyle(
                      color: _photoTeal,
                      fontSize: 12,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ),
              ],
            ),
            Align(
              alignment: AlignmentDirectional.centerStart,
              child: TextButton.icon(
                onPressed: _askLocationMethod,
                icon: const Icon(Icons.swap_horiz_rounded, size: 16),
                label: const BalaghiButtonLabel('تغيير طريقة تحديد الموقع'),
                style: TextButton.styleFrom(
                  foregroundColor: _photoTeal,
                  padding: const EdgeInsets.symmetric(horizontal: 4),
                ),
              ),
            ),
            const SizedBox(height: 11),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 11, vertical: 9),
              decoration: BoxDecoration(
                color: const Color(0xFFFAF9F6),
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: const Color(0x12000000)),
              ),
              child: Row(
                children: [
                  const Text(
                    'الإحداثيات:',
                    style: TextStyle(color: _photoSlate, fontSize: 11),
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      _formattedMapCenter(),
                      textDirection: TextDirection.ltr,
                      textAlign: TextAlign.end,
                      style: const TextStyle(
                        color: _photoTeal,
                        fontSize: 11,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 12),
            OutlinedButton.icon(
              onPressed: _confirmMapCenter,
              icon: Icon(
                _locationConfirmed
                    ? Icons.verified_rounded
                    : Icons.check_rounded,
                color: _photoGold,
                size: 19,
              ),
              label: BalaghiButtonLabel(
                _locationConfirmed
                    ? 'تعديل تأكيد الموقع'
                    : 'تأكيد موضع المشكلة على الخريطة',
                textAlign: TextAlign.center,
              ),
              style: OutlinedButton.styleFrom(
                foregroundColor: _photoTeal,
                backgroundColor: Colors.white,
                side: const BorderSide(color: Color(0x44142834)),
                padding: const EdgeInsets.symmetric(vertical: 11),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(16),
                ),
                textStyle: const TextStyle(
                  fontSize: 12,
                  fontWeight: FontWeight.w800,
                ),
              ),
            ),
            const SizedBox(height: 8),
            const Text(
              'تأكد من موضع المؤشر؛ اسم الشارع قد يختلف عن الموقع الفعلي.',
              textAlign: TextAlign.center,
              style: TextStyle(color: _photoSlate, fontSize: 10),
            ),
          ],
        ),
      ),
    ],
  );

  Widget _mapControl({
    required IconData icon,
    required String tooltip,
    required VoidCallback onTap,
  }) => Material(
    color: Colors.white.withValues(alpha: 0.96),
    borderRadius: BorderRadius.circular(12),
    elevation: 3,
    child: IconButton(
      tooltip: tooltip,
      onPressed: onTap,
      icon: Icon(icon, color: _photoTeal, size: 20),
      constraints: const BoxConstraints.tightFor(width: 38, height: 38),
      padding: EdgeInsets.zero,
    ),
  );

  Widget _reviewHeading() => Column(
    crossAxisAlignment: CrossAxisAlignment.stretch,
    children: [
      Row(
        children: [
          const CircleAvatar(radius: 3, backgroundColor: _photoGold),
          const SizedBox(width: 7),
          const Text(
            'الخطوة الرابعة',
            style: TextStyle(
              color: _photoTeal,
              fontSize: 12,
              fontWeight: FontWeight.w800,
            ),
          ),
          const Spacer(),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 3),
            decoration: BoxDecoration(
              color: const Color(0xFFEAEFF1),
              borderRadius: BorderRadius.circular(20),
            ),
            child: const Text(
              'اكتمال البيانات',
              style: TextStyle(
                color: _photoSlate,
                fontSize: 11,
                fontWeight: FontWeight.w700,
              ),
            ),
          ),
        ],
      ),
      const SizedBox(height: 10),
      Row(
        children: List.generate(
          4,
          (index) => Expanded(
            child: Padding(
              padding: const EdgeInsetsDirectional.only(end: 7),
              child: Container(
                height: 6,
                decoration: BoxDecoration(
                  color: index == 3 ? _photoGold : _photoTeal,
                  borderRadius: BorderRadius.circular(8),
                ),
              ),
            ),
          ),
        ),
      ),
      const SizedBox(height: 24),
      const Text(
        'راجع بلاغك',
        style: TextStyle(
          color: _photoTeal,
          fontSize: 26,
          fontWeight: FontWeight.w800,
        ),
      ),
    ],
  );

  Widget _reviewStep() => Column(
    crossAxisAlignment: CrossAxisAlignment.stretch,
    children: [
      _reviewCard(
        title: 'صورة المشكلة',
        icon: Icons.image_outlined,
        editStep: 0,
        child: ClipRRect(
          borderRadius: BorderRadius.circular(16),
          child: AspectRatio(
            aspectRatio: 16 / 9,
            child: _photo == null
                ? const ColoredBox(color: Color(0xFFF0F3F4))
                : Image.memory(_photo!, fit: BoxFit.cover),
          ),
        ),
      ),
      const SizedBox(height: 14),
      _reviewCard(
        title: 'تفاصيل المشكلة',
        icon: Icons.assignment_outlined,
        editStep: 1,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: const Color(0xFFF8FAFA),
                borderRadius: BorderRadius.circular(16),
                border: Border.all(color: const Color(0xFFE9EEF0)),
              ),
              child: Row(
                children: [
                  Container(
                    width: 40,
                    height: 40,
                    decoration: BoxDecoration(
                      color: _photoGold.withValues(alpha: 0.12),
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: Icon(
                      categoryIcon(_category ?? ReportCategory.pothole),
                      color: _photoGold,
                      size: 22,
                    ),
                  ),
                  const SizedBox(width: 11),
                  Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text(
                        'التصنيف المحدد',
                        style: TextStyle(color: _photoSlate, fontSize: 11),
                      ),
                      Text(
                        _category?.label ?? '',
                        style: const TextStyle(
                          color: _photoTeal,
                          fontSize: 15,
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ),
            if (_description.text.trim().isNotEmpty) ...[
              const SizedBox(height: 11),
              const Text(
                'الوصف',
                style: TextStyle(
                  color: _photoSlate,
                  fontSize: 11,
                  fontWeight: FontWeight.w700,
                ),
              ),
              const SizedBox(height: 4),
              Text(
                _description.text.trim(),
                style: const TextStyle(
                  color: _photoTeal,
                  fontSize: 13,
                  height: 1.5,
                ),
              ),
            ],
          ],
        ),
      ),
      const SizedBox(height: 14),
      _reviewCard(
        title: 'موقع المشكلة',
        icon: Icons.location_on_outlined,
        editStep: 2,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            ClipRRect(
              borderRadius: BorderRadius.circular(16),
              child: SizedBox(
                height: 145,
                child: Stack(
                  fit: StackFit.expand,
                  children: [
                    IgnorePointer(
                      child: FlutterMap(
                        options: MapOptions(
                          initialCenter: _location ?? _tripoli,
                          initialZoom: 16,
                          minZoom: 5,
                          maxZoom: 18,
                        ),
                        children: const [
                          MapLibreLayer(
                            initStyle:
                                'https://tiles.openfreemap.org/styles/bright',
                          ),
                        ],
                      ),
                    ),
                    const Center(child: IgnorePointer(child: _MapCenterPin())),
                    PositionedDirectional(
                      top: 9,
                      start: 9,
                      child: Container(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 9,
                          vertical: 5,
                        ),
                        decoration: BoxDecoration(
                          color: Colors.white.withValues(alpha: 0.93),
                          borderRadius: BorderRadius.circular(20),
                        ),
                        child: const Text(
                          'الموقع المؤكد',
                          style: TextStyle(
                            color: _photoTeal,
                            fontSize: 10,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 10),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
              decoration: BoxDecoration(
                color: const Color(0xFFF8FAFA),
                borderRadius: BorderRadius.circular(15),
                border: Border.all(color: const Color(0xFFE9EEF0)),
              ),
              child: Row(
                children: [
                  const Icon(Icons.place_outlined, color: _photoGold, size: 20),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      _location == null
                          ? ''
                          : '${_location!.latitude.toStringAsFixed(5)}, '
                                '${_location!.longitude.toStringAsFixed(5)}',
                      textDirection: TextDirection.ltr,
                      textAlign: TextAlign.end,
                      style: const TextStyle(
                        color: _photoTeal,
                        fontSize: 12,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
      const SizedBox(height: 14),
      Container(
        padding: const EdgeInsets.all(13),
        decoration: BoxDecoration(
          color: const Color(0xFFFFF8E9),
          borderRadius: BorderRadius.circular(14),
          border: Border.all(color: const Color(0x44E5A93C)),
        ),
        child: const Row(
          children: [
            Icon(Icons.info_outline_rounded, color: _photoGold, size: 18),
            SizedBox(width: 8),
            Expanded(
              child: Text(
                'تأكد من صحة الصورة والتصنيف والموقع قبل الضغط على «تأكيد».',
                style: TextStyle(color: _photoTeal, fontSize: 12),
              ),
            ),
          ],
        ),
      ),
    ],
  );

  Widget _reviewCard({
    required String title,
    required IconData icon,
    required int editStep,
    required Widget child,
  }) => Container(
    padding: const EdgeInsets.all(15),
    decoration: BoxDecoration(
      color: Colors.white,
      borderRadius: BorderRadius.circular(24),
      border: Border.all(color: const Color(0xFFE9EEF0)),
      boxShadow: const [
        BoxShadow(
          color: Color(0x0F12323F),
          blurRadius: 24,
          offset: Offset(0, 7),
        ),
      ],
    ),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          children: [
            Container(
              width: 30,
              height: 30,
              decoration: BoxDecoration(
                color: const Color(0xFFFFF8E9),
                borderRadius: BorderRadius.circular(9),
              ),
              child: Icon(icon, color: _photoGold, size: 18),
            ),
            const SizedBox(width: 8),
            Expanded(
              child: Text(
                title,
                style: const TextStyle(
                  color: _photoTeal,
                  fontWeight: FontWeight.w800,
                  fontSize: 15,
                ),
              ),
            ),
            TextButton(
              onPressed: () {
                setState(() => _step = editStep);
                if (editStep == 2) _promptForLocationOnEntry();
              },
              style: TextButton.styleFrom(
                foregroundColor: _photoTeal,
                backgroundColor: const Color(0xFFF1F4F5),
                padding: const EdgeInsets.symmetric(
                  horizontal: 12,
                  vertical: 5,
                ),
                minimumSize: Size.zero,
                shape: const StadiumBorder(),
                textStyle: const TextStyle(
                  fontSize: 12,
                  fontWeight: FontWeight.w800,
                ),
              ),
              child: const BalaghiButtonLabel('تعديل'),
            ),
          ],
        ),
        const SizedBox(height: 10),
        const Divider(color: Color(0xFFF0F3F4), height: 1),
        const SizedBox(height: 12),
        child,
      ],
    ),
  );

  Widget _success() => Padding(
    padding: const EdgeInsets.fromLTRB(4, 86, 4, 24),
    child: Column(
      children: [
        const _SuccessAnimation(),
        const SizedBox(height: 25),
        Text(
          widget.previewMode
              ? 'تم تأكيد البلاغ بنجاح'
              : _savedForLater
              ? 'حُفظ البلاغ على جهازك'
              : 'تم إرسال البلاغ بنجاح',
          textAlign: TextAlign.center,
          style: const TextStyle(
            color: _photoTeal,
            fontWeight: FontWeight.w800,
            fontSize: 26,
          ),
        ),
        const SizedBox(height: 9),
        Text(
          widget.previewMode
              ? 'هذه معاينة لواجهة النجاح؛ لم يُرسل البلاغ فعليًا.'
              : _savedForLater
              ? 'تعذّر الوصول إلى الخادم، فحفظنا البلاغ بانتظار الإرسال. سيُرسل تلقائيًا عند عودة الاتصال، ويمكنك متابعته من «بلاغاتي».'
              : 'استلمنا البلاغ، وهو بانتظار مراجعة الجهة المختصة. سيظهر على الخريطة العامة بعد اعتماده.',
          textAlign: TextAlign.center,
          style: const TextStyle(color: _photoSlate, fontSize: 14, height: 1.6),
        ),
        if (_createdReport != null) ...[
          const SizedBox(height: 20),
          _InfoBanner('رقم البلاغ: ${_createdReport!.id}'),
        ],
      ],
    ),
  );

  Widget _footer(bool completed) => _reportStepFooter(completed: completed);

  Widget _reportStepFooter({required bool completed}) => ClipRect(
    child: BackdropFilter(
      filter: ui.ImageFilter.blur(sigmaX: 18, sigmaY: 18),
      child: Container(
        padding: const EdgeInsets.fromLTRB(22, 13, 22, 16),
        decoration: BoxDecoration(
          color: Colors.white.withValues(alpha: 0.75),
          border: Border(
            top: BorderSide(color: Colors.white.withValues(alpha: 0.9)),
          ),
        ),
        child: Container(
          height: 58,
          decoration: BoxDecoration(
            gradient: const LinearGradient(
              colors: [Color(0xFFFBBF24), _photoGold, Color(0xFFF59E0B)],
            ),
            borderRadius: BorderRadius.circular(17),
            boxShadow: const [
              BoxShadow(
                color: Color(0x55E5A93C),
                blurRadius: 21,
                offset: Offset(0, 8),
              ),
            ],
          ),
          child: Material(
            color: Colors.transparent,
            child: InkWell(
              onTap: _sending
                  ? null
                  : completed
                  ? _back
                  : _next,
              borderRadius: BorderRadius.circular(17),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  if (_sending)
                    const SizedBox(
                      width: 24,
                      height: 24,
                      child: CircularProgressIndicator(
                        strokeWidth: 2,
                        color: _photoTeal,
                      ),
                    )
                  else ...[
                    BalaghiButtonLabel(
                      completed
                          ? 'العودة إلى الخريطة'
                          : switch (_step) {
                              0 || 1 => 'التالي',
                              2 => 'مراجعة البلاغ',
                              _ => 'تأكيد',
                            },
                      style: const TextStyle(
                        color: _photoTeal,
                        fontSize: 17,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                    if (!completed) ...[
                      const SizedBox(width: 10),
                      const Icon(
                        Icons.west_rounded,
                        color: _photoTeal,
                        size: 22,
                      ),
                    ],
                  ],
                ],
              ),
            ),
          ),
        ),
      ),
    ),
  );
}

class _InfoBanner extends StatelessWidget {
  const _InfoBanner(this.text);
  final String text;

  @override
  Widget build(BuildContext context) => Container(
    width: double.infinity,
    padding: const EdgeInsets.all(15),
    decoration: BoxDecoration(
      color: _orangeWash,
      borderRadius: BorderRadius.circular(12),
    ),
    child: Text(
      text,
      textAlign: TextAlign.center,
      style: const TextStyle(color: civicText, fontSize: 13),
    ),
  );
}

class _PhotoBrandPulse extends StatefulWidget {
  const _PhotoBrandPulse();

  @override
  State<_PhotoBrandPulse> createState() => _PhotoBrandPulseState();
}

class _PhotoBrandPulseState extends State<_PhotoBrandPulse>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 1600),
  )..repeat(reverse: true);

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => AnimatedBuilder(
    animation: _controller,
    builder: (context, child) => Container(
      width: 8 + 2 * _controller.value,
      height: 8 + 2 * _controller.value,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        color: _photoGold,
        boxShadow: [
          BoxShadow(
            color: _photoGold.withValues(alpha: 0.18 + _controller.value * 0.3),
            blurRadius: 5 + 8 * _controller.value,
          ),
        ],
      ),
    ),
  );
}

class _PhotoCameraBadge extends StatefulWidget {
  const _PhotoCameraBadge();

  @override
  State<_PhotoCameraBadge> createState() => _PhotoCameraBadgeState();
}

class _PhotoCameraBadgeState extends State<_PhotoCameraBadge>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 2200),
  )..repeat(reverse: true);

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => SizedBox(
    width: 96,
    height: 94,
    child: AnimatedBuilder(
      animation: _controller,
      builder: (context, child) => Transform.translate(
        offset: Offset(0, -3 * _controller.value),
        child: Transform.scale(
          scale: 0.97 + 0.04 * _controller.value,
          child: child,
        ),
      ),
      child: Stack(
        clipBehavior: Clip.none,
        children: [
          Align(
            alignment: Alignment.center,
            child: Container(
              width: 80,
              height: 80,
              decoration: BoxDecoration(
                gradient: const LinearGradient(
                  begin: Alignment.topLeft,
                  end: Alignment.bottomRight,
                  colors: [Colors.white, Color(0xFFFFFBF2)],
                ),
                borderRadius: BorderRadius.circular(23),
                border: Border.all(color: _photoGold.withValues(alpha: 0.42)),
                boxShadow: const [
                  BoxShadow(
                    color: Color(0x22E5A93C),
                    blurRadius: 24,
                    offset: Offset(0, 9),
                  ),
                ],
              ),
              child: const Icon(
                Icons.photo_camera_outlined,
                color: _photoTeal,
                size: 36,
              ),
            ),
          ),
          Positioned(
            right: -1,
            top: 1,
            child: Container(
              width: 29,
              height: 29,
              decoration: const BoxDecoration(
                color: _photoGold,
                shape: BoxShape.circle,
                boxShadow: [BoxShadow(color: Color(0x44E5A93C), blurRadius: 9)],
              ),
              child: const Icon(Icons.add_rounded, color: _photoTeal, size: 20),
            ),
          ),
        ],
      ),
    ),
  );
}

class _MapCenterPin extends StatefulWidget {
  const _MapCenterPin();

  @override
  State<_MapCenterPin> createState() => _MapCenterPinState();
}

class _MapCenterPinState extends State<_MapCenterPin>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 2200),
  )..repeat();

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => SizedBox(
    width: 80,
    height: 80,
    child: AnimatedBuilder(
      animation: _controller,
      builder: (context, child) {
        final progress = _controller.value;
        return Stack(
          alignment: Alignment.center,
          children: [
            Transform.scale(
              scale: 0.7 + progress * 2.2,
              child: Opacity(
                opacity: (1 - progress) * 0.65,
                child: Container(
                  width: 25,
                  height: 25,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    border: Border.all(color: _photoGold, width: 1.5),
                  ),
                ),
              ),
            ),
            Container(
              width: 18,
              height: 6,
              decoration: BoxDecoration(
                color: _photoTeal.withValues(alpha: 0.22),
                borderRadius: BorderRadius.circular(10),
              ),
            ),
            Transform.translate(
              offset: Offset(0, -22 - 4 * sin(progress * 2 * pi)),
              child: const SizedBox(
                width: 48,
                height: 48,
                child: Stack(
                  children: [
                    Icon(
                      Icons.location_on_rounded,
                      size: 48,
                      color: _photoTeal,
                      shadows: [
                        Shadow(color: Colors.white, blurRadius: 8),
                        Shadow(color: Color(0x66142834), blurRadius: 10),
                      ],
                    ),
                    Positioned(
                      top: 16,
                      left: 19,
                      child: CircleAvatar(
                        radius: 5,
                        backgroundColor: _photoGold,
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ],
        );
      },
    ),
  );
}

class _MapCornersPainter extends CustomPainter {
  const _MapCornersPainter();

  @override
  void paint(Canvas canvas, Size size) {
    const margin = 13.0;
    const length = 15.0;
    final path = ui.Path()
      ..moveTo(margin, margin + length)
      ..lineTo(margin, margin)
      ..lineTo(margin + length, margin)
      ..moveTo(size.width - margin - length, margin)
      ..lineTo(size.width - margin, margin)
      ..lineTo(size.width - margin, margin + length)
      ..moveTo(margin, size.height - margin - length)
      ..lineTo(margin, size.height - margin)
      ..lineTo(margin + length, size.height - margin)
      ..moveTo(size.width - margin - length, size.height - margin)
      ..lineTo(size.width - margin, size.height - margin)
      ..lineTo(size.width - margin, size.height - margin - length);
    canvas.drawPath(
      path,
      Paint()
        ..color = _photoGold.withValues(alpha: 0.85)
        ..style = PaintingStyle.stroke
        ..strokeWidth = 2
        ..strokeCap = StrokeCap.round,
    );
  }

  @override
  bool shouldRepaint(covariant _MapCornersPainter oldDelegate) => false;
}

class _ReportFlowBackdrop extends StatelessWidget {
  const _ReportFlowBackdrop();

  @override
  Widget build(BuildContext context) => IgnorePointer(
    child: const DecoratedBox(
      decoration: BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topCenter,
          end: Alignment.bottomCenter,
          colors: [_reportTopGlow, _reportBackground, _reportBackground],
          stops: [0, 0.38, 1],
        ),
      ),
    ),
  );
}

class _ViewfinderPainter extends CustomPainter {
  const _ViewfinderPainter({required this.onImage});

  final bool onImage;

  @override
  void paint(Canvas canvas, Size size) {
    const margin = 23.0;
    const length = 25.0;
    final marks = ui.Path()
      ..moveTo(margin, margin + length)
      ..lineTo(margin, margin)
      ..lineTo(margin + length, margin)
      ..moveTo(size.width - margin - length, margin)
      ..lineTo(size.width - margin, margin)
      ..lineTo(size.width - margin, margin + length)
      ..moveTo(margin, size.height - margin - length)
      ..lineTo(margin, size.height - margin)
      ..lineTo(margin + length, size.height - margin)
      ..moveTo(size.width - margin - length, size.height - margin)
      ..lineTo(size.width - margin, size.height - margin)
      ..lineTo(size.width - margin, size.height - margin - length);
    canvas.drawPath(
      marks,
      Paint()
        ..color = onImage ? Colors.white : _photoGold.withValues(alpha: 0.9)
        ..style = PaintingStyle.stroke
        ..strokeWidth = 3
        ..strokeCap = StrokeCap.round
        ..strokeJoin = StrokeJoin.round,
    );
  }

  @override
  bool shouldRepaint(covariant _ViewfinderPainter oldDelegate) =>
      oldDelegate.onImage != onImage;
}

class _SuccessAnimation extends StatefulWidget {
  const _SuccessAnimation();

  @override
  State<_SuccessAnimation> createState() => _SuccessAnimationState();
}

class _SuccessAnimationState extends State<_SuccessAnimation>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 1300),
  )..forward();

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => SizedBox(
    width: 190,
    height: 190,
    child: AnimatedBuilder(
      animation: _controller,
      builder: (context, child) {
        final circleScale = Curves.elasticOut.transform(
          ((_controller.value - 0.04) / 0.78).clamp(0.0, 1.0),
        );
        final checkProgress = ((_controller.value - 0.34) / 0.44).clamp(
          0.0,
          1.0,
        );
        final burstProgress = ((_controller.value - 0.38) / 0.52).clamp(
          0.0,
          1.0,
        );
        return Stack(
          alignment: Alignment.center,
          children: [
            Transform.scale(
              scale: circleScale,
              child: Container(
                width: 156,
                height: 156,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color: const Color(0xFFFFF7E6),
                  border: Border.all(
                    color: _photoGold.withValues(alpha: 0.35),
                    width: 2,
                  ),
                ),
                child: Center(
                  child: Container(
                    width: 112,
                    height: 112,
                    decoration: const BoxDecoration(
                      shape: BoxShape.circle,
                      color: _photoTeal,
                    ),
                    child: Center(
                      child: CustomPaint(
                        size: const Size(80, 80),
                        painter: _CheckPainter(checkProgress),
                      ),
                    ),
                  ),
                ),
              ),
            ),
            for (var index = 0; index < 8; index++)
              Transform.translate(
                offset: Offset(
                  cos(index * pi / 4) * (58 + 32 * burstProgress),
                  sin(index * pi / 4) * (58 + 32 * burstProgress),
                ),
                child: Opacity(
                  opacity: sin(pi * burstProgress).clamp(0.0, 1.0),
                  child: Container(
                    width: index.isEven ? 9 : 6,
                    height: index.isEven ? 9 : 6,
                    decoration: BoxDecoration(
                      color: index.isEven ? _photoGold : _photoTeal,
                      shape: BoxShape.circle,
                    ),
                  ),
                ),
              ),
          ],
        );
      },
    ),
  );
}

class _CheckPainter extends CustomPainter {
  const _CheckPainter(this.progress);

  final double progress;

  @override
  void paint(Canvas canvas, Size size) {
    final check = ui.Path()
      ..moveTo(13, 40)
      ..lineTo(31, 56)
      ..lineTo(67, 19);
    final metric = check.computeMetrics().first;
    final visible = metric.extractPath(0, metric.length * progress);
    canvas.drawPath(
      visible,
      Paint()
        ..color = Colors.white
        ..style = PaintingStyle.stroke
        ..strokeWidth = 7
        ..strokeCap = StrokeCap.round
        ..strokeJoin = StrokeJoin.round,
    );
  }

  @override
  bool shouldRepaint(covariant _CheckPainter oldDelegate) =>
      oldDelegate.progress != progress;
}

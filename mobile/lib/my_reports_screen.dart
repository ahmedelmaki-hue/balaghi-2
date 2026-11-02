import 'dart:io';

import 'package:flutter/material.dart';

import 'app_config.dart';
import 'citizen_auth.dart';
import 'create_report_repository.dart';
import 'create_report_screen.dart';
import 'my_reports_repository.dart';
import 'pending_reports.dart';
import 'public_reports.dart';
import 'report_details_screen.dart';
import 'report_image_viewer.dart';
import 'report_updates.dart';
import 'report_ui.dart';

const _ink = Color(0xFF12323F);
const _muted = Color(0xFF6C7C83);
const _gold = Color(0xFFE5A93C);
const _background = Color(0xFFFCF9F2);
const _border = Color(0xFFEAE4D8);

class MyReportsScreen extends StatefulWidget {
  const MyReportsScreen({
    super.key,
    required this.previewMode,
    this.previewReports,
    this.repository,
    this.pendingStore,
    this.createRepository,
    this.seenStore = const SeenReportStore(),
  });

  final bool previewMode;
  final List<MyReport>? previewReports;
  final MyReportsRepository? repository;
  final PendingReportStore? pendingStore;
  final CreateReportRepository? createRepository;
  final SeenReportStore seenStore;

  @override
  State<MyReportsScreen> createState() => _MyReportsScreenState();
}

class _MyReportsScreenState extends State<MyReportsScreen> {
  late final MyReportsRepository _repository =
      widget.repository ?? MyReportsRepository(baseUrl: apiBaseUrl);
  late final PendingReportStore _pendingStore =
      widget.pendingStore ?? PendingReportStore();
  late final CreateReportRepository _createRepository =
      widget.createRepository ?? CreateReportRepository(baseUrl: apiBaseUrl);
  final _authApi = CitizenAuthApi(baseUrl: apiBaseUrl);
  final _authStore = const CitizenAuthStore();
  ReportStatus? _filter;
  List<MyReport> _reports = const [];
  List<PendingReport> _pending = const [];
  // Reports whose stage changed since the last visit; marked for this visit only.
  final Set<String> _updated = {};
  String? _pendingError;
  bool _loading = true;
  bool _loadingMore = false;
  bool _hasMore = false;
  int _page = 0;
  int _requestSerial = 0;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _requestSerial++;
    if (widget.repository == null) _repository.dispose();
    if (widget.createRepository == null) _createRepository.dispose();
    _authApi.dispose();
    super.dispose();
  }

  Future<void> _load({bool more = false}) async {
    if (more && (_loading || _loadingMore || !_hasMore)) return;
    final serial = ++_requestSerial;
    setState(() {
      if (more) {
        _loadingMore = true;
      } else {
        _loading = true;
        _error = null;
      }
    });
    try {
      final List<MyReport> incoming;
      int page;
      bool hasMore;
      if (widget.previewMode) {
        final all =
            widget.previewReports ??
            demoPublicReports().map(MyReport.fromPublic).toList();
        incoming = all
            .where((report) => _filter == null || report.status == _filter)
            .toList();
        page = 1;
        hasMore = false;
      } else {
        final session = await _authApi.restore(_authStore);
        if (session == null || session.needsProfile) {
          throw const MyReportsFailure(
            'انتهت جلسة الدخول. ارجع وسجّل الدخول مجددًا.',
          );
        }
        if (!more) await _sendPending(session, serial);
        final result = await _repository.fetch(
          session: session,
          status: _filter,
          page: more ? _page + 1 : 1,
        );
        incoming = result.items;
        page = result.page;
        hasMore = page < result.totalPages;
        try {
          _updated.addAll(
            await markReportsSeen(widget.seenStore, session.phone, incoming),
          );
        } catch (_) {
          // The marks are a convenience; the list still shows every status.
        }
      }
      if (!mounted || serial != _requestSerial) return;
      setState(() {
        _reports = more ? [..._reports, ...incoming] : incoming;
        _page = page;
        _hasMore = hasMore;
        _loading = false;
        _loadingMore = false;
        _error = null;
      });
    } catch (error) {
      if (!mounted || serial != _requestSerial) return;
      setState(() {
        _loading = false;
        _loadingMore = false;
        _error = error is MyReportsFailure
            ? error.message
            : 'تعذّر تحميل بلاغاتك. حاول مجددًا.';
      });
    }
  }

  /// Shows the reports saved on this device, then tries to send them before
  /// the server list loads so a sent report appears there right away.
  Future<void> _sendPending(CitizenSession session, int serial) async {
    try {
      final saved = await _pendingStore.load(session.phone);
      if (!mounted || serial != _requestSerial) return;
      setState(() => _pending = saved);
      if (saved.isEmpty) return;
      final result = await sendPendingReports(
        session: session,
        store: _pendingStore,
        repository: _createRepository,
      );
      if (!mounted || serial != _requestSerial) return;
      setState(() {
        _pending = result.remaining;
        _pendingError = result.error;
      });
    } catch (_) {
      // Saved reports stay on the device and are retried on the next load.
    }
  }

  Future<void> _deletePending(PendingReport report) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => Directionality(
        textDirection: TextDirection.rtl,
        child: AlertDialog(
          title: const Text('حذف البلاغ المحفوظ؟'),
          content: const Text(
            'لم يصل هذا البلاغ إلى البلدية بعد. سيُحذف من جهازك ولن يُرسل.',
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(context).pop(false),
              child: const BalaghiButtonLabel('إلغاء'),
            ),
            TextButton(
              onPressed: () => Navigator.of(context).pop(true),
              child: const BalaghiButtonLabel(
                'حذف',
                style: TextStyle(color: Color(0xFFC93636)),
              ),
            ),
          ],
        ),
      ),
    );
    if (confirmed != true || !mounted) return;
    try {
      await _pendingStore.remove(report);
    } catch (_) {
      return;
    }
    if (!mounted) return;
    setState(() {
      _pending = _pending
          .where((item) => item.clientRequestId != report.clientRequestId)
          .toList();
      if (_pending.isEmpty) _pendingError = null;
    });
  }

  void _setFilter(ReportStatus? status) {
    if (_filter == status) return;
    setState(() {
      _filter = status;
      _reports = const [];
      _page = 0;
      _hasMore = false;
    });
    _load();
  }

  Future<void> _openCreate() async {
    final submitted = await Navigator.of(context).push<bool>(
      MaterialPageRoute(
        builder: (_) => CreateReportScreen(previewMode: widget.previewMode),
      ),
    );
    if (submitted == true && mounted && !widget.previewMode) _load();
  }

  void _openReport(MyReport report) {
    if (report.isRejected) return;
    Navigator.of(context).push<void>(
      MaterialPageRoute(
        builder: (_) => ReportDetailsScreen(
          report: report.toPublicReport(),
          pendingReview: report.isPendingReview,
          previewImageAsset: widget.previewMode
              ? _demoAsset(report.category)
              : null,
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) => Directionality(
    textDirection: TextDirection.rtl,
    child: Scaffold(
      backgroundColor: _background,
      body: Container(
        decoration: const BoxDecoration(
          gradient: LinearGradient(
            begin: Alignment.topCenter,
            end: Alignment.bottomCenter,
            stops: [0, 0.37, 1],
            colors: [Color(0xFFFEF3C7), _background, _background],
          ),
        ),
        child: SafeArea(
          child: Center(
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 520),
              child: Column(
                children: [
                  _header(),
                  _intro(),
                  _filters(),
                  Expanded(child: _body()),
                  _footer(),
                ],
              ),
            ),
          ),
        ),
      ),
    ),
  );

  Widget _header() => Padding(
    padding: const EdgeInsets.fromLTRB(20, 14, 20, 12),
    child: SizedBox(
      height: 48,
      child: Stack(
        alignment: Alignment.center,
        children: [
          const Text(
            'بلاغاتي',
            style: TextStyle(
              color: _ink,
              fontSize: 23,
              fontWeight: FontWeight.w800,
            ),
          ),
          Align(
            alignment: Alignment.centerRight,
            child: BalaghiBackButton(
              onPressed: () => Navigator.of(context).pop(),
            ),
          ),
        ],
      ),
    ),
  );

  Widget _intro() => Padding(
    padding: const EdgeInsets.fromLTRB(20, 3, 20, 19),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const Text(
          'تابع بلاغاتك وتطور معالجتها',
          style: TextStyle(
            color: _muted,
            fontSize: 14,
            fontWeight: FontWeight.w600,
          ),
        ),
        if (widget.previewMode) ...[
          const SizedBox(height: 12),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
            decoration: BoxDecoration(
              color: Colors.white.withValues(alpha: 0.76),
              border: Border.all(color: _border),
              borderRadius: BorderRadius.circular(13),
            ),
            child: const Row(
              children: [
                Icon(Icons.visibility_outlined, color: _ink, size: 19),
                SizedBox(width: 8),
                Expanded(
                  child: Text(
                    'معاينة ببلاغات تجريبية؛ البلاغات هنا غير محفوظة.',
                    style: TextStyle(
                      color: _ink,
                      fontSize: 12,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ),
              ],
            ),
          ),
        ],
      ],
    ),
  );

  Widget _filters() => SizedBox(
    height: 48,
    child: ListView(
      scrollDirection: Axis.horizontal,
      padding: const EdgeInsets.symmetric(horizontal: 20),
      children: [
        _filterButton(null, 'الكل'),
        for (final status in ReportStatus.values)
          _filterButton(status, status.label),
      ],
    ),
  );

  Widget _filterButton(ReportStatus? status, String label) {
    final selected = _filter == status;
    final color = status == null ? _ink : statusColor(status);
    return Padding(
      padding: const EdgeInsetsDirectional.only(end: 8),
      child: Material(
        color: selected ? color : Colors.white.withValues(alpha: 0.87),
        borderRadius: BorderRadius.circular(25),
        child: InkWell(
          onTap: () => _setFilter(status),
          borderRadius: BorderRadius.circular(25),
          child: Container(
            alignment: Alignment.center,
            padding: const EdgeInsets.symmetric(horizontal: 16),
            decoration: BoxDecoration(
              border: Border.all(color: selected ? color : _border),
              borderRadius: BorderRadius.circular(25),
            ),
            child: BalaghiButtonLabel(
              label,
              style: TextStyle(
                color: selected ? Colors.white : color,
                fontSize: 13,
                fontWeight: FontWeight.w700,
              ),
            ),
          ),
        ),
      ),
    );
  }

  // Saved reports have no server status yet, so only the «الكل» filter shows them.
  List<PendingReport> get _visiblePending =>
      _filter == null ? _pending : const [];

  Widget _body() {
    if (_loading) {
      return const Center(child: CircularProgressIndicator(color: _gold));
    }
    final pending = _visiblePending;
    if (_error != null && _reports.isEmpty && pending.isEmpty) {
      return _centerMessage(
        Icons.wifi_off_rounded,
        _error!,
        'إعادة المحاولة',
        _load,
      );
    }
    if (_reports.isEmpty && pending.isEmpty) {
      return RefreshIndicator(
        onRefresh: _load,
        child: ListView(
          physics: const AlwaysScrollableScrollPhysics(),
          children: [
            SizedBox(height: MediaQuery.sizeOf(context).height * 0.14),
            _emptyState(),
          ],
        ),
      );
    }
    return RefreshIndicator(
      color: _ink,
      onRefresh: _load,
      child: ListView.builder(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.fromLTRB(20, 20, 20, 22),
        itemCount:
            pending.length +
            _reports.length +
            (_hasMore || _error != null ? 1 : 0),
        itemBuilder: (context, index) {
          if (index < pending.length) {
            return _pendingCard(pending[index], first: index == 0);
          }
          final reportIndex = index - pending.length;
          if (reportIndex < _reports.length) {
            return _reportCard(_reports[reportIndex]);
          }
          return Padding(
            padding: const EdgeInsets.only(top: 8),
            child: TextButton(
              onPressed: _loadingMore ? null : () => _load(more: _hasMore),
              child: BalaghiButtonLabel(
                _loadingMore
                    ? 'جارٍ التحميل...'
                    : _error != null
                    ? 'تعذّر التحميل، اضغط للمحاولة'
                    : 'عرض المزيد',
              ),
            ),
          );
        },
      ),
    );
  }

  Widget _emptyState() => Center(
    child: Padding(
      padding: const EdgeInsets.symmetric(horizontal: 30),
      child: Column(
        children: [
          Container(
            width: 104,
            height: 104,
            decoration: BoxDecoration(
              color: _gold.withValues(alpha: 0.14),
              shape: BoxShape.circle,
            ),
            child: const Icon(Icons.assignment_outlined, color: _ink, size: 44),
          ),
          const SizedBox(height: 20),
          Text(
            _filter == null
                ? 'لم ترسل أي بلاغ بعد'
                : 'لا توجد بلاغات بهذه الحالة',
            textAlign: TextAlign.center,
            style: const TextStyle(
              color: _ink,
              fontSize: 19,
              fontWeight: FontWeight.w800,
            ),
          ),
          const SizedBox(height: 8),
          const Text(
            'عندما ترسل بلاغًا، يمكنك متابعة حالته هنا.',
            textAlign: TextAlign.center,
            style: TextStyle(color: _muted, fontSize: 13),
          ),
        ],
      ),
    ),
  );

  Widget _centerMessage(
    IconData icon,
    String message,
    String action,
    VoidCallback onAction,
  ) => Center(
    child: Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(icon, color: _muted, size: 42),
        const SizedBox(height: 12),
        Text(
          message,
          textAlign: TextAlign.center,
          style: const TextStyle(color: _muted),
        ),
        TextButton(onPressed: onAction, child: BalaghiButtonLabel(action)),
      ],
    ),
  );

  Widget _reportCard(MyReport report) {
    final rejected = report.isRejected;
    final updated = _updated.contains(report.id);
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Material(
        color: Colors.white,
        borderRadius: BorderRadius.circular(20),
        child: InkWell(
          onTap: rejected ? null : () => _openReport(report),
          borderRadius: BorderRadius.circular(20),
          child: Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              border: Border.all(
                color: updated ? _gold : _border,
                width: updated ? 1.5 : 1,
              ),
              borderRadius: BorderRadius.circular(20),
              boxShadow: const [
                BoxShadow(
                  color: Color(0x1012323F),
                  blurRadius: 16,
                  offset: Offset(0, 5),
                ),
              ],
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    _thumbnail(report),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(
                            children: [
                              Flexible(
                                child: Text(
                                  report.category.singularLabel,
                                  style: const TextStyle(
                                    color: _ink,
                                    fontSize: 16,
                                    fontWeight: FontWeight.w800,
                                  ),
                                ),
                              ),
                              if (updated) ...[
                                const SizedBox(width: 7),
                                _updatedPill(),
                              ],
                            ],
                          ),
                          const SizedBox(height: 5),
                          Text(
                            report.addressText ?? 'موقع البلاغ على الخريطة',
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(color: _muted, fontSize: 12),
                          ),
                          const SizedBox(height: 9),
                          Text(
                            reportDate(report.createdAt),
                            style: const TextStyle(color: _muted, fontSize: 11),
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(width: 4),
                    rejected
                        ? _rejectedPill()
                        : report.isPendingReview
                        ? _pendingPill()
                        : ReportStatusPill(status: report.status!),
                  ],
                ),
                if (rejected && report.rejectionReason != null) ...[
                  const SizedBox(height: 12),
                  Container(
                    padding: const EdgeInsets.all(10),
                    decoration: BoxDecoration(
                      color: const Color(0xFFF5F5F4),
                      borderRadius: BorderRadius.circular(10),
                    ),
                    child: Text(
                      'سبب الرفض: ${report.rejectionReason}',
                      style: const TextStyle(color: _muted, fontSize: 12),
                    ),
                  ),
                ],
                if (!rejected) ...[
                  if (report.isPendingReview) ...[
                    const SizedBox(height: 11),
                    const Text(
                      'البلاغ بانتظار مراجعة الجهة المختصة قبل ظهوره على الخريطة العامة.',
                      style: TextStyle(
                        color: _muted,
                        fontSize: 12,
                        height: 1.5,
                      ),
                    ),
                  ],
                  const SizedBox(height: 10),
                  const Row(
                    mainAxisAlignment: MainAxisAlignment.end,
                    children: [
                      BalaghiButtonLabel(
                        'عرض التفاصيل',
                        style: TextStyle(
                          color: _ink,
                          fontSize: 12,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                      SizedBox(width: 3),
                      Icon(Icons.chevron_left_rounded, color: _ink, size: 19),
                    ],
                  ),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _pendingCard(PendingReport report, {required bool first}) {
    // Sending stops at the first failure, so a server refusal belongs to the first card.
    final error = first ? _pendingError : null;
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Container(
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: Colors.white,
          border: Border.all(color: _border),
          borderRadius: BorderRadius.circular(20),
          boxShadow: const [
            BoxShadow(
              color: Color(0x1012323F),
              blurRadius: 16,
              offset: Offset(0, 5),
            ),
          ],
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                ClipRRect(
                  borderRadius: BorderRadius.circular(13),
                  child: SizedBox(
                    width: 78,
                    height: 78,
                    child: Image.file(
                      File(report.imagePath),
                      fit: BoxFit.cover,
                      errorBuilder: (_, _, _) =>
                          _imagePlaceholder(report.category),
                    ),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        report.category.singularLabel,
                        style: const TextStyle(
                          color: _ink,
                          fontSize: 16,
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                      const SizedBox(height: 5),
                      const Text(
                        'محفوظ على جهازك',
                        style: TextStyle(color: _muted, fontSize: 12),
                      ),
                      const SizedBox(height: 9),
                      Text(
                        reportDate(report.savedAt),
                        style: const TextStyle(color: _muted, fontSize: 11),
                      ),
                    ],
                  ),
                ),
                const SizedBox(width: 4),
                _awaitingSendPill(),
              ],
            ),
            const SizedBox(height: 11),
            Text(
              error == null
                  ? 'لم يصل البلاغ إلى البلدية بعد. سيُرسل تلقائيًا عند عودة الاتصال.'
                  : 'تعذّر إرسال البلاغ: $error',
              style: const TextStyle(color: _muted, fontSize: 12, height: 1.5),
            ),
            const SizedBox(height: 4),
            Row(
              mainAxisAlignment: MainAxisAlignment.end,
              children: [
                TextButton(
                  onPressed: () => _deletePending(report),
                  child: const BalaghiButtonLabel(
                    'حذف',
                    style: TextStyle(
                      color: _muted,
                      fontSize: 12,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ),
                TextButton.icon(
                  onPressed: _load,
                  icon: const Icon(Icons.send_rounded, color: _ink, size: 17),
                  label: const BalaghiButtonLabel(
                    'إرسال الآن',
                    style: TextStyle(
                      color: _ink,
                      fontSize: 12,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _awaitingSendPill() => Container(
    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
    decoration: BoxDecoration(
      color: const Color(0xFFE8EEF1),
      borderRadius: BorderRadius.circular(30),
    ),
    child: const Text(
      'بانتظار الإرسال',
      style: TextStyle(color: _ink, fontSize: 11, fontWeight: FontWeight.w700),
    ),
  );

  Widget _pendingPill() => Container(
    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
    decoration: BoxDecoration(
      color: const Color(0xFFFFF3D6),
      borderRadius: BorderRadius.circular(30),
    ),
    child: const Text(
      'بانتظار المراجعة',
      style: TextStyle(
        color: Color(0xFF9A6700),
        fontSize: 11,
        fontWeight: FontWeight.w700,
      ),
    ),
  );

  Widget _updatedPill() => Semantics(
    label: 'تغيّرت حالة هذا البلاغ منذ آخر زيارة',
    excludeSemantics: true,
    child: Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: _ink,
        borderRadius: BorderRadius.circular(30),
      ),
      child: const Text(
        'تحدّث',
        style: TextStyle(
          color: Colors.white,
          fontSize: 10,
          fontWeight: FontWeight.w800,
        ),
      ),
    ),
  );

  Widget _rejectedPill() => Container(
    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
    decoration: BoxDecoration(
      color: const Color(0xFFF0F0EF),
      borderRadius: BorderRadius.circular(30),
    ),
    child: const Text(
      'مرفوض',
      style: TextStyle(
        color: Color(0xFF686868),
        fontSize: 12,
        fontWeight: FontWeight.w700,
      ),
    ),
  );

  Widget _thumbnail(MyReport report) {
    final imageUrl = report.imageUrl;
    final assetPath = widget.previewMode ? _demoAsset(report.category) : null;
    final thumbnail = ClipRRect(
      borderRadius: BorderRadius.circular(13),
      child: SizedBox(
        width: 78,
        height: 78,
        child: widget.previewMode
            ? Image.asset(assetPath!, fit: BoxFit.cover)
            : report.imageUrl != null
            ? Image.network(
                report.imageUrl!,
                fit: BoxFit.cover,
                errorBuilder: (_, _, _) => _imagePlaceholder(report.category),
              )
            : _imagePlaceholder(report.category),
      ),
    );
    if (imageUrl == null && assetPath == null) return thumbnail;
    return Tooltip(
      message: 'عرض الصورة كاملة',
      child: GestureDetector(
        onTap: () => openReportImageViewer(
          context,
          imageUrl: widget.previewMode ? null : imageUrl,
          assetPath: assetPath,
        ),
        child: thumbnail,
      ),
    );
  }

  Widget _imagePlaceholder(ReportCategory category) => ColoredBox(
    color: const Color(0xFFF8F1E4),
    child: Icon(categoryIcon(category), color: _ink, size: 29),
  );

  Widget _footer() => Container(
    padding: const EdgeInsets.fromLTRB(20, 12, 20, 14),
    decoration: const BoxDecoration(
      color: Color(0xF9FCF9F2),
      border: Border(top: BorderSide(color: _border)),
    ),
    child: SizedBox(
      width: double.infinity,
      height: 56,
      child: DecoratedBox(
        decoration: BoxDecoration(
          gradient: const LinearGradient(
            colors: [Color(0xFFFBBF24), _gold, Color(0xFFF59E0B)],
          ),
          borderRadius: BorderRadius.circular(17),
          boxShadow: const [
            BoxShadow(
              color: Color(0x45E5A93C),
              blurRadius: 15,
              offset: Offset(0, 7),
            ),
          ],
        ),
        child: Material(
          color: Colors.transparent,
          child: InkWell(
            onTap: _openCreate,
            borderRadius: BorderRadius.circular(17),
            child: const Center(
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(Icons.add_rounded, color: _ink, size: 23),
                  SizedBox(width: 8),
                  BalaghiButtonLabel(
                    'إنشاء بلاغ جديد',
                    style: TextStyle(
                      color: _ink,
                      fontSize: 16,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    ),
  );
}

String _demoAsset(ReportCategory category) => switch (category) {
  ReportCategory.pothole => 'assets/demo_pothole.jpg',
  ReportCategory.waterLeak => 'assets/demo_water_leak.jpg',
  ReportCategory.garbage => 'assets/demo_garbage.jpg',
};

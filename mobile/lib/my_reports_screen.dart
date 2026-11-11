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

  /// The title in the middle, back on the side, as on the report details.
  Widget _header() => Padding(
    padding: const EdgeInsets.fromLTRB(16, 12, 16, 14),
    child: SizedBox(
      height: 48,
      child: Stack(
        alignment: Alignment.center,
        children: [
          const Text(
            'بلاغاتي',
            style: TextStyle(
              color: _ink,
              fontSize: 21,
              fontWeight: FontWeight.w800,
            ),
          ),
          Align(
            alignment: AlignmentDirectional.centerStart,
            child: BalaghiBackButton(
              onPressed: () => Navigator.of(context).pop(),
            ),
          ),
        ],
      ),
    ),
  );

  /// The four filters side by side, like the categories on the map.
  Widget _filters() => Padding(
    padding: const EdgeInsets.symmetric(horizontal: 16),
    child: Container(
      height: 48,
      padding: const EdgeInsets.all(4),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: _border),
      ),
      child: Row(
        children: [
          _filterButton(null, 'الكل'),
          for (final status in ReportStatus.values)
            _filterButton(status, status.label),
        ],
      ),
    ),
  );

  Widget _filterButton(ReportStatus? status, String label) {
    final selected = _filter == status;
    return Expanded(
      flex: status == ReportStatus.inProgress ? 14 : 10,
      child: Semantics(
        selected: selected,
        button: true,
        child: Material(
          color: selected ? _ink : Colors.transparent,
          borderRadius: BorderRadius.circular(12),
          child: InkWell(
            onTap: () => _setFilter(status),
            borderRadius: BorderRadius.circular(12),
            child: Center(
              child: FittedBox(
                fit: BoxFit.scaleDown,
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    if (status != null) ...[
                      Container(
                        width: 8,
                        height: 8,
                        decoration: BoxDecoration(
                          color: statusColor(status),
                          shape: BoxShape.circle,
                          border: selected
                              ? Border.all(color: Colors.white, width: 1.2)
                              : null,
                        ),
                      ),
                      const SizedBox(width: 6),
                    ],
                    BalaghiButtonLabel(
                      label,
                      style: TextStyle(
                        color: selected ? Colors.white : _ink,
                        fontSize: 13,
                        fontWeight: FontWeight.w700,
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
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 22),
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

  /// One card shape for every report: photo, type, place, date and state, and
  /// under it a note when the report waits for review or was refused.
  Widget _cardShell({
    required Widget top,
    Widget? note,
    Widget? actions,
    VoidCallback? onTap,
    bool highlighted = false,
  }) => Padding(
    padding: const EdgeInsets.only(bottom: 12),
    child: DecoratedBox(
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(20),
        boxShadow: const [
          BoxShadow(
            color: Color(0x0F12323F),
            blurRadius: 16,
            offset: Offset(0, 5),
          ),
        ],
      ),
      child: Material(
        color: Colors.transparent,
        borderRadius: BorderRadius.circular(20),
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(20),
          child: Ink(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: Colors.white,
              border: Border.all(
                color: highlighted ? _gold : _border,
                width: highlighted ? 1.6 : 1,
              ),
              borderRadius: BorderRadius.circular(20),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                top,
                if (note != null) ...[const SizedBox(height: 10), note],
                ?actions,
              ],
            ),
          ),
        ),
      ),
    ),
  );

  Widget _cardTop({
    required Widget thumbnail,
    required String title,
    required String place,
    required DateTime date,
    required Widget pill,
    Widget? mark,
    bool opens = false,
  }) => Row(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      thumbnail,
      const SizedBox(width: 12),
      Expanded(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Flexible(
                  child: Text(
                    title,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      color: _ink,
                      fontSize: 16,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                ),
                if (mark != null) ...[const SizedBox(width: 7), mark],
              ],
            ),
            const SizedBox(height: 4),
            _metaLine(Icons.location_on_outlined, place),
            const SizedBox(height: 3),
            _metaLine(Icons.schedule_rounded, reportDate(date)),
          ],
        ),
      ),
      const SizedBox(width: 6),
      Column(
        crossAxisAlignment: CrossAxisAlignment.end,
        children: [
          pill,
          if (opens) ...[
            const SizedBox(height: 18),
            const Icon(Icons.chevron_left_rounded, color: _muted, size: 22),
          ],
        ],
      ),
    ],
  );

  Widget _metaLine(IconData icon, String text) => Row(
    children: [
      Icon(icon, size: 14, color: _muted),
      const SizedBox(width: 4),
      Expanded(
        child: Text(
          text,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: const TextStyle(color: _muted, fontSize: 12.5),
        ),
      ),
    ],
  );

  /// A tinted strip inside a card: why the report waits, or why it was refused.
  Widget _cardNote(
    IconData icon,
    String text, {
    Color color = const Color(0xFF8A5A00),
    Color background = const Color(0xFFFFF7E6),
  }) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 11, vertical: 9),
    decoration: BoxDecoration(
      color: background,
      borderRadius: BorderRadius.circular(12),
    ),
    child: Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.only(top: 2),
          child: Icon(icon, size: 16, color: color),
        ),
        const SizedBox(width: 8),
        Expanded(
          child: Text(
            text,
            style: TextStyle(color: color, fontSize: 12.5, height: 1.55),
          ),
        ),
      ],
    ),
  );

  Widget _reportCard(MyReport report) {
    final rejected = report.isRejected;
    final updated = _updated.contains(report.id);
    return _cardShell(
      onTap: rejected ? null : () => _openReport(report),
      highlighted: updated,
      top: _cardTop(
        thumbnail: _thumbnail(report),
        title: report.category.singularLabel,
        place: report.addressText ?? 'موقع البلاغ على الخريطة',
        date: report.createdAt,
        pill: rejected
            ? _rejectedPill()
            : report.isPendingReview
            ? _pendingPill()
            : ReportStatusPill(status: report.status!),
        mark: updated ? _updatedPill() : null,
        opens: !rejected,
      ),
      note: rejected && report.rejectionReason != null
          ? _cardNote(
              Icons.info_outline_rounded,
              'سبب الرفض: ${report.rejectionReason}',
              color: const Color(0xFF6B4B47),
              background: const Color(0xFFF7EEEC),
            )
          : !rejected && report.isPendingReview
          ? _cardNote(
              Icons.hourglass_top_rounded,
              'بانتظار مراجعة البلدية قبل ظهوره على الخريطة العامة.',
            )
          : null,
    );
  }

  Widget _pendingCard(PendingReport report, {required bool first}) {
    // Sending stops at the first failure, so a server refusal belongs to the first card.
    final error = first ? _pendingError : null;
    return _cardShell(
      top: _cardTop(
        thumbnail: ClipRRect(
          borderRadius: BorderRadius.circular(14),
          child: SizedBox(
            width: 72,
            height: 72,
            child: Image.file(
              File(report.imagePath),
              fit: BoxFit.cover,
              errorBuilder: (_, _, _) => _imagePlaceholder(report.category),
            ),
          ),
        ),
        title: report.category.singularLabel,
        place: 'محفوظ على جهازك',
        date: report.savedAt,
        pill: _awaitingSendPill(),
      ),
      note: _cardNote(
        error == null ? Icons.cloud_off_rounded : Icons.error_outline_rounded,
        error == null
            ? 'لم يصل البلاغ إلى البلدية بعد. سيُرسل تلقائيًا عند عودة الاتصال.'
            : 'تعذّر إرسال البلاغ: $error',
        color: error == null ? _ink : const Color(0xFFB3261E),
        background: error == null
            ? const Color(0xFFEFF4F5)
            : const Color(0xFFFBECEA),
      ),
      actions: Padding(
        padding: const EdgeInsets.only(top: 8),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.end,
          children: [
            TextButton(
              onPressed: () => _deletePending(report),
              style: TextButton.styleFrom(
                foregroundColor: const Color(0xFFB3261E),
                minimumSize: const Size(48, 44),
              ),
              child: const BalaghiButtonLabel(
                'حذف',
                style: TextStyle(fontSize: 13, fontWeight: FontWeight.w700),
              ),
            ),
            const SizedBox(width: 6),
            OutlinedButton.icon(
              onPressed: _load,
              style: OutlinedButton.styleFrom(
                foregroundColor: _ink,
                side: const BorderSide(color: _border),
                minimumSize: const Size(48, 44),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(12),
                ),
              ),
              icon: const Icon(Icons.send_rounded, size: 17),
              label: const BalaghiButtonLabel(
                'إرسال الآن',
                style: TextStyle(fontSize: 13, fontWeight: FontWeight.w700),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _awaitingSendPill() => _plainPill(
    'بانتظار الإرسال',
    color: _ink,
    background: const Color(0xFFE8EEF1),
  );

  Widget _pendingPill() => _plainPill(
    'بانتظار المراجعة',
    color: const Color(0xFF9A6700),
    background: const Color(0xFFFFF3D6),
  );

  Widget _rejectedPill() => _plainPill(
    'مرفوض',
    color: const Color(0xFF5F6366),
    background: const Color(0xFFEEEFEF),
  );

  Widget _plainPill(
    String label, {
    required Color color,
    required Color background,
  }) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 11, vertical: 6),
    decoration: BoxDecoration(
      color: background,
      borderRadius: BorderRadius.circular(999),
    ),
    child: Text(
      label,
      style: TextStyle(color: color, fontSize: 12, fontWeight: FontWeight.w700),
    ),
  );

  Widget _updatedPill() => Semantics(
    label: 'تغيّرت حالة هذا البلاغ منذ آخر زيارة',
    excludeSemantics: true,
    child: Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: _gold,
        borderRadius: BorderRadius.circular(999),
      ),
      child: const Text(
        'تحدّث',
        style: TextStyle(
          color: _ink,
          fontSize: 11,
          fontWeight: FontWeight.w800,
        ),
      ),
    ),
  );

  Widget _thumbnail(MyReport report) {
    final imageUrl = report.imageUrl;
    final assetPath = widget.previewMode ? _demoAsset(report.category) : null;
    final thumbnail = ClipRRect(
      borderRadius: BorderRadius.circular(14),
      child: SizedBox(
        width: 72,
        height: 72,
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
    padding: const EdgeInsets.fromLTRB(16, 12, 16, 14),
    decoration: const BoxDecoration(
      color: Color(0xF9FCF9F2),
      border: Border(top: BorderSide(color: _border)),
    ),
    child: BalaghiGoldButton(
      label: 'إنشاء بلاغ جديد',
      icon: Icons.add_rounded,
      onPressed: _openCreate,
      height: 56,
      fontSize: 16,
      textColor: _ink,
    ),
  );
}

String _demoAsset(ReportCategory category) => switch (category) {
  ReportCategory.pothole => 'assets/demo_pothole.jpg',
  ReportCategory.waterLeak => 'assets/demo_water_leak.jpg',
  ReportCategory.garbage => 'assets/demo_garbage.jpg',
};

import 'package:flutter/material.dart';

import 'app_config.dart';
import 'citizen_auth.dart';
import 'citizen_auth_preview_store.dart';
import 'my_reports_screen.dart';
import 'report_ui.dart';
import 'welcome_appearance_store.dart';

const _ink = Color(0xFF12323F);
const _muted = Color(0xFF6C7C83);
const _gold = Color(0xFFE5A93C);
const _background = Color(0xFFFCF9F2);
const _border = Color(0xFFEAE4D8);

class AccountScreen extends StatefulWidget {
  const AccountScreen({super.key, required this.previewMode});

  final bool previewMode;

  @override
  State<AccountScreen> createState() => _AccountScreenState();
}

class _AccountScreenState extends State<AccountScreen> {
  final _authApi = CitizenAuthApi(baseUrl: apiBaseUrl);
  final _authStore = const CitizenAuthStore();
  final _previewStore = const CitizenAuthPreviewStore();
  final _appearanceStore = const WelcomeAppearanceStore();
  String? _name;
  String? _phone;
  String? _error;
  bool _loading = true;
  bool _busy = false;
  bool _darkWelcome = false;
  bool _savingAppearance = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _authApi.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      var darkWelcome = false;
      try {
        darkWelcome = await _appearanceStore.loadDark();
      } catch (_) {
        // The account remains usable if local appearance settings fail.
      }
      if (widget.previewMode) {
        final profile = await _previewStore.loadProfile();
        if (!mounted) return;
        setState(() {
          _name = profile.fullName;
          _phone = profile.phone;
          _darkWelcome = darkWelcome;
          _loading = false;
        });
      } else {
        final session = await _authApi.restore(_authStore);
        if (!mounted) return;
        if (session == null || session.needsProfile) {
          setState(() {
            _loading = false;
            _error = 'انتهت جلسة الدخول. ارجع وسجّل الدخول مجددًا.';
          });
          return;
        }
        setState(() {
          _name = session.fullName;
          _phone = session.phone;
          _darkWelcome = darkWelcome;
          _loading = false;
        });
      }
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = 'تعذّر تحميل الحساب. حاول مجددًا.';
      });
    }
  }

  Future<void> _setDarkWelcome(bool enabled) async {
    if (_busy || _savingAppearance) return;
    final previous = _darkWelcome;
    setState(() {
      _darkWelcome = enabled;
      _savingAppearance = true;
    });
    try {
      await _appearanceStore.saveDark(enabled);
    } catch (_) {
      if (!mounted) return;
      setState(() => _darkWelcome = previous);
      _message('تعذّر حفظ إعداد المظهر. حاول مجددًا.');
    } finally {
      if (mounted) setState(() => _savingAppearance = false);
    }
  }

  Future<void> _editName() async {
    if (_busy) return;
    var enteredName = _name ?? '';
    final formKey = GlobalKey<FormState>();
    final updated = await showDialog<String>(
      context: context,
      builder: (dialogContext) => Directionality(
        textDirection: TextDirection.rtl,
        child: AlertDialog(
          backgroundColor: _background,
          title: const Text('تعديل الاسم', style: TextStyle(color: _ink)),
          content: Form(
            key: formKey,
            child: TextFormField(
              initialValue: enteredName,
              onChanged: (value) => enteredName = value,
              autofocus: true,
              maxLength: 100,
              textCapitalization: TextCapitalization.words,
              decoration: const InputDecoration(
                labelText: 'الاسم الكامل',
                border: OutlineInputBorder(),
              ),
              validator: (value) {
                final name = value?.trim() ?? '';
                if (name.isEmpty) return 'أدخل اسمك الكامل.';
                if (name.length > 100) return 'الاسم طويل جدًا.';
                return null;
              },
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(dialogContext),
              child: const BalaghiButtonLabel('إلغاء'),
            ),
            FilledButton(
              style: FilledButton.styleFrom(backgroundColor: _ink),
              onPressed: () {
                if (formKey.currentState?.validate() == true) {
                  Navigator.pop(dialogContext, enteredName.trim());
                }
              },
              child: const BalaghiButtonLabel('حفظ'),
            ),
          ],
        ),
      ),
    );
    FocusManager.instance.primaryFocus?.unfocus();
    if (!mounted || updated == null || updated == _name) return;
    setState(() => _busy = true);
    try {
      if (widget.previewMode) {
        await _previewStore.updateName(updated);
      } else {
        final session = await _authApi.restore(_authStore);
        if (session == null || session.needsProfile) {
          throw const AuthFailure(
            'انتهت جلسة الدخول. ارجع وسجّل الدخول مجددًا.',
          );
        }
        final completed = await _authApi.completeProfile(session, updated);
        await _authStore.save(completed);
      }
      if (!mounted) return;
      setState(() => _name = updated);
      _message('تم حفظ الاسم.');
    } on AuthFailure catch (error) {
      _message(error.message);
    } catch (_) {
      _message('تعذّر حفظ الاسم. حاول مجددًا.');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _signOut() async {
    if (_busy) return;
    setState(() => _busy = true);
    try {
      if (widget.previewMode) {
        await _previewStore.clear();
      } else {
        await _authStore.clear();
      }
      if (mounted) Navigator.of(context).pop(true);
    } catch (_) {
      _message('تعذّر تسجيل الخروج. حاول مجددًا.');
      if (mounted) setState(() => _busy = false);
    }
  }

  void _message(String message) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(message), behavior: SnackBarBehavior.floating),
    );
  }

  Future<void> _openMyReports() async {
    if (_busy) return;
    await Navigator.of(context).push<void>(
      MaterialPageRoute(
        builder: (_) => MyReportsScreen(previewMode: widget.previewMode),
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
            stops: [0, 0.38, 1],
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
                  Expanded(
                    child: _loading
                        ? const Center(
                            child: CircularProgressIndicator(color: _gold),
                          )
                        : _error != null
                        ? _errorState()
                        : _content(),
                  ),
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
            'حسابي',
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

  Widget _errorState() => Center(
    child: Padding(
      padding: const EdgeInsets.all(24),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Icon(Icons.person_off_outlined, size: 44, color: _muted),
          const SizedBox(height: 12),
          Text(
            _error!,
            textAlign: TextAlign.center,
            style: const TextStyle(color: _muted),
          ),
          TextButton(
            onPressed: _load,
            child: const BalaghiButtonLabel('إعادة المحاولة'),
          ),
        ],
      ),
    ),
  );

  Widget _content() => ListView(
    padding: const EdgeInsets.fromLTRB(20, 20, 20, 28),
    children: [
      _profileCard(),
      const SizedBox(height: 20),
      _sectionLabel('الحساب'),
      _actionTile(
        icon: Icons.edit_outlined,
        title: 'تعديل الاسم',
        subtitle: 'غيّر الاسم الظاهر في حسابك',
        onTap: _editName,
      ),
      const SizedBox(height: 10),
      _actionTile(
        icon: Icons.assignment_outlined,
        title: 'بلاغاتي',
        subtitle: 'تابع بلاغاتك وحالة معالجتها',
        onTap: _openMyReports,
      ),
      const SizedBox(height: 20),
      _sectionLabel('التطبيق'),
      _appearanceTile(),
      const SizedBox(height: 10),
      _actionTile(
        icon: Icons.privacy_tip_outlined,
        title: 'سياسة الخصوصية',
        subtitle: 'كيف تُستخدم بياناتك وبيانات البلاغات',
        onTap: () => Navigator.of(context).push<void>(
          MaterialPageRoute(
            builder: (_) => _PrivacyScreen(previewMode: widget.previewMode),
          ),
        ),
      ),
      const SizedBox(height: 18),
      Center(
        child: Text(
          'بلاغي  •  الإصدار 1.0.0',
          style: TextStyle(color: _muted.withValues(alpha: 0.85), fontSize: 12),
        ),
      ),
      const SizedBox(height: 28),
      OutlinedButton.icon(
        onPressed: _busy ? null : _signOut,
        icon: const Icon(Icons.logout_rounded, size: 20),
        label: const BalaghiButtonLabel(
          'تسجيل الخروج',
          style: TextStyle(fontWeight: FontWeight.w800),
        ),
        style: OutlinedButton.styleFrom(
          foregroundColor: const Color(0xFFC93636),
          side: const BorderSide(color: Color(0x33C93636)),
          backgroundColor: Colors.white,
          minimumSize: const Size.fromHeight(54),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(16),
          ),
        ),
      ),
    ],
  );

  Widget _profileCard() => Container(
    padding: const EdgeInsets.all(20),
    decoration: BoxDecoration(
      color: Colors.white,
      border: Border.all(color: _border),
      borderRadius: BorderRadius.circular(22),
      boxShadow: const [
        BoxShadow(
          color: Color(0x1012323F),
          blurRadius: 18,
          offset: Offset(0, 6),
        ),
      ],
    ),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Center(
          child: Container(
            width: 76,
            height: 76,
            decoration: BoxDecoration(
              color: _gold.withValues(alpha: 0.19),
              shape: BoxShape.circle,
            ),
            child: const Icon(Icons.person_rounded, color: _ink, size: 40),
          ),
        ),
        const SizedBox(height: 14),
        Text(
          _name?.trim().isNotEmpty == true ? _name! : 'الاسم غير متاح',
          textAlign: TextAlign.center,
          style: const TextStyle(
            color: _ink,
            fontSize: 20,
            fontWeight: FontWeight.w800,
          ),
        ),
        if (widget.previewMode) ...[
          const SizedBox(height: 8),
          Center(child: _previewBadge()),
        ],
        const SizedBox(height: 18),
        const Divider(color: _border, height: 1),
        const SizedBox(height: 16),
        const Text('رقم الهاتف', style: TextStyle(color: _muted, fontSize: 12)),
        const SizedBox(height: 5),
        Row(
          children: [
            const Icon(Icons.phone_android_rounded, color: _ink, size: 20),
            const SizedBox(width: 8),
            Expanded(
              child: Text(
                _phone ?? 'غير محفوظ في المعاينة السابقة',
                textDirection: TextDirection.ltr,
                textAlign: TextAlign.right,
                style: const TextStyle(
                  color: _ink,
                  fontSize: 16,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ),
            const Icon(Icons.lock_outline_rounded, color: _muted, size: 17),
          ],
        ),
        const SizedBox(height: 7),
        const Text(
          'تغيير الرقم يتطلب التحقق برمز OTP جديد.',
          style: TextStyle(color: _muted, fontSize: 11),
        ),
      ],
    ),
  );

  Widget _previewBadge() => Container(
    padding: const EdgeInsets.symmetric(horizontal: 11, vertical: 5),
    decoration: BoxDecoration(
      color: _gold.withValues(alpha: 0.17),
      borderRadius: BorderRadius.circular(30),
    ),
    child: const Text(
      'وضع المعاينة',
      style: TextStyle(color: _ink, fontSize: 11, fontWeight: FontWeight.w700),
    ),
  );

  Widget _sectionLabel(String label) => Padding(
    padding: const EdgeInsets.only(bottom: 10),
    child: Text(
      label,
      style: const TextStyle(
        color: _ink,
        fontSize: 14,
        fontWeight: FontWeight.w800,
      ),
    ),
  );

  Widget _appearanceTile() => Material(
    color: Colors.white,
    borderRadius: BorderRadius.circular(17),
    child: InkWell(
      onTap: _busy || _savingAppearance
          ? null
          : () => _setDarkWelcome(!_darkWelcome),
      borderRadius: BorderRadius.circular(17),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 15, vertical: 12),
        decoration: BoxDecoration(
          border: Border.all(color: _border),
          borderRadius: BorderRadius.circular(17),
        ),
        child: Row(
          children: [
            Container(
              width: 42,
              height: 42,
              decoration: BoxDecoration(
                color: _gold.withValues(alpha: 0.14),
                borderRadius: BorderRadius.circular(13),
              ),
              child: Icon(
                _darkWelcome
                    ? Icons.dark_mode_rounded
                    : Icons.light_mode_rounded,
                color: _ink,
                size: 22,
              ),
            ),
            const SizedBox(width: 12),
            const Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  BalaghiButtonLabel(
                    'الوضع الداكن لشاشة الدخول',
                    style: TextStyle(
                      color: _ink,
                      fontSize: 15,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                  SizedBox(height: 3),
                  Text(
                    'يغيّر شاشة «المتابعة برقم الهاتف» فقط',
                    style: TextStyle(color: _muted, fontSize: 11),
                  ),
                ],
              ),
            ),
            Switch(
              value: _darkWelcome,
              onChanged: _busy || _savingAppearance ? null : _setDarkWelcome,
              activeThumbColor: _gold,
              activeTrackColor: _ink,
            ),
          ],
        ),
      ),
    ),
  );

  Widget _actionTile({
    required IconData icon,
    required String title,
    required String subtitle,
    required VoidCallback onTap,
  }) => Material(
    color: Colors.white,
    borderRadius: BorderRadius.circular(17),
    child: InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(17),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 15, vertical: 15),
        decoration: BoxDecoration(
          border: Border.all(color: _border),
          borderRadius: BorderRadius.circular(17),
        ),
        child: Row(
          children: [
            Container(
              width: 42,
              height: 42,
              decoration: BoxDecoration(
                color: _gold.withValues(alpha: 0.14),
                borderRadius: BorderRadius.circular(13),
              ),
              child: Icon(icon, color: _ink, size: 22),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  BalaghiButtonLabel(
                    title,
                    style: const TextStyle(
                      color: _ink,
                      fontSize: 15,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                  const SizedBox(height: 3),
                  Text(
                    subtitle,
                    style: const TextStyle(color: _muted, fontSize: 11),
                  ),
                ],
              ),
            ),
            const Icon(Icons.chevron_left_rounded, color: _muted, size: 22),
          ],
        ),
      ),
    ),
  );
}

class _PrivacyScreen extends StatelessWidget {
  const _PrivacyScreen({required this.previewMode});

  /// The design preview keeps its data on the device; only then is it explained.
  final bool previewMode;

  @override
  Widget build(BuildContext context) => Directionality(
    textDirection: TextDirection.rtl,
    child: Scaffold(
      backgroundColor: _background,
      appBar: AppBar(
        backgroundColor: _background,
        centerTitle: true,
        title: const Text(
          'سياسة الخصوصية',
          style: TextStyle(color: _ink, fontWeight: FontWeight.w800),
        ),
        leading: IconButton(
          tooltip: 'رجوع',
          onPressed: () => Navigator.of(context).pop(),
          icon: const Icon(
            Icons.chevron_right_rounded,
            textDirection: TextDirection.ltr,
            color: _ink,
          ),
        ),
      ),
      body: ListView(
        padding: const EdgeInsets.all(22),
        children: [
          const _PrivacySection(
            title: 'بيانات الحساب',
            body:
                'يُستخدم رقم هاتفك للتحقق من الدخول برمز OTP. يُحفظ اسمك ورقم هاتفك في ملف الحساب لربط البلاغات بك.',
          ),
          const _PrivacySection(
            title: 'بيانات البلاغ',
            body:
                'عند إرسال بلاغ، تُحفظ الصورة والتصنيف والوصف والموقع الذي أكدته، وتُزال من الصورة بياناتها المخفية مثل مكان التصوير. يراجع موظف البلدية البلاغ أولًا، وبعد اعتماده تظهر صورته ووصفه وموقعه وحالته على الخريطة العامة.',
          ),
          const _PrivacySection(
            title: 'فحص الصورة آليًا',
            body:
                'بعد الإرسال تُفحص صورة البلاغ آليًا عبر خدمة Claude من شركة Anthropic، لتساعد الموظف في التأكد من نوع المشكلة. تُرسل الصورة وحدها، دون اسمك أو رقم هاتفك أو موقع البلاغ. نتيجة الفحص اقتراح يراه الموظف فقط، والقرار له.',
          ),
          const _PrivacySection(
            title: 'من يرى بياناتك؟',
            body:
                'لا يظهر اسمك أو رقم هاتفك في البلاغ العام، ولا يراهما العامل الميداني الذي ينفّذ الإصلاح. يطّلع عليهما موظفو البلدية المختصون فقط، لمراجعة البلاغ ومتابعته.',
          ),
          if (previewMode)
            const _PrivacySection(
              title: 'وضع المعاينة',
              body:
                  'البلاغات التجريبية في وضع المعاينة لا تُرسل إلى البلدية. تُحفظ بيانات معاينة الدخول محليًا على جهازك ويمكن مسحها بتسجيل الخروج.',
            ),
        ],
      ),
    ),
  );
}

class _PrivacySection extends StatelessWidget {
  const _PrivacySection({required this.title, required this.body});

  final String title;
  final String body;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(bottom: 13),
    child: Container(
      padding: const EdgeInsets.all(17),
      decoration: BoxDecoration(
        color: Colors.white,
        border: Border.all(color: _border),
        borderRadius: BorderRadius.circular(17),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            title,
            style: const TextStyle(
              color: _ink,
              fontWeight: FontWeight.w800,
              fontSize: 15,
            ),
          ),
          const SizedBox(height: 8),
          Text(
            body,
            style: const TextStyle(color: _muted, fontSize: 13, height: 1.55),
          ),
        ],
      ),
    ),
  );
}

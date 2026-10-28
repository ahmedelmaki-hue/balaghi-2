import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import 'app_config.dart';
import 'auth_illustrations.dart';
import 'citizen_auth.dart';
import 'citizen_auth_preview_store.dart';
import 'report_ui.dart';
import 'welcome_appearance_store.dart';

enum CitizenAuthResult { authenticated, preview }

enum _AuthStage { welcome, phone, code, profile }

const _ink = civicWarmInk;
const _muted = Color(0xFF5F7382);
const _border = Color(0xFFE8E4DA);
const _welcomeDark = Color(0xFF0B0F17);
const _welcomeMuted = Color(0xFF94A3B8);

class CitizenAuthScreen extends StatefulWidget {
  const CitizenAuthScreen({super.key});

  @override
  State<CitizenAuthScreen> createState() => _CitizenAuthScreenState();
}

class _CitizenAuthScreenState extends State<CitizenAuthScreen> {
  final _api = CitizenAuthApi(baseUrl: apiBaseUrl);
  final _store = const CitizenAuthStore();
  final _previewStore = const CitizenAuthPreviewStore();
  final _appearanceStore = const WelcomeAppearanceStore();
  final _phoneController = TextEditingController();
  final _codeController = TextEditingController();
  final _firstNameController = TextEditingController();
  final _lastNameController = TextEditingController();
  final _codeFocus = FocusNode();
  Timer? _resendTimer;
  _AuthStage _stage = _AuthStage.welcome;
  CitizenSession? _session;
  String? _phone;
  String? _error;
  bool _busy = false;
  bool _verified = false;
  bool _darkWelcome = false;
  int _resendSeconds = 0;

  bool get _showDarkWelcome => _stage == _AuthStage.welcome && _darkWelcome;

  @override
  void initState() {
    super.initState();
    _loadAppearance();
  }

  Future<void> _loadAppearance() async {
    try {
      final dark = await _appearanceStore.loadDark();
      if (mounted) setState(() => _darkWelcome = dark);
    } catch (_) {
      // Keep the original light design if local preferences are unavailable.
    }
  }

  @override
  void dispose() {
    _resendTimer?.cancel();
    _api.dispose();
    _phoneController.dispose();
    _codeController.dispose();
    _firstNameController.dispose();
    _lastNameController.dispose();
    _codeFocus.dispose();
    super.dispose();
  }

  void _changeStage(_AuthStage stage) {
    FocusManager.instance.primaryFocus?.unfocus();
    setState(() {
      _stage = stage;
      _error = null;
      if (stage == _AuthStage.code) _verified = false;
    });
  }

  void _back() {
    if (_busy) return;
    switch (_stage) {
      case _AuthStage.welcome:
        Navigator.of(context).pop();
        return;
      case _AuthStage.phone:
        _changeStage(_AuthStage.welcome);
        return;
      case _AuthStage.code:
        _changeStage(_AuthStage.phone);
        return;
      case _AuthStage.profile:
        _changeStage(_AuthStage.code);
        return;
    }
  }

  void _startResendTimer() {
    _resendTimer?.cancel();
    setState(() => _resendSeconds = 30);
    _resendTimer = Timer.periodic(const Duration(seconds: 1), (timer) {
      if (!mounted) {
        timer.cancel();
        return;
      }
      if (_resendSeconds <= 1) {
        timer.cancel();
        setState(() => _resendSeconds = 0);
      } else {
        setState(() => _resendSeconds--);
      }
    });
  }

  Future<void> _sendCode() async {
    final phone = normalizeLibyanMobile(_phoneController.text);
    if (phone == null) {
      setState(() => _error = 'رقم ادخال خاطئ');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      if (!authPreviewMode) await _api.sendOtp(phone);
      if (!mounted) return;
      _phone = phone;
      _codeController.clear();
      _verified = false;
      _changeStage(_AuthStage.code);
      _startResendTimer();
    } on AuthFailure catch (error) {
      if (mounted) setState(() => _error = error.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _resendCode() async {
    if (_resendSeconds > 0 || _busy || _phone == null) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      if (!authPreviewMode) await _api.sendOtp(_phone!);
      if (!mounted) return;
      _codeController.clear();
      setState(() => _verified = false);
      _startResendTimer();
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            authPreviewMode ? 'تمت اعادة الارسال' : 'أُعيد إرسال الرمز.',
          ),
        ),
      );
    } on AuthFailure catch (error) {
      if (mounted) setState(() => _error = error.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _verifyCode() async {
    if (_busy) return;
    final code = _codeController.text.trim();
    if (!RegExp(r'^\d{6}$').hasMatch(code)) {
      setState(() => _error = 'أدخل رمز التحقق المكوّن من 6 أرقام.');
      return;
    }
    if (authPreviewMode && code != '123456') {
      setState(() => _error = 'رمز تحقق خاطئ');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      if (authPreviewMode) {
        await _showVerifiedAnimation();
        if (mounted) _changeStage(_AuthStage.profile);
        return;
      }
      final session = await _api.verifyOtp(_phone!, code);
      if (!mounted) return;
      _session = session;
      if (session.needsProfile) {
        await _showVerifiedAnimation();
        if (mounted) _changeStage(_AuthStage.profile);
      } else {
        await _store.save(session);
        await _showVerifiedAnimation();
        if (mounted) Navigator.of(context).pop(CitizenAuthResult.authenticated);
      }
    } on AuthFailure catch (error) {
      if (mounted) setState(() => _error = error.message);
    } catch (_) {
      if (mounted) {
        setState(() => _error = 'تعذر حفظ جلسة الدخول. حاول مجددًا.');
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _showVerifiedAnimation() async {
    if (!mounted) return;
    setState(() => _verified = true);
    await Future<void>.delayed(const Duration(milliseconds: 950));
  }

  Future<void> _completeProfile() async {
    final first = _firstNameController.text.trim();
    final last = _lastNameController.text.trim();
    if (first.isEmpty || last.isEmpty || '$first $last'.length > 100) {
      setState(() => _error = 'أدخل الاسم واللقب بشكل صحيح.');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      if (authPreviewMode) {
        await _previewStore.markCompleted(
          fullName: '$first $last',
          phone: _phone,
        );
        if (mounted) Navigator.of(context).pop(CitizenAuthResult.preview);
        return;
      }
      final completed = await _api.completeProfile(_session!, '$first $last');
      await _store.save(completed);
      if (mounted) Navigator.of(context).pop(CitizenAuthResult.authenticated);
    } on AuthFailure catch (error) {
      if (mounted) setState(() => _error = error.message);
    } catch (_) {
      if (mounted) {
        setState(
          () => _error = authPreviewMode
              ? 'تعذر حفظ معاينة الدخول. حاول مجددًا.'
              : 'تعذر حفظ جلسة الدخول. حاول مجددًا.',
        );
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return PopScope<CitizenAuthResult>(
      canPop: _stage == _AuthStage.welcome && !_busy,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) _back();
      },
      child: AnnotatedRegion<SystemUiOverlayStyle>(
        value: _showDarkWelcome
            ? SystemUiOverlayStyle.light
            : SystemUiOverlayStyle.dark,
        child: Scaffold(
          backgroundColor: _showDarkWelcome
              ? _welcomeDark
              : civicWarmBackground,
          body: Stack(
            children: [
              Positioned.fill(
                child: _showDarkWelcome
                    ? const _DarkWelcomeBackdrop()
                    : const BalaghiWarmBackdrop(),
              ),
              SafeArea(
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(26, 14, 26, 18),
                  child: Column(
                    children: [
                      Expanded(
                        child: LayoutBuilder(
                          builder: (context, constraints) =>
                              SingleChildScrollView(
                                child: ConstrainedBox(
                                  constraints: BoxConstraints(
                                    minHeight: constraints.maxHeight,
                                  ),
                                  child: _stageContent(),
                                ),
                              ),
                        ),
                      ),
                      if (_error != null) ...[
                        const SizedBox(height: 8),
                        Text(
                          _error!,
                          textAlign: TextAlign.center,
                          style: const TextStyle(
                            color: Color(0xFFC93636),
                            fontSize: 13,
                          ),
                        ),
                      ],
                      const SizedBox(height: 12),
                      _primaryButton(),
                      if (_stage == _AuthStage.welcome) ...[
                        const SizedBox(height: 15),
                        Text(
                          'رقم هاتفك يُستخدم للتحقق ولا يظهر على الخريطة العامة',
                          textAlign: TextAlign.center,
                          style: TextStyle(
                            color: _showDarkWelcome ? _welcomeMuted : _muted,
                            fontSize: 11,
                          ),
                        ),
                      ],
                    ],
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _stageContent() => switch (_stage) {
    _AuthStage.welcome => _welcome(),
    _AuthStage.phone => _phonePage(),
    _AuthStage.code => _codePage(),
    _AuthStage.profile => _profilePage(),
  };

  Widget _backButton() => Align(
    alignment: Alignment.centerRight,
    child: BalaghiBackButton(onPressed: _busy ? null : _back),
  );

  Widget _heading(String title, String subtitle) => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      Text(
        title,
        style: const TextStyle(
          color: _ink,
          fontSize: 25,
          fontWeight: FontWeight.w800,
        ),
      ),
      const SizedBox(height: 5),
      Text(subtitle, style: const TextStyle(color: _muted, fontSize: 14)),
    ],
  );

  Widget _welcome() => Column(
    mainAxisAlignment: MainAxisAlignment.spaceAround,
    children: [
      Align(
        alignment: Alignment.centerRight,
        child: !_darkWelcome
            ? BalaghiBackButton(onPressed: _busy ? null : _back)
            : Tooltip(
                message: 'رجوع',
                child: Material(
                  color: const Color(0x1F67BDCA),
                  borderRadius: BorderRadius.circular(16),
                  child: InkWell(
                    onTap: _busy ? null : _back,
                    borderRadius: BorderRadius.circular(16),
                    child: Container(
                      width: 44,
                      height: 44,
                      decoration: BoxDecoration(
                        borderRadius: BorderRadius.circular(16),
                        border: Border.all(color: const Color(0x4067BDCA)),
                      ),
                      child: const Icon(
                        Icons.chevron_right_rounded,
                        textDirection: TextDirection.ltr,
                        size: 25,
                        color: Colors.white,
                      ),
                    ),
                  ),
                ),
              ),
      ),
      Column(
        children: [
          if (_darkWelcome)
            Container(
              width: 108,
              height: 108,
              alignment: Alignment.center,
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(30),
                gradient: const LinearGradient(
                  begin: Alignment.topLeft,
                  end: Alignment.bottomRight,
                  colors: [Color(0x3345B7C8), Color(0x143CA0B4)],
                ),
                border: Border.all(color: const Color(0x5567CAD8)),
                boxShadow: const [
                  BoxShadow(
                    color: Color(0x4444ADBD),
                    blurRadius: 42,
                    spreadRadius: 3,
                  ),
                ],
              ),
              child: const _BrandMark(size: 82),
            )
          else
            const _BrandMark(size: 82),
          const SizedBox(height: 17),
          Text(
            'بلاغي',
            style: TextStyle(
              color: _darkWelcome ? Colors.white : _ink,
              fontSize: 32,
              fontWeight: FontWeight.w900,
            ),
          ),
          Text(
            'بلّغ، تابع، وحلّ',
            style: TextStyle(
              color: _darkWelcome ? _welcomeMuted : const Color(0xFF2B2F2F),
              fontSize: 15,
            ),
          ),
        ],
      ),
      AuthIllustration(
        scene: AuthIllustrationScene.welcome,
        dark: _darkWelcome,
      ),
      Column(
        children: [
          Text(
            'ساهم في تحسين مدينتك',
            textAlign: TextAlign.center,
            style: TextStyle(
              color: _darkWelcome ? Colors.white : _ink,
              fontSize: 23,
              fontWeight: FontWeight.w800,
            ),
          ),
          const SizedBox(height: 8),
          Text(
            'صوّر المشكلة، تابع البلاغات، وشارك\nبخطوة واحدة في كل مرة',
            textAlign: TextAlign.center,
            style: TextStyle(
              color: _darkWelcome ? _welcomeMuted : const Color(0xFF2B2F2F),
              fontSize: 14,
              height: 1.5,
            ),
          ),
        ],
      ),
    ],
  );

  Widget _phonePage() => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      _backButton(),
      const SizedBox(height: 73),
      _heading('رقم هاتفك', 'سنرسل لك رمز تحقق لتأكيد الرقم'),
      const SizedBox(height: 38),
      const Text(
        'رقم الهاتف',
        style: TextStyle(color: Color(0xFF2B3438), fontSize: 13),
      ),
      const SizedBox(height: 9),
      Container(
        height: 59,
        decoration: BoxDecoration(
          color: Colors.white,
          border: Border.all(color: civicTeal, width: 1.1),
          borderRadius: BorderRadius.circular(16),
          boxShadow: const [
            BoxShadow(color: Color(0x14000000), blurRadius: 10),
          ],
        ),
        child: Row(
          children: [
            const Padding(
              padding: EdgeInsets.symmetric(horizontal: 13),
              child: Text('🇱🇾  +218', textDirection: TextDirection.ltr),
            ),
            Container(width: 1, height: 25, color: _border),
            Expanded(
              child: TextField(
                controller: _phoneController,
                textDirection: TextDirection.ltr,
                keyboardType: TextInputType.phone,
                textInputAction: TextInputAction.done,
                inputFormatters: [
                  FilteringTextInputFormatter.digitsOnly,
                  LengthLimitingTextInputFormatter(10),
                ],
                decoration: const InputDecoration(
                  contentPadding: EdgeInsets.symmetric(horizontal: 14),
                  border: InputBorder.none,
                ),
                onSubmitted: (_) => _sendCode(),
              ),
            ),
          ],
        ),
      ),
      if (authPreviewMode) ...[const SizedBox(height: 13)],
      const SizedBox(height: 72),
      const Center(child: AuthIllustration(scene: AuthIllustrationScene.phone)),
    ],
  );

  Widget _codePage() => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      _backButton(),
      const SizedBox(height: 64),
      _heading('رمز التحقق', 'أدخل الرمز المرسل إلى رقمك'),
      const SizedBox(height: 26),
      Center(
        child: Column(
          children: [
            Container(
              width: 66,
              height: 66,
              decoration: BoxDecoration(
                color: civicTeal,
                borderRadius: BorderRadius.circular(19),
              ),
              child: const Icon(
                Icons.phone_iphone_rounded,
                color: Colors.white,
                size: 29,
              ),
            ),
            const SizedBox(height: 9),
            Text(
              _phone ?? '',
              textDirection: TextDirection.ltr,
              style: const TextStyle(color: _ink, fontWeight: FontWeight.w700),
            ),
          ],
        ),
      ),
      const SizedBox(height: 26),
      _otpInput(),
      const SizedBox(height: 14),
      Center(
        child: Wrap(
          alignment: WrapAlignment.center,
          crossAxisAlignment: WrapCrossAlignment.center,
          children: [
            const Text(
              'لم يصلك الرمز؟ ',
              style: TextStyle(color: _muted, fontSize: 12),
            ),
            TextButton(
              onPressed: _resendSeconds == 0 && !_busy ? _resendCode : null,
              child: BalaghiButtonLabel(
                _resendSeconds > 0
                    ? 'إعادة الإرسال خلال 00:${_resendSeconds.toString().padLeft(2, '0')}'
                    : 'إعادة الإرسال',
                style: TextStyle(
                  color: _resendSeconds > 0 ? _muted : civicTeal,
                  fontSize: 12,
                ),
              ),
            ),
          ],
        ),
      ),
      const SizedBox(height: 47),
      Center(child: _VerifiedIllustration(verified: _verified)),
    ],
  );

  Widget _otpInput() => Semantics(
    label: 'رمز التحقق المكوّن من ستة أرقام',
    child: SizedBox(
      height: 58,
      child: Stack(
        children: [
          Directionality(
            textDirection: TextDirection.ltr,
            child: Row(
              children: List.generate(6, (index) {
                final code = _codeController.text;
                final active = index == code.length && code.length < 6;
                return Expanded(
                  child: Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 3),
                    child: Container(
                      alignment: Alignment.center,
                      decoration: BoxDecoration(
                        color: Colors.white,
                        borderRadius: BorderRadius.circular(13),
                        border: Border.all(
                          color: active
                              ? civicWarmGold
                              : index < code.length
                              ? civicTeal
                              : _border,
                          width: active ? 1.5 : 1,
                        ),
                      ),
                      child: Text(
                        index < code.length ? code[index] : '',
                        style: const TextStyle(
                          color: _ink,
                          fontSize: 21,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                    ),
                  ),
                );
              }),
            ),
          ),
          Positioned.fill(
            child: TextField(
              controller: _codeController,
              focusNode: _codeFocus,
              enabled: !_busy,
              keyboardType: TextInputType.number,
              textDirection: TextDirection.ltr,
              autofillHints: const [AutofillHints.oneTimeCode],
              inputFormatters: [
                FilteringTextInputFormatter.digitsOnly,
                LengthLimitingTextInputFormatter(6),
              ],
              style: const TextStyle(color: Colors.transparent),
              showCursor: false,
              decoration: const InputDecoration(
                border: InputBorder.none,
                counterText: '',
              ),
              onChanged: (_) => setState(() => _error = null),
              onSubmitted: (_) => _verifyCode(),
            ),
          ),
        ],
      ),
    ),
  );

  Widget _profilePage() => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      _backButton(),
      const SizedBox(height: 42),
      _heading('أكمل بياناتك', 'اسمك لا يُعرض للعامة على الخريطة'),
      const SizedBox(height: 31),
      _nameField('الاسم', '', _firstNameController),
      const SizedBox(height: 20),
      _nameField('اللقب', '', _lastNameController),
      const SizedBox(height: 64),
      const Center(
        child: AuthIllustration(scene: AuthIllustrationScene.profile),
      ),
      const SizedBox(height: 28),
      Center(
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: List.generate(
            4,
            (index) => Container(
              width: index == 0 ? 21 : 8,
              height: 8,
              margin: const EdgeInsets.symmetric(horizontal: 3),
              decoration: BoxDecoration(
                color: index == 0 ? civicWarmGold : _border,
                borderRadius: BorderRadius.circular(8),
              ),
            ),
          ),
        ),
      ),
    ],
  );

  Widget _nameField(
    String label,
    String hint,
    TextEditingController controller,
  ) => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      Text(label, style: const TextStyle(color: _ink, fontSize: 13)),
      const SizedBox(height: 8),
      TextField(
        controller: controller,
        textDirection: TextDirection.rtl,
        textInputAction: label == 'الاسم'
            ? TextInputAction.next
            : TextInputAction.done,
        maxLength: 50,
        decoration: InputDecoration(
          hintText: hint,
          counterText: '',
          prefixIcon: const Icon(
            Icons.person_outline_rounded,
            color: _muted,
            size: 20,
          ),
          filled: true,
          fillColor: Colors.white,
          enabledBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(15),
            borderSide: const BorderSide(color: _border),
          ),
          focusedBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(15),
            borderSide: const BorderSide(color: civicTeal),
          ),
        ),
        onSubmitted: label == 'اللقب' ? (_) => _completeProfile() : null,
      ),
    ],
  );

  Widget _primaryButton() {
    final label = switch (_stage) {
      _AuthStage.welcome => 'المتابعة برقم الهاتف',
      _AuthStage.phone => 'إرسال الرمز',
      _AuthStage.code => 'تأكيد الرمز',
      _AuthStage.profile => 'ابدأ الآن',
    };
    final action = switch (_stage) {
      _AuthStage.welcome => () => _changeStage(_AuthStage.phone),
      _AuthStage.phone => _sendCode,
      _AuthStage.code => _verifyCode,
      _AuthStage.profile => _completeProfile,
    };
    return BalaghiGoldButton(
      label: label,
      onPressed: _busy ? null : action,
      loading: _busy,
      fontSize: 16,
      textColor: _showDarkWelcome ? _welcomeDark : civicWarmInk,
    );
  }
}

class _DarkWelcomeBackdrop extends StatelessWidget {
  const _DarkWelcomeBackdrop();

  @override
  Widget build(BuildContext context) => IgnorePointer(
    child: Stack(
      children: [
        const Positioned.fill(
          child: DecoratedBox(
            decoration: BoxDecoration(
              gradient: LinearGradient(
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
                colors: [_welcomeDark, Color(0xFF0F172A)],
              ),
            ),
          ),
        ),
        Positioned(
          top: 90,
          left: -100,
          child: Container(
            width: 340,
            height: 340,
            decoration: const BoxDecoration(
              shape: BoxShape.circle,
              gradient: RadialGradient(
                colors: [Color(0x263AABBA), Color(0x003AABBA)],
              ),
            ),
          ),
        ),
        Positioned(
          bottom: 50,
          right: -120,
          child: Container(
            width: 340,
            height: 340,
            decoration: const BoxDecoration(
              shape: BoxShape.circle,
              gradient: RadialGradient(
                colors: [Color(0x1C1E5A79), Color(0x001E5A79)],
              ),
            ),
          ),
        ),
      ],
    ),
  );
}

class _BrandMark extends StatelessWidget {
  const _BrandMark({required this.size});
  final double size;

  @override
  Widget build(BuildContext context) => Image.asset(
    'assets/balaghi_logo.png',
    width: size,
    height: size,
    fit: BoxFit.contain,
    semanticLabel: 'شعار بلاغي',
  );
}

class _VerifiedIllustration extends StatefulWidget {
  const _VerifiedIllustration({required this.verified});

  final bool verified;

  @override
  State<_VerifiedIllustration> createState() => _VerifiedIllustrationState();
}

class _VerifiedIllustrationState extends State<_VerifiedIllustration>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 720),
  );

  @override
  void initState() {
    super.initState();
    if (widget.verified) _controller.forward();
  }

  @override
  void didUpdateWidget(covariant _VerifiedIllustration oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.verified && !oldWidget.verified) {
      _controller.forward(from: 0);
    } else if (!widget.verified && oldWidget.verified) {
      _controller.reset();
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => AnimatedBuilder(
    animation: _controller,
    builder: (context, _) {
      final progress = Curves.easeOutCubic.transform(_controller.value);
      final bounce = Curves.elasticOut.transform(_controller.value);
      return SizedBox(
        width: 150,
        height: 150,
        child: Stack(
          alignment: Alignment.center,
          children: [
            const SizedBox(
              width: 138,
              height: 138,
              child: DecoratedBox(
                decoration: BoxDecoration(
                  color: Color(0xFFECF5F0),
                  shape: BoxShape.circle,
                ),
              ),
            ),
            const Icon(
              Icons.lock_outline_rounded,
              color: Color(0xFF9BB8AF),
              size: 44,
            ),
            if (_controller.value > 0) ...[
              Opacity(
                opacity: (1 - progress).clamp(0.0, 1.0),
                child: Container(
                  width: 85 + 60 * progress,
                  height: 85 + 60 * progress,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    border: Border.all(
                      color: const Color(0xFF70AD83),
                      width: 2,
                    ),
                  ),
                ),
              ),
              Transform.scale(
                scale: 0.5 + 0.5 * bounce,
                child: Semantics(
                  label: 'رمز التحقق صحيح',
                  child: Container(
                    width: 83,
                    height: 83,
                    decoration: const BoxDecoration(
                      color: Color(0xFF70AD83),
                      shape: BoxShape.circle,
                    ),
                    child: Center(
                      child: CustomPaint(
                        size: const Size(53, 53),
                        painter: _CheckPainter(progress: progress),
                      ),
                    ),
                  ),
                ),
              ),
            ],
          ],
        ),
      );
    },
  );
}

class _CheckPainter extends CustomPainter {
  const _CheckPainter({required this.progress});

  final double progress;

  @override
  void paint(Canvas canvas, Size size) {
    final path = Path()
      ..moveTo(size.width * 0.14, size.height * 0.52)
      ..lineTo(size.width * 0.39, size.height * 0.73)
      ..lineTo(size.width * 0.87, size.height * 0.25);
    final metric = path.computeMetrics().first;
    canvas.drawPath(
      metric.extractPath(0, metric.length * progress),
      Paint()
        ..color = Colors.white
        ..strokeWidth = 5
        ..strokeCap = StrokeCap.round
        ..strokeJoin = StrokeJoin.round
        ..style = PaintingStyle.stroke,
    );
  }

  @override
  bool shouldRepaint(covariant _CheckPainter oldDelegate) =>
      oldDelegate.progress != progress;
}

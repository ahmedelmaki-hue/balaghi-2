import 'package:flutter/material.dart';

import 'onboarding_illustrations.dart';
import 'report_ui.dart';

const _darkText = civicWarmInk;
const _mutedText = Color(0xFF5F7382);
const _gold = civicWarmGold;

class OnboardingScreen extends StatefulWidget {
  const OnboardingScreen({super.key, required this.onFinish});

  final Future<void> Function() onFinish;

  @override
  State<OnboardingScreen> createState() => _OnboardingScreenState();
}

class _OnboardingScreenState extends State<OnboardingScreen> {
  final _pageController = PageController();
  int _currentPage = 0;
  bool _finishing = false;

  static const _titles = [
    'صوّر المشكلة',
    'حدد موقع المشكلة',
    'تابع على الخريطة العامة',
    'البلدية تتابع وتحل',
  ];

  static const _descriptions = [
    'صوّر أي مشكلة بنية تحتية تشوفها في طريقك',
    'استخدم موقعك الحالي أو اختر مكان المشكلة على الخريطة',
    'شاهد كل البلاغات وحالاتها على خريطة مشتركة يراها الجميع',
    'تصل البلاغات مباشرة لفريق البلدية المختص لحلها',
  ];

  @override
  void dispose() {
    _pageController.dispose();
    super.dispose();
  }

  Future<void> _finish() async {
    if (_finishing) return;
    setState(() => _finishing = true);
    try {
      await widget.onFinish();
    } finally {
      if (mounted) setState(() => _finishing = false);
    }
  }

  void _next() {
    if (_currentPage == _titles.length - 1) {
      _finish();
    } else {
      _pageController.nextPage(
        duration: const Duration(milliseconds: 280),
        curve: Curves.easeInOut,
      );
    }
  }

  void _previous() {
    if (_currentPage == 0 || _finishing) return;
    _pageController.previousPage(
      duration: const Duration(milliseconds: 280),
      curve: Curves.easeInOut,
    );
  }

  @override
  Widget build(BuildContext context) {
    return Directionality(
      textDirection: TextDirection.rtl,
      child: PopScope(
        canPop: _currentPage == 0,
        onPopInvokedWithResult: (didPop, result) {
          if (!didPop) _previous();
        },
        child: Scaffold(
          backgroundColor: civicWarmBackground,
          body: Stack(
            children: [
              const Positioned.fill(child: BalaghiWarmBackdrop()),
              SafeArea(
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(24, 16, 24, 24),
                  child: Column(
                    children: [
                      SizedBox(
                        height: 48,
                        child: Align(
                          alignment: AlignmentDirectional.centerStart,
                          child: _currentPage > 0
                              ? BalaghiBackButton(
                                  onPressed: _finishing ? null : _previous,
                                )
                              : const SizedBox.shrink(),
                        ),
                      ),
                      Expanded(
                        child: Directionality(
                          textDirection: TextDirection.rtl,
                          child: PageView.builder(
                            controller: _pageController,
                            itemCount: _titles.length,
                            onPageChanged: (page) =>
                                setState(() => _currentPage = page),
                            itemBuilder: (context, page) => Directionality(
                              textDirection: TextDirection.rtl,
                              child: _OnboardingPage(
                                title: _titles[page],
                                description: _descriptions[page],
                                illustration: OnboardingIllustration(
                                  page: page,
                                ),
                              ),
                            ),
                          ),
                        ),
                      ),
                      const SizedBox(height: 18),
                      Row(
                        mainAxisAlignment: MainAxisAlignment.center,
                        textDirection: TextDirection.rtl,
                        children: List.generate(_titles.length, (index) {
                          final active = index == _currentPage;
                          return AnimatedContainer(
                            duration: const Duration(milliseconds: 220),
                            margin: const EdgeInsets.symmetric(horizontal: 5),
                            width: active ? 27 : 9,
                            height: 9,
                            decoration: BoxDecoration(
                              color: active ? _gold : const Color(0xFFDDE2E8),
                              borderRadius: BorderRadius.circular(10),
                            ),
                          );
                        }),
                      ),
                      const SizedBox(height: 18),
                      BalaghiGoldButton(
                        label: _currentPage == _titles.length - 1
                            ? 'ابدأ الآن'
                            : 'التالي',
                        onPressed: _finishing ? null : _next,
                        loading: _finishing,
                        fontSize: 18,
                      ),
                      const SizedBox(height: 8),
                      SizedBox(
                        height: 48,
                        child: _currentPage < _titles.length - 1
                            ? TextButton(
                                onPressed: _finishing ? null : _finish,
                                style: TextButton.styleFrom(
                                  foregroundColor: _mutedText,
                                  textStyle: const TextStyle(fontSize: 15),
                                ),
                                child: const BalaghiButtonLabel('تخطي'),
                              )
                            : const SizedBox.shrink(),
                      ),
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
}

class _OnboardingPage extends StatelessWidget {
  const _OnboardingPage({
    required this.title,
    required this.description,
    required this.illustration,
  });

  final String title;
  final String description;
  final Widget illustration;

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        Expanded(child: illustration),
        Padding(
          padding: const EdgeInsets.only(bottom: 24),
          child: Column(
            children: [
              Text(
                title,
                textAlign: TextAlign.center,
                style: const TextStyle(
                  color: _darkText,
                  fontSize: 25,
                  fontWeight: FontWeight.w800,
                  height: 1.4,
                ),
              ),
              const SizedBox(height: 9),
              Text(
                description,
                textAlign: TextAlign.center,
                style: const TextStyle(
                  color: _mutedText,
                  fontSize: 16,
                  height: 1.7,
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }
}

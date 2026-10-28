import 'package:balaghi/onboarding_screen.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  testWidgets('next opens all four pages and start finishes onboarding', (
    tester,
  ) async {
    var completions = 0;
    await tester.pumpWidget(
      MaterialApp(home: OnboardingScreen(onFinish: () async => completions++)),
    );

    expect(find.text('صوّر المشكلة'), findsOneWidget);
    await tester.tap(find.text('التالي'));
    await tester.pumpAndSettle();
    expect(find.text('حدد موقع المشكلة'), findsOneWidget);

    await tester.tap(find.text('التالي'));
    await tester.pumpAndSettle();
    expect(find.text('تابع على الخريطة العامة'), findsOneWidget);

    await tester.tap(find.text('التالي'));
    await tester.pumpAndSettle();
    expect(find.text('البلدية تتابع وتحل'), findsOneWidget);
    expect(find.text('تخطي'), findsNothing);
    await tester.tap(find.text('ابدأ الآن'));
    await tester.pumpAndSettle();
    expect(completions, 1);
  });

  testWidgets('skip finishes onboarding from the first page', (tester) async {
    var completions = 0;
    await tester.pumpWidget(
      MaterialApp(home: OnboardingScreen(onFinish: () async => completions++)),
    );

    await tester.tap(find.text('تخطي'));
    await tester.pumpAndSettle();
    expect(completions, 1);
  });

  testWidgets('back returns to the previous welcome page', (tester) async {
    await tester.pumpWidget(
      MaterialApp(home: OnboardingScreen(onFinish: () async {})),
    );

    expect(find.text('رجوع'), findsNothing);
    expect(find.byTooltip('رجوع'), findsNothing);
    expect(
      tester.getTopLeft(find.text('تخطي')).dy,
      greaterThan(tester.getTopLeft(find.text('التالي')).dy),
    );
    await tester.tap(find.text('التالي'));
    await tester.pumpAndSettle();
    expect(find.text('رجوع'), findsNothing);
    expect(find.byTooltip('رجوع'), findsOneWidget);
    expect(find.byIcon(Icons.chevron_right_rounded), findsOneWidget);
    expect(
      tester.getCenter(find.byTooltip('رجوع')).dx,
      greaterThan(tester.getSize(find.byType(OnboardingScreen)).width / 2),
    );

    await tester.tap(find.byTooltip('رجوع'));
    await tester.pumpAndSettle();
    expect(find.text('صوّر المشكلة'), findsOneWidget);
    expect(find.byTooltip('رجوع'), findsNothing);
  });

  testWidgets('Arabic swipe moves right to next and left to previous', (
    tester,
  ) async {
    await tester.pumpWidget(
      MaterialApp(home: OnboardingScreen(onFinish: () async {})),
    );

    await tester.drag(find.byType(PageView), const Offset(500, 0));
    await tester.pumpAndSettle();
    expect(find.text('حدد موقع المشكلة'), findsOneWidget);

    await tester.drag(find.byType(PageView), const Offset(-500, 0));
    await tester.pumpAndSettle();
    expect(find.text('صوّر المشكلة'), findsOneWidget);
  });

  testWidgets('system back returns to the previous welcome page', (
    tester,
  ) async {
    await tester.pumpWidget(
      MaterialApp(home: OnboardingScreen(onFinish: () async {})),
    );

    await tester.tap(find.text('التالي'));
    await tester.pumpAndSettle();
    await tester.binding.handlePopRoute();
    await tester.pumpAndSettle();
    expect(find.text('صوّر المشكلة'), findsOneWidget);
  });

  testWidgets('illustrations and controls fit a compact phone', (tester) async {
    tester.view.physicalSize = const Size(360, 640);
    tester.view.devicePixelRatio = 1;
    addTearDown(() {
      tester.view.resetPhysicalSize();
      tester.view.resetDevicePixelRatio();
    });

    await tester.pumpWidget(
      MaterialApp(home: OnboardingScreen(onFinish: () async {})),
    );
    for (var page = 0; page < 4; page++) {
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
      if (page < 3) {
        expect(find.text('تخطي'), findsOneWidget);
        await tester.tap(find.text('التالي'));
      } else {
        expect(find.text('ابدأ الآن'), findsOneWidget);
      }
    }
  });
}

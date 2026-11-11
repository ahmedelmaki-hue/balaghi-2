import 'dart:convert';

import 'package:balaghi/account_screen.dart';
import 'package:balaghi/citizen_auth.dart';
import 'package:balaghi/citizen_auth_preview_store.dart';
import 'package:balaghi/welcome_appearance_store.dart';
import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:package_info_plus/package_info_plus.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  testWidgets('preview account shows profile, edits name, and signs out', (
    tester,
  ) async {
    SharedPreferences.setMockInitialValues({});
    final store = CitizenAuthPreviewStore();
    await store.markCompleted(fullName: 'أحمد المكي', phone: '+218912345678');
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1;
    addTearDown(() {
      tester.view.resetPhysicalSize();
      tester.view.resetDevicePixelRatio();
    });

    await tester.pumpWidget(
      MaterialApp(
        home: Builder(
          builder: (context) => Scaffold(
            body: TextButton(
              onPressed: () => Navigator.of(context).push<bool>(
                MaterialPageRoute(
                  builder: (_) => const AccountScreen(previewMode: true),
                ),
              ),
              child: const Text('فتح الحساب'),
            ),
          ),
        ),
      ),
    );
    await tester.tap(find.text('فتح الحساب'));
    await tester.pumpAndSettle();
    expect(find.text('أحمد المكي'), findsOneWidget);
    expect(find.text('+218912345678'), findsOneWidget);
    expect(find.text('وضع المعاينة'), findsOneWidget);
    await tester.tap(find.text('تعديل الاسم'));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextFormField), 'أحمد لؤي المكي');
    await tester.tap(find.text('حفظ'));
    await tester.pumpAndSettle();
    expect(find.text('أحمد لؤي المكي'), findsOneWidget);
    expect((await store.loadProfile()).fullName, 'أحمد لؤي المكي');

    const appearance = WelcomeAppearanceStore();
    expect(await appearance.loadDark(), isFalse);
    await tester.scrollUntilVisible(
      find.text('الوضع الداكن لشاشة الدخول'),
      300,
      scrollable: find.byType(Scrollable).last,
    );
    await tester.tap(find.text('الوضع الداكن لشاشة الدخول'));
    await tester.pumpAndSettle();
    expect(await appearance.loadDark(), isTrue);

    tester.testTextInput.hide();
    await tester.pump(const Duration(seconds: 5));
    await tester.pumpAndSettle();
    await tester.scrollUntilVisible(
      find.text('تسجيل الخروج'),
      300,
      scrollable: find.byType(Scrollable).last,
    );
    await tester.pumpAndSettle();
    await tester.tap(find.text('تسجيل الخروج'));
    await tester.pumpAndSettle();
    expect(find.text('فتح الحساب'), findsOneWidget);
    expect(await store.isCompleted(), isFalse);
    expect((await store.loadProfile()).phone, isNull);
    expect(await appearance.loadDark(), isTrue);
    expect(tester.takeException(), isNull);
  });

  testWidgets(
    'the version comes from the app; the privacy policy explains the photo check, without preview notes',
    (tester) async {
      SharedPreferences.setMockInitialValues({});
      FlutterSecureStorage.setMockInitialValues({
        'citizen_session': jsonEncode(
          CitizenSession(
            accessToken: 'access',
            refreshToken: 'refresh',
            phone: '+218912345678',
            fullName: 'أحمد المكي',
            expiresAt: DateTime.now().add(const Duration(hours: 1)),
          ).toJson(),
        ),
      });
      tester.view.physicalSize = const Size(390, 844);
      tester.view.devicePixelRatio = 1;
      addTearDown(() {
        tester.view.resetPhysicalSize();
        tester.view.resetDevicePixelRatio();
      });

      PackageInfo.setMockInitialValues(
        appName: 'بلاغي',
        packageName: 'com.example.balaghi',
        version: '1.2.3',
        buildNumber: '4',
        buildSignature: '',
      );
      await tester.pumpWidget(
        const MaterialApp(home: AccountScreen(previewMode: false)),
      );
      await tester.pumpAndSettle();
      await tester.scrollUntilVisible(
        find.text('بلاغي  •  الإصدار 1.2.3'),
        300,
        scrollable: find.byType(Scrollable).last,
      );
      expect(
        find.text('بلاغي  •  الإصدار 1.2.3'),
        findsOneWidget,
        reason: 'the version comes from the installed app, not a fixed text',
      );
      await tester.scrollUntilVisible(
        find.text('سياسة الخصوصية'),
        300,
        scrollable: find.byType(Scrollable).last,
      );
      await tester.tap(find.text('سياسة الخصوصية'));
      await tester.pumpAndSettle();

      expect(find.text('فحص الصورة آليًا'), findsOneWidget);
      expect(find.textContaining('Anthropic'), findsOneWidget);
      expect(find.textContaining('بعد اعتماده'), findsOneWidget);
      expect(find.text('وضع المعاينة'), findsNothing);
      expect(tester.takeException(), isNull);
    },
  );
}

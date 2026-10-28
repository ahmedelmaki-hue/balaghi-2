import 'package:balaghi/auth_illustrations.dart';
import 'package:balaghi/citizen_auth_screen.dart';
import 'package:balaghi/citizen_auth_preview_store.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  testWidgets('welcome has a back button and invalid OTP shows the error', (
    tester,
  ) async {
    SharedPreferences.setMockInitialValues({});
    const previewStore = CitizenAuthPreviewStore();
    expect(await previewStore.isCompleted(), isFalse);
    final semantics = tester.ensureSemantics();
    await tester.pumpWidget(
      MaterialApp(
        home: Builder(
          builder: (context) => Scaffold(
            body: TextButton(
              onPressed: () => Navigator.of(context).push(
                MaterialPageRoute<void>(
                  builder: (_) => const CitizenAuthScreen(),
                ),
              ),
              child: const Text('open'),
            ),
          ),
        ),
      ),
    );

    await tester.tap(find.text('open'));
    await tester.pumpAndSettle();
    expect(
      find.byWidgetPredicate(
        (widget) =>
            widget is AuthIllustration &&
            widget.scene == AuthIllustrationScene.welcome,
      ),
      findsOneWidget,
    );
    expect(find.byTooltip('رجوع'), findsOneWidget);
    expect(find.byIcon(Icons.chevron_right_rounded), findsOneWidget);
    expect(
      tester.getCenter(find.byTooltip('رجوع')).dx,
      greaterThan(tester.getSize(find.byType(CitizenAuthScreen)).width / 2),
    );
    await tester.tap(find.byTooltip('رجوع'));
    await tester.pumpAndSettle();
    expect(find.text('open'), findsOneWidget);

    await tester.tap(find.text('open'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('المتابعة برقم الهاتف'));
    await tester.pump();
    expect(find.byIcon(Icons.chevron_right_rounded), findsOneWidget);
    expect(
      find.byWidgetPredicate(
        (widget) =>
            widget is AuthIllustration &&
            widget.scene == AuthIllustrationScene.phone,
      ),
      findsOneWidget,
    );
    await tester.enterText(find.byType(TextField), '0912345678');
    await tester.tap(find.text('إرسال الرمز'));
    await tester.pump();
    expect(find.byIcon(Icons.chevron_right_rounded), findsOneWidget);
    expect(find.byType(AuthIllustration), findsNothing);
    expect(find.text('رمز المعاينة: 123456'), findsNothing);

    await tester.enterText(find.byType(TextField), '111111');
    await tester.tap(find.text('تأكيد الرمز'));
    await tester.pump();
    expect(find.text('رمز تحقق خاطئ'), findsOneWidget);

    await tester.enterText(find.byType(TextField), '123456');
    await tester.tap(find.text('تأكيد الرمز'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 350));
    expect(
      find.byWidgetPredicate(
        (widget) =>
            widget is Semantics && widget.properties.label == 'رمز التحقق صحيح',
      ),
      findsOneWidget,
    );
    await tester.pump(const Duration(milliseconds: 650));
    await tester.pump(const Duration(milliseconds: 100));
    expect(find.text('أكمل بياناتك'), findsOneWidget);
    expect(find.byIcon(Icons.chevron_right_rounded), findsOneWidget);
    expect(
      find.byWidgetPredicate(
        (widget) =>
            widget is AuthIllustration &&
            widget.scene == AuthIllustrationScene.profile,
      ),
      findsOneWidget,
    );
    await tester.enterText(find.byType(TextField).at(0), 'أحمد');
    await tester.enterText(find.byType(TextField).at(1), 'المكي');
    await tester.tap(find.text('ابدأ الآن'));
    await tester.pumpAndSettle();
    expect(find.text('أدخل الاسم واللقب بشكل صحيح.'), findsNothing);
    expect(find.text('تعذر حفظ جلسة الدخول. حاول مجددًا.'), findsNothing);
    expect(find.text('open'), findsOneWidget);
    expect(await previewStore.isCompleted(), isTrue);
    semantics.dispose();
  });
}

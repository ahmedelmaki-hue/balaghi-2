import 'dart:convert';

import 'package:balaghi/create_report_screen.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:image_picker_platform_interface/image_picker_platform_interface.dart';

// A photo Android hands back when it restarted the app during capture: the
// screen opens with a photo already taken, without opening the camera.
class _PickerWithLostPhoto extends ImagePickerPlatform {
  @override
  Future<LostDataResponse> getLostData() async => LostDataResponse(
    files: [
      XFile.fromData(
        base64Decode(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
        ),
      ),
    ],
    type: RetrieveType.image,
  );
}

void main() {
  testWidgets(
    'the phone back button goes one step back and asks before dropping a photo',
    (tester) async {
      ImagePickerPlatform.instance = _PickerWithLostPhoto();
      // Wider than a phone: widget tests draw text in a test font, wider than Cairo.
      tester.view.physicalSize = const Size(480, 900);
      tester.view.devicePixelRatio = 1;
      addTearDown(() {
        tester.view.resetPhysicalSize();
        tester.view.resetDevicePixelRatio();
      });
      bool? result;
      await tester.pumpWidget(
        MaterialApp(
          home: Builder(
            builder: (context) => Scaffold(
              body: TextButton(
                onPressed: () async {
                  result = await Navigator.of(context).push<bool>(
                    MaterialPageRoute(
                      builder: (_) =>
                          const CreateReportScreen(previewMode: true),
                    ),
                  );
                },
                child: const Text('بلاغ جديد'),
              ),
            ),
          ),
        ),
      );
      Future<void> settle() => tester.pump(const Duration(milliseconds: 600));
      Future<void> phoneBack() async {
        await tester.binding.handlePopRoute();
        await settle();
      }

      await tester.tap(find.text('بلاغ جديد'));
      await settle();
      await settle();
      expect(find.text('صوّر المشكلة'), findsOneWidget);

      // With a photo taken, the next step opens; back returns to the photo.
      await tester.tap(find.text('التالي'));
      await settle();
      expect(find.text('تفاصيل البلاغ'), findsOneWidget);
      await phoneBack();
      expect(find.text('صوّر المشكلة'), findsOneWidget);
      expect(find.text('تجاهل هذا البلاغ؟'), findsNothing);

      // Leaving would drop the photo, so the citizen is asked first.
      await phoneBack();
      expect(find.text('تجاهل هذا البلاغ؟'), findsOneWidget);
      await tester.tap(find.text('متابعة البلاغ'));
      await settle();
      expect(find.text('صوّر المشكلة'), findsOneWidget);

      await phoneBack();
      await tester.tap(find.text('تجاهل البلاغ'));
      await settle();
      await settle();
      expect(find.byType(CreateReportScreen), findsNothing);
      expect(result, isFalse);
    },
  );
}

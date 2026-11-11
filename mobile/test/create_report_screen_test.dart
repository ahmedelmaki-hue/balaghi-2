import 'dart:convert';
import 'dart:typed_data';
import 'dart:ui' as ui;

import 'package:balaghi/create_report_screen.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:image_picker_platform_interface/image_picker_platform_interface.dart';

// A photo Android hands back when it restarted the app during capture: the
// screen opens with a photo already taken, without opening the camera.
class _PickerWithLostPhoto extends ImagePickerPlatform {
  _PickerWithLostPhoto([Uint8List? photo])
    : photo =
          photo ??
          base64Decode(
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
          );

  final Uint8List photo;

  @override
  Future<LostDataResponse> getLostData() async => LostDataResponse(
    files: [XFile.fromData(photo)],
    type: RetrieveType.image,
  );
}

/// A plain grey PNG, for photos of a known brightness.
Future<Uint8List> greyPng(int grey) async {
  const width = 48, height = 36;
  final rgba = Uint8List(width * height * 4);
  for (var i = 0; i < rgba.length; i += 4) {
    rgba
      ..[i] = grey
      ..[i + 1] = grey
      ..[i + 2] = grey
      ..[i + 3] = 255;
  }
  final buffer = await ui.ImmutableBuffer.fromUint8List(rgba);
  final codec = await ui.ImageDescriptor.raw(
    buffer,
    width: width,
    height: height,
    pixelFormat: ui.PixelFormat.rgba8888,
  ).instantiateCodec();
  final image = (await codec.getNextFrame()).image;
  final png = await image.toByteData(format: ui.ImageByteFormat.png);
  return png!.buffer.asUint8List();
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

  Future<void> openWithPhoto(WidgetTester tester, int grey) async {
    final photo = (await tester.runAsync(() => greyPng(grey)))!;
    ImagePickerPlatform.instance = _PickerWithLostPhoto(photo);
    tester.view.physicalSize = const Size(480, 900);
    tester.view.devicePixelRatio = 1;
    addTearDown(() {
      tester.view.resetPhysicalSize();
      tester.view.resetDevicePixelRatio();
    });
    await tester.pumpWidget(
      const MaterialApp(home: CreateReportScreen(previewMode: true)),
    );
    // Decoding the photo to measure it runs outside the test's fake clock.
    for (var i = 0; i < 6; i++) {
      await tester.runAsync(
        () => Future<void>.delayed(const Duration(milliseconds: 100)),
      );
      await tester.pump(const Duration(milliseconds: 100));
    }
  }

  testWidgets(
    'a photo taken in near darkness gets a warning the citizen can dismiss',
    (tester) async {
      await openWithPhoto(tester, 15);
      expect(find.text('الصورة مظلمة'), findsOneWidget);

      await tester.tap(find.text('استخدامها كما هي'));
      await tester.pump(const Duration(milliseconds: 300));
      expect(find.text('الصورة مظلمة'), findsNothing);

      // The warning never blocks the report: the next step opens.
      await tester.tap(find.text('التالي'));
      await tester.pump(const Duration(milliseconds: 600));
      expect(find.text('تفاصيل البلاغ'), findsOneWidget);
    },
  );

  testWidgets('a photo with enough light gets no warning', (tester) async {
    await openWithPhoto(tester, 150);
    expect(find.text('الصورة مظلمة'), findsNothing);
    expect(
      find.text('التقط صورة مباشرة بالكاميرا وتأكد من ظهور المشكلة كاملة.'),
      findsOneWidget,
    );
  });
}

import React, { useEffect, useRef, useState } from 'react';
import { Camera, RefreshCw } from 'lucide-react';

export default function CompletionCamera({ onCapture }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const mountedRef = useRef(true);
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let active = true;
    mountedRef.current = true;
    setReady(false);
    setError('');
    if (!navigator.mediaDevices?.getUserMedia) {
      setError('الكاميرا غير متاحة هنا. افتح الصفحة عبر HTTPS أو localhost واسمح باستخدام الكاميرا.');
      return undefined;
    }
    navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false })
      .then((stream) => {
        if (!active) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play().catch(() => setError('تعذّر تشغيل معاينة الكاميرا.'));
        }
      })
      .catch(() => { if (active) setError('تعذّر فتح الكاميرا. تحقق من الإذن ثم أعد المحاولة.'); });
    return () => {
      active = false;
      mountedRef.current = false;
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    };
  }, [retry]);

  const capture = () => {
    const video = videoRef.current;
    if (!video?.videoWidth || !video.videoHeight) return;
    const scale = Math.min(1, 1600 / Math.max(video.videoWidth, video.videoHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob((blob) => {
      if (!mountedRef.current) return;
      if (blob) onCapture(new File([blob], 'after-repair.jpg', { type: 'image/jpeg' }));
      else setError('تعذّر التقاط الصورة. حاول مرة أخرى.');
    }, 'image/jpeg', 0.84);
  };

  return <div className="completion-camera">
    <div className="completion-camera-view"><video ref={videoRef} autoPlay muted playsInline
      onLoadedMetadata={() => setReady(true)} aria-label="معاينة الكاميرا لتصوير الإصلاح" />
      {!ready && !error && <span>جارٍ فتح الكاميرا...</span>}
    </div>
    {error && <p className="completion-camera-error" role="alert">{error}</p>}
    <div className="completion-camera-actions">
      <button type="button" className="button button-gold" disabled={!ready} onClick={capture}>
        <Camera size={17} />التقاط صورة بعد الإصلاح
      </button>
      {error && <button type="button" className="button button-quiet" onClick={() => setRetry((value) => value + 1)}><RefreshCw size={16} />إعادة المحاولة</button>}
    </div>
  </div>;
}
